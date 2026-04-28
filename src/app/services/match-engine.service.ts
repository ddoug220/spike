import { Injectable } from '@angular/core';
import { GameEvent } from '../models/firestore.models';
import { MatchScoreState, MatchStateService } from './match-state.service';
import { MatchStatsService, SetStatsState, StatsAction, StatsState } from './match-stats.service';
import { OfflineSyncService } from './offline-sync.service';
import { RosterPlayer, TeamRosterService } from './team-roster.service';

type PointSide = 'team' | 'opponent';

export interface StartMatchOptions {
  opponentName?: string;
}

type EngineEvent =
  | {
      kind: 'player-action';
      eventId: string;
      action: StatsAction;
      playerId: string | null;
      impactedScore: boolean;
      impactedStats: boolean;
      rotatedClockwise: boolean;
    }
  | {
      kind: 'opponent-point';
      eventId: string;
      impactedScore: boolean;
      impactedStats: boolean;
      rotatedClockwise: false;
    }
  | {
      kind: 'manual-rotation';
      eventId: string;
      impactedScore: true;
      impactedStats: false;
      rotatedClockwise: true;
    }
  | {
      kind: 'substitution';
      eventId: string;
      outPlayerId: string;
      inPlayerId: string;
      impactedScore: false;
      impactedStats: false;
      rotatedClockwise: false;
    }
  | {
      kind: 'timeout';
      eventId: string;
      timeoutTeam: PointSide;
      impactedScore: true;
      impactedStats: false;
      rotatedClockwise: false;
    };

@Injectable({
  providedIn: 'root',
})
export class MatchEngineService {
  private teamServeAttemptTrackedThisRally = false;
  private boxScoreQueuedForMatchId: string | null = null;
  private matchEndedEventQueuedForMatchId: string | null = null;
  private matchStartedAtByMatchId = new Map<string, string>();
  private opponentNameByMatchId = new Map<string, string>();
  private undoStack: EngineEvent[] = [];

  constructor(
    private readonly matchState: MatchStateService,
    private readonly matchStats: MatchStatsService,
    private readonly teamRoster: TeamRosterService,
    private readonly offlineSync: OfflineSyncService,
  ) {}

  startMatch(initialServe: PointSide = 'team', options: StartMatchOptions = {}): string {
    const matchId = this.offlineSync.startNewMatch();
    const createdAt = new Date().toISOString();
    const opponentName = this.normalizeOpponentName(options.opponentName);
    this.matchState.resetMatch();
    this.matchState.setServingTeam(initialServe);
    this.matchStats.resetMatch();
    this.undoStack = [];
    this.teamServeAttemptTrackedThisRally = false;
    this.boxScoreQueuedForMatchId = null;
    this.matchEndedEventQueuedForMatchId = null;
    this.matchStartedAtByMatchId.set(matchId, createdAt);
    this.opponentNameByMatchId.set(matchId, opponentName);

    this.queueGameSnapshot(matchId, 'live', createdAt);
    this.offlineSync.logEvent({
      id: this.createEventId('evt'),
      gameId: matchId,
      type: 'matchStarted',
      action: 'match-started',
      ...this.gameEventStateFields(),
      servingTeam: initialServe,
      lineup: this.teamRoster.getLineupSnapshot(),
      createdAt,
      isDeleted: false,
    });

    return matchId;
  }

  endMatch(): void {
    const matchId = this.offlineSync.getActiveMatchId();
    if (this.matchEndedEventQueuedForMatchId === matchId) {
      return;
    }

    this.matchState.endMatch();
    const createdAt = new Date().toISOString();
    this.queueGameSnapshot(matchId, 'final', createdAt);
    this.offlineSync.logEvent({
      id: this.createEventId('evt'),
      gameId: matchId,
      type: 'matchEnded',
      action: 'match-ended',
      ...this.gameEventStateFields(),
      teamSets: this.matchState.state().teamSets,
      opponentSets: this.matchState.state().opponentSets,
      createdAt,
      isDeleted: false,
    });
    this.queuePlayerStats(matchId);
    this.matchEndedEventQueuedForMatchId = matchId;
  }

