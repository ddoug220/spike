import {
  type Lineup,
  type MatchEvent,
  type MatchSession,
  type RallyAction,
  type RallyOutcomeEvent,
  type SetNumber,
  type TeamRotation,
  type TeamSide,
  rallyWinner,
} from './match-event';

export type MatchStatus = 'scheduled' | 'live' | 'set-break' | 'final' | 'ended-early';

export interface SetResult {
  setNumber: SetNumber;
  teamPoints: number;
  opponentPoints: number;
  winner: TeamSide;
}

export interface RallyRecord {
  eventId: string;
  rallyId: string;
  setNumber: SetNumber;
  action: RallyAction;
  playerId?: string;
  winner: TeamSide;
  servingTeam: TeamSide;
  teamRotation: TeamRotation;
  lineup: Lineup;
}

export interface StatRecord {
  eventId: string;
  rallyId: string;
  setNumber: SetNumber;
  action: 'dig';
  playerId: string;
}

export interface SubmittedSet {
  setNumber: SetNumber;
  lineup: Lineup;
  servingTeam: TeamSide;
}

export interface MatchProjection {
  session: MatchSession;
  status: MatchStatus;
  currentSet: SetNumber;
  teamPoints: number;
  opponentPoints: number;
  teamSets: number;
  opponentSets: number;
  servingTeam: TeamSide;
  teamRotation: TeamRotation;
  lineup: Lineup | null;
  teamTimeoutsRemaining: number;
  opponentTimeoutsRemaining: number;
  submittedSets: readonly SubmittedSet[];
  completedSets: readonly SetResult[];
  rallies: readonly RallyRecord[];
  observations: readonly StatRecord[];
  appliedEventIds: readonly string[];
  tombstonedEventIds: ReadonlySet<string>;
}

const TIMEOUTS_PER_SET = 2;

export function reduceMatch(session: MatchSession, history: readonly MatchEvent[]): MatchProjection {
  const events = [...history]
    .filter((event) => event.matchId === session.id && event.schemaVersion === session.schemaVersion)
    .sort((left, right) => left.sequence - right.sequence || left.id.localeCompare(right.id));
  const tombstones = new Set(events.filter((event) => event.kind === 'undo').map((event) => event.targetEventId));

  return events.reduce((state, event) => {
    if (event.kind === 'undo' || tombstones.has(event.id) || state.appliedEventIds.includes(event.id)) {
      return state;
    }
    return applyEvent(state, event);
  }, initialProjection(session, tombstones));
}

function initialProjection(session: MatchSession, tombstones: ReadonlySet<string>): MatchProjection {
  return {
    session,
    status: 'scheduled',
    currentSet: 1,
    teamPoints: 0,
    opponentPoints: 0,
    teamSets: 0,
    opponentSets: 0,
    servingTeam: 'team',
    teamRotation: 1,
    lineup: null,
    teamTimeoutsRemaining: TIMEOUTS_PER_SET,
    opponentTimeoutsRemaining: TIMEOUTS_PER_SET,
    submittedSets: [],
    completedSets: [],
    rallies: [],
    observations: [],
    appliedEventIds: [],
    tombstonedEventIds: tombstones,
  };
}

function applyEvent(state: MatchProjection, event: Exclude<MatchEvent, { kind: 'undo' }>): MatchProjection {
  switch (event.kind) {
    case 'match-started':
      if (state.status !== 'scheduled') return state;
      return applied(state, event.id, {
        status: 'live',
        lineup: event.lineup,
        servingTeam: event.servingTeam,
        submittedSets: [{ setNumber: 1, lineup: event.lineup, servingTeam: event.servingTeam }],
      });
    case 'set-started':
      if (state.status !== 'set-break' || event.setNumber !== state.currentSet + 1) return state;
      return applied(state, event.id, {
        status: 'live',
        currentSet: event.setNumber,
        teamPoints: 0,
        opponentPoints: 0,
        servingTeam: event.servingTeam,
        teamRotation: 1,
        lineup: event.lineup,
        teamTimeoutsRemaining: TIMEOUTS_PER_SET,
        opponentTimeoutsRemaining: TIMEOUTS_PER_SET,
        submittedSets: [
          ...state.submittedSets,
          { setNumber: event.setNumber, lineup: event.lineup, servingTeam: event.servingTeam },
        ],
      });
    case 'rally-outcome':
      return applyRally(state, event);
    case 'stat-observation':
      if (state.status !== 'live') return state;
      return applied(state, event.id, {
        observations: [
          ...state.observations,
          {
            eventId: event.id,
            rallyId: event.rallyId,
            setNumber: state.currentSet,
            action: event.action,
            playerId: event.playerId,
          },
        ],
      });
    case 'substitution': {
      if (state.status !== 'live' || !state.lineup) return state;
      const index = event.position ? event.position - 1 : state.lineup.indexOf(event.outPlayerId);
      if (index < 0 || state.lineup[index] !== event.outPlayerId) return state;
      const lineup = [...state.lineup] as string[];
      lineup[index] = event.inPlayerId;
      return applied(state, event.id, { lineup: toLineup(lineup) });
    }
    case 'timeout-called': {
      if (state.status !== 'live') return state;
      const remaining = event.team === 'team' ? state.teamTimeoutsRemaining : state.opponentTimeoutsRemaining;
      if (remaining === 0) return state;
      return applied(state, event.id, {
        teamTimeoutsRemaining: event.team === 'team' ? remaining - 1 : state.teamTimeoutsRemaining,
        opponentTimeoutsRemaining: event.team === 'opponent' ? remaining - 1 : state.opponentTimeoutsRemaining,
      });
    }
    case 'serve-corrected':
      if (state.status !== 'live' || state.servingTeam === event.servingTeam) return state;
      return applied(state, event.id, { servingTeam: event.servingTeam });
    case 'rotation-corrected':
      if (state.status !== 'live' || !state.lineup || state.teamRotation === event.targetRotation) return state;
      return applied(state, event.id, {
        teamRotation: event.targetRotation,
        lineup: rotateLineup(state.lineup, rotationSteps(state.teamRotation, event.targetRotation)),
      });
    case 'match-ended-early':
      if (state.status !== 'live' && state.status !== 'set-break') return state;
      return applied(state, event.id, { status: 'ended-early' });
  }
}

