import type { Game, GameEvent, GameSquadPlayer } from '../models/firestore.models';
import { reduceMatch } from '../domain/match-v2';
import {
  eventsFromFirestore,
  scoreStateFromProjection,
  sessionFromGame,
  setStatsStateFromProjection,
  statsStateFromProjection,
} from './match-v2.adapter';

describe('match v2 Firestore adapter', () => {
  const squad: GameSquadPlayer[] = Array.from({ length: 7 }, (_, index) => ({
    id: `p${index + 1}`,
    name: `Player ${index + 1}`,
    jerseyNumber: index + 1,
    primaryPosition: 'OH',
  }));
  const lineup = squad.slice(0, 6).map((player) => player.id);

  it('builds a session only from a schema-v2 game with a squad snapshot', () => {
    expect(sessionFromGame(game())).toEqual(
      jasmine.objectContaining({ id: 'match-1', opponentName: 'Central High', squad }),
    );
    expect(sessionFromGame({ ...game(), schemaVersion: undefined })).toBeNull();
    expect(sessionFromGame({ ...game(), matchSquad: undefined })).toBeNull();
  });

  it('replays legacy event fields and converts the projection for existing services', () => {
    const storedEvents = [
      event(1, { type: 'matchStarted', action: 'match-started', lineup, servingTeam: 'team' }),
      event(2, { type: 'playerAction', action: 'dig', playerId: 'p4', rallyId: 'rally-1' }),
      event(3, { type: 'playerAction', action: 'kill', playerId: 'p3', rallyId: 'rally-1' }),
      event(4, { type: 'opponentPoint', action: 'opponent-point', rallyId: 'rally-2' }),
      event(5, { type: 'substitution', action: 'substitution', outPlayerId: 'p1', inPlayerId: 'p7' }),
      event(6, { type: 'serveTeamSet', action: 'serve-team-set', servingTeam: 'team' }),
      event(7, {
        type: 'manualRotation',
        action: 'manual-rotation',
        previousTeamRotation: 1,
        targetTeamRotation: 3,
      }),
    ];
    const match = game();
    const session = sessionFromGame(match)!;
    const projection = reduceMatch(session, eventsFromFirestore(match, storedEvents));

    expect(scoreStateFromProjection(projection)).toEqual(
      jasmine.objectContaining({
        teamPoints: 1,
        opponentPoints: 1,
        servingTeam: 'team',
        teamRotation: 3,
        isMatchOver: false,
      }),
    );
    expect(projection.lineup).toEqual(['p3', 'p4', 'p5', 'p6', 'p7', 'p2']);
    expect(statsStateFromProjection(projection)['p3'].kills).toBe(1);
    expect(statsStateFromProjection(projection)['p4'].digs).toBe(1);
    expect(statsStateFromProjection(projection)['p1']).toEqual(
      jasmine.objectContaining({ serveAttempts: 2, servesIn: 2 }),
    );
    expect(setStatsStateFromProjection(projection)['p3'][1]).toEqual({
      kills: 1,
      attackErrors: 0,
      totalAttacks: 1,
    });
  });

  it('maps explicit v2 fields and omits archived events', () => {
    const match = game();
    const mapped = eventsFromFirestore(match, [
      event(1, { type: 'matchStarted', action: 'match-started', lineup }),
      event(2, {
        type: 'manualRotation',
        action: 'rotation-corrected',
        eventKind: 'rotation-corrected',
        targetRotation: 5,
      }),
      event(3, {
        type: 'substitution',
        action: 'substitution',
        eventKind: 'substitution',
        courtPosition: 1,
        outPlayerId: 'p5',
        inPlayerId: 'p7',
      }),
      event(4, { type: 'opponentPoint', action: 'opponent-point', isDeleted: true }),
    ]);
    const projection = reduceMatch(sessionFromGame(match)!, mapped);

    expect(projection.teamRotation).toBe(5);
    expect(projection.lineup?.[0]).toBe('p7');
    expect(projection.opponentPoints).toBe(0);
  });

  it('drops stale events from an older writer after takeover', () => {
    const match = { ...game(), writerGeneration: 2, writerDeviceId: 'new-device' };
    const projection = reduceMatch(sessionFromGame(match)!, eventsFromFirestore(match, [
      event(1, { type: 'matchStarted', action: 'match-started', lineup, writerGeneration: 1, writerDeviceId: 'old-device' }),
      event(2, { type: 'playerAction', action: 'kill', playerId: 'p1', writerGeneration: 1, writerDeviceId: 'old-device' }),
      event(3, { type: 'opponentPoint', action: 'opponent-point', writerGeneration: 2, writerDeviceId: 'new-device' }),
      event(4, { type: 'playerAction', action: 'kill', playerId: 'p1', writerGeneration: 1, writerDeviceId: 'old-device' }),
      event(5, { type: 'playerAction', action: 'kill', playerId: 'p1', writerGeneration: 2, writerDeviceId: 'wrong-device' }),
    ]));

    expect(projection.teamPoints).toBe(1);
    expect(projection.opponentPoints).toBe(1);
  });

  function game(): Game {
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
      updatedAt: '2026-08-18T18:00:00.000Z',
      schemaVersion: 2,
      writerGeneration: 1,
      matchSquad: squad,
      startingLineup: lineup,
    };
  }

  function event(sequence: number, changes: Partial<GameEvent>): GameEvent {
    return {
      id: `event-${sequence}`,
      ownerId: 'owner-1',
      gameId: 'match-1',
      type: 'playerAction',
      action: 'kill',
      createdAt: `2026-08-18T18:${String(sequence).padStart(2, '0')}:00.000Z`,
      isDeleted: false,
      schemaVersion: 2,
      sequence,
      writerGeneration: 1,
      ...changes,
    };
  }
});
