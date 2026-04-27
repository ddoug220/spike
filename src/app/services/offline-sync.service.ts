import { Injectable, computed, signal } from '@angular/core';
import {
  Game,
  GameEvent,
  PlayerSetStats,
} from '../models/firestore.models';
import { FirebaseDbService } from './firebase-db.service';

type QueuedCollection = 'games' | 'events' | 'playerSetStats';

interface QueuedDocumentMap {
  games: Game;
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
  | SyncQueueItemBase<'games'>
  | SyncQueueItemBase<'events'>
  | SyncQueueItemBase<'playerSetStats'>;

interface ArchivedSyncState {
  games: Game[];
  events: GameEvent[];
  playerSetStats: PlayerSetStats[];
}

export interface MatchArchiveSummary {
  matchId: string;
  lastUpdatedAt: string;
  totalEvents: number;
  isFinal: boolean;
  finalTeamSets: number | null;
  finalOpponentSets: number | null;
}

@Injectable({
  providedIn: 'root',
})
export class OfflineSyncService {
  private static readonly MATCH_ID_KEY = 'spike-active-match-id-v1';
  private static readonly QUEUE_KEY = 'spike-sync-queue-v1';
  private static readonly LAST_SUCCESS_KEY = 'spike-sync-last-success-v1';
  private static readonly ARCHIVE_KEY = 'spike-sync-archive-v1';

  private readonly queueSignal = signal<SyncQueueItem[]>([]);
  private readonly syncingSignal = signal(false);
  private readonly lastErrorSignal = signal<string | null>(null);
  private readonly lastSuccessfulSyncAtSignal = signal<string | null>(null);
  private readonly archiveSignal = signal<ArchivedSyncState>({
    games: [],
    events: [],
    playerSetStats: [],
  });

  readonly pendingCount = computed(() => this.queueSignal().length);
  readonly isSyncing = computed(() => this.syncingSignal());
  readonly lastError = computed(() => this.lastErrorSignal());
  readonly lastSuccessfulSyncAt = computed(() => this.lastSuccessfulSyncAtSignal());

  constructor(private readonly firebaseDb: FirebaseDbService) {
    this.restoreQueue();
    this.restoreLastSuccess();
    this.restoreArchive();

    if (typeof window !== 'undefined') {
      window.addEventListener('online', () => {
        void this.flushQueue();
      });
    }
  }

  getActiveMatchId(): string {
    if (typeof window === 'undefined' || !window.localStorage) {
      return 'local-match';
    }

    const existing = window.localStorage.getItem(OfflineSyncService.MATCH_ID_KEY);
    if (existing) {
      return existing;
    }

    const next = this.createId('game');
    window.localStorage.setItem(OfflineSyncService.MATCH_ID_KEY, next);
    return next;
  }

  startNewMatch(): string {
    const matchId = this.createId('game');
    if (typeof window !== 'undefined' && window.localStorage) {
      window.localStorage.setItem(OfflineSyncService.MATCH_ID_KEY, matchId);
    }
    return matchId;
  }

  queueGame(payload: Game): void {
    this.enqueue('games', payload);
  }

  logEvent(payload: GameEvent): void {
    this.enqueue('events', {
      ...payload,
      isDeleted: payload.isDeleted,
      deletedAt: payload.deletedAt ?? null,
    });
  }

  queueMatchEvent(payload: GameEvent): void {
    this.logEvent(payload);
  }

  queuePlayerSetStats(payload: PlayerSetStats): void {
    this.enqueue('playerSetStats', payload);
  }

  undoLastEvent(eventId?: string): GameEvent | null {
    const matchId = this.getActiveMatchId();
    const event = this.archiveSignal()
      .events.filter((entry) => entry.gameId === matchId && !entry.isDeleted)
      .slice()
      .reverse()
      .find((entry) => !eventId || entry.id === eventId);

    if (!event) {
      return null;
    }

    const deletedEvent: GameEvent = {
      ...event,
      isDeleted: true,
      deletedAt: new Date().toISOString(),
    };

    this.archiveSignal.update((state) => ({
      ...state,
      events: state.events.map((entry) => (entry.id === deletedEvent.id ? deletedEvent : entry)),
    }));
    this.persistArchive();
    this.enqueue('events', deletedEvent, false);
    return deletedEvent;
  }

