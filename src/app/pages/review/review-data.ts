import {
  MatchEvent,
  MatchProjection,
  selectPlayerCountStats,
  selectRotationRallyWinRates,
  selectTeamSideOut,
} from '../../domain/match-v2';
import { Game, GameEvent } from '../../models/firestore.models';
import { eventsFromFirestore, projectionFromFirestore } from '../../services/match-v2.adapter';

export interface ReviewRate {
  rotation: number;
  wins: number;
  rallies: number;
  rate: number | null;
  comparison: 'Strongest' | 'Weakest' | null;
}

export interface ReviewLeader {
  label: string;
  count: number;
  players: string;
}

export interface ReviewBoxRow {
  playerId: string;
  playerName: string;
  jerseyNumber: number | null;
  kills: number;
  attackErrors: number;
  aces: number;
  blocks: number;
  digs: number;
  serviceErrors: number;
  receiveErrors: number;
  serveAttempts: number;
  servesIn: number;
}

export interface ReviewSetResult {
  setNumber: number;
  teamPoints: number;
  opponentPoints: number;
  won: boolean;
}

export interface ReviewTimelineItem {
  id: string;
  createdAt: string;
  title: string;
  context: string;
}

export interface MatchReviewData {
  status: 'live' | 'final' | 'ended-early';
  opponentName: string;
  teamName: string;
  currentSet: number;
  startedAt: string;
  teamSets: number;
  opponentSets: number;
  teamPoints: number;
  opponentPoints: number;
  sideOutWins: number;
  sideOutChances: number;
  sideOutRate: number | null;
  rotations: ReviewRate[];
  leaders: ReviewLeader[];
  boxScore: ReviewBoxRow[];
  sets: ReviewSetResult[];
  timeline: ReviewTimelineItem[];
}

export function buildMatchReview(game: Game | null, storedEvents: GameEvent[]): MatchReviewData | null {
  if (!game) return null;
  const events = eventsFromFirestore(game, storedEvents);
  const match = projectionFromFirestore(game, storedEvents);
  if (!match) return null;
  const sideOut = selectTeamSideOut(match);
  const boxScore = buildBoxScore(match);

  return {
    status: match.status === 'ended-early' ? 'ended-early' : match.status === 'final' ? 'final' : 'live',
    opponentName: match.session.opponentName,
    teamName: match.session.teamName ?? 'Team',
    currentSet: match.currentSet,
    startedAt: match.session.createdAt,
    teamSets: match.teamSets,
    opponentSets: match.opponentSets,
    teamPoints: match.teamPoints,
    opponentPoints: match.opponentPoints,
    sideOutWins: sideOut.won,
    sideOutChances: sideOut.total,
    sideOutRate: ratio(sideOut.won, sideOut.total),
    rotations: buildRotationRates(match),
    leaders: buildLeaders(boxScore),
    boxScore,
    sets: match.completedSets.map((set) => ({
      setNumber: set.setNumber,
      teamPoints: set.teamPoints,
      opponentPoints: set.opponentPoints,
      won: set.winner === 'team',
    })),
    timeline: buildTimeline(match, events),
  };
}

function buildBoxScore(match: MatchProjection): ReviewBoxRow[] {
  const players = new Map(match.session.squad.map((player) => [player.id, player]));
  return selectPlayerCountStats(match)
    .map((stats) => {
      const player = players.get(stats.playerId);
      return {
        playerId: stats.playerId,
        playerName: player?.name ?? 'Unknown player',
        jerseyNumber: player?.jerseyNumber ?? null,
        kills: stats.kills,
        attackErrors: stats.attackErrors,
        aces: stats.aces,
        blocks: stats.blocks,
        digs: stats.digs,
        serviceErrors: stats.serviceErrors,
        receiveErrors: stats.receiveErrors,
        serveAttempts: stats.serveAttempts,
        servesIn: stats.servesIn,
      };
    })
    .sort((left, right) =>
      (left.jerseyNumber ?? Number.MAX_SAFE_INTEGER) - (right.jerseyNumber ?? Number.MAX_SAFE_INTEGER) ||
      left.playerName.localeCompare(right.playerName),
    );
}

