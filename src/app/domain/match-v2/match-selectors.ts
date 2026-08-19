import type { MatchProjection, RallyRecord } from './match-reducer';
import type { TeamRotation } from './match-event';

export interface Rate {
  won: number;
  total: number;
  percentage: number | null;
}

export interface PlayerCountStats {
  playerId: string;
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
  serveInPercentage: number | null;
}

export function selectTeamSideOut(state: MatchProjection): Rate {
  const chances = state.rallies.filter((rally) => rally.servingTeam === 'opponent');
  return rate(chances.filter((rally) => rally.winner === 'team').length, chances.length);
}

export function selectRotationRallyWinRates(state: MatchProjection): Readonly<Record<TeamRotation, Rate>> {
  return {
    1: rotationRate(state.rallies, 1),
    2: rotationRate(state.rallies, 2),
    3: rotationRate(state.rallies, 3),
    4: rotationRate(state.rallies, 4),
    5: rotationRate(state.rallies, 5),
    6: rotationRate(state.rallies, 6),
  };
}

export function selectPlayerCountStats(state: MatchProjection): readonly PlayerCountStats[] {
  const stats = new Map<string, PlayerCountStats>();
  const get = (playerId: string): PlayerCountStats => {
    const current = stats.get(playerId);
    if (current) return current;
    const created = emptyPlayerStats(playerId);
    stats.set(playerId, created);
    return created;
  };

  for (const player of state.session.squad) get(player.id);

  for (const rally of state.rallies) {
    if (rally.playerId) addRallyStat(get(rally.playerId), rally.action);
    if (rally.servingTeam === 'team') {
      const server = get(rally.lineup[0]);
      server.serveAttempts += 1;
      if (rally.action !== 'service-error') server.servesIn += 1;
    }
  }
  for (const observation of state.observations) get(observation.playerId).digs += 1;

  for (const player of stats.values()) {
    player.serveInPercentage = percentage(player.servesIn, player.serveAttempts);
  }
  return [...stats.values()].sort((left, right) => left.playerId.localeCompare(right.playerId));
}

function rotationRate(rallies: readonly RallyRecord[], rotation: TeamRotation): Rate {
  const inRotation = rallies.filter((rally) => rally.teamRotation === rotation);
  return rate(inRotation.filter((rally) => rally.winner === 'team').length, inRotation.length);
}

function rate(won: number, total: number): Rate {
  return { won, total, percentage: percentage(won, total) };
}

function percentage(value: number, total: number): number | null {
  return total === 0 ? null : (value / total) * 100;
}

function emptyPlayerStats(playerId: string): PlayerCountStats {
  return {
    playerId,
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
    serveInPercentage: null,
  };
}

function addRallyStat(stats: PlayerCountStats, action: RallyRecord['action']): void {
  switch (action) {
    case 'kill':
      stats.kills += 1;
      stats.totalAttacks += 1;
      break;
    case 'attack-error':
      stats.attackErrors += 1;
      stats.totalAttacks += 1;
      break;
    case 'ace':
      stats.aces += 1;
      break;
    case 'block':
      stats.blocks += 1;
      break;
    case 'service-error':
      stats.serviceErrors += 1;
      break;
    case 'receive-error':
      stats.receiveErrors += 1;
      break;
    case 'opponent-error':
    case 'opponent-winner':
      break;
  }
}
