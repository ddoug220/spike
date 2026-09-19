import { Injectable, Optional, computed, signal } from '@angular/core';
import {
  Game,
  GameEvent,
  Player,
  PlayerSetStats,
  Roster,
  Team,
} from '../models/firestore.models';
import { AuthService } from './auth.service';
import { FirebaseDbService } from './firebase-db.service';
import { projectionFromFirestore } from './match-v2.adapter';
import { purgeLegacyMatchCaches } from './legacy-match-cache';
import { OfflineReadinessService } from './offline-readiness.service';

type QueuedCollection = 'teams' | 'players' | 'games' | 'roster' | 'events' | 'playerSetStats';
type OwnerPayload<T extends { ownerId: string }> = Omit<T, 'ownerId'> | T;

interface QueuedDocumentMap {
  teams: Team;
  players: Player;
  games: Game;
  roster: Roster;
  events: GameEvent;
  playerSetStats: PlayerSetStats;
}

interface SyncQueueItemBase<C extends QueuedCollection> {
  id: string;
  collection: C;
  payload: QueuedDocumentMap[C];
  createdAt: string;
  retryCount: number;
  lastError?: string;
}

type SyncQueueItem =
  | SyncQueueItemBase<'teams'>
  | SyncQueueItemBase<'players'>
  | SyncQueueItemBase<'games'>
  | SyncQueueItemBase<'roster'>
  | SyncQueueItemBase<'events'>
  | SyncQueueItemBase<'playerSetStats'>;

interface ArchivedSyncState {
  games: Game[];
  events: GameEvent[];
  playerSetStats: PlayerSetStats[];
}

interface DurableMatchRecord {
  version: 1;
  activeMatchId: string | null;
  queue: SyncQueueItem[];
  archive: ArchivedSyncState;
  lastSuccessfulSyncAt: string | null;
}

interface FailedLocalCommit {
  record: DurableMatchRecord;
  actionId: string;
  actionLabel: string;
}

export type LocalCommitResult =
  | { ok: true }
  | { ok: false; actionId: string; error: string };

export interface MatchArchiveSummary {
  matchId: string;
  opponentName: string;
  startedAt: string;
  lastUpdatedAt: string;
  totalEvents: number;
  isFinal: boolean;
  teamPoints: number;
  opponentPoints: number;
  teamSets: number;
  opponentSets: number;
  finalTeamSets: number | null;
  finalOpponentSets: number | null;
}

@Injectable({
  providedIn: 'root',
})
export class OfflineSyncService {
  private static readonly DURABLE_RECORD_KEY = 'spike-durable-match-record-v1';
  private static readonly MATCH_ID_KEY = 'spike-active-match-id-v2';
  private static readonly QUEUE_KEY = 'spike-sync-queue-v2';
  private static readonly LAST_SUCCESS_KEY = 'spike-sync-last-success-v2';
  private static readonly ARCHIVE_KEY = 'spike-sync-archive-v2';
  private static readonly DEVICE_ID_KEY = 'spike-scoring-device-v2';

  private readonly queueSignal = signal<SyncQueueItem[]>([]);
  private readonly syncingSignal = signal(false);
  private readonly lastErrorSignal = signal<string | null>(null);
  private readonly storageErrorSignal = signal<string | null>(null);
  private readonly unsavedLocalWrites = new Map<string, string>();
  private failedLocalCommit: FailedLocalCommit | null = null;
  private readonly activeMatchIdSignal = signal<string | null>(null);
  private readonly lastSuccessfulSyncAtSignal = signal<string | null>(null);
  private readonly archiveSignal = signal<ArchivedSyncState>({
    games: [],
    events: [],
    playerSetStats: [],
  });
  private readonly localRevisionSignal = signal(0);

  readonly pendingCount = computed(() => this.queueSignal().length);
  readonly isSyncing = computed(() => this.syncingSignal());
  readonly storageError = this.storageErrorSignal.asReadonly();
  readonly mutationBlocked = computed(() => {
    const storageError = this.storageErrorSignal();
    return this.failedLocalCommit !== null || storageError !== null;
  });
  readonly lastError = computed(() => this.storageErrorSignal() ?? this.lastErrorSignal());
  readonly lastSuccessfulSyncAt = computed(() => this.lastSuccessfulSyncAtSignal());
  readonly localRevision = this.localRevisionSignal.asReadonly();

