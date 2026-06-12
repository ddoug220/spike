import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { provideRouter } from '@angular/router';
import { RouterLink } from '@angular/router';
import { HomePage } from './home.page';
import { FirebaseDbService } from '../../services/firebase-db.service';
import { TeamRosterService } from '../../services/team-roster.service';

const firebaseDbStub = {
  isConfigured: () => false,
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

function addSixPlayers(teamRoster: TeamRosterService): void {
  for (let i = 1; i <= 6; i += 1) {
    teamRoster.addPlayer({ name: `Player ${i}`, jerseyNumber: i, primaryPosition: 'OH' });
  }
}

function assignStartingSix(teamRoster: TeamRosterService): void {
  teamRoster.players().forEach((player, index) => teamRoster.assignPlayerToPosition(player.id, index + 1));
}

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

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('shows the saved team name and player pool count', () => {
    teamRoster.updateTeamName('North High');
    teamRoster.addPlayer({ name: 'Ava Johnson', jerseyNumber: 4, primaryPosition: 'OH' });

    fixture.detectChanges();

    expect(component.playerPoolCount).toBe(1);
    expect(fixture.nativeElement.textContent).toContain('North High');
    expect(fixture.nativeElement.textContent).toContain('Roster');
    expect(fixture.nativeElement.textContent).toContain('1/6');
  });

  it('routes Start Match to lineup setup when no active match exists', () => {
    addSixPlayers(teamRoster);
    assignStartingSix(teamRoster);
    fixture.detectChanges();

    const linkDebugEls = fixture.debugElement.queryAll(By.directive(RouterLink));
    const startLink = linkDebugEls
      .map((de) => de.injector.get(RouterLink))
      .find((routerLink) => (routerLink as RouterLink).href?.includes('/pre-match'));

    expect(startLink).toBeTruthy();
  });

  it('orients a new user around the setup path', () => {
    const text = fixture.nativeElement.textContent;

    expect(text).toContain('Track a volleyball match without losing the court.');
    expect(text).toContain('Ready check');
    expect(text).toContain('Roster');
    expect(text).toContain('Starting six');
    expect(text).toContain('Live match');
    expect(text).toContain('First match guide');
    expect(text).toContain('Roster is saved once');
    expect(text).toContain('Lineup is for today');
    expect(text).toContain('Point buttons change score');
    expect(text).toContain('Build your team');
    expect(text).toContain('Local save');
  });

  it('keeps first-time empty-roster CTAs focused on adding players', () => {
    fixture.detectChanges();
    const text = fixture.nativeElement.textContent;

    expect(component.primaryActionText).toBe('Add Players');
    expect(component.secondaryActionText).toBe('Add Players');
    expect(text).toContain('Build your team');
    expect(text).toContain('Add at least 6 players once. Spike reuses this player pool for every match.');
    expect(text).toContain('Add your roster before setting starters');
    expect(text).not.toContain('Edit Lineup');
  });

  it('asks users with a roster but no starting six to set the lineup', () => {
    addSixPlayers(teamRoster);
    fixture.detectChanges();
    const text = fixture.nativeElement.textContent;

    expect(component.primaryActionText).toBe('Set Lineup');
    expect(component.secondaryActionText).toBe('Set Lineup');
    expect(text).toContain('Set your starting lineup');
    expect(text).toContain('Tap players into open court spots');
    expect(text).not.toContain('Edit Lineup');
  });

  it('turns the hero court into a starting-six preview once the lineup is assigned', () => {
    addSixPlayers(teamRoster);
    assignStartingSix(teamRoster);

    fixture.detectChanges();
    const text = fixture.nativeElement.textContent;

    expect(text).toContain('Starting six');
    expect(text).toContain('6/6 starters ready');
    expect(text).toContain('Player 1');
    expect(component.showFirstMatchGuide).toBeFalse();
  });

  it('keeps ready-to-play CTAs on starting or editing the prepared lineup', () => {
    addSixPlayers(teamRoster);
    assignStartingSix(teamRoster);

    fixture.detectChanges();
    const text = fixture.nativeElement.textContent;

    expect(component.primaryActionText).toBe('Start Match');
    expect(component.secondaryActionText).toBe('Edit Lineup');
    expect(text).toContain('Start a tracked match');
    expect(text).toContain('Ready to name opponent and serve');
    expect(text).toContain('Starting six');
    expect(text).toContain('6/6 starters ready');
  });
});
