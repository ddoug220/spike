import { Injectable } from '@angular/core';

@Injectable({
  providedIn: 'root',
})
export class BetaIdentityService {
  private static readonly STORAGE_KEY = 'spike-beta-owner-id-v1';

  get ownerId(): string {
    if (typeof window === 'undefined' || !window.localStorage) {
      return 'beta-owner-local';
    }

    const existing = window.localStorage.getItem(BetaIdentityService.STORAGE_KEY);
    if (existing) {
      return existing;
    }

    const ownerId = this.createOwnerId();
    window.localStorage.setItem(BetaIdentityService.STORAGE_KEY, ownerId);
    return ownerId;
  }

  private createOwnerId(): string {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return `beta-owner-${crypto.randomUUID()}`;
    }

    return `beta-owner-${Date.now()}-${Math.floor(Math.random() * 10000)}`;
  }
}
