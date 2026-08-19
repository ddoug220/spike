import { Game, GameEvent, PlayerSetStats, TeamSide } from '../../models/firestore.models';
import { MatchArchiveSummary } from '../../services/offline-sync.service';

interface SquadPlayer {
  id: string;
  name: string;
  jerseyNumber: number | null;
}

interface SavedSetResult {
  setNumber: number;
  teamPoints: number;
  opponentPoints: number;
}

type ReviewGame = Game & {
  matchSquad?: SquadPlayer[];
  squadSnapshot?: SquadPlayer[];
  setResults?: SavedSetResult[];
};

type ReviewEvent = Omit<GameEvent, 'type'> & {
  type: string;
  sequence?: number;
  servingTeamBefore?: TeamSide;
  teamRotationBefore?: number;
  winner?: TeamSide;
  scoringTeam?: TeamSide;
  pointWinner?: TeamSide;
  targetRotation?: number;
  setNumber?: number;
};

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
  totalAttacks: number;
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

interface ReplayState {
  servingTeam: TeamSide;
  rotation: number;
  setNumber: number;
  teamPoints: number;
  opponentPoints: number;
  teamSets: number;
  opponentSets: number;
}

const TEAM_POINT_ACTIONS = new Set(['kill', 'ace', 'block', 'opponent-error']);
const OPPONENT_POINT_ACTIONS = new Set(['service-error', 'attack-error', 'receive-error', 'opponent-winner']);

export function buildMatchReview(
  game: Game | null,
  summary: MatchArchiveSummary | null,
  storedEvents: GameEvent[],
  stats: PlayerSetStats[],
): MatchReviewData | null {
  if (!game && !summary && storedEvents.length === 0) {
    return null;
  }

  const reviewGame = game as ReviewGame | null;
  const events = (storedEvents as ReviewEvent[])
    .filter((event) => !event.isDeleted)
    .slice()
    .sort(compareEvents);
  const boxScore = buildBoxScore(reviewGame, stats, events);
  const playerLabels = new Map(boxScore.map((row) => [row.playerId, playerLabel(row)]));
  const replay = replayEvents(events, playerLabels);
  const status = readStatus(reviewGame, summary, events);

  return {
    status,
    opponentName: reviewGame?.opponentName?.trim() || summary?.opponentName || 'Opponent',
    startedAt: reviewGame?.startedAt || summary?.startedAt || events[0]?.createdAt || '',
    teamSets: reviewGame?.teamSets ?? summary?.teamSets ?? replay.state.teamSets,
    opponentSets: reviewGame?.opponentSets ?? summary?.opponentSets ?? replay.state.opponentSets,
    teamPoints: reviewGame?.teamPoints ?? summary?.teamPoints ?? replay.state.teamPoints,
    opponentPoints: reviewGame?.opponentPoints ?? summary?.opponentPoints ?? replay.state.opponentPoints,
    sideOutWins: replay.sideOutWins,
    sideOutChances: replay.sideOutChances,
    sideOutRate: replay.sideOutChances === 0 ? null : replay.sideOutWins / replay.sideOutChances,
    rotations: labelRotationComparisons(replay.rotations),
    leaders: buildLeaders(boxScore),
    boxScore,
    sets: reviewGame?.setResults?.map(toSetResult) ?? replay.sets,
    timeline: replay.timeline,
  };
}

