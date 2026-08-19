import { Injectable } from '@angular/core';
import { GameEvent } from '../models/firestore.models';
import { MatchStateService } from './match-state.service';
import { MatchStatsService, StatsAction } from './match-stats.service';
import { OfflineSyncService } from './offline-sync.service';
import { RosterPlayer, TeamRosterService } from './team-roster.service';
import {
  projectionFromFirestore,
  scoreStateFromProjection,
  setStatsStateFromProjection,
  statsStateFromProjection,
} from './match-v2.adapter';

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
      rotationSteps: number;
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
    }
  | {
      kind: 'serve-correction';
      eventId: string;
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
  private currentRallyId = this.createEventId('rally');
  private currentSetStartingLineup: Array<string | null> = [null, null, null, null, null, null];

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
    this.currentRallyId = this.createEventId('rally');
    this.currentSetStartingLineup = this.teamRoster.getLineupSnapshot();
    this.teamServeAttemptTrackedThisRally = false;
    this.boxScoreQueuedForMatchId = null;
    this.matchEndedEventQueuedForMatchId = null;
    this.matchStartedAtByMatchId.set(matchId, createdAt);
    this.opponentNameByMatchId.set(matchId, opponentName);

    this.teamRoster.syncRosterToFirebase(this.offlineSync);
    this.queueGameSnapshot(matchId, 'live', createdAt);
    this.offlineSync.logEvent({
      id: this.createEventId('evt'),
      gameId: matchId,
      type: 'matchStarted',
      action: 'match-started',
      eventKind: 'match-started',
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

  endMatchEarly(): void {
    const matchId = this.offlineSync.getActiveMatchId();
    if (this.matchState.state().isMatchOver) {
      return;
    }
    this.matchState.endMatch();
    const createdAt = new Date().toISOString();
    this.queueGameSnapshot(matchId, 'ended-early', createdAt);
    this.offlineSync.logEvent({
      id: this.createEventId('evt'),
      gameId: matchId,
      type: 'matchEndedEarly',
      action: 'match-ended-early',
      eventKind: 'match-ended-early',
      ...this.gameEventStateFields(),
      createdAt,
      isDeleted: false,
    });
    this.queuePlayerStats(matchId);
  }

  getNextSetDefaultLineup(): Array<string | null> {
    if (this.isCompleteLineup(this.currentSetStartingLineup)) {
      return [...this.currentSetStartingLineup];
    }
    const matchId = this.offlineSync.getActiveMatchId();
    const lastSubmitted = this.offlineSync.getMatchEvents(matchId)
      .slice()
      .reverse()
      .find((event) => (event.type === 'setStarted' || event.type === 'matchStarted') && this.isCompleteLineup(event.lineup))
      ?.lineup;
    return [...(lastSubmitted ?? this.offlineSync.getGame(matchId)?.startingLineup ?? this.teamRoster.matchDefaults().startingLineup)];
  }

  startNextSet(lineup: Array<string | null>, servingTeam: PointSide): boolean {
    const assigned = lineup.filter((playerId): playerId is string => typeof playerId === 'string');
    if (assigned.length !== 6 || new Set(assigned).size !== 6 || assigned.some((id) => !this.teamRoster.getPlayerById(id))) {
      return false;
    }
    if (!this.matchState.startNextSet(servingTeam)) {
      return false;
    }
    this.currentSetStartingLineup = [...lineup];
    this.currentRallyId = this.createEventId('rally');
    const createdAt = new Date().toISOString();
    const matchId = this.offlineSync.getActiveMatchId();
    this.offlineSync.logEvent({
      id: this.createEventId('evt'),
      gameId: matchId,
      type: 'setStarted',
      action: 'set-started',
      eventKind: 'set-started',
      ...this.gameEventStateFields(),
      lineup,
      servingTeam,
      actionSetNumber: this.matchState.state().currentSet,
      createdAt,
      isDeleted: false,
    });
    this.queueGameSnapshot(matchId, 'live', createdAt);
    return true;
  }

  setServingTeam(team: PointSide): void {
    if (this.matchState.state().isMatchOver) {
      return;
    }

    if (team === this.matchState.state().servingTeam) {
      return;
    }
    const eventId = this.createEventId('evt');
    this.matchState.setServingTeam(team, true);
    this.teamServeAttemptTrackedThisRally = false;
    this.undoStack.push({
      kind: 'serve-correction',
      eventId,
      impactedScore: true,
      impactedStats: false,
      rotatedClockwise: false,
    });
    this.queueGameSnapshot(this.offlineSync.getActiveMatchId(), 'live');
    this.offlineSync.logEvent({
      id: eventId,
      gameId: this.offlineSync.getActiveMatchId(),
      type: 'serveTeamSet',
      action: 'serve-team-set',
      eventKind: 'serve-corrected',
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
    const teamRotationBefore = this.matchState.state().teamRotation;
    const rallyId = this.currentRallyId;
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
      eventKind: action === 'dig' ? 'stat-observation' : 'rally-outcome',
      ...this.gameEventStateFields(),
      rotationPosition,
      playerId: selectedPlayer?.id ?? null,
      wasReceiving,
      sideOutWon: scoreResult.sideOutWon,
      inferredServeInServerPlayerId,
      actionSetNumber: currentSetBefore,
      rallyId,
      servingTeamBefore,
      teamRotationBefore,
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
    if (scoreResult.impactedScore) {
      this.currentRallyId = this.createEventId('rally');
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
    const teamRotationBefore = this.matchState.state().teamRotation;
    const rallyId = this.currentRallyId;
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
      eventKind: 'rally-outcome',
      ...this.gameEventStateFields(),
      rallyId,
      servingTeamBefore,
      teamRotationBefore,
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
    this.currentRallyId = this.createEventId('rally');

    return event;
  }

  recordSubstitution(outPlayerId: string, inPlayerId: string): boolean {
    if (this.matchState.state().isMatchOver) {
      return false;
    }

    const lineup = this.projectedLineup();
    const courtPosition = (lineup?.indexOf(outPlayerId) ?? -1) + 1;
    if (!lineup || courtPosition === 0 || lineup.includes(inPlayerId) || !this.teamRoster.getPlayerById(inPlayerId)) {
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
      eventKind: 'substitution',
      ...this.gameEventStateFields(),
      outPlayerId,
      inPlayerId,
      courtPosition,
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
      eventKind: 'timeout-called',
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
    const nextRotation = (this.matchState.state().teamRotation % 6) + 1;
    return this.manualRotateTeamTo(nextRotation);
  }

  manualRotateTeamTo(targetRotation: number): boolean {
    if (this.matchState.state().isMatchOver) {
      return false;
    }

    const previousRotation = this.matchState.state().teamRotation;
    const normalizedTarget = ((Math.trunc(targetRotation) - 1) % 6 + 6) % 6 + 1;
    const rotationSteps = (normalizedTarget - previousRotation + 6) % 6;
    if (rotationSteps === 0) {
      return false;
    }
    const didRotate = this.matchState.setTeamRotation(normalizedTarget);
    if (!didRotate) {
      return false;
    }

    this.teamServeAttemptTrackedThisRally = false;

    const eventId = this.createEventId('evt');
    const event: EngineEvent = {
      kind: 'manual-rotation',
      eventId,
      impactedScore: true,
      impactedStats: false,
      rotatedClockwise: true,
      rotationSteps,
    };
    this.undoStack.push(event);

    const nextState = this.matchState.state();
    this.queueGameSnapshot(this.offlineSync.getActiveMatchId(), 'live');
    this.offlineSync.logEvent({
      id: eventId,
      gameId: this.offlineSync.getActiveMatchId(),
      type: 'manualRotation',
      action: 'manual-rotation',
      eventKind: 'rotation-corrected',
      ...this.gameEventStateFields(),
      teamRotation: nextState.teamRotation,
      servingTeam: nextState.servingTeam,
      previousTeamRotation: previousRotation,
      targetTeamRotation: normalizedTarget,
      targetRotation: normalizedTarget,
      createdAt: new Date().toISOString(),
      isDeleted: false,
    });

    return true;
  }

  undoLastEvent(syncedEvents: GameEvent[] = this.offlineSync.getMatchEvents(this.offlineSync.getActiveMatchId())): EngineEvent | null {
    const last = this.undoStack.pop();
    if (!last) {
      const latestEvent = this.offlineSync.undoLatestEvent(
        syncedEvents.filter((event) => this.isUndoableSyncedEvent(event) || event.type === 'undo'),
      );
      if (!latestEvent) {
        return null;
      }

      const remainingEvents = syncedEvents.filter((event) => event.id !== latestEvent.id);
      this.replayLocalStateFromEvents(remainingEvents);
      this.queueGameSnapshot(this.offlineSync.getActiveMatchId(), this.matchState.state().isMatchOver ? 'final' : 'live');
      return this.toEngineEvent(latestEvent);
    }

    if (last.impactedScore) {
      this.matchState.undoLastPoint();
    }
    if (last.impactedStats) {
      this.matchStats.undoLastAction();
    }
    this.teamServeAttemptTrackedThisRally = false;
    this.queueGameSnapshot(this.offlineSync.getActiveMatchId(), this.matchState.state().isMatchOver ? 'final' : 'live');

    this.offlineSync.undoLastEvent(last.eventId);

    if (!this.matchState.state().isMatchOver) {
      this.boxScoreQueuedForMatchId = null;
      this.matchEndedEventQueuedForMatchId = null;
    }

    return last;
  }

  private getPlayerAtRotation(rotationPosition: number): RosterPlayer | null {
    const playerId = this.projectedLineup()?.[rotationPosition - 1] ?? this.teamRoster.lineup()[rotationPosition - 1] ?? null;
    return this.teamRoster.getPlayerById(playerId);
  }

  private projectedLineup(): readonly string[] | null {
    const matchId = this.offlineSync.getActiveMatchId();
    const game = this.offlineSync.getGame(matchId);
    if (!game) return null;
    return projectionFromFirestore(game, this.offlineSync.getMatchEvents(matchId))?.lineup ?? null;
  }

  private applyScoreForAction(action: StatsAction): {
    impactedScore: boolean;
    sideOutWon: boolean;
    matchEnded: boolean;
    rotatedClockwise: boolean;
  } {
    if (action === 'service-error' || action === 'attack-error' || action === 'receive-error') {
      const result = this.matchState.recordOpponentPoint();
      return { impactedScore: true, sideOutWon: false, matchEnded: result.matchEnded, rotatedClockwise: false };
    }

    if (action === 'kill' || action === 'ace' || action === 'block' || action === 'opponent-error') {
      const result = this.matchState.recordTeamPoint();
      return {
        impactedScore: true,
        sideOutWon: result.sideOut,
        matchEnded: result.matchEnded,
        rotatedClockwise: result.sideOut,
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
          serveAttempts: stats.serveAttempts,
          servesIn: stats.servesIn,
          serveInPercentage: this.matchStats.getServeInPercentage(player.id),
          blocks: stats.blocks,
          digs: stats.digs,
          serviceErrors: stats.serviceErrors,
          receiveErrors: stats.receiveErrors,
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
        serveAttempts: row.serveAttempts,
        servesIn: row.servesIn,
        serveInPercentage: row.serveInPercentage,
        blocks: row.blocks,
        digs: row.digs,
        serviceErrors: row.serviceErrors,
        receiveErrors: row.receiveErrors,
        createdAt: updatedAt,
        updatedAt,
      });
    });
    this.boxScoreQueuedForMatchId = matchId;
  }

  private queueGameSnapshot(matchId: string, status: 'live' | 'final' | 'ended-early', timestamp = new Date().toISOString()): void {
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
      isSetBreak: state.isSetBreak,
      teamTimeoutsRemaining: state.teamTimeoutsRemaining,
      opponentTimeoutsRemaining: state.opponentTimeoutsRemaining,
      teamRotation: state.teamRotation,
      matchSquad: this.teamRoster.getMatchSquadPlayers().map((player) => ({
        id: player.id,
        name: player.name,
        jerseyNumber: player.jerseyNumber,
        primaryPosition: player.primaryPosition,
      })),
      startingLineup: this.isCompleteLineup(this.currentSetStartingLineup)
        ? [...this.currentSetStartingLineup]
        : [...(existingGame?.startingLineup ?? this.teamRoster.matchDefaults().startingLineup)],
      startedAt,
      endedAt: status === 'live' ? null : timestamp,
      createdAt: startedAt,
      updatedAt: timestamp,
    });
  }

  private normalizeOpponentName(value: string | undefined): string {
    const trimmed = value?.trim() ?? '';
    return trimmed || 'Opponent';
  }

  private isStatsAction(action: string): action is StatsAction {
    return (
      action === 'kill' ||
      action === 'service-error' ||
      action === 'attack-error' ||
      action === 'ace' ||
      action === 'block' ||
      action === 'opponent-error' ||
      action === 'receive-error' ||
      action === 'dig'
    );
  }

  private isUndoableSyncedEvent(event: GameEvent): boolean {
    return !event.isDeleted && event.type !== 'matchStarted' && event.type !== 'undo';
  }

  private replayLocalStateFromEvents(events: GameEvent[]): void {
    const game = this.offlineSync.getGame(this.offlineSync.getActiveMatchId());
    if (!game) return;
    const projection = projectionFromFirestore(game, events);
    if (!projection) return;
    this.matchState.hydrateState(scoreStateFromProjection(projection));
    this.matchStats.replaceSnapshot(
      statsStateFromProjection(projection),
      setStatsStateFromProjection(projection),
    );
  }

  private isCompleteLineup(lineup: unknown): lineup is string[] {
    return Array.isArray(lineup) && lineup.length === 6 && lineup.every((id) => typeof id === 'string' && id.length > 0);
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
        rotationSteps:
          event.previousTeamRotation && event.targetTeamRotation
            ? (event.targetTeamRotation - event.previousTeamRotation + 6) % 6 || 1
            : 1,
      };
    }
    if (event.type === 'serveTeamSet') {
      return {
        kind: 'serve-correction',
        eventId: event.id,
        impactedScore: true,
        impactedStats: false,
        rotatedClockwise: false,
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
    | 'isSetBreak'
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
      isSetBreak: state.isSetBreak,
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
