import { MatchEngineService } from './match-engine.service';
import { MatchStateService } from './match-state.service';
import { MatchStatsService } from './match-stats.service';
import { OfflineSyncService } from './offline-sync.service';
import { RotationService } from './rotation.service';
import { FirebaseDbService } from './firebase-db.service';
import { TeamRosterService } from './team-roster.service';
import type { AuthService } from './auth.service';
import type { GameEvent } from '../models/firestore.models';
import { projectionFromFirestore } from './match-v2.adapter';

class FakeFirebaseDbService {
  isConfigured(): boolean {
    return false;
  }
}

class FakeAuthService {
  readonly user = () => ({ uid: 'owner-1' });
  readonly uid = 'owner-1';
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
    const auth = new FakeAuthService() as unknown as AuthService;
    offlineSync = new OfflineSyncService(firebaseDb as unknown as FirebaseDbService, auth);
    matchState = new MatchStateService();
    matchStats = new MatchStatsService();
    teamRoster = new TeamRosterService(new RotationService(), auth);
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

  it('stops undo at match start and walks backward through consecutive actions', () => {
    startWithLineup();
    const matchId = offlineSync.getActiveMatchId();
    expect(service.canUndoLastEvent()).toBeFalse();
    expect(service.undoLastEvent()).toBeNull();

    service.recordPlayerAction(1, 'kill');
    service.recordOpponentPoint();
    expect(service.canUndoLastEvent()).toBeTrue();

    expect(service.undoLastEvent()?.kind).toBe('opponent-point');
    expect(matchState.state().teamPoints).toBe(1);
    expect(matchState.state().opponentPoints).toBe(0);
    expect(service.canUndoLastEvent()).toBeTrue();

    expect(service.undoLastEvent()?.kind).toBe('player-action');
    expect(matchState.state().teamPoints).toBe(0);
    expect(service.canUndoLastEvent()).toBeFalse();
    expect(offlineSync.getMatchEvents(matchId).filter((event) => event.type === 'undo').length).toBe(2);
  });

  it('treats an ended-early match as terminal for canUndo and undo', () => {
    startWithLineup();
    service.recordPlayerAction(1, 'kill');
    service.endMatchEarly();

    expect(service.canUndoLastEvent()).toBeFalse();
    expect(service.undoLastEvent()).toBeNull();
    expect(matchState.state().isMatchOver).toBeTrue();
  });