function replayEvents(events: ReviewEvent[], playerLabels: Map<string, string>): {
  state: ReplayState;
  sideOutWins: number;
  sideOutChances: number;
  rotations: Array<{ wins: number; rallies: number }>;
  sets: ReviewSetResult[];
  timeline: ReviewTimelineItem[];
} {
  const state: ReplayState = {
    servingTeam: 'team',
    rotation: 1,
    setNumber: 1,
    teamPoints: 0,
    opponentPoints: 0,
    teamSets: 0,
    opponentSets: 0,
  };
  const rotations = Array.from({ length: 6 }, () => ({ wins: 0, rallies: 0 }));
  const sets: ReviewSetResult[] = [];
  const timeline: ReviewTimelineItem[] = [];
  let sideOutWins = 0;
  let sideOutChances = 0;

  for (const event of events) {
    if (event.type === 'matchStarted') {
      state.servingTeam = event.servingTeam ?? state.servingTeam;
      state.rotation = validRotation(event.teamRotation) ?? state.rotation;
      state.setNumber = event.currentSet ?? state.setNumber;
      timeline.push(makeTimelineItem(event, state, playerLabels));
      continue;
    }

    const winner = rallyWinner(event);
    const serveBefore = event.servingTeamBefore ?? state.servingTeam;
    const rotationBefore = validRotation(event.teamRotationBefore) ?? state.rotation;
    const setBefore = event.actionSetNumber ?? event.setNumber ?? state.setNumber;
    const pointsBefore = { team: state.teamPoints, opponent: state.opponentPoints };
    const setsBefore = { team: state.teamSets, opponent: state.opponentSets };
    let setEndingScore: string | undefined;

    if (winner) {
      const rotationLine = rotations[rotationBefore - 1];
      rotationLine.rallies += 1;
      if (winner === 'team') {
        rotationLine.wins += 1;
      }
      if (serveBefore === 'opponent') {
        sideOutChances += 1;
        if (winner === 'team') {
          sideOutWins += 1;
        }
      }

      const nextTeamSets = event.teamSets ?? state.teamSets;
      const nextOpponentSets = event.opponentSets ?? state.opponentSets;
      if (nextTeamSets > setsBefore.team || nextOpponentSets > setsBefore.opponent) {
        const teamPoints = pointsBefore.team + (winner === 'team' ? 1 : 0);
        const opponentPoints = pointsBefore.opponent + (winner === 'opponent' ? 1 : 0);
        sets.push({ setNumber: setBefore, teamPoints, opponentPoints, won: teamPoints > opponentPoints });
        setEndingScore = `${teamPoints}–${opponentPoints}`;
      }

      state.servingTeam = winner;
      if (winner === 'team' && serveBefore === 'opponent') {
        state.rotation = state.rotation === 6 ? 1 : state.rotation + 1;
      }
    }

    timeline.push(makeTimelineItem(
      event,
      { ...state, rotation: rotationBefore, setNumber: setBefore },
      playerLabels,
      setEndingScore,
    ));

    if (typeof event.teamPoints === 'number') {
      state.teamPoints = event.teamPoints;
    } else if (winner === 'team') {
      state.teamPoints += 1;
    }
    if (typeof event.opponentPoints === 'number') {
      state.opponentPoints = event.opponentPoints;
    } else if (winner === 'opponent') {
      state.opponentPoints += 1;
    }
    state.teamSets = event.teamSets ?? state.teamSets;
    state.opponentSets = event.opponentSets ?? state.opponentSets;
    state.setNumber = event.currentSet ?? state.setNumber;

    if (winner) {
      state.servingTeam = event.servingTeam ?? state.servingTeam;
      state.rotation = validRotation(event.teamRotation) ?? state.rotation;
    } else if (event.type === 'setStarted') {
      state.servingTeam = event.servingTeam ?? state.servingTeam;
      state.rotation = validRotation(event.teamRotation) ?? state.rotation;
    } else if (event.type === 'serveTeamSet' || event.type === 'serveCorrection') {
      state.servingTeam = event.servingTeam ?? state.servingTeam;
    } else if (event.type === 'manualRotation' || event.type === 'rotationCorrection') {
      state.rotation = validRotation(event.targetRotation) ?? validRotation(event.teamRotation) ?? state.rotation;
    }
  }

  return { state, sideOutWins, sideOutChances, rotations, sets, timeline };
}

