import { Component, Input, inject } from '@angular/core';
import { RouterLink, RouterLinkActive } from '@angular/router';
import { IonHeader, IonToolbar } from '@ionic/angular/standalone';
import { AuthService } from '../../services/auth.service';
import { OfflineSyncService } from '../../services/offline-sync.service';
import { OfflineReadinessService } from '../../services/offline-readiness.service';

@Component({
  selector: 'app-equipment-rail',
  standalone: true,
  imports: [IonHeader, IonToolbar, RouterLink, RouterLinkActive],
  templateUrl: './equipment-rail.component.html',
  styleUrls: ['./equipment-rail.component.scss'],
})
export class EquipmentRailComponent {
  readonly offlineReadiness = inject(OfflineReadinessService);
  @Input({ required: true }) task = '';
  @Input() context = '';

  constructor(
    private readonly auth: AuthService,
    private readonly offlineSync: OfflineSyncService,
  ) {}

  get accountLabel(): string {
    return this.auth.email ?? 'Signed in';
  }

  get syncLabel(): string {
    if (this.deviceSaveError) return 'Device save failed';
    if (this.offlineSync.lastError?.()) return 'Sync needs retry';
    if (this.offlineSync.isSyncing?.()) return 'Syncing';
    const pending = this.offlineSync.pendingCount?.() ?? 0;
    if (pending > 0) return `${pending} pending`;
    return this.offlineSync.lastSuccessfulSyncAt?.() ? 'Synced' : 'Saved here';
  }

  get deviceSaveError(): string | null {
    return this.offlineSync.storageError?.() ?? null;
  }

  get syncNeedsAttention(): boolean {
    return !!this.offlineSync.lastError?.() || (this.offlineSync.pendingCount?.() ?? 0) > 0;
  }

  get hasSyncError(): boolean {
    return !!this.offlineSync.lastError?.();
  }

  retrySync(): void {
    this.offlineSync.retryNow?.();
  }
}
