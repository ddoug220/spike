import { MatchStatsService } from './match-stats.service';

describe('MatchStatsService', () => {
  let service: MatchStatsService;

  beforeEach(() => {
    window.localStorage.clear();
    service = new MatchStatsService();
  });

  it('tracks hitting efficiency inputs', () => {
    service.recordPlayerAction('p1', 'kill', { wasReceiving: false, sideOutWon: false, currentSet: 1 });
    service.recordPlayerAction('p1', 'kill', { wasReceiving: false, sideOutWon: false, currentSet: 1 });
    service.recordPlayerAction('p1', 'attack-error', { wasReceiving: false, sideOutWon: false, currentSet: 1 });

    const stats = service.getPlayerStats('p1');
    expect(stats.kills).toBe(2);
    expect(stats.attackErrors).toBe(1);
    expect(stats.totalAttacks).toBe(3);
    expect(service.getHittingEfficiency('p1')).toBeCloseTo(1 / 3, 4);
  });

  it('tracks side-out percentage', () => {
    service.recordPlayerAction('p1', 'dig', { wasReceiving: true, sideOutWon: false, currentSet: 1 });
    service.recordPlayerAction('p1', 'kill', { wasReceiving: true, sideOutWon: true, currentSet: 1 });

    const stats = service.getPlayerStats('p1');
    expect(stats.sideOutOpportunities).toBe(2);
    expect(stats.sideOutConversions).toBe(1);
    expect(service.getSideOutPercentage('p1')).toBeCloseTo(0.5, 4);
  });

  it('tracks inferred serve-in attempts and serve-in percentage', () => {
    service.recordPlayerAction('p1', 'kill', {
      wasReceiving: false,
      sideOutWon: false,
      inferredServeInServerPlayerId: 'p1',
      currentSet: 1,
    });
    service.recordPlayerAction('p1', 'service-error', { wasReceiving: false, sideOutWon: false, currentSet: 1 });

    const stats = service.getPlayerStats('p1');
    expect(stats.serveAttempts).toBe(2);
    expect(stats.servesIn).toBe(1);
    expect(service.getServeInPercentage('p1')).toBeCloseTo(0.5, 4);
  });

  it('supports undo', () => {
    service.recordPlayerAction('p1', 'kill', { wasReceiving: false, sideOutWon: false, currentSet: 1 });
    service.recordPlayerAction('p1', 'attack-error', { wasReceiving: false, sideOutWon: false, currentSet: 1 });
    service.undoLastAction();

    const stats = service.getPlayerStats('p1');
    expect(stats.kills).toBe(1);
    expect(stats.attackErrors).toBe(0);
    expect(stats.totalAttacks).toBe(1);
  });

  it('hydrates the complete synced stat line', () => {
    service.hydrateFromPlayerSetStats([
      {
        id: 'stats-1',
        gameId: 'game-1',
        playerId: 'p1',
        playerName: 'Player One',
        jerseyNumber: 1,
        setNumber: null,
        kills: 4,
        attackErrors: 1,
        totalAttacks: 8,
        aces: 2,
        hittingEfficiency: 0.375,
        serveAttempts: 5,
        servesIn: 4,
        serveInPercentage: 0.8,
        blocks: 1,
        digs: 3,
        serviceErrors: 1,
        sideOutOpportunities: 6,
        sideOutConversions: 4,
        sideOutPercentage: 2 / 3,
        createdAt: '2026-02-10T10:00:00.000Z',
        updatedAt: '2026-02-10T10:01:00.000Z',
      },
    ]);

    const stats = service.getPlayerStats('p1');
    expect(stats.kills).toBe(4);
    expect(stats.aces).toBe(2);
    expect(stats.blocks).toBe(1);
    expect(stats.digs).toBe(3);
    expect(stats.serviceErrors).toBe(1);
    expect(stats.sideOutOpportunities).toBe(6);
    expect(stats.sideOutConversions).toBe(4);
  });
});
