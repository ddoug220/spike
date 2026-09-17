import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { routes } from './app.routes';
import { CourtPage } from './pages/court/court.page';
import { HistoryPage } from './pages/history/history.page';
import { LoginPage } from './pages/login/login.page';
import { PreMatchPage } from './pages/pre-match/pre-match.page';
import { ReviewPage } from './pages/review/review.page';
import { TeamPage } from './pages/team/team.page';
import { AuthService } from './services/auth.service';
import { FirebaseDbService } from './services/firebase-db.service';
import { MatchEngineService } from './services/match-engine.service';
import { OfflineSyncService } from './services/offline-sync.service';

const firebaseDbStub = {
  isConfigured: () => false,
  readTeamRosterSnapshot: async () => ({ ok: true, data: { teams: [], players: [], rosters: [] } }),
  subscribeGame: (_gameId: string, onData: (game: null) => void) => {
    onData(null);
    return () => undefined;
  },
  subscribeGames: (_ownerId: string, onData: (games: []) => void) => {
    onData([]);
    return () => undefined;
  },
  subscribeEvents: (_gameId: string, onData: (events: []) => void) => {
    onData([]);
    return () => undefined;
  },
  subscribePlayerSetStats: (_gameId: string, onData: (stats: []) => void) => {
    onData([]);
    return () => undefined;
  },
};

class FakeAuthService {
  private readonly userSignal = signal<{ uid: string; email: string } | null | undefined>(null);

  readonly user = this.userSignal.asReadonly();

  get uid(): string | null {
    return this.userSignal()?.uid ?? null;
  }

  get email(): string | null {
    return this.userSignal()?.email ?? null;
  }

  async signInWithEmailPassword(email: string, _password: string): Promise<void> {
    this.userSignal.set({ uid: 'first-run-mobile-user', email });
  }

  async createUserWithEmailPassword(email: string, _password: string): Promise<void> {
    this.userSignal.set({ uid: 'first-run-mobile-user', email });
  }

  async signInWithGoogle(): Promise<void> {
    this.userSignal.set({ uid: 'first-run-mobile-user', email: 'coach@example.com' });
  }

  async signOut(): Promise<void> {
    this.userSignal.set(null);
  }
}

describe('First-run mobile smoke flow', () => {
  let restoreViewport: () => void;

  beforeEach(async () => {
    window.localStorage.clear();
    restoreViewport = setSmallPhoneViewport();

    await TestBed.configureTestingModule({
      providers: [
        provideRouter(routes),
        { provide: AuthService, useClass: FakeAuthService },
        { provide: FirebaseDbService, useValue: firebaseDbStub },
      ],
    }).compileComponents();
  });

  afterEach(() => {
    restoreViewport();
  });

  it('completes the first real match and shows its saved recap in history', async () => {
    const harness = await RouterTestingHarness.create();
    const router = TestBed.inject(Router);
    expect(window.innerWidth).toBeLessThanOrEqual(390);

    const login = await harness.navigateByUrl('/login', LoginPage);
    login.email = 'coach@example.com';
    login.password = 'password123';
    await login.submitEmail();
    await harness.fixture.whenStable();
    harness.detectChanges();

    expect(router.url).toBe('/home');
    expect(harness.routeNativeElement?.textContent).toContain('Set your starting lineup');
    expect(harness.routeNativeElement?.textContent).toContain('Assign 6 more positions');

    const team = await harness.navigateByUrl('/team', TeamPage);
    await harness.fixture.whenStable();
    harness.detectChanges();

    expect(team.players.length).toBe(0);

    team.teamNameDraft = 'West Ridge';
    team.saveTeam();
    for (let i = 1; i <= 6; i += 1) {
      team.draft = { name: `Player ${i}`, jerseyNumber: i, primaryPosition: 'OH' };
      team.submitPlayer();
    }

    const preMatch = await harness.navigateByUrl('/pre-match', PreMatchPage);
    await harness.fixture.whenStable();
    harness.detectChanges();
    preMatch.players.forEach((player, index) => {
      preMatch.teamRoster.setMatchSquadPlayer(player.id, true);
      preMatch.openPositionPicker(index + 1);
      preMatch.choosePlayerForEditingPosition(player.id);
    });
    harness.detectChanges();

    expect(preMatch.teamRoster.team().name).toBe('West Ridge');
    expect(preMatch.players.length).toBe(6);
    expect(preMatch.assignedStarterCount).toBe(6);

    preMatch.opponentName = 'Central High';
    expect(preMatch.canStartMatch).toBeTrue();
    await preMatch.startMatch();
    await harness.fixture.whenStable();
    harness.detectChanges();

    expect(router.url).toBe('/court');
    expect(harness.routeNativeElement?.textContent).toContain('Live Court');
    expect(harness.routeNativeElement?.textContent).toContain('Score the Point');

    let court = harness.routeDebugElement?.componentInstance as CourtPage;
    const savedStarter = court.getPlayerForPosition(1)!;
    court.teamRoster.removePlayer(savedStarter.id);
    await harness.navigateByUrl('/home');
    await harness.navigateByUrl('/court', CourtPage);
    await harness.fixture.whenStable();
    harness.detectChanges();
    expect(router.url).toBe('/court');
    court = harness.routeDebugElement?.componentInstance as CourtPage;
    expect(court.getPlayerForPosition(1)).toEqual(savedStarter);

    for (let set = 1; set <= 3; set += 1) {
      for (let point = 0; point < 25; point += 1) {
        court.activePlayer = 1;
        court.recordStandardOutcome('kill');
      }
      if (set < 3) {
        court.nextSetLineup = TestBed.inject(MatchEngineService).getNextSetDefaultLineup();
        court.startNextSet();
      }
    }
    harness.detectChanges();

    expect(court.isMatchOver).toBeTrue();
    expect(court.gameState.teamSets).toBe(3);
    expect(court.gameState.opponentSets).toBe(0);

    await harness.navigateByUrl('/history', HistoryPage);
    await harness.fixture.whenStable();
    harness.detectChanges();

    const recap = harness.routeNativeElement?.textContent ?? '';
    expect(router.url).toBe('/history');
    expect(recap).toContain('vs Central High');
    expect(recap).toContain('Final');
    expect(recap).toContain('3–0');
    const matchId = TestBed.inject(OfflineSyncService).getActiveMatchId();
    const review = await harness.navigateByUrl(`/review/${matchId}`, ReviewPage);
    await harness.fixture.whenStable();
    harness.detectChanges();
    expect(review).toBeTruthy();
    expect(harness.routeNativeElement?.textContent).toContain('Player 1');
  });
});

function setSmallPhoneViewport(): () => void {
  const originalWidth = window.innerWidth;
  const originalHeight = window.innerHeight;
  const widthSpy = spyOnProperty(window, 'innerWidth', 'get').and.returnValue(375);
  const heightSpy = spyOnProperty(window, 'innerHeight', 'get').and.returnValue(667);

  window.dispatchEvent(new Event('resize'));

  return () => {
    widthSpy.and.returnValue(originalWidth);
    heightSpy.and.returnValue(originalHeight);
    window.dispatchEvent(new Event('resize'));
  };
}
