import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { CourtPage } from './court.page';
import { FirebaseDbService } from '../../services/firebase-db.service';
import { MatchStateService } from '../../services/match-state.service';
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

describe('CourtPage', () => {
  let component: CourtPage;
  let fixture: ComponentFixture<CourtPage>;
  let teamRoster: TeamRosterService;
  let matchState: MatchStateService;

  beforeEach(async () => {
    window.localStorage.clear();
    await TestBed.configureTestingModule({
      providers: [provideRouter([]), { provide: FirebaseDbService, useValue: firebaseDbStub }],
    }).compileComponents();

    fixture = TestBed.createComponent(CourtPage);
    component = fixture.componentInstance;
    teamRoster = TestBed.inject(TeamRosterService);
    matchState = TestBed.inject(MatchStateService);
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('rotates lineup after team side-out scoring action', () => {
    for (let i = 1; i <= 6; i += 1) {
      teamRoster.addPlayer({
        name: `Player ${i}`,
        jerseyNumber: i,
        primaryPosition: 'OH',
      });
    }
    const players = teamRoster.players();
    players.forEach((player, index) => teamRoster.assignPlayerToPosition(player.id, index + 1));

    component.recordOpponentPoint(); // Opponent now serving
    component.recordAction('kill'); // Team wins while receiving -> side-out and rotate

    const rotated = teamRoster.lineup();
    expect(rotated[0]).toBe(players[1].id);
    expect(rotated[5]).toBe(players[0].id);
  });

  it('keeps selected player across action logs until user changes selection', () => {
    component.activePlayer = 4;

    component.recordAction('kill');
    expect(component.activePlayer).toBe(4);

    component.recordOpponentPoint();
    expect(component.activePlayer).toBe(4);
  });

  it('renders the standard scoring actions and prominent undo control', () => {
    fixture.detectChanges();
    const text = fixture.nativeElement.textContent;

    expect(text).toContain('Score the Point');
    expect(text).toContain('Kill');
    expect(text).toContain('Attack Error');
    expect(text).toContain('Block');
    expect(text).toContain('Ace');
    expect(text).toContain('Service Error');
    expect(text).toContain('Opponent Error');
    expect(text).toContain('Opponent Winner');
    expect(text).toContain('Receive Error');
    expect(text).toContain('Stat tap');
    expect(text).toContain('Dig');
    expect(text).toContain('Undo');
  });

  it('updates last-action feedback after an immediate scoring tap', () => {
    component.activePlayer = 2;

    component.recordStandardOutcome('ace');

    expect(component.getLastEventText()).toBe('Last: Player #2 - Ace');
  });

  it('tracks an opponent winner point separately from team-error actions', () => {
    const before = matchState.state().opponentPoints;

    component.recordStandardOutcome('opponent-point');

    expect(matchState.state().opponentPoints).toBe(before + 1);
    expect(component.getLastEventText()).toBe('Last: Opponent Winner');
  });

  it('tracks a team point from opponent unforced error', () => {
    const before = matchState.state().teamPoints;

    component.recordStandardOutcome('opponent-error');

    expect(matchState.state().teamPoints).toBe(before + 1);
    expect(component.getLastEventText()).toBe('Last: Opponent Unforced Error');
  });

  it('tracks service error as an opponent point and serving stat', () => {
    for (let i = 1; i <= 6; i += 1) {
      teamRoster.addPlayer({
        name: `Player ${i}`,
        jerseyNumber: i,
        primaryPosition: 'OH',
      });
    }
    const server = teamRoster.players()[0];
    teamRoster.players().forEach((player, index) => teamRoster.assignPlayerToPosition(player.id, index + 1));
    const before = matchState.state().opponentPoints;

    component.recordStandardOutcome('service-error');

    expect(matchState.state().opponentPoints).toBe(before + 1);
    expect(component.liveStore.getPlayerStats(server.id).serviceErrors).toBe(1);
    expect(component.liveStore.getPlayerStats(server.id).serveAttempts).toBe(1);
  });

  it('tracks receive error as an attributed opponent point', () => {
    for (let i = 1; i <= 6; i += 1) {
      teamRoster.addPlayer({
        name: `Player ${i}`,
        jerseyNumber: i,
        primaryPosition: 'OH',
      });
    }
    const passer = teamRoster.players()[2];
    teamRoster.players().forEach((player, index) => teamRoster.assignPlayerToPosition(player.id, index + 1));
    component.activePlayer = 3;
    const before = matchState.state().opponentPoints;

    component.recordStandardOutcome('receive-error');

    expect(matchState.state().opponentPoints).toBe(before + 1);
    expect(component.liveStore.getPlayerStats(passer.id).receiveErrors).toBe(1);
    expect(component.getLastEventText()).toBe('Last: Player #3 - Receive Error');
  });

  it('tracks dig as a stat tap without changing the score', () => {
    for (let i = 1; i <= 6; i += 1) {
      teamRoster.addPlayer({
        name: `Player ${i}`,
        jerseyNumber: i,
        primaryPosition: 'OH',
      });
    }
    const defender = teamRoster.players()[3];
    teamRoster.players().forEach((player, index) => teamRoster.assignPlayerToPosition(player.id, index + 1));
    component.activePlayer = 4;
    const before = matchState.state();

    component.recordAction('dig');

    expect(matchState.state().teamPoints).toBe(before.teamPoints);
    expect(matchState.state().opponentPoints).toBe(before.opponentPoints);
    expect(component.liveStore.getPlayerStats(defender.id).digs).toBe(1);
    expect(component.getLastEventText()).toBe('Last: Player #4 - Dig');
  });

  it('allows manual rotation during live play', () => {
    for (let i = 1; i <= 6; i += 1) {
      teamRoster.addPlayer({
        name: `Player ${i}`,
        jerseyNumber: i,
        primaryPosition: 'OH',
      });
    }
    const players = teamRoster.players();
    players.forEach((player, index) => teamRoster.assignPlayerToPosition(player.id, index + 1));
    const initialRotation = matchState.state().teamRotation;
    const initialLineup = [...teamRoster.lineup()];

    component.manualRotate();

    expect(matchState.state().teamRotation).toBe(initialRotation >= 6 ? 1 : initialRotation + 1);
    expect(teamRoster.lineup()[0]).toBe(initialLineup[1]);
    expect(teamRoster.lineup()[5]).toBe(initialLineup[0]);
    expect(component.getLastEventText()).toBe('Last: Manual Rotation');
  });

  it('applies substitution immediately when a bench player is tapped in overlay mode', () => {
    for (let i = 1; i <= 8; i += 1) {
      teamRoster.addPlayer({
        name: `Player ${i}`,
        jerseyNumber: i,
        primaryPosition: 'OH',
      });
    }
    const players = teamRoster.players();
    players.slice(0, 6).forEach((player, index) => teamRoster.assignPlayerToPosition(player.id, index + 1));
    const benchInPlayer = players[6];

    component.activePlayer = 1;
    component.toggleSubMode();
    component.handleBenchPlayerTap(benchInPlayer.id);

    expect(component.isSubOverlayOpen).toBeFalse();
    expect(teamRoster.lineup()[0]).toBe(benchInPlayer.id);
    expect(component.substitutionStatus).toContain('Substituted:');
  });

  it('keeps Start New Match available in exit actions after the match is final', () => {
    matchState.endMatch();
    fixture.detectChanges();

    const actions = component.exitSheetButtons.map((button) => button.data?.action);
    expect(actions).toContain('new-match');
    expect(actions).not.toContain('end-home');
  });
});
