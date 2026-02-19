import { Injectable } from '@angular/core';
import { environment } from '../../environments/environment';

export type SupabaseTable = 'match_events' | 'match_box_scores';

export interface SupabaseResult<T> {
  ok: boolean;
  status?: number;
  data?: T;
  error?: string;
}

interface WriteOptions {
  upsert?: boolean;
  onConflict?: string;
}

@Injectable({
  providedIn: 'root',
})
export class SupabaseDbService {
  isConfigured(): boolean {
    return !!environment.supabase.url && !!environment.supabase.anonKey;
  }

  async writeRow(
    table: SupabaseTable,
    payload: Record<string, unknown>,
    options?: WriteOptions,
  ): Promise<SupabaseResult<null>> {
    const params = new URLSearchParams();
    if (options?.onConflict) {
      params.set('on_conflict', options.onConflict);
    }
    const path = params.toString() ? `/${table}?${params.toString()}` : `/${table}`;

    const preferParts = ['return=minimal'];
    if (options?.upsert) {
      preferParts.unshift('resolution=merge-duplicates');
    }

    return this.request<null>(path, {
      method: 'POST',
      body: JSON.stringify(payload),
      headers: {
        Prefer: preferParts.join(','),
      },
    });
  }

  async readRows(
    table: SupabaseTable,
    query: Record<string, string>,
  ): Promise<SupabaseResult<Record<string, unknown>[]>> {
    const params = new URLSearchParams(query);
    return this.request<Record<string, unknown>[]>(`/${table}?${params.toString()}`, {
      method: 'GET',
    });
  }

  async writeMatchEvent(payload: Record<string, unknown>): Promise<SupabaseResult<null>> {
    return this.writeRow('match_events', payload);
  }

  async writeMatchBoxScore(payload: Record<string, unknown>): Promise<SupabaseResult<null>> {
    return this.writeRow('match_box_scores', payload);
  }

  async readMatchEvents(matchId: string): Promise<SupabaseResult<Record<string, unknown>[]>> {
    return this.readRows('match_events', {
      match_id: `eq.${matchId}`,
      order: 'created_at.asc',
      select: '*',
    });
  }

  async readMatchBoxScores(matchId: string): Promise<SupabaseResult<Record<string, unknown>[]>> {
    return this.readRows('match_box_scores', {
      match_id: `eq.${matchId}`,
      order: 'created_at.desc',
      select: '*',
    });
  }

  private async request<T>(path: string, init: RequestInit): Promise<SupabaseResult<T>> {
    if (!this.isConfigured()) {
      return {
        ok: false,
        error: 'Supabase environment values are not configured.',
      };
    }

    try {
      const response = await fetch(`${environment.supabase.url}/rest/v1${path}`, {
        ...init,
        headers: {
          apikey: environment.supabase.anonKey,
          Authorization: `Bearer ${environment.supabase.anonKey}`,
          'Content-Type': 'application/json',
          ...(init.headers ?? {}),
        },
      });

      if (!response.ok) {
        return {
          ok: false,
          status: response.status,
          error: `Supabase request failed (${response.status})`,
        };
      }

      const isGet = (init.method ?? 'GET').toUpperCase() === 'GET';
      if (!isGet) {
        return { ok: true, status: response.status, data: null as T };
      }

      const data = (await response.json()) as T;
      return { ok: true, status: response.status, data };
    } catch {
      return {
        ok: false,
        error: 'Network error while calling Supabase.',
      };
    }
  }
}
