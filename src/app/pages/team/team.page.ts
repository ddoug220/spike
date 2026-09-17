import { NgClass } from '@angular/common';
import { Component } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import {
  IonButton,
  IonContent,
  IonIcon,
} from '@ionic/angular/standalone';
import { addIcons } from 'ionicons';
import { checkmarkCircleOutline, close, cloudDownloadOutline, create, personAdd, save, trash } from 'ionicons/icons';
import { OfflineSyncService } from '../../services/offline-sync.service';
import { EquipmentRailComponent } from '../../components/equipment-rail/equipment-rail.component';
import {
  NewRosterPlayer,
  PrimaryPosition,
  RosterPlayer,
  RosterTeam,
  TeamRosterService,
} from '../../services/team-roster.service';

@Component({
  selector: 'app-team',
  templateUrl: './team.page.html',
  styleUrls: ['./team.page.scss'],
  standalone: true,
  imports: [
    IonContent,
    IonButton,
    IonIcon,
    FormsModule,
    NgClass,
    RouterLink,
    EquipmentRailComponent,
  ],
})
export class TeamPage {
  readonly primaryPositions: PrimaryPosition[] = ['S', 'OH', 'MB', 'OPP', 'L', 'DS'];
  teamNameDraft: string;
  showTeamPicker = false;
  editingPlayerId: string | null = null;
  draft: NewRosterPlayer = this.emptyPlayer();

  constructor(
    public readonly teamRoster: TeamRosterService,
    public readonly offlineSync: OfflineSyncService,
  ) {
    addIcons({ checkmarkCircleOutline, close, cloudDownloadOutline, create, personAdd, save, trash });
    this.teamNameDraft = this.teamRoster.team().name;
  }

  get team(): RosterTeam {
    return this.teamRoster.team();
  }

  get players(): RosterPlayer[] {
    return this.teamRoster.players();
  }

  get cloudTeams(): RosterTeam[] {
    return this.teamRoster.cloudTeams();
  }

  get syncStatusText(): string {
    if (this.offlineSync.lastError()) return 'Saved on this device. Cloud save failed.';
    if (this.offlineSync.isSyncing()) return 'Saving to cloud…';
    if (this.offlineSync.pendingCount() > 0) return `${this.offlineSync.pendingCount()} change(s) waiting to sync`;
    return 'Team saved';
  }

  saveTeam(): void {
    if (!this.teamRoster.updateTeamName(this.teamNameDraft)) {
      this.teamNameDraft = this.team.name;
      return;
    }
    this.teamNameDraft = this.team.name;
  }

  submitPlayer(): void {
    const player = { ...this.draft, name: this.draft.name.trim() };
    if (!player.name) return;

    if (this.editingPlayerId) {
      if (!this.teamRoster.updatePlayer(this.editingPlayerId, player)) return;
      this.editingPlayerId = null;
    } else {
      this.teamRoster.addPlayer(player);
    }
    this.draft = this.emptyPlayer(player.primaryPosition);
  }

  editPlayer(playerId: string): void {
    const player = this.teamRoster.getPlayerById(playerId);
    if (!player) return;
    this.editingPlayerId = player.id;
    this.draft = {
      name: player.name,
      jerseyNumber: player.jerseyNumber,
      primaryPosition: player.primaryPosition,
    };
  }

  cancelEdit(): void {
    this.editingPlayerId = null;
    this.draft = this.emptyPlayer(this.draft.primaryPosition);
  }

  removePlayer(playerId: string): void {
    this.teamRoster.removePlayer(playerId);
    if (this.editingPlayerId === playerId) this.cancelEdit();
  }

  toggleTeamPicker(): void {
    this.showTeamPicker = !this.showTeamPicker;
  }

  switchToTeam(teamId: string): void {
    if (!this.teamRoster.switchToTeam(teamId)) return;
    this.teamNameDraft = this.team.name;
    this.showTeamPicker = false;
    this.cancelEdit();
  }

  retrySync(): void {
    void this.offlineSync.retryNow();
  }

  private emptyPlayer(primaryPosition: PrimaryPosition = 'OH'): NewRosterPlayer {
    return { name: '', jerseyNumber: 1, primaryPosition };
  }
}
