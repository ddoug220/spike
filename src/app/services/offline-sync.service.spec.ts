import { OfflineSyncService } from './offline-sync.service';
import {
  FirestoreCollection,
  FirestoreDocumentMap,
  Game,
  GameEvent,
  Player,
  PlayerSetStats,
  Roster,
  Team,
} from '../models/firestore.models';
import { FirebaseDbService } from './firebase-db.service';
import type { AuthService } from './auth.service';

class FakeAuthService {
  readonly user = () => ({ uid: 'owner-1' });
  readonly uid = 'owner-1';
}

class FakeFirebaseDbService {
  shouldSucceed = true;
  readonly failedEventIds = new Set<string>();
  readonly writes: Array<{ collection: FirestoreCollection; documentId: string; payload: FirestoreDocumentMap[FirestoreCollection] }> = [];
  readonly documents = new Map<string, FirestoreDocumentMap[FirestoreCollection]>();

  isConfigured(): boolean {
    return true;
  }

  async writeDocument<C extends FirestoreCollection>(
    collection: C,
    documentId: string,
    payload: FirestoreDocumentMap[C],
  ): Promise<{ ok: boolean; error?: string }> {
    if (this.shouldSucceed) {
      this.writes.push({ collection, documentId, payload });
      this.documents.set(`${collection}/${documentId}`, payload);
    }
    return this.writeResult();
  }

  async readDocument<C extends FirestoreCollection>(
    collection: C,
    documentId: string,
  ): Promise<{ ok: boolean; data: FirestoreDocumentMap[C] | null }> {
    return {
      ok: true,
      data: (this.documents.get(`${collection}/${documentId}`) as FirestoreDocumentMap[C] | undefined) ?? null,
    };
  }

  async writeEvent(payload: GameEvent): Promise<{ ok: boolean; error?: string }> {
    if (this.failedEventIds.has(payload.id)) {
      return { ok: false, error: 'forced event failure' };
    }
    return this.writeResult();
  }

  private writeResult(): { ok: boolean; error?: string } {
    if (this.shouldSucceed) {
      return { ok: true };
    }
    return { ok: false, error: 'forced failure' };
  }
}