function buildBoxScore(game: ReviewGame | null, stats: PlayerSetStats[], events: ReviewEvent[]): ReviewBoxRow[] {
  const totalRows = stats.filter((row) => row.setNumber === null);
  const rows = totalRows.length > 0 ? totalRows : aggregateSetRows(stats);
  const byPlayer = new Map<string, ReviewBoxRow>();

  for (const player of game?.matchSquad ?? game?.squadSnapshot ?? []) {
    byPlayer.set(player.id, emptyBoxRow(player));
  }
  for (const row of rows) {
    byPlayer.set(row.playerId, {
      playerId: row.playerId,
      playerName: row.playerName,
      jerseyNumber: row.jerseyNumber,
      kills: row.kills,
      attackErrors: row.attackErrors,
      totalAttacks: row.totalAttacks,
      aces: row.aces,
      blocks: row.blocks,
      digs: row.digs,
      serviceErrors: row.serviceErrors,
      receiveErrors: row.receiveErrors ?? 0,
      serveAttempts: row.serveAttempts,
      servesIn: row.servesIn,
    });
  }

  const playerEvents = events.filter((event) => event.type === 'playerAction' && !!event.playerId);
  if (playerEvents.length > 0) {
    for (const [playerId, row] of byPlayer) {
      byPlayer.set(playerId, emptyBoxRow(row));
    }
    for (const event of playerEvents) {
      const playerId = event.playerId as string;
      const row = byPlayer.get(playerId) ?? emptyBoxRow({ id: playerId, name: 'Unknown player', jerseyNumber: null });
      addAction(row, event.action);
      byPlayer.set(playerId, row);

      if (event.inferredServeInServerPlayerId) {
        const serverId = event.inferredServeInServerPlayerId;
        const server = byPlayer.get(serverId) ?? emptyBoxRow({ id: serverId, name: 'Unknown player', jerseyNumber: null });
        server.serveAttempts += 1;
        server.servesIn += 1;
        byPlayer.set(serverId, server);
      }
    }
  }

  return Array.from(byPlayer.values()).sort((a, b) =>
    (a.jerseyNumber ?? Number.MAX_SAFE_INTEGER) - (b.jerseyNumber ?? Number.MAX_SAFE_INTEGER) ||
    a.playerName.localeCompare(b.playerName),
  );
}

function addAction(row: ReviewBoxRow, action: string): void {
  if (action === 'kill') {
    row.kills += 1;
    row.totalAttacks += 1;
  } else if (action === 'attack-error') {
    row.attackErrors += 1;
    row.totalAttacks += 1;
  } else if (action === 'ace') {
    row.aces += 1;
    row.serveAttempts += 1;
    row.servesIn += 1;
  } else if (action === 'block') {
    row.blocks += 1;
  } else if (action === 'dig') {
    row.digs += 1;
  } else if (action === 'service-error') {
    row.serviceErrors += 1;
    row.serveAttempts += 1;
  } else if (action === 'receive-error') {
    row.receiveErrors += 1;
  }
}

function aggregateSetRows(stats: PlayerSetStats[]): PlayerSetStats[] {
  const totals = new Map<string, PlayerSetStats>();
  for (const row of stats) {
    const current = totals.get(row.playerId);
    if (!current) {
      totals.set(row.playerId, { ...row, setNumber: null });
      continue;
    }
    current.kills += row.kills;
    current.attackErrors += row.attackErrors;
    current.totalAttacks += row.totalAttacks;
    current.aces += row.aces;
    current.blocks += row.blocks;
    current.digs += row.digs;
    current.serviceErrors += row.serviceErrors;
    current.receiveErrors += row.receiveErrors ?? 0;
    current.serveAttempts += row.serveAttempts;
    current.servesIn += row.servesIn;
  }
  return Array.from(totals.values());
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
    if (count === 0) {
      continue;
    }
    const players = rows.filter((row) => read(row) === count).map(playerLabel).join(', ');
    leaders.push({ label, count, players });
  }
  return leaders;
}

function labelRotationComparisons(lines: Array<{ wins: number; rallies: number }>): ReviewRate[] {
  const rates: ReviewRate[] = lines.map((line, index) => ({
    rotation: index + 1,
    wins: line.wins,
    rallies: line.rallies,
    rate: line.rallies === 0 ? null : line.wins / line.rallies,
    comparison: null,
  }));
  const qualified = rates.filter((line) => line.rallies >= 5 && line.rate !== null);
  const values = qualified.map((line) => line.rate as number);
  if (qualified.length < 2 || new Set(values).size === 1) {
    return rates;
  }
  const high = Math.max(...values);
  const low = Math.min(...values);
  return rates.map((line) => ({
    ...line,
    comparison: line.rallies < 5 ? null : line.rate === high ? 'Strongest' : line.rate === low ? 'Weakest' : null,
  }));
}

function makeTimelineItem(
  event: ReviewEvent,
  state: ReplayState,
  labels: Map<string, string>,
  scoreAtSetEnd?: string,
): ReviewTimelineItem {
  const title = describeEvent(event, labels);
  const score = scoreAtSetEnd ?? (typeof event.teamPoints === 'number' && typeof event.opponentPoints === 'number'
    ? `${event.teamPoints}–${event.opponentPoints}`
    : `${state.teamPoints}–${state.opponentPoints}`);
  return {
    id: event.id || `${event.type}-${event.createdAt}`,
    createdAt: event.createdAt,
    title,
    context: `Set ${state.setNumber} · R${state.rotation} · ${score}`,
  };
}

