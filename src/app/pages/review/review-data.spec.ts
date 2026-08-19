import { Game, GameEvent, PlayerSetStats } from '../../models/firestore.models';
import { buildMatchReview } from './review-data';

describe('buildMatchReview', () => {
  it('uses pre-rally serve and team rotation for side-out and rotation rates', () => {
    const events = [
      event('start', 'matchStarted', 'match-started', { servingTeam: 'opponent', teamRotation: 1 }),
      event('side-out', 'playerAction', 'kill', {
        playerId: 'p1', wasReceiving: true, sideOutWon: true, servingTeam: 'team', teamRotation: 2,
        teamPoints: 1, opponentPoints: 0,
      }),
      event('opponent', 'opponentPoint', 'opponent-point', {
        servingTeam: 'opponent', teamRotation: 2, teamPoints: 1, opponentPoints: 1,
      }),
    ];

    const review = buildMatchReview(game(), null, events, [stats('p1', 'Ava', 4, { kills: 1 })]);

    expect(review?.sideOutWins).toBe(1);
    expect(review?.sideOutChances).toBe(1);
    expect(review?.rotations[0]).toEqual(jasmine.objectContaining({ wins: 1, rallies: 1 }));
    expect(review?.rotations[1]).toEqual(jasmine.objectContaining({ wins: 0, rallies: 1 }));
    expect(review?.timeline[1].context).toContain('R1');
  });

  it('shows tied non-zero count leaders and omits zero categories', () => {
    const review = buildMatchReview(game(), null, [], [
      stats('p1', 'Ava', 4, { kills: 5, digs: 3 }),
      stats('p2', 'Mia', 8, { kills: 5, digs: 1 }),
    ]);

    expect(review?.leaders).toEqual([
      { label: 'Kills', count: 5, players: '#4 Ava, #8 Mia' },
      { label: 'Digs', count: 3, players: '#4 Ava' },
    ]);
  });

  it('builds a live box score from events before final totals are saved', () => {
    const liveGame: Game = {
      ...game(),
      matchSquad: [{ id: 'p1', name: 'Ava', jerseyNumber: 4, primaryPosition: 'OH' }],
    };
    const review = buildMatchReview(liveGame, null, [
      event('kill', 'playerAction', 'kill', { playerId: 'p1', teamPoints: 1, opponentPoints: 0 }),
      event('dig', 'playerAction', 'dig', { playerId: 'p1', teamPoints: 1, opponentPoints: 0 }),
    ], []);

    expect(review?.boxScore[0]).toEqual(jasmine.objectContaining({ kills: 1, digs: 1, totalAttacks: 1 }));
  });

  it('labels strongest and weakest rotations only after the sample threshold', () => {
    const events: GameEvent[] = [event('start', 'matchStarted', 'match-started', { servingTeam: 'team', teamRotation: 1 })];
    for (let index = 0; index < 5; index += 1) {
      events.push(event(`r1-${index}`, 'playerAction', 'kill', {
        servingTeamBefore: 'team', teamRotationBefore: 1, teamPoints: index + 1,
      } as Partial<GameEvent>));
      events.push(event(`r2-${index}`, 'opponentPoint', 'opponent-point', {
        servingTeamBefore: 'team', teamRotationBefore: 2, opponentPoints: index + 1,
      } as Partial<GameEvent>));
    }

    const review = buildMatchReview(game(), null, events, []);

    expect(review?.rotations[0].comparison).toBe('Strongest');
    expect(review?.rotations[1].comparison).toBe('Weakest');
    expect(review?.rotations[2].comparison).toBeNull();
  });
});

function game(): Game {
  return {
    id: 'match-1', ownerId: 'owner-1', teamId: 'team-1', opponentName: 'Central High', status: 'live',
    servingTeam: 'team', teamPoints: 1, opponentPoints: 1, teamSets: 0, opponentSets: 0, currentSet: 1,
    isMatchOver: false, teamTimeoutsRemaining: 2, opponentTimeoutsRemaining: 2, teamRotation: 2,
    startedAt: '2026-02-10T10:00:00.000Z', endedAt: null, createdAt: '2026-02-10T10:00:00.000Z',
    updatedAt: '2026-02-10T10:10:00.000Z',
  };
}

function event(id: string, type: GameEvent['type'], action: string, extra: Partial<GameEvent> = {}): GameEvent {
  return {
    id, ownerId: 'owner-1', gameId: 'match-1', type, action,
    createdAt: `2026-02-10T10:00:${String(id.length).padStart(2, '0')}.000Z`, isDeleted: false, ...extra,
  };
}

function stats(playerId: string, playerName: string, jerseyNumber: number, values: Partial<PlayerSetStats>): PlayerSetStats {
  return {
    id: `stats-${playerId}`, ownerId: 'owner-1', gameId: 'match-1', playerId, playerName, jerseyNumber,
    setNumber: null, kills: 0, attackErrors: 0, totalAttacks: 0, aces: 0, hittingEfficiency: null,
    serveAttempts: 0, servesIn: 0, serveInPercentage: null, blocks: 0, digs: 0, serviceErrors: 0,
    receiveErrors: 0, sideOutOpportunities: 0, sideOutConversions: 0, sideOutPercentage: null,
    createdAt: '2026-02-10T10:00:00.000Z', updatedAt: '2026-02-10T10:10:00.000Z', ...values,
  };
}
