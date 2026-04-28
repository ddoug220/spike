import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { CourtPage } from './court.page';
import { MatchStateService } from '../../services/match-state.service';
import { TeamRosterService } from '../../services/team-roster.service';

describe('CourtPage', () => {
  let component: CourtPage;
  let fixture: ComponentFixture<CourtPage>;
  let teamRoster: TeamRosterService;
  let matchState: MatchStateService;

  beforeEach(async () => {
    window.localStorage.clear();
    await TestBed.configureTestingModule({
      providers: [provideRouter([])],
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

    expect(text).toContain('+ Kill');
    expect(text).toContain('\u2212 Att Error');
    expect(text).toContain('+ Block');
    expect(text).toContain('+ Ace');
    expect(text).toContain('+ Opp UE');
    expect(text).toContain('\u2212 Opp Winner');
    expect(text).toContain('Undo');
  });

  it('updates last-action feedback after an immediate scoring tap', () => {
    component.activePlayer = 2;

    component.recordStandardOutcome('ace');

    expect(component.getLastEventText()).toBe('Last: Player #2 - + Ace');
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