  markEventDeleted(event: GameEvent): GameEvent {
    const deletedEvent: GameEvent = {
      ...event,
      isDeleted: true,
      deletedAt: new Date().toISOString(),
    };

    this.archiveSignal.update((state) => ({
      ...state,
      events: [
        ...state.events.filter((entry) => entry.id !== deletedEvent.id),
        deletedEvent,
      ],
    }));
    this.persistArchive();
    this.enqueue('events', deletedEvent, false);
    return deletedEvent;
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
      let queue = this.queueSignal();
      while (queue.length > 0) {
        const current = queue[0];
        const ok = await this.pushToFirebase(current);
        if (!ok) {
          this.queueSignal.update((items) => {
            const [first, ...rest] = items;
            return [
              {
                ...first,
                retryCount: first.retryCount + 1,
                lastError: this.lastErrorSignal() ?? 'Sync failed',
              },
              ...rest,
            ];
          });
          this.persistQueue();
          break;
        }

        this.queueSignal.update((items) => items.slice(1));
        this.persistQueue();
        const syncedAt = new Date().toISOString();
        this.lastSuccessfulSyncAtSignal.set(syncedAt);
        this.persistLastSuccess();
        queue = this.queueSignal();
      }
    } finally {
      this.syncingSignal.set(false);
    }
  }

  retryNow(): Promise<void> {
    return this.flushQueue();
  }

