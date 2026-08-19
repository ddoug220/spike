import { NgClass, NgFor, NgIf } from '@angular/common';
import { Component } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { IonButton, IonContent, IonHeader, IonIcon, IonTitle, IonToolbar } from '@ionic/angular/standalone';
import { addIcons } from 'ionicons';
import { cloudDoneOutline, cloudOfflineOutline, logOutOutline, peopleOutline, timeOutline } from 'ionicons/icons';
import { AuthService } from '../../services/auth.service';
import { MatchStateService } from '../../services/match-state.service';
import { MatchStatsService } from '../../services/match-stats.service';
import { OfflineSyncService } from '../../services/offline-sync.service';
import { TeamRosterService } from '../../services/team-roster.service';

@Component({
  selector: 'app-home',
  templateUrl: './home.page.html',
  styleUrls: ['./home.page.scss'],
  standalone: true,
  imports: [IonHeader, IonToolbar, IonTitle, IonContent, IonButton, IonIcon, NgClass, NgFor, NgIf, RouterLink],
})
export class HomePage {
  signOutError: string | null = null;

  constructor(
    public readonly teamRoster: TeamRosterService,
    public readonly matchState: MatchStateService,
    public readonly offlineSync: OfflineSyncService,
    private readonly matchStats: MatchStatsService,
    private readonly auth: AuthService,
    private readonly router: Router,
  ) {
    addIcons({ cloudDoneOutline, cloudOfflineOutline, logOutOutline, peopleOutline, timeOutline });
  }

  get userEmail(): string | null { return this.auth.email; }
  get activeMatchId(): string { return this.offlineSync.getActiveMatchId(); }
  get activeGame() { return this.offlineSync.getGame(this.activeMatchId); }

  get hasStartedMatch(): boolean {
    return !!this.activeGame || this.offlineSync.getMatchEvents(this.activeMatchId).some((event) => event.type === 'matchStarted');
  }

  get hasLiveMatch(): boolean {
    return this.activeGame ? this.activeGame.status === 'live' : this.hasStartedMatch && !this.matchState.state().isMatchOver;
  }

  get hasReviewableMatch(): boolean {
    return this.activeGame?.status === 'final' ||
      this.activeGame?.status === 'ended-early' ||
      this.matchState.state().isMatchOver;
  }

  get playerCount(): number { return this.teamRoster.players().length; }
  get defaultLineup() { return this.teamRoster.getMatchStartingSlots(); }
  get assignedDefaultCount(): number { return this.teamRoster.matchDefaults().startingLineup.filter((id) => !!id).length; }

  get nextTitle(): string {
    if (this.hasLiveMatch) return this.matchState.state().isSetBreak ? 'Set up the next set' : 'Resume the live match';
    if (this.hasReviewableMatch) return this.activeGame?.status === 'ended-early' ? 'Review the ended match' : 'Review the final match';
    if (this.playerCount < 6) return 'Build your team';
    return 'Set up the next match';
  }

  get nextDetail(): string {
    const state = this.matchState.state();
    if (this.hasLiveMatch) {
      return state.isSetBreak
        ? `Set ${state.currentSet} is complete. Confirm the next lineup and first serve.`
        : `vs ${this.activeGame?.opponentName || 'Opponent'} · Set ${state.currentSet} · ${state.teamPoints}–${state.opponentPoints}`;
    }
    if (this.hasReviewableMatch) {
      return `vs ${this.activeGame?.opponentName || 'Opponent'} · ${this.activeGame?.teamSets ?? state.teamSets}–${this.activeGame?.opponentSets ?? state.opponentSets} sets`;
    }
    if (this.playerCount < 6) {
      const missing = 6 - this.playerCount;
      return `Add ${missing} more player${missing === 1 ? '' : 's'} to prepare a Match Squad.`;
    }
    return 'Confirm the opponent, Match Squad, Starting Lineup, and first serve.';
  }

  get nextActionLabel(): string {
    if (this.hasLiveMatch) return this.matchState.state().isSetBreak ? 'Continue Match' : 'Resume Match';
    if (this.hasReviewableMatch) return 'Review Match';
    if (this.playerCount < 6) return 'Manage Team';
    return 'Set Up Match';
  }

  get nextActionRoute(): string[] {
    if (this.hasLiveMatch) return ['/court'];
    if (this.hasReviewableMatch) return ['/review', this.activeMatchId];
    if (this.playerCount < 6) return ['/team'];
    return ['/pre-match'];
  }

  get syncText(): string {
    if (this.offlineSync.lastError()) return 'Saved here · Sync needs retry';
    if (this.offlineSync.pendingCount() > 0) return `Saved here · ${this.offlineSync.pendingCount()} pending`;
    return this.offlineSync.lastSuccessfulSyncAt() ? 'Synced' : 'Saved on this device';
  }

  get hasSyncAttention(): boolean {
    return this.offlineSync.pendingCount() > 0 || !!this.offlineSync.lastError();
  }

  async signOut(): Promise<void> {
    this.signOutError = null;
    if (!(await this.offlineSync.prepareForSignOut())) {
      this.signOutError = 'Sign out is blocked until saved changes reach the cloud. Reconnect, then try again.';
      return;
    }
    this.offlineSync.clearOwnerLocalData();
    this.teamRoster.clearOwnerLocalData();
    this.matchState.clearOwnerLocalData();
    this.matchStats.clearOwnerLocalData();
    await this.auth.signOut();
    await this.router.navigate(['/login']);
  }
}
