import { Game, GameEvent, GameSquadPlayer } from '../../models/firestore.models';
import { buildMatchReview } from './review-data';

describe('buildMatchReview', () => {
  const squad: GameSquadPlayer[] = Array.from({ length: 6 }, (_, index) => ({
    id: `p${index + 1}`, name: `Player ${index + 1}`, jerseyNumber: index + 1, primaryPosition: 'OH',
  }));
  const lineup = squad.map((player) => player.id);

  it('derives scores and rates from events instead of the game summary', () => {
    const review = buildMatchReview({ ...game(), teamPoints: 19, opponentPoints: 18 }, [
      event(1, { type: 'matchStarted', action: 'match-started', eventKind: 'match-started', lineup, servingTeam: 'opponent' }),
      event(2, { type: 'playerAction', action: 'kill', eventKind: 'rally-outcome', playerId: 'p1', rallyId: 'r1' }),
      event(3, { type: 'opponentPoint', action: 'opponent-point', eventKind: 'rally-outcome', rallyId: 'r2' }),
    ]);

    expect(review).toEqual(jasmine.objectContaining({ teamPoints: 1, opponentPoints: 1, sideOutWins: 1, sideOutChances: 1 }));
    expect(review?.rotations[0]).toEqual(jasmine.objectContaining({ wins: 1, rallies: 1 }));
    expect(review?.rotations[1]).toEqual(jasmine.objectContaining({ wins: 0, rallies: 1 }));
  });

  it('builds player totals and tied leaders from the reducer projection', () => {
    const events: GameEvent[] = [
      event(1, { type: 'matchStarted', action: 'match-started', eventKind: 'match-started', lineup }),
    ];
    for (let index = 0; index < 5; index += 1) {
      events.push(event(index + 2, { type: 'playerAction', action: 'kill', eventKind: 'rally-outcome', playerId: 'p1', rallyId: `a${index}` }));
      events.push(event(index + 7, { type: 'playerAction', action: 'kill', eventKind: 'rally-outcome', playerId: 'p2', rallyId: `b${index}` }));
    }
    events.push(event(12, { type: 'playerAction', action: 'dig', eventKind: 'stat-observation', playerId: 'p1', rallyId: 'open' }));

    const review = buildMatchReview(game(), events);

    expect(review?.boxScore[0]).toEqual(jasmine.objectContaining({ kills: 5, digs: 1 }));
    expect(review?.leaders[0]).toEqual({ label: 'Kills', count: 5, players: '#1 Player 1, #2 Player 2' });
    expect(review?.leaders[1]).toEqual({ label: 'Digs', count: 1, players: '#1 Player 1' });
  });

  it('labels strongest and weakest rotations only after five rallies each', () => {
    const events: GameEvent[] = [
      event(1, { type: 'matchStarted', action: 'match-started', eventKind: 'match-started', lineup }),
    ];
    for (let index = 0; index < 5; index += 1) {
      events.push(event(index + 2, { type: 'playerAction', action: 'kill', eventKind: 'rally-outcome', playerId: 'p1', rallyId: `r1-${index}` }));
    }
    events.push(event(7, { type: 'manualRotation', action: 'manual-rotation', eventKind: 'rotation-corrected', targetRotation: 2 }));
    for (let index = 0; index < 5; index += 1) {
      events.push(event(index + 8, { type: 'opponentPoint', action: 'opponent-point', eventKind: 'rally-outcome', rallyId: `r2-${index}` }));
    }

    const review = buildMatchReview(game(), events);

    expect(review?.rotations[0].comparison).toBe('Strongest');
    expect(review?.rotations[1].comparison).toBe('Weakest');
  });

  it('removes an undone rally from every review total', () => {
    const review = buildMatchReview(game(), [
      event(1, { type: 'matchStarted', action: 'match-started', eventKind: 'match-started', lineup }),
      event(2, { type: 'playerAction', action: 'kill', eventKind: 'rally-outcome', playerId: 'p1', rallyId: 'r1' }),
      event(3, { type: 'undo', action: 'undo', eventKind: 'undo', targetEventId: 'event-2' }),
    ]);

    expect(review?.teamPoints).toBe(0);
    expect(review?.boxScore[0].kills).toBe(0);
    expect(review?.timeline.map((item) => item.id)).not.toContain('event-2');
  });

  it('keeps non-rally timeline events in the set where they occurred', () => {
    const events: GameEvent[] = [
      event(1, { type: 'matchStarted', action: 'match-started', eventKind: 'match-started', lineup }),
    ];
    for (let sequence = 2; sequence <= 26; sequence += 1) {
      events.push(event(sequence, { type: 'playerAction', action: 'kill', eventKind: 'rally-outcome', playerId: 'p1', rallyId: `s1-${sequence}` }));
    }
    events.push(event(27, { type: 'setStarted', action: 'set-started', eventKind: 'set-started', setNumber: 2, currentSet: 2, lineup }));
    events.push(event(28, { type: 'timeoutCalled', action: 'timeout-called', eventKind: 'timeout-called', timeoutTeam: 'team', currentSet: 2 }));
    for (let sequence = 29; sequence <= 53; sequence += 1) {
      events.push(event(sequence, { type: 'playerAction', action: 'kill', eventKind: 'rally-outcome', playerId: 'p1', rallyId: `s2-${sequence}`, currentSet: 2 }));
    }
    events.push(event(54, { type: 'setStarted', action: 'set-started', eventKind: 'set-started', setNumber: 3, currentSet: 3, lineup }));

    const review = buildMatchReview(game(), events);
    const timeout = review?.timeline.find((item) => item.id === 'event-28');

    expect(timeout?.context).toBe('Set 2');
  });

  function game(): Game {
    return {
      id: 'match-1', ownerId: 'owner-1', teamId: 'team-1', opponentName: 'Central High', status: 'live',
      servingTeam: 'team', teamPoints: 0, opponentPoints: 0, teamSets: 0, opponentSets: 0, currentSet: 1,
      isMatchOver: false, teamTimeoutsRemaining: 2, opponentTimeoutsRemaining: 2, teamRotation: 1,
      startedAt: '2026-02-10T10:00:00.000Z', endedAt: null, createdAt: '2026-02-10T10:00:00.000Z',
      updatedAt: '2026-02-10T10:10:00.000Z', schemaVersion: 2, writerGeneration: 1,
      matchSquad: squad, startingLineup: lineup,
    };
  }

  function event(sequence: number, changes: Partial<GameEvent>): GameEvent {
    return {
      id: `event-${sequence}`, ownerId: 'owner-1', gameId: 'match-1', type: 'playerAction', action: 'kill',
      createdAt: `2026-02-10T10:${String(sequence).padStart(2, '0')}:00.000Z`, isDeleted: false,
      schemaVersion: 2, sequence, writerGeneration: 1, ...changes,
    };
  }
});
