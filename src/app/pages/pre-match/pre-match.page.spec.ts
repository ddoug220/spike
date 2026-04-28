import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { PreMatchPage } from './pre-match.page';
import { MatchEngineService } from '../../services/match-engine.service';
import { TeamRosterService } from '../../services/team-roster.service';

describe('PreMatchPage', () => {
  let component: PreMatchPage;
  let fixture: ComponentFixture<PreMatchPage>;
  let teamRoster: TeamRosterService;
  let matchEngine: MatchEngineService;
  let router: Router;

  beforeEach(async () => {
    window.localStorage.clear();
    await TestBed.configureTestingModule({
      providers: [provideRouter([])],
    }).compileComponents();

    fixture = TestBed.createComponent(PreMatchPage);
    component = fixture.componentInstance;
    teamRoster = TestBed.inject(TeamRosterService);
    matchEngine = TestBed.inject(MatchEngineService);
    router = TestBed.inject(Router);
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('assigns a selected roster player to a tapped court slot', () => {
    teamRoster.addPlayer({ name: 'Ava Johnson', jerseyNumber: 4, primaryPosition: 'OH' });
    const player = teamRoster.players()[0];

    component.selectBenchPlayer(player.id);
    component.assignSelectedToPosition(3);

    expect(teamRoster.lineup()[2]).toBe(player.id);
    expect(component.selectedBenchPlayerId).toBeNull();
  });

  it('saves the team name that owns the player pool', () => {
    component.teamNameDraft = 'North High';

    component.saveTeam();
    fixture.detectChanges();

    expect(teamRoster.team().name).toBe('North High');
    expect(fixture.nativeElement.textContent).toContain('Player Pool');
    expect(fixture.nativeElement.textContent).toContain('North High');
  });

  it('passes opponent name when starting a match', async () => {
    spyOn(matchEngine, 'startMatch').and.callThrough();
    spyOn(router, 'navigate').and.resolveTo(true);
    for (let i = 1; i <= 6; i += 1) {
      teamRoster.addPlayer({ name: `Player ${i}`, jerseyNumber: i, primaryPosition: 'OH' });
    }
    teamRoster.players().forEach((player, index) => teamRoster.assignPlayerToPosition(player.id, index + 1));
    component.matchDetails.opponentName = 'Central High';
    component.setFirstServeTeam('opponent');

    await component.startMatch();

    expect(matchEngine.startMatch).toHaveBeenCalledWith('opponent', { opponentName: 'Central High' });
  });

  it('does not expose fake-team generation in the setup template', () => {
    expect(fixture.nativeElement.textContent).not.toContain('Generate Fake Team');
  });
});