function buildRotationRates(match: MatchProjection): ReviewRate[] {
  const rates = selectRotationRallyWinRates(match);
  const rows: ReviewRate[] = ([1, 2, 3, 4, 5, 6] as const).map((rotation) => ({
    rotation,
    wins: rates[rotation].won,
    rallies: rates[rotation].total,
    rate: ratio(rates[rotation].won, rates[rotation].total),
    comparison: null,
  }));
  const qualified = rows.filter((row) => row.rallies >= 5 && row.rate !== null);
  const values = qualified.map((row) => row.rate as number);
  if (qualified.length < 2 || new Set(values).size === 1) return rows;
  const high = Math.max(...values);
  const low = Math.min(...values);
  return rows.map((row) => ({
    ...row,
    comparison: row.rallies < 5 ? null : row.rate === high ? 'Strongest' : row.rate === low ? 'Weakest' : null,
  }));
}

function buildLeaders(rows: ReviewBoxRow[]): ReviewLeader[] {
  const fields: Array<{ label: string; read: (row: ReviewBoxRow) => number }> = [
    { label: 'Kills', read: (row) => row.kills },
    { label: 'Aces', read: (row) => row.aces },
    { label: 'Digs', read: (row) => row.digs },
    { label: 'Blocks', read: (row) => row.blocks },
  ];
  const leaders: ReviewLeader[] = [];
  for (const { label, read } of fields) {
    const count = Math.max(0, ...rows.map(read));
    if (count > 0) {
      leaders.push({
        label,
        count,
        players: rows.filter((row) => read(row) === count).map(playerLabel).join(', '),
      });
    }
  }
  return leaders;
}

function buildTimeline(match: MatchProjection, events: MatchEvent[]): ReviewTimelineItem[] {
  const activeIds = new Set(match.appliedEventIds);
  return events
    .filter((event) => event.kind !== 'undo' && activeIds.has(event.id))
    .map((event) => {
      const rally = match.rallies.find((item) => item.eventId === event.id);
      if (rally) {
        const player = rally.playerId ? match.session.squad.find((item) => item.id === rally.playerId) : null;
        return {
          id: event.id,
          createdAt: event.occurredAt,
          title: actionLabel(rally.action, player ? `#${player.jerseyNumber} ${player.name}` : null),
          context: `Set ${rally.setNumber} · R${rally.teamRotation} · ${rally.servingTeam === 'team' ? 'Team' : 'Opponent'} serving`,
        };
      }
      const observation = match.observations.find((item) => item.eventId === event.id);
      if (observation) {
        const player = match.session.squad.find((item) => item.id === observation.playerId);
        return {
          id: event.id,
          createdAt: event.occurredAt,
          title: `Dig${player ? ` · #${player.jerseyNumber} ${player.name}` : ''}`,
          context: `Set ${observation.setNumber} · rally in progress`,
        };
      }
      return {
        id: event.id,
        createdAt: event.occurredAt,
        title: eventLabel(event),
        context: `Set ${event.setNumber ?? 1}`,
      };
    });
}

function eventLabel(event: MatchEvent): string {
  switch (event.kind) {
    case 'match-started': return 'Match started';
    case 'set-started': return `Set ${event.setNumber} started`;
    case 'substitution': return 'Substitution';
    case 'timeout-called': return `${event.team === 'team' ? 'Team' : 'Opponent'} timeout`;
    case 'serve-corrected': return 'Serve corrected';
    case 'rotation-corrected': return `Rotation corrected to R${event.targetRotation}`;
    case 'match-ended-early': return 'Match ended early';
    case 'rally-outcome':
    case 'stat-observation':
    case 'undo': return 'Event';
  }
}

function actionLabel(action: string, player: string | null): string {
  const labels: Record<string, string> = {
    kill: 'Kill', 'attack-error': 'Attack error', ace: 'Ace', 'service-error': 'Service error',
    'receive-error': 'Receive error', block: 'Block', 'opponent-error': 'Opponent error',
    'opponent-winner': 'Opponent winner',
  };
  return `${labels[action] ?? action}${player ? ` · ${player}` : ''}`;
}

function playerLabel(row: ReviewBoxRow): string {
  return `${row.jerseyNumber === null ? '' : `#${row.jerseyNumber} `}${row.playerName}`;
}

function ratio(value: number, total: number): number | null {
  return total === 0 ? null : value / total;
}
