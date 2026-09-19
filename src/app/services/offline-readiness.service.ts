import { Injectable, computed, signal } from '@angular/core';
import { environment } from '../../environments/environment';

@Injectable({ providedIn: 'root' })
export class OfflineReadinessService {
  readonly enabled = environment.production && typeof navigator !== 'undefined' && 'serviceWorker' in navigator;
  private readonly shellReadySignal = signal(false);
  private readonly rosterReadySignal = signal(false);
  private readonly storageReadySignal = signal(true);
  readonly ready = computed(() => this.shellReadySignal() && this.rosterReadySignal() && this.storageReadySignal());

  constructor() {
    if (this.enabled) {
      void this.prepareCache();
      window.addEventListener('online', () => {
        if (!this.ready()) void this.prepareCache();
      });
    }
  }

  get label(): string {
    if (this.ready()) return 'Ready offline';
    if (this.shellReadySignal() && (!this.rosterReadySignal() || !this.storageReadySignal())) return 'Offline setup incomplete';
    return typeof navigator !== 'undefined' && !navigator.onLine ? 'Offline' : 'Preparing offline…';
  }

  setRosterDataReady(ready: boolean): void {
    this.rosterReadySignal.set(ready);
  }

  setDeviceStorageReady(ready: boolean): void {
    this.storageReadySignal.set(ready);
  }

  private async prepareCache(): Promise<void> {
    try {
      await navigator.serviceWorker.ready;
      if (!navigator.serviceWorker.controller) {
        await new Promise<void>((resolve) => navigator.serviceWorker.addEventListener('controllerchange', () => resolve(), { once: true }));
      }
      if (!navigator.onLine) return;
      const response = await fetch(new URL('ngsw.json', document.baseURI));
      if (!response.ok) return;
      const manifest: { hashTable: Record<string, string> } = await response.json();
      const cached = await Promise.all(Object.keys(manifest.hashTable).map(async (path) => {
        if (!(await caches.match(path))) await fetch(path);
        return !!(await caches.match(path));
      }));
      this.shellReadySignal.set(cached.length > 0 && cached.every(Boolean));
    } catch {
      // Scoring remains available while offline startup is still being prepared.
    }
  }
}
