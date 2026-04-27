import { NgClass, NgIf } from '@angular/common';
import { Component } from '@angular/core';
import { RouterLink } from '@angular/router';
import { IonButton, IonContent, IonHeader, IonTitle, IonToolbar } from '@ionic/angular/standalone';
import { MatchStateService } from '../../services/match-state.service';
import { OfflineSyncService } from '../../services/offline-sync.service';
import { TeamRosterService } from '../../services/team-roster.service';

@Component({
  selector: 'app-home',
  templateUrl: './home.page.html',
  styleUrls: ['./home.page.scss'],
  standalone: true,
  imports: [IonHeader, IonToolbar, IonTitle, IonContent, IonButton, NgIf, NgClass, RouterLink],
})
export class HomePage {
  constructor(
    public readonly teamRoster: TeamRosterService,
    public readonly matchState: MatchStateService,
    public readonly offlineSync: OfflineSyncService,
  ) {}

  get hasValidLineup(): boolean {
    const lineup = this.teamRoster.lineup();
    const assigned = lineup.filter((playerId): playerId is string => !!playerId);
    return (
      assigned.length === 6 &&
      new Set(assigned).size === 6 &&
      assigned.every((playerId) => !!this.teamRoster.getPlayerById(playerId))
    );
  }

  get lineupAssignedCount(): number {
    return this.teamRoster.lineup().filter((playerId) => !!playerId).length;
  }

  get hasMatchStarted(): boolean {
    const state = this.matchState.state();
    if (state.teamPoints > 0 || state.opponentPoints > 0 || state.teamSets > 0 || state.opponentSets > 0 || state.currentSet > 1) {
      return true;
    }

    const events = this.offlineSync.getMatchEvents(this.offlineSync.getActiveMatchId());
    return events.some((event) => event.type === 'matchStarted');
  }

  get matchStatusText(): string {
    const state = this.matchState.state();
    if (state.isMatchOver) {
      return `Final: ${state.teamSets}-${state.opponentSets} sets`;
    }
    if (!this.hasMatchStarted) {
      return 'No live match in progress';
    }
    return `Live: ${state.teamPoints}-${state.opponentPoints} in set ${state.currentSet}`;
  }

  get syncStatusText(): string {
    if (this.offlineSync.pendingCount() > 0) {
      return `${this.offlineSync.pendingCount()} event(s) pending sync`;
    }

    if (this.offlineSync.lastSuccessfulSyncAt()) {
      return 'All changes synced';
    }

    return 'No successful sync yet';
  }

  get liveMatchButtonText(): string {
    return this.hasMatchStarted && !this.matchState.state().isMatchOver ? 'Resume Live Match' : 'Open Live Match';
  }
}