  setServingTeam(team: PointSide): void {
    if (this.matchState.state().isMatchOver) {
      return;
    }

    this.matchState.setServingTeam(team);
    this.teamServeAttemptTrackedThisRally = false;
    this.queueGameSnapshot(this.offlineSync.getActiveMatchId(), 'live');
    this.offlineSync.logEvent({
      id: this.createEventId('evt'),
      gameId: this.offlineSync.getActiveMatchId(),
      type: 'serveTeamSet',
      action: 'serve-team-set',
      ...this.gameEventStateFields(),
      servingTeam: team,
      createdAt: new Date().toISOString(),
      isDeleted: false,
    });
  }

  recordPlayerAction(rotationPosition: number, action: StatsAction): EngineEvent {
    if (this.matchState.state().isMatchOver) {
      return {
        kind: 'player-action',
        eventId: this.createEventId('evt'),
        action,
        playerId: this.getPlayerAtRotation(rotationPosition)?.id ?? null,
        impactedScore: false,
        impactedStats: false,
        rotatedClockwise: false,
      };
    }

    const matchId = this.offlineSync.getActiveMatchId();
    const servingTeamBefore = this.matchState.state().servingTeam;
    const currentSetBefore = this.matchState.state().currentSet;
    const wasReceiving = servingTeamBefore === 'opponent';
    const isTeamPointFromOpponentError = action === 'opponent-error';
    const selectedPlayer = isTeamPointFromOpponentError ? null : this.getPlayerAtRotation(rotationPosition);
    const serverPlayer = this.getPlayerAtRotation(1);

    let inferredServeInServerPlayerId: string | undefined;
    if (
      servingTeamBefore === 'team' &&
      !this.teamServeAttemptTrackedThisRally &&
      action !== 'ace' &&
      action !== 'service-error'
    ) {
      inferredServeInServerPlayerId = serverPlayer?.id ?? undefined;
      if (inferredServeInServerPlayerId) {
        this.teamServeAttemptTrackedThisRally = true;
      }
    } else if (
      servingTeamBefore === 'team' &&
      !this.teamServeAttemptTrackedThisRally &&
      (action === 'ace' || action === 'service-error')
    ) {
      this.teamServeAttemptTrackedThisRally = true;
    }

    const scoreResult = this.applyScoreForAction(action);
    let impactedStats = false;
    if (selectedPlayer) {
      this.matchStats.recordPlayerAction(selectedPlayer.id, action, {
        wasReceiving,
        sideOutWon: scoreResult.sideOutWon,
        inferredServeInServerPlayerId,
        currentSet: currentSetBefore,
      });
      impactedStats = true;
    } else if (inferredServeInServerPlayerId) {
      this.matchStats.recordInferredServeIn(inferredServeInServerPlayerId);
      impactedStats = true;
    }

    if (scoreResult.impactedScore) {
      this.teamServeAttemptTrackedThisRally = false;
    }
    this.queueGameSnapshot(matchId, this.matchState.state().isMatchOver ? 'final' : 'live');

    const event: EngineEvent = {
      kind: 'player-action',
      eventId: this.createEventId('evt'),
      action,
      playerId: selectedPlayer?.id ?? null,
      impactedScore: scoreResult.impactedScore,
      impactedStats,
      rotatedClockwise: scoreResult.rotatedClockwise,
    };
    this.undoStack.push(event);

    this.offlineSync.logEvent({
      id: event.eventId,
      gameId: matchId,
      type: 'playerAction',
      action,
      ...this.gameEventStateFields(),
      rotationPosition,
      playerId: selectedPlayer?.id ?? null,
      wasReceiving,
      sideOutWon: scoreResult.sideOutWon,
      inferredServeInServerPlayerId,
      actionSetNumber: currentSetBefore,
      teamPoints: this.matchState.state().teamPoints,
      opponentPoints: this.matchState.state().opponentPoints,
      teamSets: this.matchState.state().teamSets,
      opponentSets: this.matchState.state().opponentSets,
      createdAt: new Date().toISOString(),
      isDeleted: false,
    });

    if (scoreResult.matchEnded) {
      this.queuePlayerStats(matchId);
    }

    return event;
  }

