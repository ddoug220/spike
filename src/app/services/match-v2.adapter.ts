import type { Game, GameEvent } from '../models/firestore.models';
import type { MatchScoreState } from './match-state.service';
import type { PlayerStatLine, SetStatsState, StatsState } from './match-stats.service';
import {
  MATCH_SCHEMA_VERSION,
  type CourtPosition,
  type Lineup,
  type MatchEvent,
  type MatchProjection,
  type MatchSession,
  type PlayerRallyAction,
  type RallyAction,
  type SetNumber,
  type TeamRotation,
  selectPlayerCountStats,
  reduceMatch,
} from '../domain/match-v2';

export function projectionFromFirestore(game: Game, storedEvents: readonly GameEvent[]): MatchProjection | null {
  const session = sessionFromGame(game);
  return session ? reduceMatch(session, eventsFromFirestore(game, storedEvents)) : null;
}

export function sessionFromGame(game: Game): MatchSession | null {
  if (game.schemaVersion !== MATCH_SCHEMA_VERSION || !game.matchSquad) return null;
  return {
    schemaVersion: MATCH_SCHEMA_VERSION,
    id: game.id,
    ownerId: game.ownerId,
    teamId: game.teamId,
    teamName: game.teamName,
    opponentName: game.opponentName,
    squad: game.matchSquad.map((player) => ({ ...player })),
    createdAt: game.createdAt,
  };
}

export function eventsFromFirestore(game: Game, storedEvents: readonly GameEvent[]): MatchEvent[] {
  const fallbackLineup = readLineup(game.startingLineup);
  return eventsFromValidWriters(game, storedEvents)
    .filter((event) => !event.isDeleted && (event.schemaVersion ?? game.schemaVersion) === MATCH_SCHEMA_VERSION)
    .map((event, index) => toDomainEvent(game, event, index + 1, fallbackLineup))
    .filter((event): event is MatchEvent => event !== null);
}

function eventsFromValidWriters(game: Game, storedEvents: readonly GameEvent[]): GameEvent[] {
  const currentGeneration = game.writerGeneration ?? 1;
  const ordered = [...storedEvents].sort(
    (left, right) => (left.sequence ?? 0) - (right.sequence ?? 0) || left.createdAt.localeCompare(right.createdAt),
  );
  const firstCurrentSequence = ordered.find((event) => (event.writerGeneration ?? 1) === currentGeneration)?.sequence;

  return ordered.filter((event) => {
    const generation = event.writerGeneration ?? 1;
    if (generation === currentGeneration) {
      return !game.writerDeviceId || !event.writerDeviceId || event.writerDeviceId === game.writerDeviceId;
    }
    return generation < currentGeneration &&
      (firstCurrentSequence === undefined || (event.sequence ?? 0) < firstCurrentSequence);
  });
}

export function scoreStateFromProjection(state: MatchProjection): MatchScoreState {
  return {
    teamPoints: state.teamPoints,
    opponentPoints: state.opponentPoints,
    teamSets: state.teamSets,
    opponentSets: state.opponentSets,
    currentSet: state.currentSet,
    servingTeam: state.servingTeam,
    isMatchOver: state.status === 'final' || state.status === 'ended-early',
    isSetBreak: state.status === 'set-break',
    teamTimeoutsRemaining: state.teamTimeoutsRemaining,
    opponentTimeoutsRemaining: state.opponentTimeoutsRemaining,
    teamRotation: state.teamRotation,
  };
}

export function statsStateFromProjection(state: MatchProjection): StatsState {
  const stats: StatsState = {};
  for (const player of selectPlayerCountStats(state)) {
    stats[player.playerId] = {
      kills: player.kills,
      attackErrors: player.attackErrors,
      totalAttacks: player.totalAttacks,
      aces: player.aces,
      serveAttempts: player.serveAttempts,
      servesIn: player.servesIn,
      blocks: player.blocks,
      digs: player.digs,
      serviceErrors: player.serviceErrors,
      receiveErrors: player.receiveErrors,
    } satisfies PlayerStatLine;
  }
  return stats;
}

export function setStatsStateFromProjection(state: MatchProjection): SetStatsState {
  const stats: SetStatsState = {};
  for (const rally of state.rallies) {
    if (!rally.playerId || (rally.action !== 'kill' && rally.action !== 'attack-error')) continue;
    const current = stats[rally.playerId]?.[rally.setNumber] ?? {
      kills: 0,
      attackErrors: 0,
      totalAttacks: 0,
    };
    stats[rally.playerId] = {
      ...(stats[rally.playerId] ?? {}),
      [rally.setNumber]: {
        kills: current.kills + (rally.action === 'kill' ? 1 : 0),
        attackErrors: current.attackErrors + (rally.action === 'attack-error' ? 1 : 0),
        totalAttacks: current.totalAttacks + 1,
      },
    };
  }
  return stats;
}

