import type { Game, GameEvent } from '../models/firestore.models';
import { MatchV2StoreService } from './match-v2-store.service';

describe('MatchV2StoreService', () => {
  const service = new MatchV2StoreService();

  it('returns a replayed projection for a schema-v2 game', () => {
    const game = makeGame();
    const events: GameEvent[] = [
      {
        id: 'start',
        ownerId: game.ownerId,
        gameId: game.id,
        type: 'matchStarted',
        action: 'match-started',
        lineup: game.startingLineup,
        servingTeam: 'opponent',
        createdAt: game.createdAt,
        isDeleted: false,
        schemaVersion: 2,
        sequence: 1,
        writerGeneration: 1,
      },
      {
        id: 'point',
        ownerId: game.ownerId,
        gameId: game.id,
        type: 'playerAction',
        action: 'opponent-error',
        createdAt: game.updatedAt,
        isDeleted: false,
        schemaVersion: 2,
        sequence: 2,
        writerGeneration: 1,
      },
    ];

    const projection = service.projectionFor(game, events);

    expect(projection).not.toBeNull();
    expect(projection?.teamPoints).toBe(1);
    expect(projection?.teamRotation).toBe(2);
    expect(service.scoreStateFrom(projection!).teamPoints).toBe(1);
    expect(service.statsStateFrom(projection!)['p1']).toBeDefined();
  });

  it('does not project a legacy game without a squad snapshot', () => {
    expect(service.projectionFor({ ...makeGame(), schemaVersion: undefined }, [])).toBeNull();
  });

  function makeGame(): Game {
    const matchSquad = Array.from({ length: 6 }, (_, index) => ({
      id: `p${index + 1}`,
      name: `Player ${index + 1}`,
      jerseyNumber: index + 1,
      primaryPosition: 'OH' as const,
    }));
    return {
      id: 'match-1',
      ownerId: 'owner-1',
      teamId: 'team-1',
      opponentName: 'Central High',
      status: 'live',
      servingTeam: 'team',
      teamPoints: 0,
      opponentPoints: 0,
      teamSets: 0,
      opponentSets: 0,
      currentSet: 1,
      isMatchOver: false,
      teamTimeoutsRemaining: 2,
      opponentTimeoutsRemaining: 2,
      teamRotation: 1,
      startedAt: '2026-08-18T18:00:00.000Z',
      endedAt: null,
      createdAt: '2026-08-18T18:00:00.000Z',
      updatedAt: '2026-08-18T18:01:00.000Z',
      schemaVersion: 2,
      writerGeneration: 1,
      matchSquad,
      startingLineup: matchSquad.map((player) => player.id),
    };
  }
});
