import { environment } from '../../environments/environment';
import { SupabaseDbService } from './supabase-db.service';

describe('SupabaseDbService', () => {
  let service: SupabaseDbService;
  let originalFetch: typeof fetch | undefined;
  let originalUrl: string;
  let originalKey: string;

  beforeEach(() => {
    service = new SupabaseDbService();
    originalFetch = globalThis.fetch;
    originalUrl = environment.supabase.url;
    originalKey = environment.supabase.anonKey;
  });

  afterEach(() => {
    environment.supabase.url = originalUrl;
    environment.supabase.anonKey = originalKey;
    if (originalFetch) {
      globalThis.fetch = originalFetch;
    }
  });

  it('returns configuration status', () => {
    environment.supabase.url = '';
    environment.supabase.anonKey = '';
    expect(service.isConfigured()).toBeFalse();

    environment.supabase.url = 'https://example.supabase.co';
    environment.supabase.anonKey = 'anon-key';
    expect(service.isConfigured()).toBeTrue();
  });

  it('writes a row to supabase', async () => {
    environment.supabase.url = 'https://example.supabase.co';
    environment.supabase.anonKey = 'anon-key';

    globalThis.fetch = jasmine
      .createSpy('fetch')
      .and.resolveTo(new Response(null, { status: 201, statusText: 'Created' })) as typeof fetch;

    const result = await service.writeMatchEvent({ id: 'evt-1', match_id: 'm-1' });

    expect(result.ok).toBeTrue();
    expect(globalThis.fetch).toHaveBeenCalled();
  });

  it('reads rows from supabase', async () => {
    environment.supabase.url = 'https://example.supabase.co';
    environment.supabase.anonKey = 'anon-key';

    const body = JSON.stringify([{ id: 'evt-1', match_id: 'm-1' }]);
    globalThis.fetch = jasmine
      .createSpy('fetch')
      .and.resolveTo(new Response(body, { status: 200 })) as typeof fetch;

    const result = await service.readMatchEvents('m-1');

    expect(result.ok).toBeTrue();
    expect(result.data?.length).toBe(1);
  });
});
