import type { Game, GameEvent } from '../models/firestore.models';
import type { MatchScoreState } from './match-state.service';
import type { PlayerStatLine, StatsState } from './match-stats.service';
import {
  MATCH_SCHEMA_VERSION,
  type CourtPosition,
  type Lineup,
  type MatchEvent,
  type MatchProjection,
  type MatchSession,
  type PlayerRallyAction,
  type RallyAction,
  type TeamRotation,
  selectPlayerCountStats,
} from '../domain/match-v2';

export function sessionFromGame(game: Game): MatchSession | null {
  if (game.schemaVersion !== MATCH_SCHEMA_VERSION || !game.matchSquad) return null;
  return {
    schemaVersion: MATCH_SCHEMA_VERSION,
    id: game.id,
    ownerId: game.ownerId,
    teamId: game.teamId,
    opponentName: game.opponentName,
    squad: game.matchSquad.map((player) => ({ ...player })),
    createdAt: game.createdAt,
  };
}

export function eventsFromFirestore(game: Game, storedEvents: readonly GameEvent[]): MatchEvent[] {
  const fallbackLineup = readLineup(game.startingLineup);
  return storedEvents
    .filter((event) => !event.isDeleted && (event.schemaVersion ?? game.schemaVersion) === MATCH_SCHEMA_VERSION)
    .map((event, index) => toDomainEvent(game, event, index + 1, fallbackLineup))
    .filter((event): event is MatchEvent => event !== null);
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
      sideOutOpportunities: 0,
      sideOutConversions: 0,
    } satisfies PlayerStatLine;
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
    sequence: event.sequence ?? fallbackSequence,
    writerGeneration: event.writerGeneration ?? game.writerGeneration ?? 1,
    occurredAt: event.createdAt,
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
        return { ...base, kind, rallyId: event.rallyId ?? event.id, action, playerId: event.playerId };
      }
      return { ...base, kind, rallyId: event.rallyId ?? event.id, action };
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

function readSetNumber(value: number | undefined): 1 | 2 | 3 | 4 | 5 | null {
  return typeof value === 'number' && value >= 1 && value <= 5 && Number.isInteger(value)
    ? (value as 1 | 2 | 3 | 4 | 5)
    : null;
}

function isOneToSix(value: number | undefined): boolean {
  return typeof value === 'number' && value >= 1 && value <= 6 && Number.isInteger(value);
}