  getMatchSummaries(): MatchArchiveSummary[] {
    const grouped = new Map<string, { events: GameEvent[]; stats: PlayerSetStats[] }>();

    this.archiveSignal().events.filter((event) => !event.isDeleted).forEach((event) => {
      const existing = grouped.get(event.gameId) ?? { events: [], stats: [] };
      existing.events.push(event);
      grouped.set(event.gameId, existing);
    });

    this.archiveSignal().playerSetStats.forEach((stats) => {
      const existing = grouped.get(stats.gameId) ?? { events: [], stats: [] };
      existing.stats.push(stats);
      grouped.set(stats.gameId, existing);
    });

    return Array.from(grouped.entries())
      .map(([matchId, state]) => {
        const latestStats = state.stats.slice().sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0];
        const latestEvent = state.events.slice().sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
        const finalEvent = state.events
          .slice()
          .reverse()
          .find((event) => event.type === 'matchEnded');
        return {
          matchId,
          lastUpdatedAt: latestStats?.updatedAt ?? latestEvent?.createdAt ?? '',
          totalEvents: state.events.length,
          isFinal: !!finalEvent,
          finalTeamSets: finalEvent?.teamSets ?? null,
          finalOpponentSets: finalEvent?.opponentSets ?? null,
        };
      })
      .sort((a, b) => b.lastUpdatedAt.localeCompare(a.lastUpdatedAt));
  }

  getMatchEvents(matchId: string): GameEvent[] {
    return this.archiveSignal()
      .events.filter((event) => event.gameId === matchId)
      .filter((event) => !event.isDeleted)
      .slice()
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
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
  ): void {
    const queueId = this.createId('sync');
    const item: SyncQueueItem = {
      id: queueId,
      collection: collectionName,
      payload,
      createdAt: new Date().toISOString(),
      retryCount: 0,
    } as SyncQueueItem;
    this.queueSignal.update((items) => [...items, item]);
    if (shouldArchive) {
      this.archive(collectionName, payload);
    }
    this.persistQueue();
    void this.flushQueue();
  }

  private async pushToFirebase(item: SyncQueueItem): Promise<boolean> {
    const result = await this.writeQueuedDocument(item);
    if (result.ok) {
      return true;
    }

    this.lastErrorSignal.set(result.error ?? 'Network error while syncing');
    return false;
  }

  private writeQueuedDocument(item: SyncQueueItem): Promise<{ ok: boolean; error?: string }> {
    switch (item.collection) {
      case 'games':
        return this.firebaseDb.writeDocument('games', item.payload.id, item.payload);
      case 'events':
        return this.firebaseDb.writeEvent(item.payload);
      case 'playerSetStats':
        return this.firebaseDb.writeDocument('playerSetStats', item.payload.id, item.payload);
    }
  }

  private persistQueue(): void {
    if (typeof window === 'undefined' || !window.localStorage) {
      return;
    }
    window.localStorage.setItem(OfflineSyncService.QUEUE_KEY, JSON.stringify(this.queueSignal()));
  }

  private restoreQueue(): void {
    if (typeof window === 'undefined' || !window.localStorage) {
      return;
    }
    const raw = window.localStorage.getItem(OfflineSyncService.QUEUE_KEY);
    if (!raw) {
      return;
    }
    try {
      const parsed = JSON.parse(raw) as SyncQueueItem[];
      if (!Array.isArray(parsed)) {
        return;
      }
      this.queueSignal.set(parsed);
    } catch {
      // Ignore corrupted local queue data.
    }
  }

  private persistLastSuccess(): void {
    if (typeof window === 'undefined' || !window.localStorage) {
      return;
    }

    const value = this.lastSuccessfulSyncAtSignal();
    if (!value) {
      window.localStorage.removeItem(OfflineSyncService.LAST_SUCCESS_KEY);
      return;
    }

    window.localStorage.setItem(OfflineSyncService.LAST_SUCCESS_KEY, value);
  }

  private restoreLastSuccess(): void {
    if (typeof window === 'undefined' || !window.localStorage) {
      return;
    }

    const raw = window.localStorage.getItem(OfflineSyncService.LAST_SUCCESS_KEY);
    if (!raw) {
      return;
    }

    this.lastSuccessfulSyncAtSignal.set(raw);
  }

  private archive<C extends QueuedCollection>(collectionName: C, payload: QueuedDocumentMap[C]): void {
    if (collectionName === 'games') {
      const game = payload as Game;
      this.archiveSignal.update((state) => ({
        ...state,
        games: [...state.games.filter((entry) => entry.id !== game.id), game],
      }));
    }
    if (collectionName === 'events') {
      this.archiveSignal.update((state) => ({
        ...state,
        events: [...state.events, payload as GameEvent],
      }));
    }
    if (collectionName === 'playerSetStats') {
      this.archiveSignal.update((state) => ({
        ...state,
        playerSetStats: [...state.playerSetStats, payload as PlayerSetStats],
      }));
    }
    this.persistArchive();
  }

  private persistArchive(): void {
    if (typeof window === 'undefined' || !window.localStorage) {
      return;
    }

    window.localStorage.setItem(OfflineSyncService.ARCHIVE_KEY, JSON.stringify(this.archiveSignal()));
  }

  private restoreArchive(): void {
    if (typeof window === 'undefined' || !window.localStorage) {
      return;
    }

    const raw = window.localStorage.getItem(OfflineSyncService.ARCHIVE_KEY);
    if (!raw) {
      return;
    }

    try {
      const parsed = JSON.parse(raw) as ArchivedSyncState;
      if (!Array.isArray(parsed?.events) || !Array.isArray(parsed?.playerSetStats)) {
        return;
      }
      this.archiveSignal.set({
        games: Array.isArray(parsed.games) ? parsed.games : [],
        events: parsed.events,
        playerSetStats: parsed.playerSetStats,
      });
    } catch {
      // Ignore corrupted archive and continue with an empty in-memory cache.
    }
  }

  private createId(prefix: string): string {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return `${prefix}-${crypto.randomUUID()}`;
    }
    return `${prefix}-${Date.now()}-${Math.floor(Math.random() * 100000)}`;
  }
}