describe('OfflineSyncService', () => {
  let service: OfflineSyncService;
  let firebaseDb: FakeFirebaseDbService;
  let online: jasmine.Spy;

  const event = (id: string, gameId: string, type: GameEvent['type'], createdAt: string): GameEvent => ({
    id,
    ownerId: 'owner-1',
    gameId,
    type,
    action: type,
    createdAt,
    isDeleted: false,
  });

  const playerStats = (id: string, gameId: string, updatedAt: string): PlayerSetStats => ({
    id,
    ownerId: 'owner-1',
    gameId,
    playerId: 'p-1',
    playerName: 'Player One',
    jerseyNumber: 1,
    setNumber: null,
    kills: 0,
    attackErrors: 0,
    totalAttacks: 0,
    aces: 0,
    serveAttempts: 0,
    servesIn: 0,
    serveInPercentage: null,
    blocks: 0,
    digs: 0,
    serviceErrors: 0,
    receiveErrors: 0,
    createdAt: updatedAt,
    updatedAt,
  });

  beforeEach(() => {
    window.localStorage.clear();
    online = spyOnProperty(window.navigator, 'onLine', 'get').and.returnValue(true);
    firebaseDb = new FakeFirebaseDbService();
    service = new OfflineSyncService(firebaseDb as unknown as FirebaseDbService, new FakeAuthService() as unknown as AuthService);
  });

  const waitForIdle = async (): Promise<void> => {
    for (let i = 0; i < 20; i += 1) {
      if (!service.isSyncing()) {
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
  };

  it('retries pending cloud saves automatically when restarted online', async () => {
    online.and.returnValue(false);
    service.queueTeam({ id: 'team-restart', ownerId: 'owner-1', name: 'North High', createdAt: '2026-09-17', updatedAt: '2026-09-17' });
    expect(service.pendingCount()).toBe(1);

    online.and.returnValue(true);
    service = new OfflineSyncService(firebaseDb as unknown as FirebaseDbService, new FakeAuthService() as unknown as AuthService);
    await waitForIdle();

    expect(service.pendingCount()).toBe(0);
    expect(firebaseDb.documents.get('teams/team-restart')).toEqual(jasmine.objectContaining({ name: 'North High' }));
  });

  it('records last successful sync timestamp', async () => {
    service.queueMatchEvent(event('evt-1', 'm-1', 'matchStarted', '2026-02-10T10:00:00.000Z'));
    await waitForIdle();

    expect(service.pendingCount()).toBe(0);
    expect(service.lastSuccessfulSyncAt()).not.toBeNull();
  });

  for (const firstWriteSucceeds of [true, false]) {
    it(`saves a newer edit made while an older save ${firstWriteSucceeds ? 'succeeds' : 'fails'}`, async () => {
      let finishFirstWrite!: () => void;
      const firstWrite = new Promise<void>((resolve) => finishFirstWrite = resolve);
      const writeDocument = firebaseDb.writeDocument.bind(firebaseDb);
      let writesStarted = 0;
      spyOn(firebaseDb, 'writeDocument').and.callFake(async (collection, id, payload) => {
        if (++writesStarted === 1) {
          await firstWrite;
          if (!firstWriteSucceeds) return { ok: false, error: 'Older save failed' };
        }
        return writeDocument(collection, id, payload);
      });
      const team: Team = {
        id: 'team-edited', ownerId: 'owner-1', name: 'Before edit',
        createdAt: '2026-09-17T10:00:00.000Z', updatedAt: '2026-09-17T10:00:00.000Z',
      };

      service.queueTeam(team);
      service.queueTeam({ ...team, name: 'After edit' });
      finishFirstWrite();
      await waitForIdle();

      expect(firebaseDb.documents.get('teams/team-edited')).toEqual(jasmine.objectContaining({ name: 'After edit' }));
      expect(service.pendingCount()).toBe(0);
      expect(service.lastError()).toBeNull();
    });
  }

  it('retains unsaved match data, blocks sign out, and saves it when device storage recovers', async () => {
    online.and.returnValue(false);
    const setItem = spyOn(Storage.prototype, 'setItem').and.throwError('QuotaExceededError');

    expect(() => service.queueMatchEvent(event('unsaved-event', 'unsaved-match', 'matchStarted', '2026-09-17T10:00:00.000Z'))).not.toThrow();
    expect(service.getMatchEvents('unsaved-match').length).toBe(1);
    expect(service.lastError()).toContain('Device save failed');
    expect(await service.prepareForSignOut()).toBeFalse();

    setItem.and.callThrough();
    await service.retryNow();
    const restored = new OfflineSyncService(firebaseDb as unknown as FirebaseDbService, new FakeAuthService() as unknown as AuthService);
    expect(restored.getMatchEvents('unsaved-match').map((entry) => entry.id)).toEqual(['unsaved-event']);
    expect(restored.pendingCount()).toBe(1);
    expect(service.lastError()).toBeNull();
  });

  it('keeps the device-save warning after cloud sync succeeds until local saving recovers', async () => {
    const setItem = spyOn(Storage.prototype, 'setItem').and.throwError('QuotaExceededError');
    service.queueTeam({
      id: 'cloud-saved-team', ownerId: 'owner-1', name: 'North High',
      createdAt: '2026-09-17T10:00:00.000Z', updatedAt: '2026-09-17T10:00:00.000Z',
    });
    await waitForIdle();

    expect(service.pendingCount()).toBe(0);
    expect(service.lastError()).toContain('Device save failed');
    expect(await service.prepareForSignOut()).toBeFalse();

    setItem.and.callThrough();
    await service.retryNow();
    expect(service.lastError()).toBeNull();
    expect(await service.prepareForSignOut()).toBeTrue();
  });

  it('pushes teams, players, and roster documents through the retry queue', async () => {
    const createdAt = '2026-02-10T10:00:00.000Z';
    const team: Team = {
      id: 'team-1',
      ownerId: 'owner-1',
      name: 'North High',
      createdAt,
      updatedAt: createdAt,
    };
    const player: Player = {
      id: 'player-1',
      ownerId: 'owner-1',
      teamId: team.id,
      name: 'Ava Johnson',
      jerseyNumber: 4,
      primaryPosition: 'OH',
      active: true,
      createdAt,
      updatedAt: createdAt,
    };
    const roster: Roster = {
      id: 'team-1-active-roster',
      ownerId: 'owner-1',
      teamId: team.id,
      gameId: null,
      lineup: [player.id, null, null, null, null, null],
      createdAt,
      updatedAt: createdAt,
    };

    service.queueTeam(team);
    service.queuePlayer(player);
    service.queueRoster(roster);
    await waitForIdle();

    expect(firebaseDb.writes.map((write) => write.collection)).toEqual(['teams', 'players', 'roster']);
    expect(firebaseDb.writes[0].payload).toEqual(team);
    expect(firebaseDb.writes[1].payload).toEqual(player);
    expect(firebaseDb.writes[2].payload).toEqual(roster);
    expect(service.pendingCount()).toBe(0);
  });

  it('does not let one failed match write block team, player, and roster saves', async () => {
    const createdAt = '2026-02-10T10:00:00.000Z';
    const team: Team = {
      id: 'team-1',
      ownerId: 'owner-1',
      name: 'North High',
      createdAt,
      updatedAt: createdAt,
    };
    const player: Player = {
      id: 'player-1',
      ownerId: 'owner-1',
      teamId: team.id,
      name: 'Ava Johnson',
      jerseyNumber: 4,
      primaryPosition: 'OH',
      active: true,
      createdAt,
      updatedAt: createdAt,
    };
    const roster: Roster = {
      id: 'team-1-active-roster',
      ownerId: 'owner-1',
      teamId: team.id,
      gameId: null,
      lineup: [player.id, null, null, null, null, null],
      createdAt,
      updatedAt: createdAt,
    };

    firebaseDb.failedEventIds.add('evt-stale');
    service.queueMatchEvent(event('evt-stale', 'm-stale', 'matchStarted', createdAt));
    service.queueTeam(team);
    service.queuePlayer(player);
    service.queueRoster(roster);
    await waitForIdle();

    expect(firebaseDb.writes.map((write) => write.collection)).toEqual(['teams', 'players', 'roster']);
    expect(service.pendingCount()).toBe(1);
    expect(service.lastError()).toBe('forced event failure');
  });

  it('stores match archive summaries for review flows', () => {
    service.queueMatchEvent(event('evt-start', 'm-archive', 'matchStarted', '2026-02-10T10:00:00.000Z'));
    service.queueMatchEvent({
      id: 'evt-end',
      gameId: 'm-archive',
      type: 'matchEnded',
      action: 'match-ended',
      teamSets: 3,
      opponentSets: 1,
      createdAt: '2026-02-10T10:30:00.000Z',
      isDeleted: false,
    });
    service.queuePlayerSetStats(playerStats('stats-1', 'm-archive', '2026-02-10T10:31:00.000Z'));

    const summaries = service.getMatchSummaries();
    expect(summaries.length).toBe(1);
    expect(summaries[0].matchId).toBe('m-archive');
    expect(summaries[0].isFinal).toBeTrue();
    expect(summaries[0].finalTeamSets).toBe(3);
    expect(service.getMatchEvents('m-archive').length).toBe(2);
    expect(service.getPlayerSetStats('m-archive').length).toBe(1);
  });

  it('appends an undo event without changing the original event', async () => {
    service.queueMatchEvent(event('evt-delete', service.getActiveMatchId(), 'playerAction', '2026-02-10T10:00:00.000Z'));
    await waitForIdle();

    const undone = service.undoLastEvent('evt-delete');
    const events = service.getMatchEvents(service.getActiveMatchId());

    expect(undone?.id).toBe('evt-delete');
    expect(events[0].isDeleted).toBeFalse();
    expect(events[1]).toEqual(jasmine.objectContaining({ type: 'undo', targetEventId: 'evt-delete', isDeleted: false }));
  });

  it('supports explicit retry after failure', async () => {
    firebaseDb.shouldSucceed = false;
    service.queueMatchEvent(event('evt-2', 'm-2', 'matchStarted', '2026-02-10T10:00:00.000Z'));
    await waitForIdle();

    expect(service.pendingCount()).toBe(1);
    expect(service.lastError()).toBe('forced failure');

    firebaseDb.shouldSucceed = true;
    await service.retryNow();
    await waitForIdle();

    expect(service.pendingCount()).toBe(0);
    expect(service.lastError()).toBeNull();
    expect(service.lastSuccessfulSyncAt()).not.toBeNull();
  });

  it('takes over a live match with a server-confirmed writer generation', async () => {
    const now = '2026-02-10T10:00:00.000Z';
    const game: Game = {
      id: 'm-live', ownerId: 'owner-1', teamId: 'team-1', opponentName: 'Central High', status: 'live',
      servingTeam: 'team', teamPoints: 4, opponentPoints: 3, teamSets: 0, opponentSets: 0, currentSet: 1,
      isMatchOver: false, teamTimeoutsRemaining: 2, opponentTimeoutsRemaining: 2, teamRotation: 1,
      startedAt: now, endedAt: null, createdAt: now, updatedAt: now,
      writerDeviceId: 'other-device', writerGeneration: 3,
    };
    service.queueGame(game);
    await waitForIdle();
    firebaseDb.documents.set(`games/${game.id}`, { ...game, writerGeneration: 5 });
    service.cacheRemoteEvents(game.id, [
      { ...event('remote-event', game.id, 'matchStarted', now), sequence: 30, writerGeneration: 5, writerDeviceId: 'other-device' },
    ]);

    expect(service.isCurrentScoringDevice(game.id)).toBeFalse();
    expect(await service.takeOverScoring(game.id)).toBeTrue();
    expect(service.getGame(game.id)?.writerGeneration).toBe(6);
    expect(service.getGame(game.id)?.writerDeviceId).not.toBe('other-device');
    expect(service.isCurrentScoringDevice(game.id)).toBeTrue();
    expect(service.getActiveMatchId()).toBe(game.id);

    service.queueMatchEvent(event('new-writer-event', game.id, 'opponentPoint', now));
    const nextEvent = service.getMatchEvents(game.id).find((entry) => entry.id === 'new-writer-event');
    expect(nextEvent?.sequence).toBe(31);
    expect(nextEvent?.writerGeneration).toBe(6);
  });

  it('quarantines pending events from an older writer generation as conflicts', async () => {
    const now = '2026-02-10T10:00:00.000Z';
    const game: Game = {
      id: 'm-conflict', ownerId: 'owner-1', teamId: 'team-1', opponentName: 'Central High', status: 'live',
      servingTeam: 'team', teamPoints: 0, opponentPoints: 0, teamSets: 0, opponentSets: 0, currentSet: 1,
      isMatchOver: false, teamTimeoutsRemaining: 2, opponentTimeoutsRemaining: 2, teamRotation: 1,
      startedAt: now, endedAt: null, createdAt: now, updatedAt: now,
      writerGeneration: 1,
    };
    service.queueGame(game);
    await waitForIdle();
    firebaseDb.failedEventIds.add('stale-event');
    service.queueMatchEvent({ ...event('stale-event', game.id, 'opponentPoint', now), writerGeneration: 1 });
    await waitForIdle();

    service.cacheRemoteGame({ ...game, writerDeviceId: 'replacement-device', writerGeneration: 2 });

    expect(service.getWriterConflictCount(game.id)).toBe(1);
    expect(service.pendingCount()).toBe(1);
  });

  it('keeps the current writer when Firestore rejects takeover', async () => {
    const now = '2026-02-10T10:00:00.000Z';
    service.queueGame({
      id: 'm-rejected', ownerId: 'owner-1', teamId: 'team-1', opponentName: 'Central High', status: 'live',
      servingTeam: 'team', teamPoints: 0, opponentPoints: 0, teamSets: 0, opponentSets: 0, currentSet: 1,
      isMatchOver: false, teamTimeoutsRemaining: 2, opponentTimeoutsRemaining: 2, teamRotation: 1,
      startedAt: now, endedAt: null, createdAt: now, updatedAt: now,
      writerDeviceId: 'other-device', writerGeneration: 2,
    });
    await waitForIdle();
    firebaseDb.shouldSucceed = false;

    expect(await service.takeOverScoring('m-rejected')).toBeFalse();
    expect(service.getGame('m-rejected')?.writerDeviceId).toBe('other-device');
    expect(service.isCurrentScoringDevice('m-rejected')).toBeFalse();
  });
});