function describeEvent(event: ReviewEvent, labels: Map<string, string>): string {
  const player = event.playerId ? labels.get(event.playerId) : null;
  switch (event.type) {
    case 'matchStarted': return 'Match started';
    case 'setStarted': {
      const setNumber = event.setNumber ?? event.currentSet;
      return setNumber ? `Set ${setNumber} started` : 'Set started';
    }
    case 'matchEnded': return `Match finished ${event.teamSets ?? 0}–${event.opponentSets ?? 0}`;
    case 'matchEndedEarly':
    case 'endedEarly': return 'Match ended early';
    case 'opponentPoint': return 'Opponent winner';
    case 'playerAction':
    case 'rallyOutcome': return event.action === 'opponent-error'
      ? 'Opponent error'
      : `${titleCase(event.action)}${player ? ` · ${player}` : ''}`;
    case 'substitution': return `Substitution${labels.get(event.outPlayerId ?? '') ? ` · ${labels.get(event.outPlayerId ?? '')} out` : ''}${labels.get(event.inPlayerId ?? '') ? `, ${labels.get(event.inPlayerId ?? '')} in` : ''}`;
    case 'timeoutCalled': return `${event.timeoutTeam === 'opponent' ? 'Opponent' : 'Team'} timeout`;
    case 'serveTeamSet':
    case 'serveCorrection': return `Serve corrected · ${event.servingTeam === 'opponent' ? 'Opponent' : 'Team'}`;
    case 'manualRotation':
    case 'rotationCorrection': return `Rotation corrected · R${event.targetRotation ?? event.targetTeamRotation ?? event.teamRotation ?? stateFallbackRotation(event)}`;
    case 'undo': return 'Last action undone';
    default: return titleCase(event.type);
  }
}

function rallyWinner(event: ReviewEvent): TeamSide | null {
  const savedWinner = event.winner ?? event.scoringTeam ?? event.pointWinner;
  if (savedWinner === 'team' || savedWinner === 'opponent') {
    return savedWinner;
  }
  if (event.type === 'opponentPoint') {
    return 'opponent';
  }
  if (event.type !== 'playerAction' && event.type !== 'rallyOutcome') {
    return null;
  }
  if (TEAM_POINT_ACTIONS.has(event.action)) {
    return 'team';
  }
  return OPPONENT_POINT_ACTIONS.has(event.action) ? 'opponent' : null;
}

function readStatus(game: ReviewGame | null, summary: MatchArchiveSummary | null, events: ReviewEvent[]): MatchReviewData['status'] {
  if (game?.status === 'ended-early' || events.some((event) => event.type === 'endedEarly' || event.type === 'matchEndedEarly')) {
    return 'ended-early';
  }
  return game?.isMatchOver || summary?.isFinal || events.some((event) => event.type === 'matchEnded') ? 'final' : 'live';
}

function compareEvents(a: ReviewEvent, b: ReviewEvent): number {
  if (typeof a.sequence === 'number' && typeof b.sequence === 'number') {
    return a.sequence - b.sequence;
  }
  return a.createdAt.localeCompare(b.createdAt);
}

function validRotation(value: number | undefined): number | null {
  return Number.isInteger(value) && (value as number) >= 1 && (value as number) <= 6 ? value as number : null;
}

function playerLabel(row: Pick<ReviewBoxRow, 'playerName' | 'jerseyNumber'>): string {
  return `#${row.jerseyNumber ?? '–'} ${row.playerName}`;
}

function emptyBoxRow(player: SquadPlayer | ReviewBoxRow): ReviewBoxRow {
  return {
    playerId: 'playerId' in player ? player.playerId : player.id,
    playerName: 'playerName' in player ? player.playerName : player.name,
    jerseyNumber: player.jerseyNumber,
    kills: 0,
    attackErrors: 0,
    totalAttacks: 0,
    aces: 0,
    blocks: 0,
    digs: 0,
    serviceErrors: 0,
    receiveErrors: 0,
    serveAttempts: 0,
    servesIn: 0,
  };
}

function toSetResult(result: SavedSetResult): ReviewSetResult {
  return { ...result, won: result.teamPoints > result.opponentPoints };
}

function titleCase(value: string): string {
  return value.replace(/[-_]/g, ' ').replace(/\b\w/g, (character) => character.toUpperCase());
}

function stateFallbackRotation(event: ReviewEvent): number {
  return validRotation(event.rotationPosition) ?? 1;
}
