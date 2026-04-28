import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { Game, PlayerSetStats } from '../../models/firestore.models';
import { OfflineSyncService } from '../../services/offline-sync.service';
import { HistoryPage } from './history.page';

describe('HistoryPage', () => {
  let component: HistoryPage;
  let fixture: ComponentFixture<HistoryPage>;
  let offlineSync: OfflineSyncService;

  beforeEach(async () => {
    window.localStorage.clear();
    await TestBed.configureTestingModule({
      providers: [provideRouter([])],
    }).compileComponents();

    offlineSync = TestBed.inject(OfflineSyncService);
    fixture = TestBed.createComponent(HistoryPage);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('renders recap cards with opponent, result, and stat leaders', () => {
    const game: Game = {
      id: 'match-1',
      teamId: 'local-team',
      opponentName: 'Central High',
      status: 'final',
      servingTeam: 'team',
      teamPoints: 0,
      opponentPoints: 0,
      teamSets: 3,
      opponentSets: 1,
      currentSet: 4,
      isMatchOver: true,
      teamTimeoutsRemaining: 2,
      opponentTimeoutsRemaining: 2,
      teamRotation: 1,
      startedAt: '2026-02-10T10:00:00.000Z',
      endedAt: '2026-02-10T11:00:00.000Z',
      createdAt: '2026-02-10T10:00:00.000Z',
      updatedAt: '2026-02-10T11:00:00.000Z',
    };
    const stats: PlayerSetStats = {
      id: 'match-1-p1-match',
      gameId: 'match-1',
      playerId: 'p1',
      playerName: 'Ava Johnson',
      jerseyNumber: 4,
      setNumber: null,
      kills: 12,
      attackErrors: 2,
      totalAttacks: 24,
      aces: 3,
      hittingEfficiency: 0.417,
      serveAttempts: 10,
      servesIn: 9,
      serveInPercentage: 0.9,
      blocks: 1,
      digs: 5,
      serviceErrors: 1,
      sideOutOpportunities: 7,
      sideOutConversions: 5,
      sideOutPercentage: 0.714,
      createdAt: '2026-02-10T11:00:00.000Z',
      updatedAt: '2026-02-10T11:00:00.000Z',
    };

    offlineSync.queueGame(game);
    offlineSync.queueMatchEvent({
      id: 'evt-end',
      gameId: 'match-1',
      type: 'matchEnded',
      action: 'match-ended',
      teamSets: 3,
      opponentSets: 1,
      createdAt: '2026-02-10T11:00:00.000Z',
      isDeleted: false,
    });
    offlineSync.queuePlayerSetStats(stats);
    component.selectedMatchId = 'match-1';
    fixture.detectChanges();

    const text = fixture.nativeElement.textContent;
    expect(text).toContain('vs Central High');
    expect(text).toContain('Final 3 - 1');
    expect(text).toContain('Ava Johnson 12');
    expect(component.timeline.length).toBe(1);
  });
});