  recordOpponentPoint(): EngineEvent {
    if (this.matchState.state().isMatchOver) {
      return {
        kind: 'opponent-point',
        eventId: this.createEventId('evt'),
        impactedScore: false,
        impactedStats: false,
        rotatedClockwise: false,
      };
    }

    const matchId = this.offlineSync.getActiveMatchId();
    const servingTeamBefore = this.matchState.state().servingTeam;
    let impactedStats = false;
    if (servingTeamBefore === 'team' && !this.teamServeAttemptTrackedThisRally) {
      const serverPlayerId = this.getPlayerAtRotation(1)?.id;
      if (serverPlayerId) {
        this.matchStats.recordInferredServeIn(serverPlayerId);
        impactedStats = true;
        this.teamServeAttemptTrackedThisRally = true;
      }
    }

    const result = this.matchState.recordOpponentPoint();
    this.teamServeAttemptTrackedThisRally = false;
    this.queueGameSnapshot(matchId, this.matchState.state().isMatchOver ? 'final' : 'live');

    const event: EngineEvent = {
      kind: 'opponent-point',
      eventId: this.createEventId('evt'),
      impactedScore: true,
      impactedStats,
      rotatedClockwise: false,
    };
    this.undoStack.push(event);

    this.offlineSync.logEvent({
      id: event.eventId,
      gameId: matchId,
      type: 'opponentPoint',
      action: 'opponent-point',
      ...this.gameEventStateFields(),
      teamPoints: this.matchState.state().teamPoints,
      opponentPoints: this.matchState.state().opponentPoints,
      teamSets: this.matchState.state().teamSets,
      opponentSets: this.matchState.state().opponentSets,
      createdAt: new Date().toISOString(),
      isDeleted: false,
    });

    if (result.matchEnded) {
      this.queuePlayerStats(matchId);
    }

    return event;
  }

  recordSubstitution(outPlayerId: string, inPlayerId: string): boolean {
    if (this.matchState.state().isMatchOver) {
      return false;
    }

    const didSubstitute = this.teamRoster.substitutePlayers(outPlayerId, inPlayerId);
    if (!didSubstitute) {
      return false;
    }

    const eventId = this.createEventId('evt');
    const event: EngineEvent = {
      kind: 'substitution',
      eventId,
      outPlayerId,
      inPlayerId,
      impactedScore: false,
      impactedStats: false,
      rotatedClockwise: false,
    };
    this.undoStack.push(event);

    this.offlineSync.logEvent({
      id: eventId,
      gameId: this.offlineSync.getActiveMatchId(),
      type: 'substitution',
      action: 'substitution',
      ...this.gameEventStateFields(),
      outPlayerId,
      inPlayerId,
      createdAt: new Date().toISOString(),
      isDeleted: false,
    });
    return true;
  }

  recordTimeout(team: PointSide): boolean {
    if (this.matchState.state().isMatchOver) {
      return false;
    }

    const didCallTimeout = this.matchState.callTimeout(team);
    if (!didCallTimeout) {
      return false;
    }

    const eventId = this.createEventId('evt');
    const event: EngineEvent = {
      kind: 'timeout',
      eventId,
      timeoutTeam: team,
      impactedScore: true,
      impactedStats: false,
      rotatedClockwise: false,
    };
    this.undoStack.push(event);

    const nextState = this.matchState.state();
    this.queueGameSnapshot(this.offlineSync.getActiveMatchId(), 'live');
    this.offlineSync.logEvent({
      id: eventId,
      gameId: this.offlineSync.getActiveMatchId(),
      type: 'timeoutCalled',
      action: 'timeout-called',
      ...this.gameEventStateFields(),
      timeoutTeam: team,
      teamTimeoutsRemaining: nextState.teamTimeoutsRemaining,
      opponentTimeoutsRemaining: nextState.opponentTimeoutsRemaining,
      createdAt: new Date().toISOString(),
      isDeleted: false,
    });

    return true;
  }

