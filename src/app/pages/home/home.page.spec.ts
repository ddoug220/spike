import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { provideRouter, RouterLink } from '@angular/router';
import { FirebaseDbService } from '../../services/firebase-db.service';
import type { Game, GameStatus } from '../../models/firestore.models';
import { OfflineSyncService } from '../../services/offline-sync.service';
import { TeamRosterService } from '../../services/team-roster.service';
import { HomePage } from './home.page';

const firebaseDbStub = {
  isConfigured: () => false,
  subscribeGame: (_gameId: string, onData: (game: null) => void) => { onData(null); return () => undefined; },
  subscribeEvents: (_gameId: string, onData: (events: []) => void) => { onData([]); return () => undefined; },
  subscribePlayerSetStats: (_gameId: string, onData: (stats: []) => void) => { onData([]); return () => undefined; },
};

describe('HomePage', () => {
  let component: HomePage;
  let fixture: ComponentFixture<HomePage>;
  let teamRoster: TeamRosterService;
  let offlineSync: OfflineSyncService;

  beforeEach(async () => {
    window.localStorage.clear();
    await TestBed.configureTestingModule({
      providers: [provideRouter([]), { provide: FirebaseDbService, useValue: firebaseDbStub }],
    }).compileComponents();
    fixture = TestBed.createComponent(HomePage);
    component = fixture.componentInstance;
    teamRoster = TestBed.inject(TeamRosterService);
    offlineSync = TestBed.inject(OfflineSyncService);
    fixture.detectChanges();
  });

  it('shows one next step for an empty team', () => {
    expect(component.nextTitle).toBe('Build your team');
    expect(component.nextActionLabel).toBe('Manage Team');
    expect(fixture.nativeElement.textContent).not.toContain('Ready check');
    expect(routeLinks()).toContain('/team');
  });

  it('moves the next step to Match Setup once six players exist', () => {
    addSixPlayers();
    fixture.detectChanges();

    expect(component.nextTitle).toBe('Set up the next match');
    expect(component.nextActionLabel).toBe('Set Up Match');
    expect(routeLinks()).toContain('/pre-match');
  });

  it('previews saved match-default starters without a readiness dashboard', () => {
    addSixPlayers();
    teamRoster.players().forEach((player) => teamRoster.setMatchSquadPlayer(player.id, true));
    teamRoster.players().forEach((player, index) => teamRoster.assignMatchStarter(player.id, index + 1));
    fixture.detectChanges();

    expect(component.assignedDefaultCount).toBe(6);
    expect(fixture.nativeElement.textContent).toContain('Next-match default');
    expect(fixture.nativeElement.textContent).toContain('Player 1');
    expect(fixture.nativeElement.textContent).not.toContain('First match guide');
  });

  for (const status of ['final', 'ended-early'] as const) {
    it(`makes Match Setup primary and review secondary after a ${status} match`, () => {
      saveFinishedGame(status);
      fixture.detectChanges();

      expect(component.nextActionLabel).toBe('Set Up Next Match');
      expect(component.nextActionRoute).toEqual(['/pre-match']);
      expect(component.nextActionQueryParams).toEqual({ nextMatch: offlineSync.getActiveMatchId() });
      expect(component.reviewLastMatchRoute).toEqual(['/review', offlineSync.getActiveMatchId()]);
      expect(routeLinks()).toContain(`/pre-match?nextMatch=${offlineSync.getActiveMatchId()}`);
      expect(routeLinks()).toContain(`/review/${offlineSync.getActiveMatchId()}`);
      expect(fixture.nativeElement.textContent).toContain('Review Last Match');
    });
  }

  it('does not offer Review Last Match without a finished game snapshot', () => {
    expect(component.hasReviewableMatch).toBeFalse();
    expect(fixture.nativeElement.textContent).not.toContain('Review Last Match');
  });

  function addSixPlayers(): void {
    for (let index = 1; index <= 6; index += 1) {
      teamRoster.addPlayer({ name: `Player ${index}`, jerseyNumber: index, primaryPosition: 'OH' });
    }
  }

  function saveFinishedGame(status: GameStatus): void {
    const matchId = offlineSync.getActiveMatchId();
    const now = '2026-09-02T12:00:00.000Z';
    offlineSync.queueGame({
      id: matchId,
      teamId: teamRoster.team().id,
      opponentName: 'Central High',
      status,
      servingTeam: 'team',
      teamPoints: 0,
      opponentPoints: 0,
      teamSets: status === 'final' ? 3 : 0,
      opponentSets: 0,
      currentSet: 3,
      isMatchOver: true,
      teamTimeoutsRemaining: 2,
      opponentTimeoutsRemaining: 2,
      teamRotation: 1,
      startedAt: now,
      endedAt: now,
      createdAt: now,
      updatedAt: now,
      matchSquad: [],
      startingLineup: [],
    } as Omit<Game, 'ownerId'>);
  }

  function routeLinks(): string[] {
    return fixture.debugElement
      .queryAll(By.directive(RouterLink))
      .map((element) => element.injector.get(RouterLink).href)
      .filter((href): href is string => href !== null);
  }
});
