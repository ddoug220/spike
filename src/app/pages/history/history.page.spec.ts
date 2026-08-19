import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { MatchArchiveSummary, OfflineSyncService } from '../../services/offline-sync.service';
import { HistoryPage } from './history.page';

describe('HistoryPage', () => {
  let fixture: ComponentFixture<HistoryPage>;

  beforeEach(async () => {
    const summary: MatchArchiveSummary = {
      matchId: 'match-1', opponentName: 'Central High', startedAt: '2026-02-10T10:00:00.000Z',
      lastUpdatedAt: '2026-02-10T11:00:00.000Z', totalEvents: 74, isFinal: true, teamPoints: 0,
      opponentPoints: 0, teamSets: 3, opponentSets: 1, finalTeamSets: 3, finalOpponentSets: 1,
    };
    const offlineSync = {
      getMatchSummaries: () => [summary],
      getGame: () => null,
      getActiveMatchId: () => 'another-match',
      pendingCount: () => 0,
      subscribeRemoteGames: () => () => undefined,
      cacheRemoteGame: () => undefined,
    };

    await TestBed.configureTestingModule({
      imports: [HistoryPage],
      providers: [provideRouter([]), { provide: OfflineSyncService, useValue: offlineSync }],
    }).compileComponents();

    fixture = TestBed.createComponent(HistoryPage);
    fixture.detectChanges();
  });

  it('links each saved match to its single review page', () => {
    const row = fixture.nativeElement.querySelector('.match-row') as HTMLAnchorElement;
    expect(row.getAttribute('href')).toBe('/review/match-1');
    expect(row.textContent).toContain('Central High');
    expect(row.textContent).toContain('Final');
    expect(row.textContent).toContain('3–1');
  });
});