  manualRotateTeam(): boolean {
    if (this.matchState.state().isMatchOver) {
      return false;
    }

    const didRotate = this.matchState.rotateTeam();
    if (!didRotate) {
      return false;
    }

    this.teamRoster.rotateLineupClockwise();
    this.teamServeAttemptTrackedThisRally = false;

    const eventId = this.createEventId('evt');
    const event: EngineEvent = {
      kind: 'manual-rotation',
      eventId,
      impactedScore: true,
      impactedStats: false,
      rotatedClockwise: true,
    };
    this.undoStack.push(event);

    const nextState = this.matchState.state();
    this.queueGameSnapshot(this.offlineSync.getActiveMatchId(), 'live');
    this.offlineSync.logEvent({
      id: eventId,
      gameId: this.offlineSync.getActiveMatchId(),
      type: 'manualRotation',
      action: 'manual-rotation',
      ...this.gameEventStateFields(),
      teamRotation: nextState.teamRotation,
      servingTeam: nextState.servingTeam,
      lineup: this.teamRoster.getLineupSnapshot(),
      createdAt: new Date().toISOString(),
      isDeleted: false,
    });

    return true;
  }

  undoLastEvent(syncedEvents: GameEvent[] = this.offlineSync.getMatchEvents(this.offlineSync.getActiveMatchId())): EngineEvent | null {
    const last = this.undoStack.pop();
    if (!last) {
      const latestEvent = syncedEvents.slice().reverse().find((event) => this.isUndoableSyncedEvent(event));
      if (!latestEvent) {
        return null;
      }

      const deleted = this.offlineSync.markEventDeleted(latestEvent);
      const remainingEvents = syncedEvents.filter((event) => event.id !== deleted.id);
      this.replayLocalStateFromEvents(remainingEvents);
      this.replayLineupFromEvents(remainingEvents);
      this.queueGameSnapshot(this.offlineSync.getActiveMatchId(), this.matchState.state().isMatchOver ? 'final' : 'live');
      return this.toEngineEvent(deleted);
    }

    if (last.impactedScore) {
      this.matchState.undoLastPoint();
    }
    if (last.rotatedClockwise) {
      this.teamRoster.rotateLineupCounterClockwise();
    }
    if (last.impactedStats) {
      this.matchStats.undoLastAction();
    }
    if (last.kind === 'substitution') {
      this.teamRoster.substitutePlayers(last.inPlayerId, last.outPlayerId);
    }

    this.teamServeAttemptTrackedThisRally = false;
    this.queueGameSnapshot(this.offlineSync.getActiveMatchId(), this.matchState.state().isMatchOver ? 'final' : 'live');

    this.offlineSync.undoLastEvent(last.eventId);

    return last;
  }

  private getPlayerAtRotation(rotationPosition: number): RosterPlayer | null {
    const playerId = this.teamRoster.lineup()[rotationPosition - 1] ?? null;
    return this.teamRoster.getPlayerById(playerId);
  }

  private applyScoreForAction(action: StatsAction): {
    impactedScore: boolean;
    sideOutWon: boolean;
    matchEnded: boolean;
    rotatedClockwise: boolean;
  } {
    if (action === 'service-error' || action === 'attack-error') {
      const result = this.matchState.recordOpponentPoint();
      return { impactedScore: true, sideOutWon: false, matchEnded: result.matchEnded, rotatedClockwise: false };
    }

    if (action === 'kill' || action === 'ace' || action === 'block' || action === 'opponent-error') {
      const result = this.matchState.recordTeamPoint();
      let rotatedClockwise = false;
      if (result.sideOut) {
        this.teamRoster.rotateLineupClockwise();
        rotatedClockwise = true;
      }
      return {
        impactedScore: true,
        sideOutWon: result.sideOut,
        matchEnded: result.matchEnded,
        rotatedClockwise,
      };
    }

    return { impactedScore: false, sideOutWon: false, matchEnded: false, rotatedClockwise: false };
  }

