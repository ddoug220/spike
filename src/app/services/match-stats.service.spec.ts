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
});
