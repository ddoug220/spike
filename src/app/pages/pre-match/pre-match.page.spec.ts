import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { FirebaseDbService } from '../../services/firebase-db.service';
import { MatchEngineService } from '../../services/match-engine.service';
import { TeamRosterService } from '../../services/team-roster.service';
import { PreMatchPage } from './pre-match.page';

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

describe('PreMatchPage', () => {
  let component: PreMatchPage;
  let fixture: ComponentFixture<PreMatchPage>;
  let teamRoster: TeamRosterService;
  let matchEngine: MatchEngineService;
  let router: Router;

  beforeEach(async () => {
    window.localStorage.clear();
    await TestBed.configureTestingModule({
      providers: [provideRouter([]), { provide: FirebaseDbService, useValue: firebaseDbStub }],
    }).compileComponents();

    fixture = TestBed.createComponent(PreMatchPage);
    component = fixture.componentInstance;
    teamRoster = TestBed.inject(TeamRosterService);
    matchEngine = TestBed.inject(MatchEngineService);
    router = TestBed.inject(Router);
    fixture.detectChanges();
  });

  it('requires an opponent, a six-player squad, and six unique starters', () => {
    addSixPlayers();
    expect(component.canStartMatch).toBeFalse();
    expect(component.startMatchDisabledReason).toBe('Enter the opponent name');

    component.opponentName = 'Central High';
    expect(component.canStartMatch).toBeFalse();

    teamRoster.players().forEach((player, index) => {
      teamRoster.setMatchSquadPlayer(player.id, true);
      teamRoster.assignMatchStarter(player.id, index + 1);
    });

    expect(component.canStartMatch).toBeTrue();
  });

  it('clears a starter when that player leaves the match squad', () => {
    addSixPlayers();
    const player = teamRoster.players()[0];
    teamRoster.setMatchSquadPlayer(player.id, true);
    teamRoster.assignMatchStarter(player.id, 1);

    teamRoster.setMatchSquadPlayer(player.id, false);

    expect(teamRoster.matchDefaults().startingLineup[0]).toBeNull();
  });

  it('starts from saved match defaults without changing them during live lineup updates', async () => {
    addSixPlayers();
    const players = teamRoster.players();
    players.forEach((player, index) => {
      teamRoster.setMatchSquadPlayer(player.id, true);
      teamRoster.assignMatchStarter(player.id, index + 1);
    });
    component.opponentName = ' Central High ';
    component.setFirstServeTeam('opponent');
    spyOn(matchEngine, 'startMatch').and.returnValue('game-test');
    spyOn(router, 'navigate').and.resolveTo(true);

    await component.startMatch();
    teamRoster.rotateLineupClockwise();

    expect(matchEngine.startMatch).toHaveBeenCalledWith('opponent', { opponentName: 'Central High' });
    expect(teamRoster.matchDefaults().startingLineup).toEqual(players.map((player) => player.id));
    expect(teamRoster.lineup()[0]).toBe(players[1].id);
  });

  it('shows only match-specific setup controls', () => {
    const text = fixture.nativeElement.textContent;

    expect(text).toContain('Match Setup');
    expect(text).toContain('Opponent');
    expect(text).toContain('Match Squad');
    expect(text).toContain('Starting Six');
    expect(text).not.toContain('Add Player');
    expect(text).not.toContain('Team Name');
  });

  function addSixPlayers(): void {
    for (let i = 1; i <= 6; i += 1) {
      teamRoster.addPlayer({ name: `Player ${i}`, jerseyNumber: i, primaryPosition: 'OH' });
    }
  }
});
