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

  it('shows player identity and full playing position separately from court location after a swap', () => {
    teamRoster.addPlayer({ name: 'Alexandra Martinez-Williams', jerseyNumber: 12, primaryPosition: 'S' });
    teamRoster.addPlayer({ name: 'Jordan Chen', jerseyNumber: 8, primaryPosition: 'DS' });
    teamRoster.players().forEach((player, index) => {
      teamRoster.setMatchSquadPlayer(player.id, true);
      teamRoster.assignMatchStarter(player.id, index + 1);
    });
    fixture.detectChanges();
    const page: HTMLElement = fixture.nativeElement;
    const p1 = page.querySelector<HTMLButtonElement>('.court-slot[data-position="1"]')!;
    const p2 = page.querySelector<HTMLButtonElement>('.court-slot[data-position="2"]')!;
    expect(p1.querySelector('strong')?.textContent).toBe('Alexandra Martinez-Williams');
    expect(p1.querySelector('.slot-jersey')?.textContent).toBe('#12');
    expect(p1.querySelector('.slot-playing-position')?.textContent).toBe('Setter');
    expect(p1.querySelector('.slot-location')?.textContent).toBe('Back Right');
    p1.click();
    fixture.detectChanges();
    p2.click();
    fixture.detectChanges();
    expect(p1.querySelector('.slot-playing-position')?.textContent).toBe('Defensive specialist');
    expect(p1.querySelector('.slot-location')?.textContent).toBe('Back Right');
    expect(p2.querySelector('.slot-playing-position')?.textContent).toBe('Setter');
    expect(p2.getAttribute('aria-label')).toContain('Front Right, starter, #12 Alexandra Martinez-Williams, Setter');
  });

  it('swaps two starters directly without losing squad members or match readiness', () => {
    addSixPlayers();
    const players = teamRoster.players();
    players.forEach((player, index) => {
      teamRoster.setMatchSquadPlayer(player.id, true);
      teamRoster.assignMatchStarter(player.id, index + 1);
    });
    component.opponentName = 'Central High';
    fixture.detectChanges();
    const page: HTMLElement = fixture.nativeElement;
    const positions = Array.from(page.querySelectorAll<HTMLButtonElement>('.court-slot'));
    positions.find((button) => button.textContent!.includes('P1'))!.click();
    fixture.detectChanges();
    expect(teamRoster.matchDefaults().startingLineup).toEqual(players.map((player) => player.id));
    expect(component.selectedPlayerId).toBe(players[0].id);

    positions.find((button) => button.textContent!.includes('P2'))!.click();
    fixture.detectChanges();
    expect(teamRoster.matchDefaults().startingLineup).toEqual([
      players[1].id, players[0].id, ...players.slice(2).map((player) => player.id),
    ]);
    expect(teamRoster.getMatchSquadPlayers().length).toBe(6);
    expect(component.canStartMatch).toBeTrue();
    expect(component.selectedPlayerId).toBeNull();
    expect(page.querySelector('.lineup-instruction')?.textContent).toContain('Swapped Player 1 (P1) and Player 2 (P2)');
    expect(page.querySelector('.server-label')?.closest('button')?.textContent).toContain('Player 2');
  });

  it('cancels a court selection without clearing a starter and removes only through the explicit action', () => {
    addSixPlayers();
    const player = teamRoster.players()[0];
    teamRoster.setMatchSquadPlayer(player.id, true);
    teamRoster.assignMatchStarter(player.id, 4);
    const lineup = [...teamRoster.matchDefaults().startingLineup];
    fixture.detectChanges();
    const page: HTMLElement = fixture.nativeElement;
    const position = Array.from(page.querySelectorAll<HTMLButtonElement>('.court-slot'))
      .find((button) => button.textContent!.includes('P4'))!;
    position.click();
    fixture.detectChanges();
    position.click();
    fixture.detectChanges();
    expect(teamRoster.matchDefaults().startingLineup).toEqual(lineup);
    expect(component.selectedPlayerId).toBeNull();

    position.click();
    fixture.detectChanges();
    page.querySelector<HTMLButtonElement>('.remove-starter')!.click();
    fixture.detectChanges();
    expect(teamRoster.matchDefaults().startingLineup[3]).toBeNull();
    expect(teamRoster.isInMatchSquad(player.id)).toBeTrue();
  });

  it('swaps occupied positions on drop and clears selection when a drag is cancelled', () => {
    addSixPlayers();
    const players = teamRoster.players();
    players.forEach((player, index) => {
      teamRoster.setMatchSquadPlayer(player.id, true);
      teamRoster.assignMatchStarter(player.id, index + 1);
    });
    component.onDragStart(new DragEvent('dragstart'), players[0].id);
    component.dropOnPosition(new DragEvent('drop'), 3);
    expect(teamRoster.matchDefaults().startingLineup[0]).toBe(players[2].id);
    expect(teamRoster.matchDefaults().startingLineup[2]).toBe(players[0].id);
    expect(component.isLineupReady).toBeTrue();

    const lineup = [...teamRoster.matchDefaults().startingLineup];
    component.onDragStart(new DragEvent('dragstart'), players[1].id);
    component.endDrag();
    expect(component.selectedPlayerId).toBeNull();
    expect(teamRoster.matchDefaults().startingLineup).toEqual(lineup);
  });

  it('distinguishes selection and starter roles, then identifies a missing starter when availability changes', () => {
    addSixPlayers();
    teamRoster.players().forEach((player, index) => {
      teamRoster.setMatchSquadPlayer(player.id, true);
      teamRoster.assignMatchStarter(player.id, index + 1);
    });
    component.opponentName = 'Central High';
    fixture.detectChanges();
    const page: HTMLElement = fixture.nativeElement;
    expect(page.querySelectorAll('.court-slot .starter-label').length).toBe(6);
    expect(page.querySelector('.server-label')?.textContent).toContain('Serves first');

    const selection = page.querySelector<HTMLButtonElement>('.assign-player')!;
    selection.click();
    fixture.detectChanges();
    expect(selection.getAttribute('aria-pressed')).toBe('true');
    expect(selection.textContent).toContain('Selected');

    page.querySelector<HTMLInputElement>('.squad-check input')!.click();
    fixture.detectChanges();
    const missing = page.querySelector('.court-slot[aria-invalid="true"]')!;
    expect(missing.textContent).toContain('Needs player');
    expect(missing.getAttribute('aria-label')).toContain('Assign starter');
    expect(page.querySelectorAll('.court-slot .starter-label').length).toBe(5);
    expect(page.querySelector('.server-label')).toBeNull();
    expect(selection.getAttribute('aria-pressed')).toBe('false');
    expect(component.canStartMatch).toBeFalse();
  });

  it('explains an empty opponent after blur and clears the error when an opponent is entered', async () => {
    const page: HTMLElement = fixture.nativeElement;
    const input = page.querySelector<HTMLInputElement>('.opponent-field input')!;
    expect(input.getAttribute('aria-invalid')).toBe('false');
    expect(page.querySelector('#opponent-error')).toBeNull();

    input.dispatchEvent(new Event('blur'));
    fixture.detectChanges();
    expect(input.getAttribute('aria-invalid')).toBe('true');
    expect(input.getAttribute('aria-describedby')).toBe('opponent-error');
    expect(page.querySelector('#opponent-error')?.textContent).toContain('Enter the opponent name');

    input.value = 'Central High';
    input.dispatchEvent(new Event('input'));
    await fixture.whenStable();
    fixture.detectChanges();
    expect(input.getAttribute('aria-invalid')).toBe('false');
    expect(page.querySelector('#opponent-error')).toBeNull();
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
