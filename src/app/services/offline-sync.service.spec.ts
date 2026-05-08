import { OfflineSyncService } from './offline-sync.service';
import {
  FirestoreCollection,
  FirestoreDocumentMap,
  GameEvent,
  Player,
  PlayerSetStats,
  Roster,
  Team,
} from '../models/firestore.models';
import { FirebaseDbService } from './firebase-db.service';

class FakeFirebaseDbService {
  shouldSucceed = true;
  readonly failedEventIds = new Set<string>();
  readonly writes: Array<{ collection: FirestoreCollection; documentId: string; payload: FirestoreDocumentMap[FirestoreCollection] }> = [];

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
    }
    return this.writeResult();
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
    hittingEfficiency: null,
    serveAttempts: 0,
    servesIn: 0,
    serveInPercentage: null,
    blocks: 0,
    digs: 0,
    serviceErrors: 0,
    receiveErrors: 0,
    sideOutOpportunities: 0,
    sideOutConversions: 0,
    sideOutPercentage: null,
    createdAt: updatedAt,
    updatedAt,
  });

  beforeEach(() => {
    window.localStorage.clear();
    spyOnProperty(window.navigator, 'onLine', 'get').and.returnValue(true);
    firebaseDb = new FakeFirebaseDbService();
    service = new OfflineSyncService(firebaseDb as unknown as FirebaseDbService);
  });

  const waitForIdle = async (): Promise<void> => {
    for (let i = 0; i < 20; i += 1) {
      if (!service.isSyncing()) {
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
  };

  it('records last successful sync timestamp', async () => {
    service.queueMatchEvent(event('evt-1', 'm-1', 'matchStarted', '2026-02-10T10:00:00.000Z'));
    await waitForIdle();

    expect(service.pendingCount()).toBe(0);
    expect(service.lastSuccessfulSyncAt()).not.toBeNull();
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

  it('optimistically hides undone events and queues the delete marker', async () => {
    service.queueMatchEvent(event('evt-delete', service.getActiveMatchId(), 'playerAction', '2026-02-10T10:00:00.000Z'));
    await waitForIdle();

    const deleted = service.undoLastEvent('evt-delete');

    expect(deleted?.isDeleted).toBeTrue();
    expect(deleted?.deletedAt).toBeTruthy();
    expect(service.getMatchEvents(service.getActiveMatchId())).toEqual([]);
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
});