  private queuePlayerStats(matchId: string): void {
    if (this.boxScoreQueuedForMatchId === matchId) {
      return;
    }

    const rows = this.teamRoster
      .players()
      .slice()
      .sort((a, b) => a.jerseyNumber - b.jerseyNumber)
      .map((player) => {
        const stats = this.matchStats.getPlayerStats(player.id);
        return {
          playerId: player.id,
          jerseyNumber: player.jerseyNumber,
          playerName: player.name,
          kills: stats.kills,
          attackErrors: stats.attackErrors,
          totalAttacks: stats.totalAttacks,
          aces: stats.aces,
          hittingEfficiency: this.matchStats.getHittingEfficiency(player.id),
          serveAttempts: stats.serveAttempts,
          servesIn: stats.servesIn,
          serveInPercentage: this.matchStats.getServeInPercentage(player.id),
          blocks: stats.blocks,
          digs: stats.digs,
          serviceErrors: stats.serviceErrors,
          sideOutOpportunities: stats.sideOutOpportunities,
          sideOutConversions: stats.sideOutConversions,
          sideOutPercentage: this.matchStats.getSideOutPercentage(player.id),
        };
      });

    const updatedAt = new Date().toISOString();
    rows.forEach((row) => {
      this.offlineSync.queuePlayerSetStats({
        id: `${matchId}-${row.playerId}-match`,
        gameId: matchId,
        playerId: row.playerId,
        playerName: row.playerName,
        jerseyNumber: row.jerseyNumber,
        setNumber: null,
        kills: row.kills,
        attackErrors: row.attackErrors,
        totalAttacks: row.totalAttacks,
        aces: row.aces,
        hittingEfficiency: row.hittingEfficiency,
        serveAttempts: row.serveAttempts,
        servesIn: row.servesIn,
        serveInPercentage: row.serveInPercentage,
        blocks: row.blocks,
        digs: row.digs,
        serviceErrors: row.serviceErrors,
        sideOutOpportunities: row.sideOutOpportunities,
        sideOutConversions: row.sideOutConversions,
        sideOutPercentage: row.sideOutPercentage,
        createdAt: updatedAt,
        updatedAt,
      });
    });
    this.boxScoreQueuedForMatchId = matchId;
  }

  private queueGameSnapshot(matchId: string, status: 'live' | 'final', timestamp = new Date().toISOString()): void {
    const state = this.matchState.state();
    const existingGame = this.offlineSync.getGame(matchId);
    const startedAt = this.matchStartedAtByMatchId.get(matchId) ?? existingGame?.startedAt ?? timestamp;
    const opponentName =
      this.opponentNameByMatchId.get(matchId) ??
      this.normalizeOpponentName(existingGame?.opponentName);
    this.matchStartedAtByMatchId.set(matchId, startedAt);
    this.opponentNameByMatchId.set(matchId, opponentName);
    this.offlineSync.queueGame({
      id: matchId,
      teamId: this.teamRoster.team().id,
      opponentName,
      status,
      servingTeam: state.servingTeam,
      teamPoints: state.teamPoints,
      opponentPoints: state.opponentPoints,
      teamSets: state.teamSets,
      opponentSets: state.opponentSets,
      currentSet: state.currentSet,
      isMatchOver: state.isMatchOver,
      teamTimeoutsRemaining: state.teamTimeoutsRemaining,
      opponentTimeoutsRemaining: state.opponentTimeoutsRemaining,
      teamRotation: state.teamRotation,
      startedAt,
      endedAt: status === 'final' ? timestamp : null,
      createdAt: startedAt,
      updatedAt: timestamp,
    });
  }

  private normalizeOpponentName(value: string | undefined): string {
    const trimmed = value?.trim() ?? '';
    return trimmed || 'Opponent';
  }

  private eventStateSnapshot(event: GameEvent): MatchScoreState | null {
    if (
      typeof event.teamPoints !== 'number' ||
      typeof event.opponentPoints !== 'number' ||
      typeof event.teamSets !== 'number' ||
      typeof event.opponentSets !== 'number' ||
      typeof event.currentSet !== 'number' ||
      typeof event.teamTimeoutsRemaining !== 'number' ||
      typeof event.opponentTimeoutsRemaining !== 'number' ||
      typeof event.teamRotation !== 'number'
    ) {
      return null;
    }

    return {
      teamPoints: event.teamPoints,
      opponentPoints: event.opponentPoints,
      teamSets: event.teamSets,
      opponentSets: event.opponentSets,
      currentSet: event.currentSet,
      servingTeam: event.servingTeam ?? 'team',
      isMatchOver: event.isMatchOver === true,
      teamTimeoutsRemaining: event.teamTimeoutsRemaining,
      opponentTimeoutsRemaining: event.opponentTimeoutsRemaining,
      teamRotation: event.teamRotation,
    };
  }