function applyRally(state: MatchProjection, event: RallyOutcomeEvent): MatchProjection {
  if (state.status !== 'live' || !state.lineup) return state;

  const winner = rallyWinner(event.action);
  const rally: RallyRecord = {
    eventId: event.id,
    rallyId: event.rallyId,
    setNumber: state.currentSet,
    action: event.action,
    playerId: 'playerId' in event ? event.playerId : undefined,
    winner,
    servingTeam: state.servingTeam,
    teamRotation: state.teamRotation,
    lineup: state.lineup,
  };
  const sideOut = winner !== state.servingTeam;
  const teamPoints = state.teamPoints + (winner === 'team' ? 1 : 0);
  const opponentPoints = state.opponentPoints + (winner === 'opponent' ? 1 : 0);
  const teamSideOut = winner === 'team' && sideOut;
  const nextLineup = teamSideOut ? rotateLineup(state.lineup, 1) : state.lineup;
  const nextRotation = teamSideOut ? nextTeamRotation(state.teamRotation) : state.teamRotation;
  const next = applied(state, event.id, {
    teamPoints,
    opponentPoints,
    servingTeam: winner,
    teamRotation: nextRotation,
    lineup: nextLineup,
    rallies: [...state.rallies, rally],
  });

  if (!hasSetWinner(state.currentSet, teamPoints, opponentPoints)) return next;

  const setWinner: TeamSide = teamPoints > opponentPoints ? 'team' : 'opponent';
  const teamSets = state.teamSets + (setWinner === 'team' ? 1 : 0);
  const opponentSets = state.opponentSets + (setWinner === 'opponent' ? 1 : 0);
  return {
    ...next,
    status: teamSets === 3 || opponentSets === 3 ? 'final' : 'set-break',
    teamSets,
    opponentSets,
    completedSets: [
      ...state.completedSets,
      { setNumber: state.currentSet, teamPoints, opponentPoints, winner: setWinner },
    ],
  };
}

function applied(
  state: MatchProjection,
  eventId: string,
  changes: Partial<Omit<MatchProjection, 'session' | 'appliedEventIds' | 'tombstonedEventIds'>>,
): MatchProjection {
  return { ...state, ...changes, appliedEventIds: [...state.appliedEventIds, eventId] };
}

function hasSetWinner(setNumber: number, teamPoints: number, opponentPoints: number): boolean {
  const target = setNumber === 5 ? 15 : 25;
  return Math.max(teamPoints, opponentPoints) >= target && Math.abs(teamPoints - opponentPoints) >= 2;
}

function nextTeamRotation(rotation: TeamRotation): TeamRotation {
  return (rotation === 6 ? 1 : rotation + 1) as TeamRotation;
}

function rotationSteps(from: TeamRotation, to: TeamRotation): number {
  return (to - from + 6) % 6;
}

function rotateLineup(lineup: Lineup, steps: number): Lineup {
  const offset = steps % 6;
  return toLineup(lineup.map((_, index) => lineup[(index + offset) % 6]));
}

function toLineup(players: readonly string[]): Lineup {
  if (players.length !== 6) throw new Error('A lineup must contain six players.');
  return [players[0], players[1], players[2], players[3], players[4], players[5]];
}
