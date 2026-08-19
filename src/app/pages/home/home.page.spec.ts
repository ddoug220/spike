import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { provideRouter, RouterLink } from '@angular/router';
import { FirebaseDbService } from '../../services/firebase-db.service';
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

  beforeEach(async () => {
    window.localStorage.clear();
    await TestBed.configureTestingModule({
      providers: [provideRouter([]), { provide: FirebaseDbService, useValue: firebaseDbStub }],
    }).compileComponents();
    fixture = TestBed.createComponent(HomePage);
    component = fixture.componentInstance;
    teamRoster = TestBed.inject(TeamRosterService);
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

  function addSixPlayers(): void {
    for (let index = 1; index <= 6; index += 1) {
      teamRoster.addPlayer({ name: `Player ${index}`, jerseyNumber: index, primaryPosition: 'OH' });
    }
  }

  function routeLinks(): string[] {
    return fixture.debugElement
      .queryAll(By.directive(RouterLink))
      .map((element) => element.injector.get(RouterLink).href)
      .filter((href): href is string => href !== null);
  }
});
