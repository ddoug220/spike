import { TestBed } from '@angular/core/testing';
import { MatchSession, MatchEvent, reduceMatch } from '../../domain/match-v2';
import { MatchBoxScoreComponent } from './match-box-score.component';

describe('MatchBoxScoreComponent', () => {
  it('shows the full squad, player identity, team totals, and every stat by match or set after undo', async () => {
    await TestBed.configureTestingModule({ imports: [MatchBoxScoreComponent] }).compileComponents();
    const squad = Array.from({ length: 7 }, (_, index) => ({ id: `p${index + 1}`, name: `Player ${index + 1}`, jerseyNumber: index + 1, primaryPosition: 'OH' as const }));
    const lineup = ['p1', 'p2', 'p3', 'p4', 'p5', 'p6'] as const;
    const session: MatchSession = { schemaVersion: 2, id: 'match', ownerId: 'owner', teamId: 'team', opponentName: 'Central', createdAt: '2026-09-17', squad };
    const events: MatchEvent[] = [];
    const base = (setNumber: 1 | 2 = 1) => ({ schemaVersion: 2 as const, id: `e${events.length + 1}`, matchId: 'match', ownerId: 'owner', sequence: events.length + 1, writerGeneration: 1, occurredAt: '2026-09-17', setNumber });
    events.push({ ...base(), kind: 'match-started', lineup, servingTeam: 'team' });
    events.push({ ...base(), kind: 'stat-observation', playerId: 'p2', rallyId: 'r1', action: 'dig' });
    for (let point = 0; point < 25; point += 1) events.push({ ...base(), kind: 'rally-outcome', action: 'kill', playerId: 'p1', rallyId: `r${point}`, servingTeamBefore: 'team', teamRotationBefore: 1 });
    events.push({ ...base(2), kind: 'set-started', lineup, servingTeam: 'team', setNumber: 2 });
    events.push({ ...base(2), kind: 'substitution', outPlayerId: 'p1', inPlayerId: 'p7' });
    events.push({ ...base(2), kind: 'rally-outcome', action: 'ace', playerId: 'p7', rallyId: 'ace', servingTeamBefore: 'team', teamRotationBefore: 1 });
    events.push({ ...base(2), kind: 'stat-observation', playerId: 'p7', rallyId: 'next', action: 'dig' });
    const digId = events[events.length - 1].id;
    events.push({ ...base(2), kind: 'undo', targetEventId: digId });

    const fixture = TestBed.createComponent(MatchBoxScoreComponent);
    fixture.componentRef.setInput('match', reduceMatch(session, events));
    fixture.detectChanges();
    const component = fixture.componentInstance;
    expect(fixture.nativeElement.querySelectorAll('tbody tr').length).toBe(7);
    expect(component.totals()).toEqual(jasmine.objectContaining({ kills: 25, aces: 1, digs: 1, serveAttempts: 26 }));
    expect(component.rows()[0].courtPosition).toBe(0);
    expect(component.rows()[6].courtPosition).toBe(1);
    expect(fixture.nativeElement.textContent).toContain('Bench');

    const scope = fixture.nativeElement.querySelector('select') as HTMLSelectElement;
    scope.value = '2';
    scope.dispatchEvent(new Event('change'));
    fixture.detectChanges();
    await fixture.whenStable();
    expect(component.totals()).toEqual(jasmine.objectContaining({ kills: 0, aces: 1, digs: 0, serveAttempts: 1 }));
    component.selectSet('1');
    expect(component.totals()).toEqual(jasmine.objectContaining({ kills: 25, aces: 0, digs: 1, serveAttempts: 25 }));
    component.selectSet('');
    expect(component.totals().kills).toBe(25);
  });
});