  constructor(
    private readonly firebaseDb: FirebaseDbService,
    private readonly auth: AuthService,
    @Optional() private readonly offlineReadiness?: OfflineReadinessService,
  ) {
    purgeLegacyMatchCaches();
    this.restoreDurableRecord();
    this.offlineReadiness?.setDeviceStorageReady(this.storageErrorSignal() === null);
    void this.flushQueue();

    if (typeof window !== 'undefined') {
      window.addEventListener('online', () => {
        void this.flushQueue();
      });
    }
  }

  getActiveMatchId(): string {
    return this.activeMatchIdSignal() ?? 'local-match';
  }

  createMatchId(): string {
    return this.createId('game');
  }

  beginMatch(
    matchId: string,
    gamePayload: OwnerPayload<Game>,
    eventPayload: OwnerPayload<GameEvent>,
  ): LocalCommitResult {
    const game = this.withOwner<Game>({
      ...gamePayload,
      id: matchId,
      schemaVersion: 2,
      writerDeviceId: gamePayload.writerDeviceId ?? this.getDeviceId(),
      writerGeneration: gamePayload.writerGeneration ?? 1,
    } as OwnerPayload<Game>);
    const event = {
      ...this.withOwner(eventPayload),
      gameId: matchId,
      schemaVersion: 2 as const,
      sequence: 1,
      writerDeviceId: eventPayload.writerDeviceId ?? game.writerDeviceId,
      writerGeneration: eventPayload.writerGeneration ?? game.writerGeneration ?? 1,
      isDeleted: eventPayload.isDeleted,
      deletedAt: eventPayload.deletedAt ?? null,
    };
    const createdAt = new Date().toISOString();
    const gameItem = {
      id: this.createId('sync'),
      collection: 'games',
      payload: game,
      createdAt,
      retryCount: 0,
    } satisfies SyncQueueItemBase<'games'>;
    const eventItem = {
      id: this.createId('sync'),
      collection: 'events',
      payload: event,
      createdAt,
      retryCount: 0,
    } satisfies SyncQueueItemBase<'events'>;
    const queue = this.upsertQueuedItem(this.upsertQueuedItem(this.queueSignal(), gameItem), eventItem);
    const archive = this.withArchivedPayload(
      this.withArchivedPayload(this.archiveSignal(), 'games', game),
      'events',
      event,
    );
    const result = this.commitDurableRecord(
      { ...this.currentDurableRecord(), activeMatchId: matchId, queue, archive },
      event.id,
      'Start Match',
    );
    if (result.ok) void this.flushQueue();
    return result;
  }

  queueGame(payload: OwnerPayload<Game>): LocalCommitResult {
    const existing = this.getGame(payload.id);
    return this.enqueue('games', this.withOwner<Game>({
      ...payload,
      schemaVersion: 2,
      writerDeviceId: payload.writerDeviceId ?? existing?.writerDeviceId ?? this.getDeviceId(),
      writerGeneration: payload.writerGeneration ?? existing?.writerGeneration ?? 1,
    } as OwnerPayload<Game>));
  }

  queueTeam(payload: OwnerPayload<Team>): LocalCommitResult {
    return this.enqueue('teams', this.withOwner(payload), false);
  }

  queuePlayer(payload: OwnerPayload<Player>): LocalCommitResult {
    return this.enqueue('players', this.withOwner(payload), false);
  }

  queueRoster(payload: OwnerPayload<Roster>): LocalCommitResult {
    return this.enqueue('roster', this.withOwner(payload), false);
  }

  logEvent(payload: OwnerPayload<GameEvent>): LocalCommitResult {
    const events = this.getMatchEvents(payload.gameId);
    const game = this.getGame(payload.gameId);
    return this.enqueue('events', {
      ...this.withOwner(payload),
      schemaVersion: 2,
      sequence: payload.sequence ?? Math.max(0, ...events.map((event) => event.sequence ?? 0)) + 1,
      writerDeviceId: payload.writerDeviceId ?? game?.writerDeviceId ?? this.getDeviceId(),
      writerGeneration: payload.writerGeneration ?? game?.writerGeneration ?? 1,
      isDeleted: payload.isDeleted,
      deletedAt: payload.deletedAt ?? null,
    });
  }

