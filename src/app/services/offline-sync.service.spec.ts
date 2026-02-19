import { OfflineSyncService } from './offline-sync.service';
import { SupabaseDbService, SupabaseTable } from './supabase-db.service';

class FakeSupabaseDbService {
  shouldSucceed = true;

  isConfigured(): boolean {
    return true;
  }

  async writeRow(
    _table: SupabaseTable,
    _payload: Record<string, unknown>,
  ): Promise<{ ok: boolean; error?: string }> {
    if (this.shouldSucceed) {
      return { ok: true };
    }
    return { ok: false, error: 'forced failure' };
  }
}

describe('OfflineSyncService', () => {
  let service: OfflineSyncService;
  let supabaseDb: FakeSupabaseDbService;

  beforeEach(() => {
    window.localStorage.clear();
    spyOnProperty(window.navigator, 'onLine', 'get').and.returnValue(true);
    supabaseDb = new FakeSupabaseDbService();
    service = new OfflineSyncService(supabaseDb as unknown as SupabaseDbService);
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
    service.queueMatchEvent({ id: 'evt-1', match_id: 'm-1' });
    await waitForIdle();

    expect(service.pendingCount()).toBe(0);
    expect(service.lastSuccessfulSyncAt()).not.toBeNull();
  });

  it('stores match archive summaries for review flows', () => {
    service.queueMatchEvent({
      id: 'evt-start',
      match_id: 'm-archive',
      event_type: 'match_started',
      created_at: '2026-02-10T10:00:00.000Z',
    });
    service.queueMatchEvent({
      id: 'evt-end',
      match_id: 'm-archive',
      event_type: 'match_ended',
      created_at: '2026-02-10T10:30:00.000Z',
    });
    service.queueBoxScore({
      id: 'box-1',
      match_id: 'm-archive',
      final_team_sets: 3,
      final_opponent_sets: 1,
      stats: [],
      created_at: '2026-02-10T10:31:00.000Z',
    });

    const summaries = service.getMatchSummaries();
    expect(summaries.length).toBe(1);
    expect(summaries[0].matchId).toBe('m-archive');
    expect(summaries[0].isFinal).toBeTrue();
    expect(summaries[0].finalTeamSets).toBe(3);
    expect(service.getMatchEvents('m-archive').length).toBe(2);
    expect(service.getMatchBoxScores('m-archive').length).toBe(1);
  });

  it('supports explicit retry after failure', async () => {
    supabaseDb.shouldSucceed = false;
    service.queueMatchEvent({ id: 'evt-2', match_id: 'm-2' });
    await waitForIdle();

    expect(service.pendingCount()).toBe(1);
    expect(service.lastError()).toBe('forced failure');

    supabaseDb.shouldSucceed = true;
    await service.retryNow();
    await waitForIdle();

    expect(service.pendingCount()).toBe(0);
    expect(service.lastError()).toBeNull();
    expect(service.lastSuccessfulSyncAt()).not.toBeNull();
  });
});
