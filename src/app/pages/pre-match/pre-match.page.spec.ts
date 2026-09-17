import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter, Router } from '@angular/router';
import { FirebaseDbService } from '../../services/firebase-db.service';
import { MatchEngineService } from '../../services/match-engine.service';
import { OfflineSyncService } from '../../services/offline-sync.service';
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
  let offlineSync: OfflineSyncService;
  let router: Router;
  let finishedMatchId: string | null;
  let newMatch: boolean;

  beforeEach(async () => {
    window.localStorage.clear();
    finishedMatchId = null;
    newMatch = false;
    await TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        { provide: FirebaseDbService, useValue: firebaseDbStub },
        {
          provide: ActivatedRoute,
          useValue: {
            snapshot: {
              get queryParamMap() {
                return convertToParamMap(newMatch ? { newMatch: '1' } : finishedMatchId ? { nextMatch: finishedMatchId } : {});
              },
            },
          },
        },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(PreMatchPage);
    component = fixture.componentInstance;
    teamRoster = TestBed.inject(TeamRosterService);
    matchEngine = TestBed.inject(MatchEngineService);
    offlineSync = TestBed.inject(OfflineSyncService);
    router = TestBed.inject(Router);
    fixture.detectChanges();
  });

  it('starts a new match from Home without overwriting its edited starters', () => {
    addSixPlayers();
    teamRoster.players().forEach((player, index) => {
      teamRoster.setMatchSquadPlayer(player.id, true);
      teamRoster.assignMatchStarter(player.id, index + 1);
    });
    teamRoster.moveMatchStarter(1, 4);
    const lineup = [...teamRoster.matchDefaults().startingLineup];
    component.opponentName = 'Previous opponent';
    component.firstServeTeam = 'opponent';
    newMatch = true;
    spyOn(router, 'navigate').and.resolveTo(true);
    component.ionViewWillEnter();
    expect(component.opponentName).toBe('');
    expect(component.firstServeTeam).toBe('team');
    expect(teamRoster.matchDefaults().startingLineup).toEqual(lineup);
    expect(router.navigate).toHaveBeenCalledWith([], {
      relativeTo: TestBed.inject(ActivatedRoute), queryParams: { newMatch: null, nextMatch: null },
      queryParamsHandling: 'merge', replaceUrl: true,
    });
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

  it('assigns and moves starters through the position picker', () => {
    addSixPlayers();
    const players = teamRoster.players();
    players.forEach((player) => teamRoster.setMatchSquadPlayer(player.id, true));
    teamRoster.assignMatchStarter(players[0].id, 1);
    teamRoster.assignMatchStarter(players[1].id, 2);

    component.openPositionPicker(4);
    component.choosePlayerForEditingPosition(players[2].id);
    expect(teamRoster.matchDefaults().startingLineup[3]).toBe(players[2].id);
    expect(component.editingPosition).toBeNull();

    component.openPositionPicker(6);
    component.choosePlayerForEditingPosition(players[0].id);
    expect(teamRoster.matchDefaults().startingLineup[0]).toBeNull();
    expect(teamRoster.matchDefaults().startingLineup[5]).toBe(players[0].id);
  });

  it('dismisses the picker without changing the lineup and restores trigger focus', () => {
    addSixPlayers();
    const player = teamRoster.players()[0];
    teamRoster.setMatchSquadPlayer(player.id, true);
    teamRoster.assignMatchStarter(player.id, 3);
    const lineup = [...teamRoster.matchDefaults().startingLineup];
    const trigger = document.createElement('button');
    spyOn(trigger, 'focus');

    component.openPositionPicker(3, trigger);
    component.closePositionPicker();
    component.handlePositionPickerDismiss();

    expect(teamRoster.matchDefaults().startingLineup).toEqual(lineup);
    expect(trigger.focus).toHaveBeenCalled();
  });

  it('clears the edited position explicitly and exposes descriptive accessible labels', () => {
    addSixPlayers();
    const player = teamRoster.players()[0];
    teamRoster.setMatchSquadPlayer(player.id, true);
    teamRoster.assignMatchStarter(player.id, 5);

    expect(component.getCourtSlotAriaLabel(5)).toContain(`#${player.jerseyNumber} ${player.name}`);
    expect(component.getPlayerPickerAriaLabel(player)).toContain('currently P5');

    component.openPositionPicker(5);
    component.clearEditingPosition();

    expect(teamRoster.matchDefaults().startingLineup[4]).toBeNull();
    expect(component.getCourtSlotAriaLabel(5)).toContain('open position');
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

  it('clears a cached opponent for next-match setup without changing saved squad and lineup defaults', () => {
    addSixPlayers();
    const players = teamRoster.players();
    players.forEach((player, index) => {
      teamRoster.setMatchSquadPlayer(player.id, true);
      teamRoster.assignMatchStarter(player.id, index + 1);
    });
    const savedSquad = [...teamRoster.matchDefaults().squadPlayerIds];
    const savedLineup = [...teamRoster.matchDefaults().startingLineup];
    teamRoster.setMatchSquadPlayer(players[5].id, false);
    component.opponentName = 'Previous Opponent';
    finishedMatchId = 'finished-game-1';
    spyOn(offlineSync, 'getGame').and.returnValue({
      matchSquad: players.map(({ id, name, jerseyNumber, primaryPosition }) => ({ id, name, jerseyNumber, primaryPosition })),
      startingLineup: savedLineup,
    } as ReturnType<OfflineSyncService['getGame']>);
    spyOn(router, 'navigate').and.callFake(() => {
      finishedMatchId = null;
      return Promise.resolve(true);
    });

    component.ionViewWillEnter();

    expect(component.opponentName).toBe('');
    expect(component.canStartMatch).toBeFalse();
    expect(teamRoster.matchDefaults().squadPlayerIds).toEqual(savedSquad);
    expect(teamRoster.matchDefaults().startingLineup).toEqual(savedLineup);
    expect(router.navigate).toHaveBeenCalledWith([], {
      relativeTo: TestBed.inject(ActivatedRoute),
      queryParams: { nextMatch: null },
      queryParamsHandling: 'merge',
      replaceUrl: true,
    });

    component.opponentName = 'Next Opponent';
    component.ionViewWillEnter();
    expect(component.opponentName).toBe('Next Opponent');

    finishedMatchId = 'finished-game-1';
    component.ionViewWillEnter();
    expect(component.opponentName).toBe('');
  });

  it('shows only match-specific setup controls', () => {
    const text = fixture.nativeElement.textContent;

    expect(text).toContain('Match Setup');
    expect(text).toContain('Opponent');
    expect(text).toContain('Match Squad');
    expect(text).toContain('Starting Six');
    expect(text).not.toContain('Add Player');
    expect(text).not.toContain('Team Name');
    expect(fixture.nativeElement.querySelector('ion-footer.start-footer')).not.toBeNull();
    expect(component.opponentName).toBe('');
  });

  function addSixPlayers(): void {
    for (let i = 1; i <= 6; i += 1) {
      teamRoster.addPlayer({ name: `Player ${i}`, jerseyNumber: i, primaryPosition: 'OH' });
    }
  }
});