  private isStatsAction(action: string): action is StatsAction {
    return (
      action === 'kill' ||
      action === 'service-error' ||
      action === 'attack-error' ||
      action === 'ace' ||
      action === 'block' ||
      action === 'opponent-error' ||
      action === 'dig'
    );
  }

  private isUndoableSyncedEvent(event: GameEvent): boolean {
    return !event.isDeleted && event.type !== 'matchStarted';
  }

  private replayLocalStateFromEvents(events: GameEvent[]): void {
    const ordered = events.slice().filter((event) => !event.isDeleted).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    const stateSnapshots = ordered.map((event) => this.eventStateSnapshot(event)).filter((state): state is MatchScoreState => !!state);
    const latestState = stateSnapshots[stateSnapshots.length - 1] ?? null;
    if (latestState) {
      this.matchState.hydrateState(latestState);
    } else {
      this.matchState.resetMatch();
    }

    const stats: StatsState = {};
    const setStats: SetStatsState = {};
    ordered.forEach((event) => {
      if (event.type !== 'playerAction' || !event.playerId || !this.isStatsAction(event.action)) {
        return;
      }

      const line = stats[event.playerId] ?? this.createEmptyStatLine();
      if (event.wasReceiving) {
        line.sideOutOpportunities += 1;
      }
      if (event.sideOutWon) {
        line.sideOutConversions += 1;
      }
      if (event.action === 'kill') {
        line.kills += 1;
        line.totalAttacks += 1;
      }
      if (event.action === 'attack-error') {
        line.attackErrors += 1;
        line.totalAttacks += 1;
      }
      if (event.action === 'ace') {
        line.aces += 1;
        line.serveAttempts += 1;
        line.servesIn += 1;
      }
      if (event.action === 'block') {
        line.blocks += 1;
      }
      if (event.action === 'dig') {
        line.digs += 1;
      }
      if (event.action === 'service-error') {
        line.serviceErrors += 1;
        line.serveAttempts += 1;
      }
      stats[event.playerId] = line;

      if (event.inferredServeInServerPlayerId) {
        const serveLine = stats[event.inferredServeInServerPlayerId] ?? this.createEmptyStatLine();
        serveLine.serveAttempts += 1;
        serveLine.servesIn += 1;
        stats[event.inferredServeInServerPlayerId] = serveLine;
      }

      if (event.action === 'kill' || event.action === 'attack-error') {
        const setNumber = event.actionSetNumber ?? event.currentSet ?? 1;
        const current = setStats[event.playerId]?.[setNumber] ?? { kills: 0, attackErrors: 0, totalAttacks: 0 };
        setStats[event.playerId] = {
          ...(setStats[event.playerId] ?? {}),
          [setNumber]: {
            kills: current.kills + (event.action === 'kill' ? 1 : 0),
            attackErrors: current.attackErrors + (event.action === 'attack-error' ? 1 : 0),
            totalAttacks: current.totalAttacks + 1,
          },
        };
      }
    });
    this.matchStats.replaceSnapshot(stats, setStats);
  }

  private replayLineupFromEvents(events: GameEvent[]): void {
    const ordered = events.slice().filter((event) => !event.isDeleted).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    const seedEvent = ordered.find((event) => event.type === 'matchStarted' && this.isValidLineup(event.lineup));
    const fallbackSeed = ordered
      .slice()
      .reverse()
      .find((event) => event.type === 'manualRotation' && this.isValidLineup(event.lineup));
    const seeded = seedEvent?.lineup ?? fallbackSeed?.lineup;
    if (!seeded) {
      return;
    }

    let lineup = this.normalizeLineup(seeded);
    ordered.forEach((event) => {
      if (event.type === 'matchStarted' && this.isValidLineup(event.lineup)) {
        lineup = this.normalizeLineup(event.lineup);
        return;
      }

      if (event.type === 'playerAction' && event.sideOutWon) {
        lineup = this.rotateLineupClockwise(lineup);
        return;
      }

      if (event.type === 'manualRotation') {
        if (this.isValidLineup(event.lineup)) {
          lineup = this.normalizeLineup(event.lineup);
        } else {
          lineup = this.rotateLineupClockwise(lineup);
        }
        return;
      }

      if (event.type === 'substitution' && event.outPlayerId && event.inPlayerId) {
        const outIndex = lineup.findIndex((id) => id === event.outPlayerId);
        if (outIndex >= 0 && !lineup.includes(event.inPlayerId)) {
          lineup[outIndex] = event.inPlayerId;
        }
      }
    });

    this.teamRoster.setLineup(lineup);
  }

