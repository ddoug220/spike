import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { CourtPage } from './court.page';
import { FirebaseDbService } from '../../services/firebase-db.service';
import { MatchStateService } from '../../services/match-state.service';
import { TeamRosterService } from '../../services/team-roster.service';
import { MatchEngineService } from '../../services/match-engine.service';

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
  let matchEngine: MatchEngineService;
  let router: Router;

  beforeEach(async () => {
    window.localStorage.clear();
    await TestBed.configureTestingModule({
      providers: [provideRouter([]), { provide: FirebaseDbService, useValue: firebaseDbStub }],
    }).compileComponents();

    fixture = TestBed.createComponent(CourtPage);
    component = fixture.componentInstance;
    teamRoster = TestBed.inject(TeamRosterService);
    matchState = TestBed.inject(MatchStateService);
    matchEngine = TestBed.inject(MatchEngineService);
    router = TestBed.inject(Router);
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
    matchEngine.startMatch('team');

    component.recordOpponentPoint(); // Opponent now serving
    component.activePlayer = 1;
    component.recordAction('kill'); // Team wins while receiving -> side-out and rotate

    expect(component.getPlayerForPosition(1)?.id).toBe(players[1].id);
    expect(component.getPlayerForPosition(6)?.id).toBe(players[0].id);
    expect(teamRoster.lineup()[0]).toBe(players[0].id);
  });

  it('starts without a selected player and clears selection after each rally', () => {
    expect(component.activePlayer).toBeNull();
    component.activePlayer = 4;

    component.recordAction('kill');
    expect(component.activePlayer).toBeNull();

    component.activePlayer = 4;
    component.recordOpponentPoint();
    expect(component.activePlayer).toBeNull();
  });

  it('does not record a player-specific action until a player is selected', () => {
    const before = matchState.state().teamPoints;

    component.recordAction('kill');

    expect(matchState.state().teamPoints).toBe(before);
  });

  it('renders the standard scoring actions and prominent undo control', () => {
    startMatchWithLineup();
    component.recordOpponentPoint();
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
    startMatchWithLineup();
    component.activePlayer = 2;

    component.recordStandardOutcome('ace');

    expect(component.getLastEventText()).toContain('Last: Ace · Starter 2');
    expect(component.getLastEventText()).toContain('· R1');
  });

  it('keeps touch Undo available while prior applied actions remain', () => {
    startMatchWithLineup();
    component.activePlayer = 1;
    component.recordStandardOutcome('kill');
    component.recordStandardOutcome('opponent-point');
    expect(component.canUndo).toBeTrue();
    expect(component.getLastEventText()).toContain('Opponent Winner');

    component.activePlayer = 4;
    component.undoLastAction();
    expect(component.activePlayer).toBeNull();
    expect(component.canUndo).toBeTrue();
    expect(component.getLastEventText()).toContain('Kill · Starter 1');

    component.undoLastAction();
    expect(component.canUndo).toBeFalse();
    expect(component.getLastEventText()).toBe('No actions yet');
  });

  it('tracks an opponent winner point separately from team-error actions', () => {
    startMatchWithLineup();
    const before = matchState.state().opponentPoints;

    component.recordStandardOutcome('opponent-point');

    expect(matchState.state().opponentPoints).toBe(before + 1);
    expect(component.getLastEventText()).toContain('Last: Opponent Winner');
  });

  it('tracks a team point from opponent unforced error', () => {
    startMatchWithLineup();
    const before = matchState.state().teamPoints;

    component.recordStandardOutcome('opponent-error');

    expect(matchState.state().teamPoints).toBe(before + 1);
    expect(component.getLastEventText()).toContain('Last: Opponent Unforced Error');
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
    matchEngine.startMatch('team');
    component.activePlayer = 1;
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
    matchEngine.startMatch('team');
    component.activePlayer = 3;
    const before = matchState.state().opponentPoints;

    component.recordStandardOutcome('receive-error');

    expect(matchState.state().opponentPoints).toBe(before + 1);
    expect(component.liveStore.getPlayerStats(passer.id).receiveErrors).toBe(1);
    expect(component.getLastEventText()).toContain('Last: Receive Error · Player 3');
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
    matchEngine.startMatch('team');
    component.activePlayer = 4;
    const before = matchState.state();

    component.recordAction('dig');

    expect(matchState.state().teamPoints).toBe(before.teamPoints);
    expect(matchState.state().opponentPoints).toBe(before.opponentPoints);
    expect(component.liveStore.getPlayerStats(defender.id).digs).toBe(1);
    expect(component.getLastEventText()).toContain('Last: Dig · Player 4');
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
    matchEngine.startMatch('team');
    const initialRotation = matchState.state().teamRotation;
    const initialLineup = [...teamRoster.lineup()];

    component.manualRotate();

    expect(matchState.state().teamRotation).toBe(initialRotation >= 6 ? 1 : initialRotation + 1);
    expect(component.getPlayerForPosition(1)?.id).toBe(initialLineup[1] ?? undefined);
    expect(component.getPlayerForPosition(6)?.id).toBe(initialLineup[0] ?? undefined);
    expect(teamRoster.lineup()).toEqual(initialLineup);
    expect(component.getLastEventText()).toContain('Last: Rotation corrected · R2');
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
    matchEngine.startMatch('team');

    component.activePlayer = 1;
    component.toggleSubMode();
    component.handleBenchPlayerTap(benchInPlayer.id);

    expect(component.isSubOverlayOpen).toBeFalse();
    expect(component.getPlayerForPosition(1)?.id).toBe(benchInPlayer.id);
    expect(teamRoster.lineup()[0]).toBe(players[0].id);
    expect(component.substitutionStatus).toContain('Substituted:');
  });

  it('uses only saved match players for court identity, substitution bench, and next-set choices', () => {
    for (let i = 1; i <= 8; i += 1) {
      teamRoster.addPlayer({ name: `Snapshot ${i}`, jerseyNumber: i, primaryPosition: 'OH' });
    }
    const players = teamRoster.players();
    players.slice(0, 6).forEach((player, index) => teamRoster.assignPlayerToPosition(player.id, index + 1));
    players.slice(0, 7).forEach((player) => teamRoster.setMatchSquadPlayer(player.id, true));
    teamRoster.setMatchSquadPlayer(players[7].id, false);
    matchEngine.startMatch('team');
    component.liveStore.syncActiveGame();

    teamRoster.updatePlayer(players[0].id, { name: 'Roster rename', jerseyNumber: 90, primaryPosition: 'S' });
    teamRoster.removePlayer(players[0].id);

    expect(component.getPlayerForPosition(1)?.name).toBe('Snapshot 1');
    expect(component.benchPlayers.map((player) => player.id)).toEqual([players[6].id]);

    for (let point = 0; point < 25; point += 1) {
      matchEngine.recordPlayerAction(1, 'kill');
    }
    component.nextSetLineup = matchEngine.getNextSetDefaultLineup();
    fixture.detectChanges();
    const options = Array.from(fixture.nativeElement.querySelectorAll('.next-set-grid option'))
      .map((option) => (option as HTMLOptionElement).textContent?.trim());
    expect(options).toContain('#1 Snapshot 1');
    expect(options).toContain('#7 Snapshot 7');
    expect(options).not.toContain('#8 Snapshot 8');
    expect(options).not.toContain('#90 Roster rename');
  });

  it('offers only safe exit actions during a live match', () => {
    startMatchWithLineup();

    expect(component.exitSheetButtons.map((button) => button.text)).toEqual([
      'Go Home', 'Match History', 'End Match + Go Home', 'Cancel',
    ]);
  });

  it('routes a finished match through Match Setup and removes direct new-match actions', async () => {
    matchState.endMatch();
    fixture.detectChanges();
    spyOn(router, 'navigate').and.resolveTo(true);

    const actions = component.exitSheetButtons.map((button) => button.data?.action);
    expect(component.exitSheetButtons.map((button) => button.text)).toEqual([
      'Go Home', 'Set Up Next Match', 'Match History', 'Cancel',
    ]);
    expect(actions).toContain('setup-next');
    expect(component.exitSheetButtons.some((button) => button.text === 'Start New Match')).toBeFalse();
    expect(actions).not.toContain('end-home');

    component.handleExitSheetDismiss(new CustomEvent('dismiss', { detail: { data: { action: 'setup-next' } } }));
    await fixture.whenStable();
    expect(router.navigate).toHaveBeenCalledWith(
      ['/pre-match'],
      { queryParams: { nextMatch: component.offlineSync.getActiveMatchId() } },
    );
  });

  function startMatchWithLineup(): void {
    for (let i = 1; i <= 6; i += 1) {
      teamRoster.addPlayer({ name: `Starter ${i}`, jerseyNumber: i, primaryPosition: 'OH' });
    }
    teamRoster.players().forEach((player, index) => teamRoster.assignPlayerToPosition(player.id, index + 1));
    matchEngine.startMatch('team');
  }
});