  it('allows the final rally to be undone and reopens the match', () => {
    startWithLineup();
    for (let set = 1; set <= 3; set += 1) {
      for (let point = 0; point < 25; point += 1) service.recordPlayerAction(1, 'kill');
      if (set < 3) service.startNextSet(service.getNextSetDefaultLineup(), 'team');
    }

    expect(matchState.state().isMatchOver).toBeTrue();
    expect(service.canUndoLastEvent()).toBeTrue();
    service.undoLastEvent();
    expect(matchState.state().isMatchOver).toBeFalse();
    expect(matchState.state().teamPoints).toBe(24);
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

  it('preserves the match squad and starting lineup after reusable roster and defaults change', () => {
    for (let i = 1; i <= 8; i += 1) {
      teamRoster.addPlayer({ name: `Original ${i}`, jerseyNumber: i, primaryPosition: 'OH' });
    }
    const players = teamRoster.players();
    players.slice(0, 6).forEach((player, index) => teamRoster.assignPlayerToPosition(player.id, index + 1));
    const matchId = service.startMatch('team');
    const originalGame = offlineSync.getGame(matchId)!;

    teamRoster.updatePlayer(players[0].id, { name: 'Renamed later', jerseyNumber: 99, primaryPosition: 'S' });
    teamRoster.removePlayer(players[6].id);
    teamRoster.setMatchSquadPlayer(players[7].id, false);
    teamRoster.unassignPosition(1);
    service.recordOpponentPoint();

    const updatedGame = offlineSync.getGame(matchId)!;
    expect(updatedGame.matchSquad).toEqual(originalGame.matchSquad);
    expect(updatedGame.startingLineup).toEqual(originalGame.startingLineup);
  });

  it('uses snapshot identity for actions after a reusable roster player is renamed and removed', () => {
    startWithLineup();
    const matchId = offlineSync.getActiveMatchId();
    const snapshotPlayer = offlineSync.getGame(matchId)!.matchSquad![0];

    teamRoster.updatePlayer(snapshotPlayer.id, { name: 'Changed name', jerseyNumber: 77, primaryPosition: 'S' });
    teamRoster.removePlayer(snapshotPlayer.id);
    service.recordPlayerAction(1, 'kill');

    expect(offlineSync.getMatchEvents(matchId)).toContain(
      jasmine.objectContaining({ type: 'playerAction', playerId: snapshotPlayer.id, action: 'kill' }),
    );
    expect(offlineSync.getGame(matchId)?.matchSquad?.[0]).toEqual(snapshotPlayer);
  });

  it('rejects substitutions and next-set lineups containing players outside the saved match squad', () => {
    for (let i = 1; i <= 8; i += 1) {
      teamRoster.addPlayer({ name: `Player ${i}`, jerseyNumber: i, primaryPosition: 'OH' });
    }
    const players = teamRoster.players();
    players.slice(0, 6).forEach((player, index) => teamRoster.assignPlayerToPosition(player.id, index + 1));
    players.slice(0, 7).forEach((player) => teamRoster.setMatchSquadPlayer(player.id, true));
    teamRoster.setMatchSquadPlayer(players[7].id, false);
    const matchId = service.startMatch('team');

    expect(service.recordSubstitution(players[0].id, players[7].id)).toBeFalse();
    expect(offlineSync.getMatchEvents(matchId).some((event) => event.type === 'substitution')).toBeFalse();

    for (let point = 0; point < 25; point += 1) {
      service.recordPlayerAction(1, 'kill');
    }
    expect(matchState.state().isSetBreak).toBeTrue();
    expect(service.startNextSet([players[7].id, ...players.slice(1, 6).map((player) => player.id)], 'team')).toBeFalse();
    expect(offlineSync.getMatchEvents(matchId).some((event) => event.type === 'setStarted')).toBeFalse();
  });

  it('undoes lineup rotation when undoing a side-out scoring action', () => {
    for (let i = 1; i <= 6; i += 1) {
      teamRoster.addPlayer({ name: `P${i}`, jerseyNumber: i, primaryPosition: 'OH' });
    }
    const players = teamRoster.players();
    players.forEach((player, index) => teamRoster.assignPlayerToPosition(player.id, index + 1));

    service.startMatch('team');
    service.setServingTeam('opponent');
    service.recordPlayerAction(1, 'kill'); // side-out, rotates clockwise
    expect(projectedLineup()[0]).toBe(players[1].id);
    expect(teamRoster.lineup()[0]).toBe(players[0].id);

    service.undoLastEvent();
    expect(projectedLineup()[0]).toBe(players[0].id);
  });

  it('undos substitutions through the same undo stack', () => {
    for (let i = 1; i <= 7; i += 1) {
      teamRoster.addPlayer({ name: `P${i}`, jerseyNumber: i, primaryPosition: 'OH' });
    }
    const players = teamRoster.players();
    players.slice(0, 6).forEach((player, index) => teamRoster.assignPlayerToPosition(player.id, index + 1));
    service.startMatch('team');

    const didSubstitute = service.recordSubstitution(players[0].id, players[6].id);
    expect(didSubstitute).toBeTrue();
    expect(projectedLineup()[0]).toBe(players[6].id);
    expect(teamRoster.lineup()[0]).toBe(players[0].id);

    service.undoLastEvent();
    expect(projectedLineup()[0]).toBe(players[0].id);
  });

  it('records timeout calls and undoes them through the same undo stack', () => {
    startWithLineup();
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
    service.startMatch('team');

    const didRotate = service.manualRotateTeam();
    expect(didRotate).toBeTrue();
    expect(matchState.state().teamRotation).toBe(2);
    expect(projectedLineup()[0]).toBe(players[1].id);
    expect(teamRoster.lineup()[0]).toBe(players[0].id);

    service.undoLastEvent();
    expect(matchState.state().teamRotation).toBe(1);
    expect(projectedLineup()[0]).toBe(players[0].id);
  });

  it('blocks scoring events after match is ended', () => {
    startWithLineup();
    service.endMatchEarly();
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

    const storedEvents = offlineSync.getMatchEvents(matchId);
    const playerActionId = storedEvents.find((event) => event.type === 'playerAction')?.id;
    expect(storedEvents.some((event) => event.type === 'playerAction')).toBeTrue();
    expect(storedEvents.some((event) => event.type === 'undo' && event.targetEventId === playerActionId)).toBeTrue();
    expect(restoredStats.getPlayerStats(players[0].id).kills).toBe(0);
    expect(restoredState.state().teamPoints).toBe(0);

    const secondRestore = new MatchEngineService(new MatchStateService(), new MatchStatsService(), teamRoster, offlineSync);
    expect(secondRestore.undoLastEvent(offlineSync.getMatchEvents(matchId))).toBeNull();
    expect(offlineSync.getMatchEvents(matchId).filter((event) => event.type === 'undo').length).toBe(1);
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
    expect(projectedLineup()[0]).toBe(players[1].id);

    const restoredEngine = new MatchEngineService(new MatchStateService(), new MatchStatsService(), teamRoster, offlineSync);
    restoredEngine.undoLastEvent(offlineSync.getMatchEvents(matchId));

    expect(teamRoster.lineup()).toEqual(initialLineup);
    expect([...projectedLineup()]).toEqual(initialLineup.map((playerId) => playerId as string));
  });

  it('undoes the latest applied domain event when later synced records are ignored', () => {
    startWithLineup();
    const matchId = offlineSync.getActiveMatchId();
    const startEvent = offlineSync.getMatchEvents(matchId).find((event) => event.type === 'matchStarted')!;
    const playerId = teamRoster.lineup()[0]!;
    const syncedEvents: GameEvent[] = [
      startEvent,
      {
        id: 'evt-kill',
        ownerId: 'owner-1',
        gameId: matchId,
        type: 'playerAction',
        action: 'kill',
        playerId,
        eventKind: 'rally-outcome',
        schemaVersion: 2,
        sequence: 2,
        writerGeneration: 1,
        setNumber: 1,
        rallyId: 'rally-1',
        servingTeamBefore: 'team',
        teamRotationBefore: 1,
        createdAt: '2026-02-10T10:01:00.000Z',
        isDeleted: false,
      },
      {
        id: 'evt-end', ownerId: 'owner-1', gameId: matchId, type: 'matchEnded', action: 'match-ended',
        schemaVersion: 2, sequence: 3, writerGeneration: 1, setNumber: 1,
        createdAt: '2026-02-10T10:02:00.000Z', isDeleted: false,
      },
      {
        id: 'evt-malformed', ownerId: 'owner-1', gameId: matchId, type: 'playerAction', action: 'kill',
        eventKind: 'rally-outcome', schemaVersion: 2, sequence: 4, writerGeneration: 1, setNumber: 1,
        createdAt: '2026-02-10T10:03:00.000Z', isDeleted: false,
      },
    ];

    const restoredState = new MatchStateService();
    const restoredStats = new MatchStatsService();
    const restoredEngine = new MatchEngineService(restoredState, restoredStats, teamRoster, offlineSync);
    const undone = restoredEngine.undoLastEvent(syncedEvents);

    expect(undone?.eventId).toBe('evt-kill');
    expect(offlineSync.getMatchEvents(matchId)).toContain(
      jasmine.objectContaining({ type: 'undo', targetEventId: 'evt-kill' }),
    );
    expect(restoredStats.getPlayerStats(playerId).kills).toBe(0);
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
    expect(selectedPlayerStats.attackErrors).toBe(0);
    expect(selectedPlayerStats.totalAttacks).toBe(0);
  });

  it('rebuilds one rally and its Undo from persisted ordered events after refresh', () => {
    for (let i = 1; i <= 6; i += 1) {
      teamRoster.addPlayer({ name: `P${i}`, jerseyNumber: i, primaryPosition: 'OH' });
    }
    const players = teamRoster.players();
    players.forEach((player, index) => teamRoster.assignPlayerToPosition(player.id, index + 1));
    const matchId = service.startMatch('team');

    service.recordPlayerAction(4, 'dig');
    const refreshedSync = new OfflineSyncService(
      new FakeFirebaseDbService() as unknown as FirebaseDbService,
      new FakeAuthService() as unknown as AuthService,
    );
    const refreshedState = new MatchStateService();
    const refreshedStats = new MatchStatsService();
    const refreshedEngine = new MatchEngineService(refreshedState, refreshedStats, teamRoster, refreshedSync);
    refreshedEngine.recordPlayerAction(3, 'kill');

    const events = refreshedSync.getMatchEvents(matchId);
    const dig = events.find((event) => event.action === 'dig')!;
    const outcome = events.find((event) => event.action === 'kill')!;
    const afterRally = projectionFromFirestore(refreshedSync.getGame(matchId)!, events)!;
    expect(outcome).toEqual(jasmine.objectContaining({
      schemaVersion: 2,
      sequence: 3,
      ownerId: 'owner-1',
      writerGeneration: 1,
      setNumber: 1,
      rallyId: dig.rallyId,
      courtPosition: 3,
      servingTeamBefore: 'team',
      teamRotationBefore: 1,
    }));
    expect(outcome.rotationPosition).toBeUndefined();
    expect(afterRally.teamPoints).toBe(1);
    expect(afterRally.servingTeam).toBe('team');
    expect([...(afterRally.lineup ?? [])]).toEqual(players.map((player) => player.id));
    expect(afterRally.observations.length).toBe(1);
    expect(afterRally.rallies.length).toBe(1);
    expect(refreshedStats.getPlayerStats(players[3].id).digs).toBe(1);
    expect(refreshedStats.getPlayerStats(players[0].id).serveAttempts).toBe(1);

    const secondRefreshSync = new OfflineSyncService(
      new FakeFirebaseDbService() as unknown as FirebaseDbService,
      new FakeAuthService() as unknown as AuthService,
    );
    const secondRefreshState = new MatchStateService();
    const secondRefreshStats = new MatchStatsService();
    const secondRefreshEngine = new MatchEngineService(
      secondRefreshState,
      secondRefreshStats,
      teamRoster,
      secondRefreshSync,
    );
    secondRefreshEngine.undoLastEvent(secondRefreshSync.getMatchEvents(matchId));

    const replayed = projectionFromFirestore(
      secondRefreshSync.getGame(matchId)!,
      secondRefreshSync.getMatchEvents(matchId),
    )!;
    expect(replayed.teamPoints).toBe(0);
    expect(replayed.observations.length).toBe(1);
    expect(replayed.rallies.length).toBe(0);
    expect(secondRefreshStats.getPlayerStats(players[3].id).digs).toBe(1);
    expect(secondRefreshStats.getPlayerStats(players[0].id).serveAttempts).toBe(0);
  });

  function projectedLineup(): readonly string[] {
    const matchId = offlineSync.getActiveMatchId();
    const game = offlineSync.getGame(matchId);
    if (!game) return [];
    return projectionFromFirestore(game, offlineSync.getMatchEvents(matchId))?.lineup ?? [];
  }

  function startWithLineup(): void {
    for (let i = 1; i <= 6; i += 1) {
      teamRoster.addPlayer({ name: `Starter ${i}`, jerseyNumber: i, primaryPosition: 'OH' });
    }
    teamRoster.players().forEach((player, index) => teamRoster.assignPlayerToPosition(player.id, index + 1));
    service.startMatch('team');
  }
});
