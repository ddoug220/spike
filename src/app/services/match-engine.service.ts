import { Injectable } from '@angular/core';
import { MatchStateService } from './match-state.service';
import { MatchStatsService, StatsAction } from './match-stats.service';
import { OfflineSyncService } from './offline-sync.service';
import { RosterPlayer, TeamRosterService } from './team-roster.service';

type PointSide = 'team' | 'opponent';
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
  private undoStack: EngineEvent[] = [];

  constructor(
    private readonly matchState: MatchStateService,
    private readonly matchStats: MatchStatsService,
    private readonly teamRoster: TeamRosterService,
    private readonly offlineSync: OfflineSyncService,
  ) {}

  startMatch(initialServe: PointSide = 'team'): string {
    const matchId = this.offlineSync.startNewMatch();
    const createdAt = new Date().toISOString();
    this.matchState.resetMatch();
    this.matchState.setServingTeam(initialServe);
    this.matchStats.resetMatch();
    this.undoStack = [];
    this.teamServeAttemptTrackedThisRally = false;
    this.boxScoreQueuedForMatchId = null;
    this.matchEndedEventQueuedForMatchId = null;

    this.offlineSync.queueGame({
      id: matchId,
      teamId: 'local-team',
      opponentName: 'Opponent',
      status: 'live',
      servingTeam: initialServe,
      teamSets: 0,
      opponentSets: 0,
      startedAt: createdAt,
      endedAt: null,
      createdAt,
      updatedAt: createdAt,
    });
    this.offlineSync.queueMatchEvent({
      id: this.createEventId('evt'),
      gameId: matchId,
      type: 'matchStarted',
      action: 'match-started',
      servingTeam: initialServe,
      lineup: this.teamRoster.getLineupSnapshot(),
      createdAt,
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
    this.offlineSync.queueGame({
      id: matchId,
      teamId: 'local-team',
      opponentName: 'Opponent',
      status: 'final',
      servingTeam: this.matchState.state().servingTeam,
      teamSets: this.matchState.state().teamSets,
      opponentSets: this.matchState.state().opponentSets,
      startedAt: createdAt,
      endedAt: createdAt,
      createdAt,
      updatedAt: createdAt,
    });
    this.offlineSync.queueMatchEvent({
      id: this.createEventId('evt'),
      gameId: matchId,
      type: 'matchEnded',
      action: 'match-ended',
      teamSets: this.matchState.state().teamSets,
      opponentSets: this.matchState.state().opponentSets,
      createdAt,
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
    this.offlineSync.queueMatchEvent({
      id: this.createEventId('evt'),
      gameId: this.offlineSync.getActiveMatchId(),
      type: 'serveTeamSet',
      action: 'serve-team-set',
      servingTeam: team,
      createdAt: new Date().toISOString(),
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
    const selectedPlayer = this.getPlayerAtRotation(rotationPosition);
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

    this.offlineSync.queueMatchEvent({
      id: event.eventId,
      gameId: matchId,
      type: 'playerAction',
      action,
      rotationPosition,
      playerId: selectedPlayer?.id ?? null,
      wasReceiving,
      sideOutWon: scoreResult.sideOutWon,
      teamPoints: this.matchState.state().teamPoints,
      opponentPoints: this.matchState.state().opponentPoints,
      teamSets: this.matchState.state().teamSets,
      opponentSets: this.matchState.state().opponentSets,
      createdAt: new Date().toISOString(),
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

    const event: EngineEvent = {
      kind: 'opponent-point',
      eventId: this.createEventId('evt'),
      impactedScore: true,
      impactedStats,
      rotatedClockwise: false,
    };
    this.undoStack.push(event);

    this.offlineSync.queueMatchEvent({
      id: event.eventId,
      gameId: matchId,
      type: 'opponentPoint',
      action: 'opponent-point',
      teamPoints: this.matchState.state().teamPoints,
      opponentPoints: this.matchState.state().opponentPoints,
      teamSets: this.matchState.state().teamSets,
      opponentSets: this.matchState.state().opponentSets,
      createdAt: new Date().toISOString(),
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

    this.offlineSync.queueMatchEvent({
      id: eventId,
      gameId: this.offlineSync.getActiveMatchId(),
      type: 'substitution',
      action: 'substitution',
      outPlayerId,
      inPlayerId,
      createdAt: new Date().toISOString(),
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
    this.offlineSync.queueMatchEvent({
      id: eventId,
      gameId: this.offlineSync.getActiveMatchId(),
      type: 'timeoutCalled',
      action: 'timeout-called',
      timeoutTeam: team,
      teamTimeoutsRemaining: nextState.teamTimeoutsRemaining,
      opponentTimeoutsRemaining: nextState.opponentTimeoutsRemaining,
      createdAt: new Date().toISOString(),
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
    this.offlineSync.queueMatchEvent({
      id: eventId,
      gameId: this.offlineSync.getActiveMatchId(),
      type: 'manualRotation',
      action: 'manual-rotation',
      teamRotation: nextState.teamRotation,
      servingTeam: nextState.servingTeam,
      lineup: this.teamRoster.getLineupSnapshot(),
      createdAt: new Date().toISOString(),
    });

    return true;
  }

  undoLastEvent(): EngineEvent | null {
    const last = this.undoStack.pop();
    if (!last) {
      return null;
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

    this.offlineSync.queueMatchEvent({
      id: this.createEventId('evt'),
      gameId: this.offlineSync.getActiveMatchId(),
      type: 'undo',
      action: 'undo',
      targetEventId: last.eventId,
      createdAt: new Date().toISOString(),
    });

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
          hittingEfficiency: this.matchStats.getHittingEfficiency(player.id),
          serveAttempts: stats.serveAttempts,
          serveInPercentage: this.matchStats.getServeInPercentage(player.id),
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
        hittingEfficiency: row.hittingEfficiency,
        serveAttempts: row.serveAttempts,
        serveInPercentage: row.serveInPercentage,
        sideOutPercentage: row.sideOutPercentage,
        createdAt: updatedAt,
        updatedAt,
      });
    });
    this.boxScoreQueuedForMatchId = matchId;
  }

  private createEventId(prefix: string): string {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return `${prefix}-${crypto.randomUUID()}`;
    }
    return `${prefix}-${Date.now()}-${Math.floor(Math.random() * 100000)}`;
  }
}
