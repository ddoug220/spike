import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { routes } from './app.routes';
import { LoginPage } from './pages/login/login.page';
import { PreMatchPage } from './pages/pre-match/pre-match.page';
import { AuthService } from './services/auth.service';
import { FirebaseDbService } from './services/firebase-db.service';

const firebaseDbStub = {
  isConfigured: () => false,
  readTeamRosterSnapshot: async () => ({ ok: true, data: { teams: [], players: [], rosters: [] } }),
  subscribeGame: (_gameId: string, onData: (game: null) => void) => {
    onData(null);
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

  it('signs in, builds an empty roster, starts six players, and reaches the live court', async () => {
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
    expect(harness.routeNativeElement?.textContent).toContain('Add your roster before setting starters');

    const preMatch = await harness.navigateByUrl('/pre-match', PreMatchPage);
    await harness.fixture.whenStable();
    harness.detectChanges();

    expect(preMatch.players.length).toBe(0);

    for (let i = 1; i <= 6; i += 1) {
      preMatch.draft = { name: `Player ${i}`, jerseyNumber: i, primaryPosition: 'OH' };
      preMatch.submitPlayer();
    }
    preMatch.players.forEach((player, index) => {
      preMatch.selectBenchPlayer(player.id);
      preMatch.assignSelectedToPosition(index + 1);
    });
    harness.detectChanges();

    expect(preMatch.players.length).toBe(6);
    expect(preMatch.assignedStarterCount).toBe(6);
    expect(preMatch.canStartMatch).toBeTrue();

    await preMatch.startMatch();
    await harness.fixture.whenStable();
    harness.detectChanges();

    expect(router.url).toBe('/court');
    expect(harness.routeNativeElement?.textContent).toContain('Live Court');
    expect(harness.routeNativeElement?.textContent).toContain('Score the Point');
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
