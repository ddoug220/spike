import { Injectable, computed, signal } from '@angular/core';
import { SupabaseDbService, SupabaseTable } from './supabase-db.service';

interface SyncQueueItem {
  id: string;
  table: SupabaseTable;
  payload: Record<string, unknown>;
  createdAt: string;
  retryCount: number;
  lastError?: string;
}

interface ArchivedSyncState {
  match_events: Record<string, unknown>[];
  match_box_scores: Record<string, unknown>[];
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
    match_events: [],
    match_box_scores: [],
  });

  readonly pendingCount = computed(() => this.queueSignal().length);
  readonly isSyncing = computed(() => this.syncingSignal());
  readonly lastError = computed(() => this.lastErrorSignal());
  readonly lastSuccessfulSyncAt = computed(() => this.lastSuccessfulSyncAtSignal());

  constructor(private readonly supabaseDb: SupabaseDbService) {
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

    const next = this.createId('match');
    window.localStorage.setItem(OfflineSyncService.MATCH_ID_KEY, next);
    return next;
  }

  startNewMatch(): string {
    const matchId = this.createId('match');
    if (typeof window !== 'undefined' && window.localStorage) {
      window.localStorage.setItem(OfflineSyncService.MATCH_ID_KEY, matchId);
    }
    return matchId;
  }

  queueMatchEvent(payload: Record<string, unknown>): void {
    this.enqueue('match_events', payload);
  }

  queueBoxScore(payload: Record<string, unknown>): void {
    this.enqueue('match_box_scores', payload);
  }

  async flushQueue(): Promise<void> {
    if (this.syncingSignal() || this.queueSignal().length === 0) {
      return;
    }
    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      return;
    }
    if (!this.supabaseDb.isConfigured()) {
      return;
    }

    this.syncingSignal.set(true);
    this.lastErrorSignal.set(null);

    try {
      let queue = this.queueSignal();
      while (queue.length > 0) {
        const current = queue[0];
        const ok = await this.pushToSupabase(current);
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
    const grouped = new Map<
      string,
      {
        events: Record<string, unknown>[];
        boxScores: Record<string, unknown>[];
      }
    >();

    this.archiveSignal().match_events.forEach((event) => {
      const matchId = this.readMatchId(event);
      if (!matchId) {
        return;
      }
      const existing = grouped.get(matchId) ?? { events: [], boxScores: [] };
      existing.events.push(event);
      grouped.set(matchId, existing);
    });

    this.archiveSignal().match_box_scores.forEach((boxScore) => {
      const matchId = this.readMatchId(boxScore);
      if (!matchId) {
        return;
      }
      const existing = grouped.get(matchId) ?? { events: [], boxScores: [] };
      existing.boxScores.push(boxScore);
      grouped.set(matchId, existing);
    });

    return Array.from(grouped.entries())
      .map(([matchId, state]) => {
        const latestBox = state.boxScores
          .slice()
          .sort((a, b) => this.readCreatedAt(b).localeCompare(this.readCreatedAt(a)))[0];
        const latestEvent = state.events
          .slice()
          .sort((a, b) => this.readCreatedAt(b).localeCompare(this.readCreatedAt(a)))[0];
        return {
          matchId,
          lastUpdatedAt: this.readCreatedAt(latestBox ?? latestEvent),
          totalEvents: state.events.length,
          isFinal: !!latestBox || state.events.some((event) => event['event_type'] === 'match_ended'),
          finalTeamSets: latestBox ? this.readNumber(latestBox['final_team_sets']) : null,
          finalOpponentSets: latestBox ? this.readNumber(latestBox['final_opponent_sets']) : null,
        };
      })
      .sort((a, b) => b.lastUpdatedAt.localeCompare(a.lastUpdatedAt));
  }

  getMatchEvents(matchId: string): Record<string, unknown>[] {
    return this.archiveSignal()
      .match_events.filter((event) => event['match_id'] === matchId)
      .slice()
      .sort((a, b) => this.readCreatedAt(a).localeCompare(this.readCreatedAt(b)));
  }

  getMatchBoxScores(matchId: string): Record<string, unknown>[] {
    return this.archiveSignal()
      .match_box_scores.filter((boxScore) => boxScore['match_id'] === matchId)
      .slice()
      .sort((a, b) => this.readCreatedAt(b).localeCompare(this.readCreatedAt(a)));
  }

  private enqueue(table: SupabaseTable, payload: Record<string, unknown>): void {
    const queueId = this.createId('sync');
    const payloadWithId = {
      id: typeof payload['id'] === 'string' ? payload['id'] : queueId,
      ...payload,
    };
    const item: SyncQueueItem = {
      id: queueId,
      table,
      payload: payloadWithId,
      createdAt: new Date().toISOString(),
      retryCount: 0,
    };
    this.queueSignal.update((items) => [...items, item]);
    this.archive(table, payloadWithId);
    this.persistQueue();
    void this.flushQueue();
  }

  private async pushToSupabase(item: SyncQueueItem): Promise<boolean> {
    const result = await this.supabaseDb.writeRow(item.table, item.payload, {
      upsert: true,
      onConflict: 'id',
    });
    if (result.ok) {
      return true;
    }

    this.lastErrorSignal.set(result.error ?? 'Network error while syncing');
    return false;
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

  private archive(table: SupabaseTable, payload: Record<string, unknown>): void {
    this.archiveSignal.update((state) => ({
      ...state,
      [table]: [...state[table], payload],
    }));
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
      if (!Array.isArray(parsed?.match_events) || !Array.isArray(parsed?.match_box_scores)) {
        return;
      }
      this.archiveSignal.set({
        match_events: parsed.match_events,
        match_box_scores: parsed.match_box_scores,
      });
    } catch {
      // Ignore corrupted archive and continue with an empty in-memory cache.
    }
  }

  private readMatchId(payload: Record<string, unknown>): string | null {
    return typeof payload['match_id'] === 'string' ? payload['match_id'] : null;
  }

  private readCreatedAt(payload: Record<string, unknown> | undefined): string {
    if (!payload) {
      return '';
    }
    return typeof payload['created_at'] === 'string' ? payload['created_at'] : '';
  }

  private readNumber(value: unknown): number | null {
    return typeof value === 'number' ? value : null;
  }

  private createId(prefix: string): string {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return `${prefix}-${crypto.randomUUID()}`;
    }
    return `${prefix}-${Date.now()}-${Math.floor(Math.random() * 100000)}`;
  }
}
