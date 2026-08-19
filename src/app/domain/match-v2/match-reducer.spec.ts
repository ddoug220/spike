import {
  MATCH_SCHEMA_VERSION,
  type Lineup,
  type MatchEvent,
  type MatchSession,
  type RallyAction,
  type TeamSide,
} from './match-event';
import { reduceMatch } from './match-reducer';
import { selectPlayerCountStats, selectRotationRallyWinRates, selectTeamSideOut } from './match-selectors';

describe('match v2 reducer', () => {
  const lineup: Lineup = ['p1', 'p2', 'p3', 'p4', 'p5', 'p6'];
  const session: MatchSession = {
    schemaVersion: MATCH_SCHEMA_VERSION,
    id: 'match-1',
    ownerId: 'owner-1',
    teamId: 'team-1',
    opponentName: 'Central High',
    squad: lineup.map((id, index) => ({
      id,
      name: `Player ${index + 1}`,
      jerseyNumber: index + 1,
      primaryPosition: 'OH',
    })),
    createdAt: '2026-08-18T18:00:00.000Z',
  };

  it('replays an ordered history to the same state regardless of input order', () => {
    const events = [start(1), rally(2, 'kill', 'p3'), rally(3, 'opponent-winner')];

    const ordered = reduceMatch(session, events);
    const reversed = reduceMatch(session, [...events].reverse());

    expect(reversed).toEqual(ordered);
    expect(ordered.teamPoints).toBe(1);
    expect(ordered.opponentPoints).toBe(1);
  });

  it('uses the pre-rally serve and Team Rotation for side-out and rotation rates', () => {
    const state = reduceMatch(session, [
      start(1, 'opponent'),
      rally(2, 'opponent-error'),
      rally(3, 'opponent-winner'),
      rally(4, 'opponent-winner'),
    ]);

    expect(selectTeamSideOut(state)).toEqual({ won: 1, total: 2, percentage: 50 });
    expect(selectRotationRallyWinRates(state)[1]).toEqual({ won: 1, total: 1, percentage: 100 });
    expect(selectRotationRallyWinRates(state)[2]).toEqual({ won: 0, total: 2, percentage: 0 });
    expect(state.teamRotation).toBe(2);
    expect(state.lineup).toEqual(['p2', 'p3', 'p4', 'p5', 'p6', 'p1']);
  });

  it('records a Dig without changing score and infers serve attempts from P1', () => {
    const state = reduceMatch(session, [
      start(1),
      dig(2, 'p4'),
      rally(3, 'kill', 'p3'),
      rally(4, 'service-error', 'p1'),
    ]);
    const stats = selectPlayerCountStats(state);

    expect(state.teamPoints).toBe(1);
    expect(state.opponentPoints).toBe(1);
    expect(stats.find((player) => player.playerId === 'p4')?.digs).toBe(1);
    expect(stats.find((player) => player.playerId === 'p3')?.kills).toBe(1);
    expect(stats.find((player) => player.playerId === 'p1')).toEqual(
      jasmine.objectContaining({ serveAttempts: 2, servesIn: 1, serveInPercentage: 50, serviceErrors: 1 }),
    );
  });

  it('pauses after a set and starts the next set only after a submitted lineup', () => {
    const firstSet = winSet(2, 'team');
    const atBreak = reduceMatch(session, [start(1), ...firstSet]);
    const nextSet = reduceMatch(session, [
      start(1),
      ...firstSet,
      {
        ...eventBase(27),
        kind: 'set-started',
        setNumber: 2,
        lineup,
        servingTeam: 'opponent',
      },
    ]);

    expect(atBreak.status).toBe('set-break');
    expect(atBreak.currentSet).toBe(1);
    expect(atBreak.teamPoints).toBe(25);
    expect(atBreak.teamSets).toBe(1);
    expect(nextSet.status).toBe('live');
    expect(nextSet.currentSet).toBe(2);
    expect(nextSet.teamPoints).toBe(0);
    expect(nextSet.servingTeam).toBe('opponent');
    expect(nextSet.submittedSets.map((set) => set.setNumber)).toEqual([1, 2]);
  });

  it('requires a two-point lead and uses 15 points for the fifth set', () => {
    const deuceEvents: MatchEvent[] = [start(1)];
    for (let sequence = 2; sequence < 50; sequence += 2) {
      deuceEvents.push(rally(sequence, 'opponent-error'), rally(sequence + 1, 'opponent-winner'));
    }
    deuceEvents.push(rally(50, 'opponent-error'));
    expect(reduceMatch(session, deuceEvents).status).toBe('live');
    deuceEvents.push(rally(51, 'opponent-error'));
    expect(reduceMatch(session, deuceEvents).status).toBe('set-break');

    const fifthSetEvents: MatchEvent[] = [start(1)];
    let sequence = 2;
    for (let setNumber = 1; setNumber <= 4; setNumber += 1) {
      const winner: TeamSide = setNumber % 2 === 1 ? 'team' : 'opponent';
      fifthSetEvents.push(...winSet(sequence, winner));
      sequence += 25;
      fifthSetEvents.push({
        ...eventBase(sequence++),
        kind: 'set-started',
        setNumber: (setNumber + 1) as 2 | 3 | 4 | 5,
        lineup,
        servingTeam: 'team',
      });
    }
    for (let point = 0; point < 15; point += 1) fifthSetEvents.push(rally(sequence++, 'opponent-error'));

    const fifthSet = reduceMatch(session, fifthSetEvents);
    expect(fifthSet.status).toBe('final');
    expect(fifthSet.currentSet).toBe(5);
    expect(fifthSet.completedSets[4].teamPoints).toBe(15);
  });

  it('reopens a final match when an Undo tombstones the final rally', () => {
    const events: MatchEvent[] = [start(1)];
    let sequence = 2;
    for (let setNumber = 1; setNumber <= 3; setNumber += 1) {
      if (setNumber > 1) {
        events.push({
          ...eventBase(sequence++),
          kind: 'set-started',
          setNumber: setNumber as 2 | 3,
          lineup,
          servingTeam: 'team',
        });
      }
      events.push(...winSet(sequence, 'team'));
      sequence += 25;
    }
    const finalRally = events[events.length - 1];
    const finalState = reduceMatch(session, events);
    const reopened = reduceMatch(session, [
      ...events,
      { ...eventBase(sequence), kind: 'undo', targetEventId: finalRally.id },
    ]);

    expect(finalState.status).toBe('final');
    expect(finalState.teamSets).toBe(3);
    expect(reopened.status).toBe('live');
    expect(reopened.teamSets).toBe(2);
    expect(reopened.teamPoints).toBe(24);
    expect(reopened.tombstonedEventIds.has(finalRally.id)).toBeTrue();
  });

  it('keeps an ended-early match reviewable without assigning a winner', () => {
    const state = reduceMatch(session, [
      start(1),
      rally(2, 'kill', 'p3'),
      { ...eventBase(3), kind: 'match-ended-early' },
      rally(4, 'kill', 'p3'),
    ]);

    expect(state.status).toBe('ended-early');
    expect(state.teamPoints).toBe(1);
    expect(state.teamSets).toBe(0);
    expect(state.opponentSets).toBe(0);
    expect(state.rallies.length).toBe(1);
  });

  it('applies exact rotation corrections, timeouts, substitutions, and their tombstones', () => {
    const events: MatchEvent[] = [
      start(1),
      { ...eventBase(2), kind: 'rotation-corrected', targetRotation: 4 },
      { ...eventBase(3), kind: 'timeout-called', team: 'team' },
      { ...eventBase(4), kind: 'substitution', position: 1, outPlayerId: 'p4', inPlayerId: 'p7' },
      { ...eventBase(5), kind: 'serve-corrected', servingTeam: 'opponent' },
      { ...eventBase(6), kind: 'undo', targetEventId: 'event-3' },
    ];

    const state = reduceMatch(session, events);

    expect(state.teamRotation).toBe(4);
    expect(state.lineup).toEqual(['p7', 'p5', 'p6', 'p1', 'p2', 'p3']);
    expect(state.servingTeam).toBe('opponent');
    expect(state.teamTimeoutsRemaining).toBe(2);
    expect(state.tombstonedEventIds.has('event-3')).toBeTrue();
  });

  it('lists the full match squad in the player box score', () => {
    const state = reduceMatch(session, [start(1), rally(2, 'attack-error', 'p3')]);
    const stats = selectPlayerCountStats(state);

    expect(stats.length).toBe(6);
    expect(stats.find((player) => player.playerId === 'p3')).toEqual(
      jasmine.objectContaining({ attackErrors: 1, totalAttacks: 1 }),
    );
    expect(stats.find((player) => player.playerId === 'p6')).toEqual(
      jasmine.objectContaining({ kills: 0, totalAttacks: 0 }),
    );
  });

  function start(sequence: number, servingTeam: TeamSide = 'team'): MatchEvent {
    return { ...eventBase(sequence), kind: 'match-started', lineup, servingTeam };
  }

  function rally(sequence: number, action: RallyAction, playerId?: string): MatchEvent {
    const shared = { ...eventBase(sequence), kind: 'rally-outcome' as const, rallyId: `rally-${sequence}`, action };
    return playerId ? ({ ...shared, playerId } as MatchEvent) : (shared as MatchEvent);
  }

  function dig(sequence: number, playerId: string): MatchEvent {
    return { ...eventBase(sequence), kind: 'stat-observation', rallyId: `rally-${sequence}`, action: 'dig', playerId };
  }

  function winSet(firstSequence: number, winner: TeamSide): MatchEvent[] {
    return Array.from({ length: 25 }, (_, index) =>
      rally(firstSequence + index, winner === 'team' ? 'opponent-error' : 'opponent-winner'),
    );
  }

  function eventBase(sequence: number) {
    return {
      schemaVersion: MATCH_SCHEMA_VERSION,
      id: `event-${sequence}`,
      matchId: session.id,
      sequence,
      writerGeneration: 1,
      occurredAt: `2026-08-18T18:${String(sequence).padStart(2, '0')}:00.000Z`,
    } as const;
  }
});
