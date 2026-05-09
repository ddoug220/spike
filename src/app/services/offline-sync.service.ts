import { Injectable, computed, signal } from '@angular/core';
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

  constructor(
    private readonly firebaseDb: FirebaseDbService,
    private readonly auth: AuthService,
  ) {
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

  queueGame(payload: OwnerPayload<Game>): void {
    this.enqueue('games', this.withOwner(payload));
  }

  queueTeam(payload: OwnerPayload<Team>): void {
    this.enqueue('teams', this.withOwner(payload), false);
  }

  queuePlayer(payload: OwnerPayload<Player>): void {
    this.enqueue('players', this.withOwner(payload), false);
  }

  queueRoster(payload: OwnerPayload<Roster>): void {
    this.enqueue('roster', this.withOwner(payload), false);
  }

  logEvent(payload: OwnerPayload<GameEvent>): void {
    this.enqueue('events', {
      ...this.withOwner(payload),
      isDeleted: payload.isDeleted,
      deletedAt: payload.deletedAt ?? null,
    });
  }

  queueMatchEvent(payload: OwnerPayload<GameEvent>): void {
    this.logEvent(payload);
  }

  queuePlayerSetStats(payload: OwnerPayload<PlayerSetStats>): void {
    this.enqueue('playerSetStats', this.withOwner(payload));
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
    this.enqueue('events', this.withOwner(deletedEvent), false);
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
    this.enqueue('events', this.withOwner(deletedEvent), false);
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
      const attemptedIds = new Set<string>();
      while (true) {
        const current = this.queueSignal().find((item) => !attemptedIds.has(item.id));
        if (!current) {
          break;
        }

        attemptedIds.add(current.id);
        const ok = await this.pushToFirebase(current);
        if (!ok) {
          this.queueSignal.update((items) => {
            return items.map((item) =>
              item.id === current.id
                ? {
                    ...item,
                    retryCount: item.retryCount + 1,
                    lastError: this.lastErrorSignal() ?? 'Sync failed',
                  } as SyncQueueItem
                : item,
            );
          });
          this.persistQueue();
          continue;
        }

        this.queueSignal.update((items) => items.filter((item) => item.id !== current.id));
        this.persistQueue();
        const syncedAt = new Date().toISOString();
        this.lastSuccessfulSyncAtSignal.set(syncedAt);
        this.persistLastSuccess();
      }
    } finally {
      this.syncingSignal.set(false);
    }
  }

  retryNow(): Promise<void> {
    return this.flushQueue();
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
        return {
          matchId,
          opponentName: latestGame?.opponentName?.trim() || 'Opponent',
          startedAt: latestGame?.startedAt ?? firstEvent?.createdAt ?? '',
          lastUpdatedAt: latestGame?.updatedAt ?? latestStats?.updatedAt ?? latestEvent?.createdAt ?? '',
          totalEvents: state.events.length,
          isFinal: latestGame?.isMatchOver ?? !!finalEvent,
          teamPoints: latestGame?.teamPoints ?? finalEvent?.teamPoints ?? latestEvent?.teamPoints ?? 0,
          opponentPoints: latestGame?.opponentPoints ?? finalEvent?.opponentPoints ?? latestEvent?.opponentPoints ?? 0,
          teamSets: latestGame?.teamSets ?? finalEvent?.teamSets ?? latestEvent?.teamSets ?? 0,
          opponentSets: latestGame?.opponentSets ?? finalEvent?.opponentSets ?? latestEvent?.opponentSets ?? 0,
          finalTeamSets: latestGame?.isMatchOver ? latestGame.teamSets : finalEvent?.teamSets ?? null,
          finalOpponentSets: latestGame?.isMatchOver ? latestGame.opponentSets : finalEvent?.opponentSets ?? null,
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
    this.queueSignal.update((items) => this.upsertQueuedItem(items, item));
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

  private upsertQueuedItem(items: SyncQueueItem[], item: SyncQueueItem): SyncQueueItem[] {
    const existingIndex = items.findIndex(
      (entry) => entry.collection === item.collection && entry.payload.id === item.payload.id,
    );
    if (existingIndex < 0) {
      return [...items, item];
    }

    const next = [...items];
    next[existingIndex] = {
      ...next[existingIndex],
      payload: item.payload,
      retryCount: 0,
      lastError: undefined,
    } as SyncQueueItem;
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
      this.queueSignal.set(
        parsed.map((item) => ({
          ...item,
          payload: this.withOwner(item.payload as OwnerPayload<typeof item.payload>),
        })) as SyncQueueItem[],
      );
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

  private withOwner<T extends { ownerId: string }>(payload: OwnerPayload<T>): T {
    return {
      ...payload,
      ownerId: 'ownerId' in payload && payload.ownerId ? payload.ownerId : this.auth.uid ?? '',
    } as T;
  }
}
