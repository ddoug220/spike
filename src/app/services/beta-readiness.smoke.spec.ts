import type { AuthService } from './auth.service';
import { FirebaseDbService } from './firebase-db.service';
import { MatchEngineService } from './match-engine.service';
import { MatchStateService } from './match-state.service';
import { MatchStatsService } from './match-stats.service';
import { OfflineSyncService } from './offline-sync.service';
import { RotationService } from './rotation.service';
import { TeamRosterService } from './team-roster.service';
import type { FirestoreCollection, FirestoreDocumentMap, GameEvent } from '../models/firestore.models';

class FakeAuthService {
  readonly user = () => ({ uid: 'owner-beta-smoke' });
  readonly uid = 'owner-beta-smoke';
}

class FakeFirebaseDbService {
  readonly writes: Array<{ collection: FirestoreCollection; documentId: string; payload: FirestoreDocumentMap[FirestoreCollection] }> = [];
  readonly events: GameEvent[] = [];

  isConfigured(): boolean {
    return true;
  }

  async readTeamRosterSnapshot(): Promise<{ ok: boolean; data: { teams: []; players: []; rosters: [] } }> {
    return { ok: true, data: { teams: [], players: [], rosters: [] } };
  }

  async writeDocument<C extends FirestoreCollection>(
    collection: C,
    documentId: string,
    payload: FirestoreDocumentMap[C],
  ): Promise<{ ok: boolean; data: string }> {
    this.writes.push({ collection, documentId, payload });
    return { ok: true, data: documentId };
  }

  async writeEvent(event: GameEvent): Promise<{ ok: boolean; data: string }> {
    this.events.push(event);
    return { ok: true, data: event.id };
  }
}

describe('Beta readiness smoke flow', () => {
  let firebaseDb: FakeFirebaseDbService;
  let offlineSync: OfflineSyncService;
  let teamRoster: TeamRosterService;
  let matchEngine: MatchEngineService;

  beforeEach(() => {
    window.localStorage.clear();
    spyOnProperty(window.navigator, 'onLine', 'get').and.returnValue(true);
    const auth = new FakeAuthService() as unknown as AuthService;
    firebaseDb = new FakeFirebaseDbService();
    offlineSync = new OfflineSyncService(firebaseDb as unknown as FirebaseDbService, auth);
    teamRoster = new TeamRosterService(
      new RotationService(),
      auth,
      offlineSync,
      firebaseDb as unknown as FirebaseDbService,
    );
    matchEngine = new MatchEngineService(new MatchStateService(), new MatchStatsService(), teamRoster, offlineSync);
  });

  it('saves a complete beta match day to owned Firebase documents', async () => {
    teamRoster.updateTeamName('North High');
    for (let i = 1; i <= 7; i += 1) {
      teamRoster.addPlayer({ name: `Player ${i}`, jerseyNumber: i, primaryPosition: 'OH' });
    }
    teamRoster.players().slice(0, 6).forEach((player, index) => teamRoster.assignPlayerToPosition(player.id, index + 1));

    const matchId = matchEngine.startMatch('team', { opponentName: 'Central High' });
    matchEngine.recordPlayerAction(1, 'kill');
    matchEngine.recordSubstitution(teamRoster.players()[0].id, teamRoster.players()[6].id);
    matchEngine.undoLastEvent();
    matchEngine.endMatch();
    await waitForIdle(offlineSync);

    const collections = new Set(firebaseDb.writes.map((write) => write.collection));
    expect(collections.has('teams')).toBeTrue();
    expect(collections.has('players')).toBeTrue();
    expect(collections.has('roster')).toBeTrue();
    expect(collections.has('games')).toBeTrue();
    expect(collections.has('playerSetStats')).toBeTrue();
    expect(firebaseDb.events.some((event) => event.type === 'matchStarted')).toBeTrue();
    expect(firebaseDb.events.some((event) => event.type === 'matchEnded')).toBeTrue();
    expect(firebaseDb.writes.every((write) => write.payload.ownerId === 'owner-beta-smoke')).toBeTrue();
    expect(firebaseDb.events.every((event) => event.ownerId === 'owner-beta-smoke')).toBeTrue();
    expect(offlineSync.getGame(matchId)?.opponentName).toBe('Central High');
    expect(offlineSync.pendingCount()).toBe(0);
  });
});

const waitForIdle = async (offlineSync: OfflineSyncService): Promise<void> => {
  for (let i = 0; i < 20; i += 1) {
    if (!offlineSync.isSyncing()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
};
