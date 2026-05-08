import { MatchEngineService } from './match-engine.service';
import { MatchStateService } from './match-state.service';
import { MatchStatsService } from './match-stats.service';
import { OfflineSyncService } from './offline-sync.service';
import { RotationService } from './rotation.service';
import { FirebaseDbService } from './firebase-db.service';
import { TeamRosterService } from './team-roster.service';
import type { GameEvent } from '../models/firestore.models';

class FakeFirebaseDbService {
  isConfigured(): boolean {
    return false;
  }
}

describe('MatchEngineService', () => {
  let service: MatchEngineService;
  let matchState: MatchStateService;
  let matchStats: MatchStatsService;
  let teamRoster: TeamRosterService;
  let offlineSync: OfflineSyncService;

  beforeEach(() => {
    window.localStorage.clear();
    const firebaseDb = new FakeFirebaseDbService();
    offlineSync = new OfflineSyncService(firebaseDb as unknown as FirebaseDbService);
    matchState = new MatchStateService();
    matchStats = new MatchStatsService();
    teamRoster = new TeamRosterService(new RotationService());
    service = new MatchEngineService(matchState, matchStats, teamRoster, offlineSync);
  });

  it('starts a new match with a new durable match id', () => {
    const first = offlineSync.getActiveMatchId();
    const second = service.startMatch('team');

    expect(second).not.toBe(first);
    expect(offlineSync.getActiveMatchId()).toBe(second);
    expect(matchState.state().teamPoints).toBe(0);
    expect(matchState.state().opponentPoints).toBe(0);
  });

  it('persists opponent name into the active game snapshot', () => {
    const matchId = service.startMatch('team', { opponentName: 'Central High' });

    expect(offlineSync.getGame(matchId)?.opponentName).toBe('Central High');
    expect(offlineSync.getMatchSummaries()[0].opponentName).toBe('Central High');
  });

  it('attaches the saved team id to new game snapshots', () => {
    teamRoster.updateTeamName('North High');

    const matchId = service.startMatch('team');

    expect(offlineSync.getGame(matchId)?.teamId).toBe(teamRoster.team().id);
  });

  it('undoes lineup rotation when undoing a side-out scoring action', () => {
    for (let i = 1; i <= 6; i += 1) {
      teamRoster.addPlayer({ name: `P${i}`, jerseyNumber: i, primaryPosition: 'OH' });
    }
    const players = teamRoster.players();
    players.forEach((player, index) => teamRoster.assignPlayerToPosition(player.id, index + 1));

    service.setServingTeam('opponent');
    service.recordPlayerAction(1, 'kill'); // side-out, rotates clockwise
    expect(teamRoster.lineup()[0]).toBe(players[1].id);

    service.undoLastEvent();
    expect(teamRoster.lineup()[0]).toBe(players[0].id);
  });

  it('undos substitutions through the same undo stack', () => {
    for (let i = 1; i <= 7; i += 1) {
      teamRoster.addPlayer({ name: `P${i}`, jerseyNumber: i, primaryPosition: 'OH' });
    }
    const players = teamRoster.players();
    players.slice(0, 6).forEach((player, index) => teamRoster.assignPlayerToPosition(player.id, index + 1));

    const didSubstitute = service.recordSubstitution(players[0].id, players[6].id);
    expect(didSubstitute).toBeTrue();
    expect(teamRoster.lineup()[0]).toBe(players[6].id);

    service.undoLastEvent();
    expect(teamRoster.lineup()[0]).toBe(players[0].id);
  });

  it('records timeout calls and undoes them through the same undo stack', () => {
    const didCallTimeout = service.recordTimeout('team');
    expect(didCallTimeout).toBeTrue();
    expect(matchState.state().teamTimeoutsRemaining).toBe(1);

    service.undoLastEvent();
    expect(matchState.state().teamTimeoutsRemaining).toBe(2);
  });

  it('manually rotates lineup and supports undo through the same stack', () => {
    for (let i = 1; i <= 6; i += 1) {
      teamRoster.addPlayer({ name: `P${i}`, jerseyNumber: i, primaryPosition: 'OH' });
    }
    const players = teamRoster.players();
    players.forEach((player, index) => teamRoster.assignPlayerToPosition(player.id, index + 1));

    const didRotate = service.manualRotateTeam();
    expect(didRotate).toBeTrue();
    expect(matchState.state().teamRotation).toBe(2);
    expect(teamRoster.lineup()[0]).toBe(players[1].id);

    service.undoLastEvent();
    expect(matchState.state().teamRotation).toBe(1);
    expect(teamRoster.lineup()[0]).toBe(players[0].id);
  });

  it('blocks scoring events after match is ended', () => {
    service.startMatch('team');
    service.endMatch();
    const before = matchState.state();

    const event = service.recordPlayerAction(1, 'kill');
    const after = matchState.state();

    expect(event.impactedScore).toBeFalse();
    expect(event.impactedStats).toBeFalse();
    expect(after.teamPoints).toBe(before.teamPoints);
    expect(after.opponentPoints).toBe(before.opponentPoints);
  });

  it('undoes the latest synced event when the in-memory undo stack is empty', () => {
    for (let i = 1; i <= 6; i += 1) {
      teamRoster.addPlayer({ name: `P${i}`, jerseyNumber: i, primaryPosition: 'OH' });
    }
    const players = teamRoster.players();
    players.forEach((player, index) => teamRoster.assignPlayerToPosition(player.id, index + 1));
    const matchId = service.startMatch('team');

    service.recordPlayerAction(1, 'kill');
    expect(matchStats.getPlayerStats(players[0].id).kills).toBe(1);
    expect(matchState.state().teamPoints).toBe(1);

    const restoredState = new MatchStateService();
    const restoredStats = new MatchStatsService();
    const restoredEngine = new MatchEngineService(restoredState, restoredStats, teamRoster, offlineSync);
    restoredEngine.undoLastEvent(offlineSync.getMatchEvents(matchId));

    expect(offlineSync.getMatchEvents(matchId).some((event) => event.type === 'playerAction')).toBeFalse();
    expect(restoredStats.getPlayerStats(players[0].id).kills).toBe(0);
    expect(restoredState.state().teamPoints).toBe(0);
  });

  it('replays lineup state when synced fallback undo removes a side-out event', () => {
    for (let i = 1; i <= 6; i += 1) {
      teamRoster.addPlayer({ name: `P${i}`, jerseyNumber: i, primaryPosition: 'OH' });
    }
    const players = teamRoster.players();
    players.forEach((player, index) => teamRoster.assignPlayerToPosition(player.id, index + 1));
    const initialLineup = [...teamRoster.lineup()];
    const matchId = service.startMatch('team');
    service.setServingTeam('opponent');

    service.recordPlayerAction(1, 'kill');
    expect(teamRoster.lineup()[0]).toBe(players[1].id);

    const restoredEngine = new MatchEngineService(new MatchStateService(), new MatchStatsService(), teamRoster, offlineSync);
    restoredEngine.undoLastEvent(offlineSync.getMatchEvents(matchId));

    expect(teamRoster.lineup()).toEqual(initialLineup);
  });

  it('undoes a store-provided synced event when it is not already archived locally', () => {
    const matchId = offlineSync.startNewMatch();
    const syncedEvents: GameEvent[] = [
      {
        id: 'evt-start',
        ownerId: 'owner-1',
        gameId: matchId,
        type: 'matchStarted',
        action: 'match-started',
        servingTeam: 'team',
        teamPoints: 0,
        opponentPoints: 0,
        teamSets: 0,
        opponentSets: 0,
        currentSet: 1,
        isMatchOver: false,
        teamTimeoutsRemaining: 2,
        opponentTimeoutsRemaining: 2,
        teamRotation: 1,
        createdAt: '2026-02-10T10:00:00.000Z',
        isDeleted: false,
      },
      {
        id: 'evt-kill',
        ownerId: 'owner-1',
        gameId: matchId,
        type: 'playerAction',
        action: 'kill',
        playerId: 'p1',
        servingTeam: 'team',
        teamPoints: 1,
        opponentPoints: 0,
        teamSets: 0,
        opponentSets: 0,
        currentSet: 1,
        isMatchOver: false,
        teamTimeoutsRemaining: 2,
        opponentTimeoutsRemaining: 2,
        teamRotation: 1,
        wasReceiving: false,
        sideOutWon: false,
        actionSetNumber: 1,
        createdAt: '2026-02-10T10:01:00.000Z',
        isDeleted: false,
      },
    ];

    const restoredState = new MatchStateService();
    const restoredStats = new MatchStatsService();
    const restoredEngine = new MatchEngineService(restoredState, restoredStats, teamRoster, offlineSync);
    const undone = restoredEngine.undoLastEvent(syncedEvents);

    expect(undone?.eventId).toBe('evt-kill');
    expect(offlineSync.pendingCount()).toBe(2);
    expect(offlineSync.getMatchEvents(matchId)).toEqual([]);
    expect(restoredStats.getPlayerStats('p1').kills).toBe(0);
    expect(restoredState.state().teamPoints).toBe(0);
  });

  it('preserves the original start time when a resumed match queues a new game snapshot', () => {
    const matchId = service.startMatch('team');
    const startedAt = offlineSync.getGame(matchId)?.startedAt;
    expect(startedAt).toBeTruthy();

    const restoredEngine = new MatchEngineService(new MatchStateService(), new MatchStatsService(), teamRoster, offlineSync);
    restoredEngine.recordOpponentPoint();

    expect(offlineSync.getGame(matchId)?.startedAt).toBe(startedAt);
  });

  it('does not attribute opponent unforced error points to the selected team player', () => {
    for (let i = 1; i <= 6; i += 1) {
      teamRoster.addPlayer({ name: `P${i}`, jerseyNumber: i, primaryPosition: 'OH' });
    }
    const players = teamRoster.players();
    players.forEach((player, index) => teamRoster.assignPlayerToPosition(player.id, index + 1));
    service.startMatch('opponent');

    service.recordPlayerAction(3, 'opponent-error');

    const selectedPlayerStats = matchStats.getPlayerStats(players[2].id);
    expect(selectedPlayerStats.sideOutOpportunities).toBe(0);
    expect(selectedPlayerStats.sideOutConversions).toBe(0);
    expect(selectedPlayerStats.attackErrors).toBe(0);
    expect(selectedPlayerStats.totalAttacks).toBe(0);
  });
});
