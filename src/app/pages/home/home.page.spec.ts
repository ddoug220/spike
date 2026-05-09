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
    expect(fixture.nativeElement.textContent).toContain('1/6 minimum in your saved player pool');
  });

  it('routes Start Match to lineup setup when no active match exists', () => {
    for (let i = 1; i <= 6; i += 1) {
      teamRoster.addPlayer({ name: `Player ${i}`, jerseyNumber: i, primaryPosition: 'OH' });
    }
    teamRoster.players().forEach((player, index) => teamRoster.assignPlayerToPosition(player.id, index + 1));
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
    expect(text).toContain('First match guide');
    expect(text).toContain('Roster is saved once');
    expect(text).toContain('Lineup is for today');
    expect(text).toContain('Point buttons change score');
    expect(text).toContain('Build your team');
    expect(text).toContain('Add players');
    expect(text).toContain('Set lineup');
    expect(text).toContain('Track live');
  });
});
