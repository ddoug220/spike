import { Injectable, Optional } from '@angular/core';
import { SwUpdate, VersionReadyEvent } from '@angular/service-worker';
import { filter } from 'rxjs';
import { OfflineSyncService } from './offline-sync.service';

@Injectable({ providedIn: 'root' })
export class SwUpdateManagerService {
  private pendingUpdate = false;

  constructor(
    @Optional() private readonly swUpdate: SwUpdate | null,
    private readonly offlineSync: OfflineSyncService,
  ) {
    if (!this.swUpdate?.isEnabled) return;

    this.swUpdate.versionUpdates
      .pipe(filter((evt): evt is VersionReadyEvent => evt.type === 'VERSION_READY'))
      .subscribe(() => {
        this.pendingUpdate = true;
        if (!this.hasLiveMatch()) {
          this.activateUpdate();
        }
      });
  }

  hasPendingUpdate(): boolean {
    return this.pendingUpdate;
  }

  activateUpdate(): void {
    if (!this.pendingUpdate || !this.swUpdate?.isEnabled) return;
    if (this.hasLiveMatch()) return;
    
    this.pendingUpdate = false;
    void this.swUpdate.activateUpdate().then(() => {
      document.location.reload();
    });
  }

  private hasLiveMatch(): boolean {
    const activeMatchId = this.offlineSync.getActiveMatchId();
    const game = this.offlineSync.getGame(activeMatchId);
    return game?.status === 'live';
  }
}