function toDomainEvent(
  game: Game,
  event: GameEvent,
  fallbackSequence: number,
  fallbackLineup: Lineup | null,
): MatchEvent | null {
  const base = {
    schemaVersion: MATCH_SCHEMA_VERSION,
    id: event.id,
    matchId: event.gameId,
    ownerId: event.ownerId,
    sequence: event.sequence ?? fallbackSequence,
    writerGeneration: event.writerGeneration ?? game.writerGeneration ?? 1,
    occurredAt: event.createdAt,
    setNumber: readSetNumber(event.setNumber ?? event.actionSetNumber ?? event.currentSet) ?? 1,
  } as const;
  const kind = event.eventKind ?? legacyKind(event);

  switch (kind) {
    case 'match-started': {
      const lineup = readLineup(event.lineup) ?? fallbackLineup;
      if (!lineup) return null;
      return { ...base, kind, lineup, servingTeam: event.servingTeam ?? game.servingTeam };
    }
    case 'set-started': {
      const lineup = readLineup(event.lineup) ?? fallbackLineup;
      const setNumber = readSetNumber(event.setNumber ?? event.actionSetNumber ?? event.currentSet);
      if (!lineup || !setNumber || setNumber === 1) return null;
      return { ...base, kind, setNumber, lineup, servingTeam: event.servingTeam ?? game.servingTeam };
    }
    case 'rally-outcome': {
      const action = readRallyAction(event);
      if (!action) return null;
      if (needsPlayer(action)) {
        if (!event.playerId) return null;
        return {
          ...base,
          kind,
          rallyId: event.rallyId ?? event.id,
          action,
          playerId: event.playerId,
          servingTeamBefore: event.servingTeamBefore!,
          teamRotationBefore: readTeamRotation(event.teamRotationBefore)!,
        };
      }
      return {
        ...base,
        kind,
        rallyId: event.rallyId ?? event.id,
        action,
        servingTeamBefore: event.servingTeamBefore!,
        teamRotationBefore: readTeamRotation(event.teamRotationBefore)!,
      };
    }
    case 'stat-observation':
      if (event.action !== 'dig' || !event.playerId) return null;
      return { ...base, kind, rallyId: event.rallyId ?? event.id, action: 'dig', playerId: event.playerId };
    case 'substitution': {
      if (!event.outPlayerId || !event.inPlayerId) return null;
      const position = readCourtPosition(event.courtPosition ?? event.rotationPosition);
      return {
        ...base,
        kind,
        position: position ?? undefined,
        outPlayerId: event.outPlayerId,
        inPlayerId: event.inPlayerId,
      };
    }
    case 'timeout-called': {
      const team = event.timeoutTeam;
      return team ? { ...base, kind, team } : null;
    }
    case 'serve-corrected': {
      const servingTeam = event.servingTeam;
      return servingTeam ? { ...base, kind, servingTeam } : null;
    }
    case 'rotation-corrected': {
      const targetRotation = readTeamRotation(event.targetRotation ?? event.targetTeamRotation ?? event.teamRotation);
      return targetRotation ? { ...base, kind, targetRotation } : null;
    }
    case 'match-ended-early':
      return { ...base, kind };
    case 'undo':
      return event.targetEventId ? { ...base, kind, targetEventId: event.targetEventId } : null;
    default:
      return null;
  }
}

function legacyKind(event: GameEvent): GameEvent['eventKind'] | null {
  switch (event.type) {
    case 'matchStarted':
      return 'match-started';
    case 'setStarted':
      return 'set-started';
    case 'playerAction':
      return event.action === 'dig' ? 'stat-observation' : 'rally-outcome';
    case 'opponentPoint':
      return 'rally-outcome';
    case 'substitution':
      return 'substitution';
    case 'timeoutCalled':
      return 'timeout-called';
    case 'serveTeamSet':
      return 'serve-corrected';
    case 'manualRotation':
      return 'rotation-corrected';
    case 'matchEndedEarly':
      return 'match-ended-early';
    case 'undo':
      return 'undo';
    case 'matchEnded':
      return null;
  }
}

function readRallyAction(event: GameEvent): RallyAction | null {
  if (event.type === 'opponentPoint' || event.action === 'opponent-point') return 'opponent-winner';
  switch (event.action) {
    case 'kill':
    case 'attack-error':
    case 'ace':
    case 'service-error':
    case 'receive-error':
    case 'block':
    case 'opponent-error':
    case 'opponent-winner':
      return event.action;
    default:
      return null;
  }
}

function needsPlayer(action: RallyAction): action is PlayerRallyAction {
  return action !== 'opponent-error' && action !== 'opponent-winner';
}

function readLineup(value: readonly (string | null)[] | undefined): Lineup | null {
  if (!value || value.length !== 6 || value.some((playerId) => !playerId)) return null;
  return [value[0]!, value[1]!, value[2]!, value[3]!, value[4]!, value[5]!];
}

function readCourtPosition(value: number | undefined): CourtPosition | null {
  return isOneToSix(value) ? (value as CourtPosition) : null;
}

function readTeamRotation(value: number | undefined): TeamRotation | null {
  return isOneToSix(value) ? (value as TeamRotation) : null;
}

function readSetNumber(value: number | undefined): SetNumber | null {
  return typeof value === 'number' && value >= 1 && value <= 5 && Number.isInteger(value)
    ? (value as SetNumber)
    : null;
}

function isOneToSix(value: number | undefined): boolean {
  return typeof value === 'number' && value >= 1 && value <= 6 && Number.isInteger(value);
}
