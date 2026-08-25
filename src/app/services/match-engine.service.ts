import { Injectable } from '@angular/core';
import type { MatchProjection } from '../domain/match-v2';
import { GameEvent } from '../models/firestore.models';
import { MatchStateService } from './match-state.service';
import { MatchStatsService, StatsAction } from './match-stats.service';
import { OfflineSyncService } from './offline-sync.service';
import { RosterPlayer, TeamRosterService } from './team-roster.service';
import {
  eventsFromFirestore,
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
  private boxScoreQueuedForMatchId: string | null = null;
  private matchEndedEventQueuedForMatchId: string | null = null;
  private matchStartedAtByMatchId = new Map<string, string>();
  private opponentNameByMatchId = new Map<string, string>();
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
    this.currentSetStartingLineup = this.teamRoster.getLineupSnapshot();
    this.boxScoreQueuedForMatchId = null;
    this.matchEndedEventQueuedForMatchId = null;
    this.matchStartedAtByMatchId.set(matchId, createdAt);
    this.opponentNameByMatchId.set(matchId, opponentName);

    this.teamRoster.syncRosterToFirebase(this.offlineSync);
    this.queueMatchBootstrap(matchId, initialServe, createdAt);
    this.offlineSync.logEvent({
      id: this.createEventId('evt'),
      gameId: matchId,
      type: 'matchStarted',
      action: 'match-started',
      eventKind: 'match-started',
      setNumber: 1,
      servingTeam: initialServe,
      lineup: this.teamRoster.getLineupSnapshot(),
      createdAt,
      isDeleted: false,
    });
    this.replayAndProject(matchId, createdAt);

    return matchId;
  }

  endMatch(): void {
    const matchId = this.offlineSync.getActiveMatchId();
    if (this.matchEndedEventQueuedForMatchId === matchId) {
      return;
    }

    const projection = this.currentProjection();
    if (!projection || projection.status !== 'final') return;
    const createdAt = new Date().toISOString();
    this.queueGameSnapshot(matchId, projection, createdAt);
    this.offlineSync.logEvent({
      id: this.createEventId('evt'),
      gameId: matchId,
      type: 'matchEnded',
      action: 'match-ended',
      setNumber: projection.currentSet,
      teamSets: projection.teamSets,
      opponentSets: projection.opponentSets,
      createdAt,
      isDeleted: false,
    });
    this.queuePlayerStats(matchId);
    this.matchEndedEventQueuedForMatchId = matchId;
  }

  endMatchEarly(): void {
    const matchId = this.offlineSync.getActiveMatchId();
    const projection = this.currentProjection();
    if (!projection || (projection.status !== 'live' && projection.status !== 'set-break')) {
      return;
    }
    const createdAt = new Date().toISOString();
    this.offlineSync.logEvent({
      id: this.createEventId('evt'),
      gameId: matchId,
      type: 'matchEndedEarly',
      action: 'match-ended-early',
      eventKind: 'match-ended-early',
      setNumber: projection.currentSet,
      createdAt,
      isDeleted: false,
    });
    this.replayAndProject(matchId, createdAt);
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
    const projection = this.currentProjection();
    if (!projection || projection.status !== 'set-break' || projection.currentSet >= 5) {
      return false;
    }
    this.currentSetStartingLineup = [...lineup];
    const createdAt = new Date().toISOString();
    const matchId = this.offlineSync.getActiveMatchId();
    this.offlineSync.logEvent({
      id: this.createEventId('evt'),
      gameId: matchId,
      type: 'setStarted',
      action: 'set-started',
      eventKind: 'set-started',
      lineup,
      servingTeam,
      setNumber: projection.currentSet + 1,
      actionSetNumber: projection.currentSet + 1,
      createdAt,
      isDeleted: false,
    });
    this.replayAndProject(matchId, createdAt);
    return true;
  }

  setServingTeam(team: PointSide): void {
    const projection = this.currentProjection();
    if (!projection || projection.status !== 'live') {
      return;
    }

    if (team === projection.servingTeam) {
      return;
    }
    const eventId = this.createEventId('evt');
    this.offlineSync.logEvent({
      id: eventId,
      gameId: this.offlineSync.getActiveMatchId(),
      type: 'serveTeamSet',
      action: 'serve-team-set',
      eventKind: 'serve-corrected',
      setNumber: projection.currentSet,
      servingTeam: team,
      createdAt: new Date().toISOString(),
      isDeleted: false,
    });
    this.replayAndProject(this.offlineSync.getActiveMatchId());
  }

  recordPlayerAction(courtPosition: number, action: StatsAction): EngineEvent {
    const projection = this.currentProjection();
    if (!projection || projection.status !== 'live') {
      return {
        kind: 'player-action',
        eventId: this.createEventId('evt'),
        action,
        playerId: this.getPlayerAtCourtPosition(courtPosition)?.id ?? null,
        impactedScore: false,
        impactedStats: false,
        rotatedClockwise: false,
      };
    }

    const matchId = this.offlineSync.getActiveMatchId();
    const servingTeamBefore = projection.servingTeam;
    const teamRotationBefore = projection.teamRotation;
    const rallyId = projection.openRallyId ?? this.createEventId('rally');
    const currentSetBefore = projection.currentSet;
    const wasReceiving = servingTeamBefore === 'opponent';
    const isTeamPointFromOpponentError = action === 'opponent-error';
    const selectedPlayer = isTeamPointFromOpponentError ? null : this.getPlayerAtCourtPosition(courtPosition);
    const impactedScore = action !== 'dig';
    const sideOutWon = impactedScore && servingTeamBefore === 'opponent' &&
      (action === 'kill' || action === 'ace' || action === 'block' || action === 'opponent-error');

    const event: EngineEvent = {
      kind: 'player-action',
      eventId: this.createEventId('evt'),
      action,
      playerId: selectedPlayer?.id ?? null,
      impactedScore,
      impactedStats: selectedPlayer !== null,
      rotatedClockwise: sideOutWon,
    };

    this.offlineSync.logEvent({
      id: event.eventId,
      gameId: matchId,
      type: 'playerAction',
      action,
      eventKind: action === 'dig' ? 'stat-observation' : 'rally-outcome',
      courtPosition,
      playerId: selectedPlayer?.id ?? null,
      wasReceiving,
      sideOutWon,
      actionSetNumber: currentSetBefore,
      setNumber: currentSetBefore,
      rallyId,
      servingTeamBefore,
      teamRotationBefore,
      createdAt: new Date().toISOString(),
      isDeleted: false,
    });

    const next = this.replayAndProject(matchId);
    if (next?.status === 'final') {
      this.queuePlayerStats(matchId);
    }

    return event;
  }

  recordOpponentPoint(): EngineEvent {
    const projection = this.currentProjection();
    if (!projection || projection.status !== 'live') {
      return {
        kind: 'opponent-point',
        eventId: this.createEventId('evt'),
        impactedScore: false,
        impactedStats: false,
        rotatedClockwise: false,
      };
    }

    const matchId = this.offlineSync.getActiveMatchId();
    const servingTeamBefore = projection.servingTeam;
    const teamRotationBefore = projection.teamRotation;
    const rallyId = projection.openRallyId ?? this.createEventId('rally');

    const event: EngineEvent = {
      kind: 'opponent-point',
      eventId: this.createEventId('evt'),
      impactedScore: true,
      impactedStats: servingTeamBefore === 'team',
      rotatedClockwise: false,
    };
    this.offlineSync.logEvent({
      id: event.eventId,
      gameId: matchId,
      type: 'opponentPoint',
      action: 'opponent-point',
      eventKind: 'rally-outcome',
      setNumber: projection.currentSet,
      rallyId,
      servingTeamBefore,
      teamRotationBefore,
      createdAt: new Date().toISOString(),
      isDeleted: false,
    });

    const next = this.replayAndProject(matchId);
    if (next?.status === 'final') {
      this.queuePlayerStats(matchId);
    }

    return event;
  }

  recordSubstitution(outPlayerId: string, inPlayerId: string): boolean {
    const projection = this.currentProjection();
    if (!projection || projection.status !== 'live') {
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
    this.offlineSync.logEvent({
      id: eventId,
      gameId: this.offlineSync.getActiveMatchId(),
      type: 'substitution',
      action: 'substitution',
      eventKind: 'substitution',
      setNumber: projection.currentSet,
      outPlayerId,
      inPlayerId,
      courtPosition,
      createdAt: new Date().toISOString(),
      isDeleted: false,
    });
    this.replayAndProject(this.offlineSync.getActiveMatchId());
    return true;
  }

  recordTimeout(team: PointSide): boolean {
    const projection = this.currentProjection();
    if (!projection || projection.status !== 'live') {
      return false;
    }

    const remaining = team === 'team' ? projection.teamTimeoutsRemaining : projection.opponentTimeoutsRemaining;
    if (remaining === 0) {
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
    this.offlineSync.logEvent({
      id: eventId,
      gameId: this.offlineSync.getActiveMatchId(),
      type: 'timeoutCalled',
      action: 'timeout-called',
      eventKind: 'timeout-called',
      setNumber: projection.currentSet,
      timeoutTeam: team,
      createdAt: new Date().toISOString(),
      isDeleted: false,
    });
    this.replayAndProject(this.offlineSync.getActiveMatchId());

    return true;
  }

  manualRotateTeam(): boolean {
    const nextRotation = ((this.currentProjection()?.teamRotation ?? 1) % 6) + 1;
    return this.manualRotateTeamTo(nextRotation);
  }

  manualRotateTeamTo(targetRotation: number): boolean {
    const projection = this.currentProjection();
    if (!projection || projection.status !== 'live') {
      return false;
    }

    const previousRotation = projection.teamRotation;
    const normalizedTarget = ((Math.trunc(targetRotation) - 1) % 6 + 6) % 6 + 1;
    const rotationSteps = (normalizedTarget - previousRotation + 6) % 6;
    if (rotationSteps === 0) {
      return false;
    }
    const eventId = this.createEventId('evt');
    const event: EngineEvent = {
      kind: 'manual-rotation',
      eventId,
      impactedScore: true,
      impactedStats: false,
      rotatedClockwise: true,
      rotationSteps,
    };
    this.offlineSync.logEvent({
      id: eventId,
      gameId: this.offlineSync.getActiveMatchId(),
      type: 'manualRotation',
      action: 'manual-rotation',
      eventKind: 'rotation-corrected',
      setNumber: projection.currentSet,
      teamRotation: normalizedTarget,
      servingTeam: projection.servingTeam,
      previousTeamRotation: previousRotation,
      targetTeamRotation: normalizedTarget,
      targetRotation: normalizedTarget,
      createdAt: new Date().toISOString(),
      isDeleted: false,
    });
    this.replayAndProject(this.offlineSync.getActiveMatchId());

    return true;
  }

  undoLastEvent(syncedEvents: GameEvent[] = this.offlineSync.getMatchEvents(this.offlineSync.getActiveMatchId())): EngineEvent | null {
    const matchId = this.offlineSync.getActiveMatchId();
    const latestEvent = this.latestUndoableEvent(matchId, syncedEvents);
    if (!latestEvent) return null;
    this.offlineSync.undoLatestEvent([latestEvent], latestEvent.id);
    const localUndo = this.offlineSync.getMatchEvents(matchId).find(
      (event) => event.type === 'undo' && event.targetEventId === latestEvent.id,
    );
    const replayEvents = this.mergeEvents(syncedEvents, localUndo ? [localUndo] : []);
    const projection = this.replayAndProject(matchId, undefined, replayEvents);

    if (projection && projection.status !== 'final') {
      this.boxScoreQueuedForMatchId = null;
      this.matchEndedEventQueuedForMatchId = null;
    }

    return this.toEngineEvent(latestEvent);
  }

  private getPlayerAtCourtPosition(courtPosition: number): RosterPlayer | null {
    const playerId = this.projectedLineup()?.[courtPosition - 1] ?? this.teamRoster.lineup()[courtPosition - 1] ?? null;
    return this.teamRoster.getPlayerById(playerId);
  }

  private projectedLineup(): readonly string[] | null {
    const matchId = this.offlineSync.getActiveMatchId();
    const game = this.offlineSync.getGame(matchId);
    if (!game) return null;
    return projectionFromFirestore(game, this.offlineSync.getMatchEvents(matchId))?.lineup ?? null;
  }

  private queuePlayerStats(matchId: string): void {
    if (this.boxScoreQueuedForMatchId === matchId) {
      return;
    }

    const projection = this.currentProjection();
    if (!projection) return;
    const projectedStats = statsStateFromProjection(projection);
    const rows = projection.session.squad
      .slice()
      .sort((a, b) => a.jerseyNumber - b.jerseyNumber)
      .map((player) => {
        const stats = projectedStats[player.id];
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
          serveInPercentage: stats.serveAttempts === 0 ? null : stats.servesIn / stats.serveAttempts,
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

  private queueMatchBootstrap(matchId: string, servingTeam: PointSide, timestamp: string): void {
    this.offlineSync.queueGame({
      ...this.gameFields(matchId, timestamp),
      id: matchId,
      status: 'live',
      servingTeam,
      teamPoints: 0,
      opponentPoints: 0,
      teamSets: 0,
      opponentSets: 0,
      currentSet: 1,
      isMatchOver: false,
      isSetBreak: false,
      teamTimeoutsRemaining: 2,
      opponentTimeoutsRemaining: 2,
      teamRotation: 1,
      endedAt: null,
      updatedAt: timestamp,
    });
  }

  private queueGameSnapshot(
    matchId: string,
    projection: MatchProjection,
    timestamp = new Date().toISOString(),
  ): void {
    const state = scoreStateFromProjection(projection);
    const status = projection.status === 'final'
      ? 'final'
      : projection.status === 'ended-early'
        ? 'ended-early'
        : 'live';
    this.offlineSync.queueGame({
      ...this.gameFields(matchId, timestamp),
      id: matchId,
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
      endedAt: status === 'live' ? null : timestamp,
      updatedAt: timestamp,
    });
  }

  private gameFields(matchId: string, timestamp: string) {
    const existingGame = this.offlineSync.getGame(matchId);
    const startedAt = this.matchStartedAtByMatchId.get(matchId) ?? existingGame?.startedAt ?? timestamp;
    const opponentName =
      this.opponentNameByMatchId.get(matchId) ??
      this.normalizeOpponentName(existingGame?.opponentName);
    this.matchStartedAtByMatchId.set(matchId, startedAt);
    this.opponentNameByMatchId.set(matchId, opponentName);
    return {
      teamId: this.teamRoster.team().id,
      opponentName,
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
      createdAt: startedAt,
    };
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

  private replayAndProject(
    matchId: string,
    timestamp = new Date().toISOString(),
    events = this.offlineSync.getMatchEvents(matchId),
  ): MatchProjection | null {
    const game = this.offlineSync.getGame(matchId);
    if (!game) return null;
    const projection = projectionFromFirestore(game, events);
    if (!projection) return null;
    this.matchState.hydrateState(scoreStateFromProjection(projection));
    this.matchStats.replaceSnapshot(
      statsStateFromProjection(projection),
      setStatsStateFromProjection(projection),
    );
    this.queueGameSnapshot(matchId, projection, timestamp);
    return projection;
  }

  private currentProjection(): MatchProjection | null {
    const matchId = this.offlineSync.getActiveMatchId();
    const game = this.offlineSync.getGame(matchId);
    return game ? projectionFromFirestore(game, this.offlineSync.getMatchEvents(matchId)) : null;
  }

  private latestUndoableEvent(matchId: string, events: readonly GameEvent[]): GameEvent | null {
    const game = this.offlineSync.getGame(matchId);
    if (!game) return null;
    const projection = projectionFromFirestore(game, events);
    if (!projection) return null;
    const domainEvents = new Map(eventsFromFirestore(game, events).map((event) => [event.id, event]));
    const targetId = [...projection.appliedEventIds]
      .reverse()
      .find((eventId) => {
        const event = domainEvents.get(eventId);
        return !!event && event.kind !== 'match-started';
      });
    return targetId ? events.find((event) => event.id === targetId) ?? null : null;
  }

  private mergeEvents(left: readonly GameEvent[], right: readonly GameEvent[]): GameEvent[] {
    const byId = new Map<string, GameEvent>();
    [...left, ...right].forEach((event) => byId.set(event.id, event));
    return [...byId.values()].sort(
      (a, b) => (a.sequence ?? 0) - (b.sequence ?? 0) || a.createdAt.localeCompare(b.createdAt),
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

  private createEventId(prefix: string): string {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return `${prefix}-${crypto.randomUUID()}`;
    }
    return `${prefix}-${Date.now()}-${Math.floor(Math.random() * 100000)}`;
  }
}
