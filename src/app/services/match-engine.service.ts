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
    this.matchState.resetMatch();
    this.matchState.setServingTeam(initialServe);
    this.matchStats.resetMatch();
    this.undoStack = [];
    this.teamServeAttemptTrackedThisRally = false;
    this.boxScoreQueuedForMatchId = null;
    this.matchEndedEventQueuedForMatchId = null;

    this.offlineSync.queueMatchEvent({
      id: this.createEventId('evt'),
      match_id: matchId,
      event_type: 'match_started',
      action: 'match-started',
      serving_team: initialServe,
      lineup: this.teamRoster.getLineupSnapshot(),
      created_at: new Date().toISOString(),
    });

    return matchId;
  }

  endMatch(): void {
    const matchId = this.offlineSync.getActiveMatchId();
    if (this.matchEndedEventQueuedForMatchId === matchId) {
      return;
    }

    this.matchState.endMatch();
    this.offlineSync.queueMatchEvent({
      id: this.createEventId('evt'),
      match_id: matchId,
      event_type: 'match_ended',
      action: 'match-ended',
      team_sets: this.matchState.state().teamSets,
      opponent_sets: this.matchState.state().opponentSets,
      created_at: new Date().toISOString(),
    });
    this.queueBoxScore(matchId);
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
      match_id: this.offlineSync.getActiveMatchId(),
      event_type: 'serve_team_set',
      action: 'serve-team-set',
      serving_team: team,
      created_at: new Date().toISOString(),
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
      match_id: matchId,
      event_type: 'player_action',
      action,
      rotation_position: rotationPosition,
      player_id: selectedPlayer?.id ?? null,
      was_receiving: wasReceiving,
      side_out_won: scoreResult.sideOutWon,
      team_points: this.matchState.state().teamPoints,
      opponent_points: this.matchState.state().opponentPoints,
      team_sets: this.matchState.state().teamSets,
      opponent_sets: this.matchState.state().opponentSets,
      created_at: new Date().toISOString(),
    });

    if (scoreResult.matchEnded) {
      this.queueBoxScore(matchId);
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
      match_id: matchId,
      event_type: 'opponent_point',
      action: 'opponent-point',
      team_points: this.matchState.state().teamPoints,
      opponent_points: this.matchState.state().opponentPoints,
      team_sets: this.matchState.state().teamSets,
      opponent_sets: this.matchState.state().opponentSets,
      created_at: new Date().toISOString(),
    });

    if (result.matchEnded) {
      this.queueBoxScore(matchId);
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
      match_id: this.offlineSync.getActiveMatchId(),
      event_type: 'substitution',
      action: 'substitution',
      out_player_id: outPlayerId,
      in_player_id: inPlayerId,
      created_at: new Date().toISOString(),
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
      match_id: this.offlineSync.getActiveMatchId(),
      event_type: 'timeout_called',
      action: 'timeout-called',
      timeout_team: team,
      team_timeouts_remaining: nextState.teamTimeoutsRemaining,
      opponent_timeouts_remaining: nextState.opponentTimeoutsRemaining,
      created_at: new Date().toISOString(),
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
      match_id: this.offlineSync.getActiveMatchId(),
      event_type: 'manual_rotation',
      action: 'manual-rotation',
      team_rotation: nextState.teamRotation,
      serving_team: nextState.servingTeam,
      lineup: this.teamRoster.getLineupSnapshot(),
      created_at: new Date().toISOString(),
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
      match_id: this.offlineSync.getActiveMatchId(),
      event_type: 'undo',
      action: 'undo',
      target_event_id: last.eventId,
      created_at: new Date().toISOString(),
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

  private queueBoxScore(matchId: string): void {
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
          player_id: player.id,
          jersey_number: player.jerseyNumber,
          player_name: player.name,
          kills: stats.kills,
          attack_errors: stats.attackErrors,
          total_attacks: stats.totalAttacks,
          hitting_efficiency: this.matchStats.getHittingEfficiency(player.id),
          serve_attempts: stats.serveAttempts,
          serve_in_percentage: this.matchStats.getServeInPercentage(player.id),
          side_out_percentage: this.matchStats.getSideOutPercentage(player.id),
        };
      });

    this.offlineSync.queueBoxScore({
      id: this.createEventId('box'),
      match_id: matchId,
      final_team_sets: this.matchState.state().teamSets,
      final_opponent_sets: this.matchState.state().opponentSets,
      stats: rows,
      created_at: new Date().toISOString(),
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
