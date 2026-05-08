import type { Unsubscribe } from 'firebase/firestore';
import type { FirestoreCollection, FirestoreDocumentMap, Game, GameEvent, PlayerSetStats } from '../models/firestore.models';
import { FirebaseDbService } from './firebase-db.service';
import { LiveMatchStoreService } from './live-match-store.service';
import { MatchEngineService } from './match-engine.service';
import { MatchStateService } from './match-state.service';
import { MatchStatsService } from './match-stats.service';
import type { PlayerStatLine } from './match-stats.service';
import { OfflineSyncService } from './offline-sync.service';
import { RotationService } from './rotation.service';
import { TeamRosterService } from './team-roster.service';

class FakeFirebaseDbService {
  private gameCallback: ((game: Game | null) => void) | null = null;
  private eventsCallback: ((events: GameEvent[]) => void) | null = null;
  private statsCallback: ((stats: PlayerSetStats[]) => void) | null = null;

  isConfigured(): boolean {
    return true;
  }

  async writeDocument<C extends FirestoreCollection>(
    _collection: C,
    documentId: string,
    _payload: FirestoreDocumentMap[C],
  ): Promise<{ ok: boolean; data: string }> {
    return { ok: true, data: documentId };
  }

  async writeEvent(event: GameEvent): Promise<{ ok: boolean; data: string }> {
    return { ok: true, data: event.id };
  }

  subscribeGame(_gameId: string, onData: (game: Game | null) => void): Unsubscribe {
    this.gameCallback = onData;
    return () => {
      this.gameCallback = null;
    };
  }

  subscribeEvents(_gameId: string, onData: (events: GameEvent[]) => void): Unsubscribe {
    this.eventsCallback = onData;
    return () => {
      this.eventsCallback = null;
    };
  }

  subscribePlayerSetStats(_gameId: string, onData: (stats: PlayerSetStats[]) => void): Unsubscribe {
    this.statsCallback = onData;
    return () => {
      this.statsCallback = null;
    };
  }

  emitGame(game: Game | null): void {
    this.gameCallback?.(game);
  }

  emitEvents(events: GameEvent[]): void {
    this.eventsCallback?.(events);
  }

  emitStats(stats: PlayerSetStats[]): void {
    this.statsCallback?.(stats);
  }
}

describe('LiveMatchStoreService', () => {
  let firebaseDb: FakeFirebaseDbService;
  let matchState: MatchStateService;
  let matchStats: MatchStatsService;
  let offlineSync: OfflineSyncService;
  let teamRoster: TeamRosterService;
  let store: LiveMatchStoreService;
  let engine: MatchEngineService;

  beforeEach(() => {
    window.localStorage.clear();
    firebaseDb = new FakeFirebaseDbService();
    matchState = new MatchStateService();
    matchStats = new MatchStatsService();
    offlineSync = new OfflineSyncService(firebaseDb as unknown as FirebaseDbService);
    teamRoster = new TeamRosterService(new RotationService());
    store = new LiveMatchStoreService(matchState, matchStats, offlineSync, firebaseDb as unknown as FirebaseDbService);
    engine = new MatchEngineService(matchState, matchStats, teamRoster, offlineSync);
  });

  it('hydrates command state from Firestore game snapshots before local commands run', () => {
    const gameId = offlineSync.getActiveMatchId();
    store.syncActiveGame();

    firebaseDb.emitGame(
      game(gameId, {
        teamPoints: 14,
        opponentPoints: 12,
        servingTeam: 'opponent',
        teamRotation: 4,
      }),
    );

    expect(store.gameState().teamPoints).toBe(14);
    expect(matchState.state().teamPoints).toBe(14);

    engine.recordOpponentPoint();

    expect(matchState.state().teamPoints).toBe(14);
    expect(matchState.state().opponentPoints).toBe(13);
    expect(offlineSync.getGame(gameId)?.teamPoints).toBe(14);
    expect(offlineSync.getGame(gameId)?.opponentPoints).toBe(13);
    expect(offlineSync.getGame(gameId)?.teamRotation).toBe(4);
  });

  it('uses the full synced stat line instead of mixing local stale fields', () => {
    matchStats.recordPlayerAction('p1', 'service-error', { wasReceiving: true, sideOutWon: false, currentSet: 1 });
    matchStats.recordPlayerAction('p1', 'dig', { wasReceiving: true, sideOutWon: false, currentSet: 1 });
    store.syncActiveGame();

    firebaseDb.emitStats([
      playerSetStats({
        playerId: 'p1',
        kills: 4,
        attackErrors: 1,
        totalAttacks: 8,
        aces: 2,
        serveAttempts: 5,
        servesIn: 4,
        blocks: 1,
        digs: 3,
        serviceErrors: 1,
        receiveErrors: 2,
        sideOutOpportunities: 6,
        sideOutConversions: 4,
      }),
    ]);

    const expected: PlayerStatLine = {
      kills: 4,
      attackErrors: 1,
      totalAttacks: 8,
      aces: 2,
      serveAttempts: 5,
      servesIn: 4,
      blocks: 1,
      digs: 3,
      serviceErrors: 1,
      receiveErrors: 2,
      sideOutOpportunities: 6,
      sideOutConversions: 4,
    };
    expect(store.getPlayerStats('p1')).toEqual(expected);
    expect(store.getSideOutPercentage('p1')).toBeCloseTo(2 / 3, 4);
    expect(store.getServeInPercentage('p1')).toBeCloseTo(0.8, 4);
  });
});

const game = (id: string, overrides: Partial<Game> = {}): Game => ({
  id,
  ownerId: 'owner-1',
  teamId: 'local-team',
  opponentName: 'Opponent',
  status: 'live',
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
  startedAt: '2026-02-10T10:00:00.000Z',
  endedAt: null,
  createdAt: '2026-02-10T10:00:00.000Z',
  updatedAt: '2026-02-10T10:05:00.000Z',
  ...overrides,
});

const playerSetStats = (overrides: Partial<PlayerSetStats> = {}): PlayerSetStats => ({
  id: 'stats-1',
  ownerId: 'owner-1',
  gameId: 'game-1',
  playerId: 'p1',
  playerName: 'Player One',
  jerseyNumber: 1,
  setNumber: null,
  kills: 0,
  attackErrors: 0,
  totalAttacks: 0,
  aces: 0,
  hittingEfficiency: 0.375,
  serveAttempts: 0,
  servesIn: 0,
  serveInPercentage: 0.8,
  blocks: 0,
  digs: 0,
  serviceErrors: 0,
  receiveErrors: 0,
  sideOutOpportunities: 0,
  sideOutConversions: 0,
  sideOutPercentage: 2 / 3,
  createdAt: '2026-02-10T10:00:00.000Z',
  updatedAt: '2026-02-10T10:01:00.000Z',
  ...overrides,
});