  private isValidLineup(lineup: unknown): lineup is Array<string | null> {
    if (!Array.isArray(lineup) || lineup.length !== 6) {
      return false;
    }
    return lineup.every((id) => id === null || typeof id === 'string');
  }

  private normalizeLineup(lineup: Array<string | null>): Array<string | null> {
    return lineup.map((id) => (typeof id === 'string' ? id : null));
  }

  private rotateLineupClockwise(lineup: Array<string | null>): Array<string | null> {
    return lineup.map((_, index) => lineup[(index + 1) % 6] ?? null);
  }

  private createEmptyStatLine(): StatsState[string] {
    return {
      kills: 0,
      attackErrors: 0,
      totalAttacks: 0,
      aces: 0,
      serveAttempts: 0,
      servesIn: 0,
      blocks: 0,
      digs: 0,
      serviceErrors: 0,
      sideOutOpportunities: 0,
      sideOutConversions: 0,
    };
  }

  private toEngineEvent(event: GameEvent): EngineEvent {
    if (event.type === 'substitution' && event.outPlayerId && event.inPlayerId) {
      return {
        kind: 'substitution',
        eventId: event.id,
        outPlayerId: event.outPlayerId,
        inPlayerId: event.inPlayerId,
        impactedScore: false,
        impactedStats: false,
        rotatedClockwise: false,
      };
    }
    if (event.type === 'timeoutCalled') {
      return {
        kind: 'timeout',
        eventId: event.id,
        timeoutTeam: event.timeoutTeam ?? 'team',
        impactedScore: true,
        impactedStats: false,
        rotatedClockwise: false,
      };
    }
    if (event.type === 'manualRotation') {
      return {
        kind: 'manual-rotation',
        eventId: event.id,
        impactedScore: true,
        impactedStats: false,
        rotatedClockwise: true,
      };
    }
    if (event.type === 'opponentPoint') {
      return {
        kind: 'opponent-point',
        eventId: event.id,
        impactedScore: true,
        impactedStats: false,
        rotatedClockwise: false,
      };
    }
    return {
      kind: 'player-action',
      eventId: event.id,
      action: this.isStatsAction(event.action) ? event.action : 'dig',
      playerId: event.playerId ?? null,
      impactedScore: true,
      impactedStats: event.type === 'playerAction',
      rotatedClockwise: false,
    };
  }

  private gameEventStateFields(): Pick<
    GameEvent,
    | 'servingTeam'
    | 'teamPoints'
    | 'opponentPoints'
    | 'teamSets'
    | 'opponentSets'
    | 'currentSet'
    | 'isMatchOver'
    | 'teamTimeoutsRemaining'
    | 'opponentTimeoutsRemaining'
    | 'teamRotation'
  > {
    const state = this.matchState.state();
    return {
      servingTeam: state.servingTeam,
      teamPoints: state.teamPoints,
      opponentPoints: state.opponentPoints,
      teamSets: state.teamSets,
      opponentSets: state.opponentSets,
      currentSet: state.currentSet,
      isMatchOver: state.isMatchOver,
      teamTimeoutsRemaining: state.teamTimeoutsRemaining,
      opponentTimeoutsRemaining: state.opponentTimeoutsRemaining,
      teamRotation: state.teamRotation,
    };
  }

  private createEventId(prefix: string): string {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return `${prefix}-${crypto.randomUUID()}`;
    }
    return `${prefix}-${Date.now()}-${Math.floor(Math.random() * 100000)}`;
  }
}