  queueMatchEvent(payload: OwnerPayload<GameEvent>): LocalCommitResult {
    return this.logEvent(payload);
  }

  queuePlayerSetStats(payload: OwnerPayload<PlayerSetStats>): LocalCommitResult {
    const game = this.getGame(payload.gameId);
    return this.enqueue('playerSetStats', this.withOwner<PlayerSetStats>({
      ...payload,
      writerDeviceId: payload.writerDeviceId ?? game?.writerDeviceId ?? this.getDeviceId(),
      writerGeneration: payload.writerGeneration ?? game?.writerGeneration ?? 1,
    }));
  }

  undoLastEvent(eventId?: string): GameEvent | null {
    return this.undoLatestEvent(this.getMatchEvents(this.getActiveMatchId()), eventId);
  }

  undoLatestEvent(events: readonly GameEvent[], eventId?: string): GameEvent | null {
    const undoneIds = new Set(events.filter((entry) => entry.type === 'undo').map((entry) => entry.targetEventId));
    const event = [...events]
      .sort((a, b) => (a.sequence ?? 0) - (b.sequence ?? 0) || a.id.localeCompare(b.id))
      .reverse()
      .find((entry) => entry.type !== 'undo' && !undoneIds.has(entry.id) && (!eventId || entry.id === eventId));

    if (!event) {
      return null;
    }

    return this.appendUndoFor(event);
  }

  private appendUndoFor(event: GameEvent): GameEvent | null {
    const result = this.logEvent({
      id: this.createId('evt'),
      gameId: event.gameId,
      type: 'undo',
      action: 'undo',
      eventKind: 'undo',
      targetEventId: event.id,
      createdAt: new Date().toISOString(),
      isDeleted: false,
    });
    return result.ok ? event : null;
  }

  async flushQueue(): Promise<void> {
    if (this.syncingSignal() || this.queueSignal().length === 0) {
      return;
    }
    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      return;
    }
    if (!this.firebaseDb.isConfigured()) {
      return;
    }

    this.syncingSignal.set(true);
    this.lastErrorSignal.set(null);

