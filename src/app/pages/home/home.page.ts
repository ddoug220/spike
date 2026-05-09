import { NgClass } from '@angular/common';
import { Component } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { IonButton, IonContent, IonHeader, IonIcon, IonTitle, IonToolbar } from '@ionic/angular/standalone';
import { addIcons } from 'ionicons';
import {
  cloudDoneOutline,
  cloudOfflineOutline,
  createOutline,
  gridOutline,
  logOutOutline,
  people,
  peopleOutline,
  play,
  playCircle,
  radioButtonOnOutline,
  swapHorizontalOutline,
  timeOutline,
} from 'ionicons/icons';
import { AuthService } from '../../services/auth.service';
import { MatchStateService } from '../../services/match-state.service';
import { OfflineSyncService } from '../../services/offline-sync.service';
import { RosterTeam, TeamRosterService } from '../../services/team-roster.service';

type HomeStepState = 'complete' | 'current' | 'locked';

interface HomeSetupStep {
  label: string;
  detail: string;
  state: HomeStepState;
}

@Component({
  selector: 'app-home',
  templateUrl: './home.page.html',
  styleUrls: ['./home.page.scss'],
  standalone: true,
  imports: [IonHeader, IonToolbar, IonTitle, IonContent, IonButton, IonIcon, NgClass, RouterLink],
})
export class HomePage {
  showTeamPicker = false;

  constructor(
    public readonly teamRoster: TeamRosterService,
    public readonly matchState: MatchStateService,
    public readonly offlineSync: OfflineSyncService,
    private readonly auth: AuthService,
    private readonly router: Router,
  ) {
    addIcons({
      timeOutline,
      playCircle,
      people,
      createOutline,
      play,
      cloudDoneOutline,
      cloudOfflineOutline,
      swapHorizontalOutline,
      logOutOutline,
      peopleOutline,
      gridOutline,
      radioButtonOnOutline,
    });
  }

  get userEmail(): string | null {
    return this.auth.email;
  }

  async signOut(): Promise<void> {
    await this.auth.signOut();
    await this.router.navigate(['/login']);
  }

  get cloudTeams(): RosterTeam[] {
    return this.teamRoster.cloudTeams();
  }

  toggleTeamPicker(): void {
    this.showTeamPicker = !this.showTeamPicker;
  }

  switchToTeam(teamId: string): void {
    this.teamRoster.switchToTeam(teamId);
    this.showTeamPicker = false;
  }

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

  get playerPoolCount(): number {
    return this.teamRoster.players().length;
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
      return `Final vs ${this.opponentName}: ${state.teamSets}-${state.opponentSets} sets`;
    }
    if (!this.hasMatchStarted) {
      return 'No live match in progress';
    }
    return `Live vs ${this.opponentName}: ${state.teamPoints}-${state.opponentPoints} in set ${state.currentSet}`;
  }

  get syncStatusText(): string {
    if (this.offlineSync.lastError()) {
      return 'Saved on device. Cloud sync needs retry';
    }

    if (this.offlineSync.pendingCount() > 0) {
      return `${this.offlineSync.pendingCount()} change(s) pending sync`;
    }

    if (this.offlineSync.lastSuccessfulSyncAt()) {
      return 'All changes synced';
    }

    return 'No successful sync yet';
  }

  get hasActiveMatch(): boolean {
    return this.hasMatchStarted && !this.matchState.state().isMatchOver;
  }

  get opponentName(): string {
    return this.offlineSync.getGame(this.offlineSync.getActiveMatchId())?.opponentName?.trim() || 'Opponent';
  }

  get liveMatchButtonText(): string {
    return this.hasActiveMatch ? 'Resume Live Match' : 'Open Live Match';
  }

  get nextActionTitle(): string {
    if (this.hasActiveMatch) {
      return 'Resume the live match';
    }
    if (this.matchState.state().isMatchOver) {
      return 'Review the final match';
    }
    if (this.playerPoolCount < 6) {
      return 'Build your team';
    }
    if (!this.hasValidLineup) {
      return 'Set your starting lineup';
    }
    return 'Start a tracked match';
  }

  get nextActionDetail(): string {
    if (this.hasActiveMatch) {
      return this.matchStatusText;
    }
    if (this.matchState.state().isMatchOver) {
      return `${this.matchStatusText}. Start another match from lineup setup when you are ready.`;
    }
    if (this.playerPoolCount < 6) {
      return 'Add at least 6 players once. Spike reuses this player pool for every match.';
    }
    if (!this.hasValidLineup) {
      return 'Place 6 starters on the court so every scoring tap is tied to the right player.';
    }
    return 'Name the opponent, choose first serve, then score the match from the live court.';
  }

  get primaryActionText(): string {
    if (this.hasActiveMatch) {
      return 'Resume Match';
    }
    if (this.matchState.state().isMatchOver) {
      return 'View Match History';
    }
    if (this.hasValidLineup) {
      return 'Start Match';
    }
    return this.playerPoolCount < 6 ? 'Add Players' : 'Set Lineup';
  }

  get primaryActionRoute(): string[] {
    if (this.hasActiveMatch) {
      return ['/court'];
    }
    if (this.matchState.state().isMatchOver) {
      return ['/history'];
    }
    return ['/pre-match'];
  }

  get setupSteps(): HomeSetupStep[] {
    return [
      {
        label: 'Add players',
        detail: `${this.playerPoolCount}/6 minimum in your saved player pool`,
        state: this.playerPoolCount >= 6 ? 'complete' : 'current',
      },
      {
        label: 'Set lineup',
        detail: `${this.lineupAssignedCount}/6 starters assigned to court spots`,
        state: this.playerPoolCount < 6 ? 'locked' : this.hasValidLineup ? 'complete' : 'current',
      },
      {
        label: 'Track live',
        detail: 'Opponent, first serve, score, subs, undo, and box score',
        state: this.hasValidLineup ? 'current' : 'locked',
      },
    ];
  }

  get matchCardTitle(): string {
    if (this.hasActiveMatch) {
      return `Live vs ${this.opponentName}`;
    }
    if (this.matchState.state().isMatchOver) {
      return `Final vs ${this.opponentName}`;
    }
    return 'No live match yet';
  }

  get matchCardDetail(): string {
    const state = this.matchState.state();
    if (this.hasActiveMatch || state.isMatchOver) {
      return `${state.teamSets}-${state.opponentSets} sets, ${state.teamPoints}-${state.opponentPoints} in set ${state.currentSet}`;
    }
    return 'Start from lineup setup when your starters are ready.';
  }

  get syncIconName(): string {
    return this.offlineSync.lastError() || this.offlineSync.pendingCount() > 0 ? 'cloud-offline-outline' : 'cloud-done-outline';
  }
}
