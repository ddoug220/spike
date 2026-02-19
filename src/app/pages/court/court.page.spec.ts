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
});