    try {
      const attemptedIds = new Set<string>();
      while (true) {
        const current = this.queueSignal().find((item) => !attemptedIds.has(item.id));
        if (!current) {
          break;
        }

        attemptedIds.add(current.id);
        const ok = await this.pushToFirebase(current);
        if (!ok) {
          const queue = this.queueSignal().map((item) =>
              item.id === current.id
                ? {
                    ...item,
                    retryCount: item.retryCount + 1,
                    lastError: this.lastErrorSignal() ?? 'Sync failed',
                  } as SyncQueueItem
                : item,
            );
          const committed = this.commitDurableRecord(
            { ...this.currentDurableRecord(), queue },
            current.payload.id,
            'Save cloud retry state',
          );
          if (!committed.ok) break;
          continue;
        }

        const syncedAt = new Date().toISOString();
        const committed = this.commitDurableRecord(
          {
            ...this.currentDurableRecord(),
            queue: this.queueSignal().filter((item) => item.id !== current.id),
            lastSuccessfulSyncAt: syncedAt,
          },
          current.payload.id,
          'Confirm cloud sync',
        );
        if (!committed.ok) break;
      }
      if (this.queueSignal().length === 0) this.lastErrorSignal.set(null);
    } finally {
      this.syncingSignal.set(false);
    }
  }

  async prepareForSignOut(): Promise<boolean> {
    await this.retryNow();
    return this.queueSignal().length === 0 && this.unsavedLocalWrites.size === 0 && !this.failedLocalCommit;
  }

  clearOwnerLocalData(): void {
    if (typeof window !== 'undefined' && window.localStorage) {
      [
        OfflineSyncService.DURABLE_RECORD_KEY,
        OfflineSyncService.MATCH_ID_KEY,
        OfflineSyncService.QUEUE_KEY,
        OfflineSyncService.LAST_SUCCESS_KEY,
        OfflineSyncService.ARCHIVE_KEY,
      ].forEach((key) => window.localStorage.removeItem(this.ownerKey(key)));
    }
    this.queueSignal.set([]);
    this.activeMatchIdSignal.set(null);
    this.archiveSignal.set({ games: [], events: [], playerSetStats: [] });
    this.lastSuccessfulSyncAtSignal.set(null);
    this.lastErrorSignal.set(null);
    this.failedLocalCommit = null;
    this.unsavedLocalWrites.clear();
    this.storageErrorSignal.set(null);
    this.offlineReadiness?.setDeviceStorageReady(true);
  }

  isCurrentScoringDevice(gameId: string): boolean {
    const game = this.getGame(gameId);
    return !game?.writerDeviceId || game.writerDeviceId === this.getDeviceId();
  }

  cacheRemoteGame(game: Game): void {
    const local = this.getGame(game.id);
    if (local && (local.writerGeneration ?? 1) === (game.writerGeneration ?? 1) && local.updatedAt > game.updatedAt) return;
    this.archive('games', game);
  }

  cacheRemoteEvents(gameId: string, events: readonly GameEvent[]): void {
    const byId = new Map(this.archiveSignal().events.map((event) => [event.id, event]));
    events.filter((event) => event.gameId === gameId).forEach((event) => byId.set(event.id, event));
    this.commitDurableRecord(
      {
        ...this.currentDurableRecord(),
        archive: { ...this.archiveSignal(), events: [...byId.values()] },
      },
      gameId,
      'Cache synced match events',
    );
  }

  subscribeRemoteGames(onData: (games: Game[]) => void): () => void {
    const ownerId = this.auth.user()?.uid;
    if (!ownerId) {
      onData([]);
      return () => undefined;
    }
    return this.firebaseDb.subscribeGames(ownerId, onData);
  }

  getWriterConflictCount(gameId: string): number {
    const game = this.getGame(gameId);
    if (!game) return 0;
    return this.queueSignal().filter((item) => {
      if (item.collection !== 'events' || item.payload.gameId !== gameId) return false;
      return (item.payload.writerGeneration ?? 1) !== (game.writerGeneration ?? 1) ||
        (!!game.writerDeviceId && item.payload.writerDeviceId !== game.writerDeviceId);
    }).length;
  }

  async takeOverScoring(gameId: string): Promise<boolean> {
    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      return false;
    }
    const latestResult = await this.firebaseDb.readDocument('games', gameId);
    const game = latestResult.ok ? latestResult.data : null;
    if (!game || game.status !== 'live') {
      this.lastErrorSignal.set(latestResult.error ?? 'Could not load the latest match before takeover.');
      return false;
    }
    if (game.writerDeviceId === this.getDeviceId()) {
      return this.commitDurableRecord(
        {
          ...this.currentDurableRecord(),
          activeMatchId: gameId,
          archive: this.withArchivedPayload(this.archiveSignal(), 'games', game),
        },
        gameId,
        'Take over scoring',
      ).ok;
    }
    const nextGame: Game = this.withOwner({
      ...game,
      writerDeviceId: this.getDeviceId(),
      writerGeneration: (game.writerGeneration ?? 1) + 1,
      updatedAt: new Date().toISOString(),
    });
    const result = await this.firebaseDb.writeDocument('games', nextGame.id, nextGame);
    if (!result.ok) {
      this.lastErrorSignal.set(result.error ?? 'Scoring takeover failed.');
      return false;
    }
    const committed = this.commitDurableRecord(
      {
        ...this.currentDurableRecord(),
        activeMatchId: gameId,
        archive: this.withArchivedPayload(this.archiveSignal(), 'games', nextGame),
        lastSuccessfulSyncAt: nextGame.updatedAt,
      },
      gameId,
      'Take over scoring',
    );
    if (!committed.ok) return false;
    this.lastErrorSignal.set(null);
    return true;
  }

  async retryNow(): Promise<LocalCommitResult> {
    for (const [key, value] of this.unsavedLocalWrites) {
      this.saveLocalData(key, value);
    }
    const localResult = this.retryFailedLocalCommit();
    if (!localResult.ok) return localResult;
    await this.flushQueue();
    return { ok: true };
  }

  saveLocalData(key: string, value: string): void {
    if (typeof window === 'undefined') return;

    try {
      window.localStorage.setItem(key, value);
      this.unsavedLocalWrites.delete(key);
      if (this.unsavedLocalWrites.size === 0 && !this.failedLocalCommit && this.storageErrorSignal() !== null) {
        this.storageErrorSignal.set(null);
        this.offlineReadiness?.setDeviceStorageReady(true);
      }
    } catch {
      this.unsavedLocalWrites.set(key, value);
      this.storageErrorSignal.set('Device save failed. Keep Spike open, free device storage or allow browser storage, then Retry Save.');
      this.offlineReadiness?.setDeviceStorageReady(false);
    }
  }

  getMatchSummaries(): MatchArchiveSummary[] {
    const grouped = new Map<string, { games: Game[]; events: GameEvent[]; stats: PlayerSetStats[] }>();

    this.archiveSignal().games.forEach((game) => {
      const existing = grouped.get(game.id) ?? { games: [], events: [], stats: [] };
      existing.games.push(game);
      grouped.set(game.id, existing);
    });

    this.archiveSignal().events.filter((event) => !event.isDeleted).forEach((event) => {
      const existing = grouped.get(event.gameId) ?? { games: [], events: [], stats: [] };
      existing.events.push(event);
      grouped.set(event.gameId, existing);
    });

    this.archiveSignal().playerSetStats.forEach((stats) => {
      const existing = grouped.get(stats.gameId) ?? { games: [], events: [], stats: [] };
      existing.stats.push(stats);
      grouped.set(stats.gameId, existing);
    });

    return Array.from(grouped.entries())
      .map(([matchId, state]) => {
        const latestGame = state.games.slice().sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0];
        const latestStats = state.stats.slice().sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0];
        const latestEvent = state.events.slice().sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
        const firstEvent = state.events.slice().sort((a, b) => a.createdAt.localeCompare(b.createdAt))[0];
        const finalEvent = state.events
          .slice()
          .reverse()
          .find((event) => event.type === 'matchEnded');
        const projection = latestGame ? projectionFromFirestore(latestGame, state.events) : null;
        const isFinal = projection
          ? projection.status === 'final' || projection.status === 'ended-early'
          : latestGame?.isMatchOver ?? !!finalEvent;
        return {
          matchId,
          opponentName: latestGame?.opponentName?.trim() || 'Opponent',
          startedAt: latestGame?.startedAt ?? firstEvent?.createdAt ?? '',
          lastUpdatedAt: latestGame?.updatedAt ?? latestStats?.updatedAt ?? latestEvent?.createdAt ?? '',
          totalEvents: state.events.length,
          isFinal,
          teamPoints: projection?.teamPoints ?? latestGame?.teamPoints ?? finalEvent?.teamPoints ?? latestEvent?.teamPoints ?? 0,
          opponentPoints: projection?.opponentPoints ?? latestGame?.opponentPoints ?? finalEvent?.opponentPoints ?? latestEvent?.opponentPoints ?? 0,
          teamSets: projection?.teamSets ?? latestGame?.teamSets ?? finalEvent?.teamSets ?? latestEvent?.teamSets ?? 0,
          opponentSets: projection?.opponentSets ?? latestGame?.opponentSets ?? finalEvent?.opponentSets ?? latestEvent?.opponentSets ?? 0,
          finalTeamSets: isFinal ? projection?.teamSets ?? latestGame?.teamSets ?? finalEvent?.teamSets ?? null : null,
          finalOpponentSets: isFinal ? projection?.opponentSets ?? latestGame?.opponentSets ?? finalEvent?.opponentSets ?? null : null,
        };
      })
      .sort((a, b) => b.lastUpdatedAt.localeCompare(a.lastUpdatedAt));
  }

  getMatchEvents(matchId: string): GameEvent[] {
    return this.archiveSignal()
      .events.filter((event) => event.gameId === matchId)
      .filter((event) => !event.isDeleted)
      .slice()
      .sort((a, b) => (a.sequence ?? 0) - (b.sequence ?? 0) || a.createdAt.localeCompare(b.createdAt));
  }

  getGame(matchId: string): Game | null {
    return (
      this.archiveSignal()
        .games.filter((game) => game.id === matchId)
        .slice()
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0] ?? null
    );
  }

  getPlayerSetStats(matchId: string): PlayerSetStats[] {
    return this.archiveSignal()
      .playerSetStats.filter((stats) => stats.gameId === matchId)
      .slice()
      .sort((a, b) => a.jerseyNumber - b.jerseyNumber);
  }

  private enqueue<C extends QueuedCollection>(
    collectionName: C,
    payload: QueuedDocumentMap[C],
    shouldArchive = true,
  ): LocalCommitResult {
    const queueId = this.createId('sync');
    const item: SyncQueueItem = {
      id: queueId,
      collection: collectionName,
      payload,
      createdAt: new Date().toISOString(),
      retryCount: 0,
    } as SyncQueueItem;
    const queue = this.upsertQueuedItem(this.queueSignal(), item);
    const archive = shouldArchive
      ? this.withArchivedPayload(this.archiveSignal(), collectionName, payload)
      : this.archiveSignal();
    const result = this.commitDurableRecord(
      { ...this.currentDurableRecord(), queue, archive },
      payload.id,
      this.actionLabel(collectionName, payload),
    );
    if (result.ok) void this.flushQueue();
    return result;
  }

  private async pushToFirebase(item: SyncQueueItem): Promise<boolean> {
    const result = await this.writeQueuedDocument(item);
    if (result.ok) {
      return true;
    }

    this.lastErrorSignal.set(result.error ?? 'Network error while syncing');
    return false;
  }

  private upsertQueuedItem(items: SyncQueueItem[], item: SyncQueueItem): SyncQueueItem[] {
    const existingIndex = items.findIndex(
      (entry) => entry.collection === item.collection && entry.payload.id === item.payload.id,
    );
    if (existingIndex < 0) {
      return [...items, item];
    }

    const next = [...items];
    next[existingIndex] = item;
    return next;
  }

  private writeQueuedDocument(item: SyncQueueItem): Promise<{ ok: boolean; error?: string }> {
    switch (item.collection) {
      case 'teams':
        return this.firebaseDb.writeDocument('teams', item.payload.id, item.payload);
      case 'players':
        return this.firebaseDb.writeDocument('players', item.payload.id, item.payload);
      case 'games':
        return this.firebaseDb.writeDocument('games', item.payload.id, item.payload);
      case 'roster':
        return this.firebaseDb.writeDocument('roster', item.payload.id, item.payload);
      case 'events':
        return this.firebaseDb.writeEvent(item.payload);
      case 'playerSetStats':
        return this.firebaseDb.writeDocument('playerSetStats', item.payload.id, item.payload);
    }
  }

  private currentDurableRecord(): DurableMatchRecord {
    return {
      version: 1,
      activeMatchId: this.activeMatchIdSignal(),
      queue: this.queueSignal(),
      archive: this.archiveSignal(),
      lastSuccessfulSyncAt: this.lastSuccessfulSyncAtSignal(),
    };
  }

  private commitDurableRecord(
    record: DurableMatchRecord,
    actionId: string,
    actionLabel: string,
  ): LocalCommitResult {
    if (this.failedLocalCommit) {
      return {
        ok: false,
        actionId: this.failedLocalCommit.actionId,
        error: this.storageErrorSignal() ?? 'A previous action still needs to be saved.',
      };
    }
    if (this.storageErrorSignal() !== null && this.unsavedLocalWrites.size === 0) {
      return {
        ok: false,
        actionId,
        error: this.storageErrorSignal() ?? 'Device storage is not ready.',
      };
    }

    if (typeof window === 'undefined' || !window.localStorage) {
      this.applyDurableRecord(record);
      return { ok: true };
    }

    try {
      const serialized = JSON.stringify(record);
      const key = this.ownerKey(OfflineSyncService.DURABLE_RECORD_KEY);
      window.localStorage.setItem(key, serialized);
      const confirmed = this.parseDurableRecord(window.localStorage.getItem(key));
      if (!confirmed) throw new Error('Stored match record could not be read back.');
      this.applyDurableRecord(confirmed);
      this.failedLocalCommit = null;
      this.storageErrorSignal.set(null);
      this.offlineReadiness?.setDeviceStorageReady(true);
      return { ok: true };
    } catch {
      const error = `${actionLabel} was not recorded. Device storage failed, so Spike kept the last saved match. Free device storage or allow browser storage, then Retry Save.`;
      this.failedLocalCommit = { record, actionId, actionLabel };
      this.storageErrorSignal.set(error);
      this.offlineReadiness?.setDeviceStorageReady(false);
      return { ok: false, actionId, error };
    }
  }

  private applyDurableRecord(record: DurableMatchRecord): void {
    this.activeMatchIdSignal.set(record.activeMatchId);
    this.queueSignal.set(record.queue);
    this.archiveSignal.set(record.archive);
    this.lastSuccessfulSyncAtSignal.set(record.lastSuccessfulSyncAt);
    this.localRevisionSignal.update((revision) => revision + 1);
  }

  private retryFailedLocalCommit(): LocalCommitResult {
    const failed = this.failedLocalCommit;
    if (!failed) return { ok: true };
    if (typeof window === 'undefined' || !window.localStorage) {
      this.applyDurableRecord(failed.record);
      this.failedLocalCommit = null;
      this.storageErrorSignal.set(null);
      this.offlineReadiness?.setDeviceStorageReady(true);
      return { ok: true };
    }

    try {
      const key = this.ownerKey(OfflineSyncService.DURABLE_RECORD_KEY);
      window.localStorage.setItem(key, JSON.stringify(failed.record));
      const confirmed = this.parseDurableRecord(window.localStorage.getItem(key));
      if (!confirmed) throw new Error('Stored match record could not be read back.');
      this.applyDurableRecord(confirmed);
      this.failedLocalCommit = null;
      if (this.unsavedLocalWrites.size === 0) this.storageErrorSignal.set(null);
      this.offlineReadiness?.setDeviceStorageReady(this.unsavedLocalWrites.size === 0);
      return { ok: true };
    } catch {
      const error = `${failed.actionLabel} was not recorded. Device storage still cannot save the match.`;
      this.storageErrorSignal.set(error);
      this.offlineReadiness?.setDeviceStorageReady(false);
      return { ok: false, actionId: failed.actionId, error };
    }
  }

  private restoreDurableRecord(): void {
    if (typeof window === 'undefined' || !window.localStorage) return;
    const key = this.ownerKey(OfflineSyncService.DURABLE_RECORD_KEY);
    const current = window.localStorage.getItem(key);
    if (current !== null) {
      const parsed = this.parseDurableRecord(current);
      if (parsed) {
        this.applyDurableRecord(parsed);
      } else {
        this.storageErrorSignal.set('Saved match data is damaged. Spike did not replace it with an empty match. Restore device data or contact support before scoring.');
        this.offlineReadiness?.setDeviceStorageReady(false);
      }
      return;
    }

    this.migrateLegacyDurableRecord();
  }

  private migrateLegacyDurableRecord(): void {
    if (typeof window === 'undefined' || !window.localStorage) return;
    const matchKey = this.ownerKey(OfflineSyncService.MATCH_ID_KEY);
    const queueKey = this.ownerKey(OfflineSyncService.QUEUE_KEY);
    const archiveKey = this.ownerKey(OfflineSyncService.ARCHIVE_KEY);
    const successKey = this.ownerKey(OfflineSyncService.LAST_SUCCESS_KEY);
    const matchId = window.localStorage.getItem(matchKey);
    const rawQueue = window.localStorage.getItem(queueKey);
    const rawArchive = window.localStorage.getItem(archiveKey);
    const lastSuccessfulSyncAt = window.localStorage.getItem(successKey);
    if (matchId === null && rawQueue === null && rawArchive === null && lastSuccessfulSyncAt === null) return;

    try {
      const queue = rawQueue === null ? [] : JSON.parse(rawQueue);
      const archive = rawArchive === null
        ? { games: [], events: [], playerSetStats: [] }
        : JSON.parse(rawArchive);
      const record = this.parseDurableRecord(JSON.stringify({
        version: 1,
        activeMatchId: matchId,
        queue,
        archive,
        lastSuccessfulSyncAt,
      }));
      if (!record) throw new Error('Legacy match record is invalid.');
      const result = this.commitDurableRecord(record, matchId ?? 'legacy-match-record', 'Migrate saved match data');
      if (!result.ok) return;
      [matchKey, queueKey, archiveKey, successKey].forEach((legacyKey) => window.localStorage.removeItem(legacyKey));
    } catch {
      this.storageErrorSignal.set('Saved match data is damaged. Spike did not replace it with an empty match. Restore device data or contact support before scoring.');
      this.offlineReadiness?.setDeviceStorageReady(false);
    }
  }

  private parseDurableRecord(raw: string | null): DurableMatchRecord | null {
    if (raw === null) return null;
    try {
      const parsed = JSON.parse(raw) as Partial<DurableMatchRecord>;
      if (
        parsed.version !== 1 ||
        (parsed.activeMatchId !== null && typeof parsed.activeMatchId !== 'string') ||
        !Array.isArray(parsed.queue) ||
        !Array.isArray(parsed.archive?.games) ||
        !Array.isArray(parsed.archive?.events) ||
        !Array.isArray(parsed.archive?.playerSetStats) ||
        (parsed.lastSuccessfulSyncAt !== null && typeof parsed.lastSuccessfulSyncAt !== 'string')
      ) return null;
      return {
        version: 1,
        activeMatchId: parsed.activeMatchId,
        queue: parsed.queue.map((item) => ({
          ...item,
          payload: this.withOwner(item.payload as OwnerPayload<typeof item.payload>),
        })) as SyncQueueItem[],
        archive: {
          games: parsed.archive.games,
          events: parsed.archive.events,
          playerSetStats: parsed.archive.playerSetStats,
        },
        lastSuccessfulSyncAt: parsed.lastSuccessfulSyncAt,
      };
    } catch {
      return null;
    }
  }

  private withArchivedPayload<C extends QueuedCollection>(
    state: ArchivedSyncState,
    collectionName: C,
    payload: QueuedDocumentMap[C],
  ): ArchivedSyncState {
    if (collectionName === 'games') {
      const game = payload as Game;
      return {
        ...state,
        games: [...state.games.filter((entry) => entry.id !== game.id), game],
      };
    }
    if (collectionName === 'events') {
      const event = payload as GameEvent;
      return {
        ...state,
        events: [...state.events.filter((entry) => entry.id !== event.id), event],
      };
    }
    if (collectionName === 'playerSetStats') {
      const stats = payload as PlayerSetStats;
      return {
        ...state,
        playerSetStats: [...state.playerSetStats.filter((entry) => entry.id !== stats.id), stats],
      };
    }
    return state;
  }

  private archive<C extends QueuedCollection>(
    collectionName: C,
    payload: QueuedDocumentMap[C],
  ): LocalCommitResult {
    return this.commitDurableRecord(
      {
        ...this.currentDurableRecord(),
        archive: this.withArchivedPayload(this.archiveSignal(), collectionName, payload),
      },
      payload.id,
      'Cache synced match data',
    );
  }

  private actionLabel<C extends QueuedCollection>(
    collectionName: C,
    payload: QueuedDocumentMap[C],
  ): string {
    if (collectionName === 'events') {
      const event = payload as GameEvent;
      return event.action === 'match-started' ? 'Start Match' : event.action.replace(/-/g, ' ');
    }
    return collectionName === 'games' ? 'Save match' : 'Save changes';
  }

  private createId(prefix: string): string {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return `${prefix}-${crypto.randomUUID()}`;
    }
    return `${prefix}-${Date.now()}-${Math.floor(Math.random() * 100000)}`;
  }

  private withOwner<T extends { ownerId: string }>(payload: OwnerPayload<T>): T {
    return {
      ...payload,
      ownerId: 'ownerId' in payload && payload.ownerId ? payload.ownerId : this.auth.uid ?? '',
    } as T;
  }

  private ownerKey(base: string): string {
    return `${base}:${this.auth.uid ?? 'signed-out'}`;
  }

  private getDeviceId(): string {
    if (typeof window === 'undefined' || !window.localStorage) {
      return 'server-device';
    }
    const key = this.ownerKey(OfflineSyncService.DEVICE_ID_KEY);
    const existing = this.unsavedLocalWrites.get(key) ?? window.localStorage.getItem(key);
    if (existing) {
      return existing;
    }
    const id = this.createId('device');
    this.saveLocalData(key, id);
    return id;
  }
}
