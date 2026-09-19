import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { provideRouter, RouterLink } from '@angular/router';
import { FirebaseDbService } from '../../services/firebase-db.service';
import type { Game, GameStatus } from '../../models/firestore.models';
import { OfflineSyncService } from '../../services/offline-sync.service';
import { TeamRosterService } from '../../services/team-roster.service';
import { FirstRunCourtComponent } from './first-run-court/first-run-court.component';
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
  let offlineSync: OfflineSyncService;

  beforeEach(async () => {
    window.localStorage.clear();
    await TestBed.configureTestingModule({
      providers: [provideRouter([]), { provide: FirebaseDbService, useValue: firebaseDbStub }],
    }).compileComponents();
    fixture = TestBed.createComponent(HomePage);
    component = fixture.componentInstance;
    teamRoster = TestBed.inject(TeamRosterService);
    offlineSync = TestBed.inject(OfflineSyncService);
    fixture.detectChanges();
  });

  it('starts an empty team from the interactive court', () => {
    expect(component.nextTitle).toBe('Build your team');
    expect(component.nextActionLabel).toBe('Manage Team');
    expect(component.showsFirstRunCourt).toBeTrue();
    expect(fixture.nativeElement.textContent).toContain('Set your starting lineup');
    expect(fixture.nativeElement.textContent).toContain('Assign 6 more positions');
    expect(fixture.nativeElement.textContent).not.toContain('Ready check');
    expect(routeLinks()).toContain('/team');
  });

  it('adds a player to the roster and selected Starting Lineup Court Position from an empty court slot', () => {
    const court = fixture.debugElement.query(By.directive(FirstRunCourtComponent)).componentInstance as FirstRunCourtComponent;
    court.selectSlot(4);
    court.draft = { name: 'Ava Johnson', jerseyNumber: 4, primaryPosition: 'OH' };
    court.savePlayer();
    fixture.detectChanges();

    const player = teamRoster.players()[0];
    expect(player.name).toBe('Ava Johnson');
    expect(teamRoster.matchDefaults().startingLineup[3]).toBe(player.id);
    expect(fixture.nativeElement.textContent).toContain('Ava Johnson');
  });

  it('places an existing unassigned player without duplicating the roster', () => {
    const player = teamRoster.addPlayer({ name: 'Mia Chen', jerseyNumber: 8, primaryPosition: 'S' });
    fixture.detectChanges();

    const court = fixture.debugElement.query(By.directive(FirstRunCourtComponent)).componentInstance as FirstRunCourtComponent;
    court.selectSlot(1);
    court.selectedExistingPlayerId = player.id;
    court.placeExistingPlayer();
    fixture.detectChanges();

    expect(teamRoster.players().length).toBe(1);
    expect(teamRoster.matchDefaults().startingLineup[0]).toBe(player.id);
    expect(fixture.nativeElement.textContent).toContain('Mia Chen');
  });

  it('explains how to recover when the player name is missing', async () => {
    const court = fixture.debugElement.query(By.directive(FirstRunCourtComponent)).componentInstance as FirstRunCourtComponent;
    court.selectSlot(2);
    fixture.detectChanges();
    await fixture.whenStable();

    const playerNameInput = fixture.debugElement.query(By.css('input[name="courtPlayerName"]'));
    playerNameInput.nativeElement.dispatchEvent(new Event('blur'));
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain('Enter a player name.');
    expect(fixture.debugElement.query(By.css('input[name="courtPlayerName"].invalid'))).not.toBeNull();
    expect(teamRoster.players()).toEqual([]);
  });

  it('explains whitespace-only names instead of silently refusing to save', async () => {
    const court = fixture.debugElement.query(By.directive(FirstRunCourtComponent)).componentInstance as FirstRunCourtComponent;
    court.selectSlot(2);
    fixture.detectChanges();
    await fixture.whenStable();
    const input = fixture.nativeElement.querySelector('input[name="courtPlayerName"]') as HTMLInputElement;
    input.value = '   ';
    input.dispatchEvent(new Event('input'));
    input.dispatchEvent(new Event('blur'));
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Enter a player name.');
    expect(teamRoster.players()).toEqual([]);
  });

  it('keeps the interactive court available for a scheduled match that has not started', () => {
    teamRoster.addPlayer({ name: 'Mia Chen', jerseyNumber: 8, primaryPosition: 'S' });
    saveGame('scheduled');
    fixture.detectChanges();

    expect(component.hasStartedMatch).toBeFalse();
    expect(fixture.debugElement.query(By.directive(FirstRunCourtComponent))).not.toBeNull();
  });

  it('keeps the court primary when six saved players still have an open starting position', () => {
    addSixPlayers();
    teamRoster.players().slice(0, 5).forEach((player, index) => {
      teamRoster.setMatchSquadPlayer(player.id, true);
      teamRoster.assignMatchStarter(player.id, index + 1);
    });
    fixture.detectChanges();

    expect(component.showsFirstRunCourt).toBeTrue();
    expect(teamRoster.isMatchLineupReady).toBeFalse();
    expect(fixture.debugElement.query(By.directive(FirstRunCourtComponent))).not.toBeNull();
    expect(fixture.nativeElement.textContent).toContain('Assign 1 more position');
    expect(fixture.nativeElement.textContent).toContain('Choose a position to add a player or adjust your lineup.');
    expect(fixture.nativeElement.textContent).not.toContain('Next-match default');
    expect(fixture.nativeElement.querySelector('.court-setup a[href="/pre-match"]')).toBeNull();
  });

  it('makes Match Setup the next action once all six starting positions are assigned', () => {
    addSixPlayers();
    teamRoster.players().forEach((player) => teamRoster.setMatchSquadPlayer(player.id, true));
    teamRoster.players().forEach((player, index) => teamRoster.assignMatchStarter(player.id, index + 1));
    fixture.detectChanges();

    expect(component.showsFirstRunCourt).toBeFalse();
    expect(component.assignedDefaultCount).toBe(6);
    expect(fixture.debugElement.query(By.directive(FirstRunCourtComponent))).toBeNull();
    expect(fixture.nativeElement.textContent).toContain('Set up the next match');
    expect(fixture.nativeElement.textContent).toContain('Set Up Match');
    expect(fixture.nativeElement.textContent).toContain('Saved starting six');
    expect(fixture.nativeElement.textContent).toContain('Player 1');
    expect(fixture.nativeElement.textContent).not.toContain('First match guide');
    expect(routeLinks()).toContain('/pre-match');
  });

  for (const status of ['final', 'ended-early'] as const) {
    it(`makes Match Setup primary and review secondary after a ${status} match`, () => {
      addSixPlayers();
      teamRoster.players().forEach((player, index) => {
        teamRoster.setMatchSquadPlayer(player.id, true);
        teamRoster.assignMatchStarter(player.id, index + 1);
      });
      saveGame(status);
      fixture.detectChanges();

      expect(component.nextActionLabel).toBe('Set Up Next Match');
      expect(component.nextActionRoute).toEqual(['/pre-match']);
      expect(component.nextActionQueryParams).toEqual({ newMatch: '1' });
      expect(component.reviewLastMatchRoute).toEqual(['/review', offlineSync.getActiveMatchId()]);
      expect(component.showsFirstRunCourt).toBeFalse();
      expect(routeLinks()).toContain('/pre-match?newMatch=1');
      expect(routeLinks()).toContain(`/review/${offlineSync.getActiveMatchId()}`);
      expect(fixture.nativeElement.textContent).toContain('Review Last Match');
    });
  }

  it('retains drafts across positions and closing, discards them explicitly, and clears them on page departure', () => {
    const court = fixture.debugElement.query(By.directive(FirstRunCourtComponent)).componentInstance as FirstRunCourtComponent;
    court.selectSlot(1);
    court.draft.name = 'Unfinished player';
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Leaving Home or refreshing discards them.');
    court.selectSlot(2);
    expect(court.draft.name).toBe('');
    court.closeEditor();
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Leaving Home or refreshing discards them.');
    court.selectSlot(1);
    expect(court.draft.name).toBe('Unfinished player');
    expect(court.hasUnsavedChanges).toBeTrue();
    court.discardChanges();
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).not.toContain('Leaving Home or refreshing discards them.');
    expect(court.draft.name).toBe('');
    court.draft.name = 'Another draft';
    component.ionViewWillLeave();
    court.selectSlot(1);
    expect(court.draft.name).toBe('');
    expect(teamRoster.players()).toEqual([]);
  });

  it('keeps an incomplete lineup editable and follows player drafts through a swap', () => {
    addSixPlayers();
    teamRoster.players().slice(0, 5).forEach((player, index) => {
      teamRoster.setMatchSquadPlayer(player.id, true);
      teamRoster.assignMatchStarter(player.id, index + 1);
    });
    fixture.detectChanges();
    const court = fixture.debugElement.query(By.directive(FirstRunCourtComponent)).componentInstance as FirstRunCourtComponent;
    court.selectSlot(1);
    court.draft.name = 'Renamed player';
    court.startMove();
    court.selectSlot(2);
    court.selectSlot(2);
    expect(court.draft.name).toBe('Renamed player');
    court.savePlayer();
    expect(teamRoster.getMatchStartingSlots()[1].player?.name).toBe('Renamed player');
    expect(teamRoster.isMatchLineupReady).toBeFalse();
    court.selectSlot(2);
    court.clearPosition();
    fixture.detectChanges();
    expect(teamRoster.isMatchLineupReady).toBeFalse();
    expect(teamRoster.players().length).toBe(6);
    expect(teamRoster.getMatchSquadPlayers().length).toBe(5);
    expect(component.showsFirstRunCourt).toBeTrue();
  });

  it('keeps invalid jersey submissions out of the roster', () => {
    const court = fixture.debugElement.query(By.directive(FirstRunCourtComponent)).componentInstance as FirstRunCourtComponent;
    court.selectSlot(1);
    court.draft.name = 'Player';
    court.draft.jerseyNumber = 100;
    court.savePlayer();
    expect(teamRoster.players()).toEqual([]);
    expect(court.selectedPosition).toBe(1);
  });

  it('offers resume without an editable court during live play', () => {
    saveGame('live');
    fixture.detectChanges();
    expect(fixture.debugElement.query(By.directive(FirstRunCourtComponent))).toBeNull();
    expect(routeLinks()).toContain('/court');
  });

  it('does not apply an open player draft to a replacement starter', () => {
    addSixPlayers();
    const [first, replacement] = teamRoster.players();
    for (const player of [first, replacement]) teamRoster.setMatchSquadPlayer(player.id, true);
    teamRoster.assignMatchStarter(first.id, 1);
    fixture.detectChanges();
    const court = fixture.debugElement.query(By.directive(FirstRunCourtComponent)).componentInstance as FirstRunCourtComponent;
    court.selectSlot(1);
    court.draft.name = 'Unfinished rename';
    teamRoster.assignMatchStarter(replacement.id, 1);
    court.savePlayer();
    expect(teamRoster.getPlayerById(replacement.id)?.name).toBe(replacement.name);
    expect(court.draft.name).toBe('Unfinished rename');
    expect(court.selectedPosition).toBe(1);
    expect(court.operationError).toContain('lineup changed');
  });

  it('does not recreate a player removed while their form is open', () => {
    const player = teamRoster.addPlayer({ name: 'Removed player', jerseyNumber: 3, primaryPosition: 'OH' });
    teamRoster.setMatchSquadPlayer(player.id, true);
    teamRoster.assignMatchStarter(player.id, 1);
    fixture.detectChanges();
    const court = fixture.debugElement.query(By.directive(FirstRunCourtComponent)).componentInstance as FirstRunCourtComponent;
    court.selectSlot(1);
    court.draft.name = 'Draft to keep';
    teamRoster.removePlayer(player.id);
    court.savePlayer();
    expect(teamRoster.players()).toEqual([]);
    expect(court.draft.name).toBe('Draft to keep');
  });

  it('does not move a replacement starter when the move source changes', () => {
    addSixPlayers();
    const [first, replacement] = teamRoster.players();
    for (const player of [first, replacement]) teamRoster.setMatchSquadPlayer(player.id, true);
    teamRoster.assignMatchStarter(first.id, 1);
    fixture.detectChanges();
    const court = fixture.debugElement.query(By.directive(FirstRunCourtComponent)).componentInstance as FirstRunCourtComponent;
    court.selectSlot(1);
    court.startMove();
    teamRoster.assignMatchStarter(replacement.id, 1);
    court.selectSlot(2);
    expect(teamRoster.matchDefaults().startingLineup[0]).toBe(replacement.id);
    expect(teamRoster.matchDefaults().startingLineup[1]).toBeNull();
  });

  it('preserves a draft when saved details change and reloads current details on discard', () => {
    const player = teamRoster.addPlayer({ name: 'Original name', jerseyNumber: 3, primaryPosition: 'OH' });
    teamRoster.setMatchSquadPlayer(player.id, true);
    teamRoster.assignMatchStarter(player.id, 1);
    fixture.detectChanges();
    const court = fixture.debugElement.query(By.directive(FirstRunCourtComponent)).componentInstance as FirstRunCourtComponent;
    court.selectSlot(1);
    court.draft.name = 'My draft';
    teamRoster.updatePlayer(player.id, { name: 'Other saved name', jerseyNumber: 8, primaryPosition: 'S' });
    court.savePlayer();
    expect(teamRoster.getPlayerById(player.id)?.name).toBe('Other saved name');
    expect(court.draft.name).toBe('My draft');
    expect(court.operationError).toContain('saved details changed');
    court.discardChanges();
    expect(court.draft.name).toBe('Other saved name');
    expect(court.draft.jerseyNumber).toBe(8);
    expect(court.hasUnsavedChanges).toBeFalse();
    expect(court.operationError).toBe('');
  });

  it('connects invalid field messages to their inputs', async () => {
    const court = fixture.debugElement.query(By.directive(FirstRunCourtComponent)).componentInstance as FirstRunCourtComponent;
    court.selectSlot(1);
    fixture.detectChanges();
    await fixture.whenStable();
    const input = fixture.nativeElement.querySelector('input[name="courtPlayerName"]') as HTMLInputElement;
    input.dispatchEvent(new Event('blur'));
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(input.getAttribute('aria-invalid')).toBe('true');
    const message = fixture.nativeElement.querySelector('#' + input.getAttribute('aria-describedby'));
    expect(message.textContent).toBe('Enter a player name.');
  });

  it('does not offer Review Last Match without a finished game snapshot', () => {
    expect(component.hasReviewableMatch).toBeFalse();
    expect(fixture.nativeElement.textContent).not.toContain('Review Last Match');
  });

  function addSixPlayers(): void {
    for (let index = 1; index <= 6; index += 1) {
      teamRoster.addPlayer({ name: `Player ${index}`, jerseyNumber: index, primaryPosition: 'OH' });
    }
  }

  function saveGame(status: GameStatus): void {
    const matchId = offlineSync.getActiveMatchId();
    const now = '2026-09-02T12:00:00.000Z';
    const isFinished = status === 'final' || status === 'ended-early';
    offlineSync.queueGame({
      id: matchId,
      teamId: teamRoster.team().id,
      opponentName: 'Central High',
      status,
      servingTeam: 'team',
      teamPoints: 0,
      opponentPoints: 0,
      teamSets: status === 'final' ? 3 : 0,
      opponentSets: 0,
      currentSet: 3,
      isMatchOver: isFinished,
      teamTimeoutsRemaining: 2,
      opponentTimeoutsRemaining: 2,
      teamRotation: 1,
      startedAt: now,
      endedAt: isFinished ? now : null,
      createdAt: now,
      updatedAt: now,
      matchSquad: [],
      startingLineup: [],
    } as Omit<Game, 'ownerId'>);
  }

  function routeLinks(): string[] {
    return fixture.debugElement
      .queryAll(By.directive(RouterLink))
      .map((element) => element.injector.get(RouterLink).href)
      .filter((href): href is string => href !== null);
  }
});
