import { NgClass } from '@angular/common';
import { Component, viewChild, type ElementRef } from '@angular/core';
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
  private readonly playerNameInput = viewChild.required<ElementRef<HTMLInputElement>>('playerNameInput');
  readonly primaryPositions: PrimaryPosition[] = ['S', 'OH', 'MB', 'OPP', 'L', 'DS'];
  teamNameDraft: string;
  showTeamPicker = false;
  editingPlayerId: string | null = null;
  draft: NewRosterPlayer = this.emptyPlayer();
  bulkRosterText = '';
  bulkImportErrors: string[] = [];
  bulkImportStatus = '';

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

  importRoster(): void {
    this.bulkImportErrors = [];
    this.bulkImportStatus = '';
    const parsedPlayers: NewRosterPlayer[] = [];
    const lines = this.bulkRosterText.split(/\r?\n/);

    for (const [index, line] of lines.entries()) {
      if (!line.trim()) continue;

      const columns = this.parseRosterLine(line);
      if (!columns) {
        this.bulkImportErrors.push(`Line ${index + 1}: Check the quotes or use tabs between spreadsheet columns.`);
        continue;
      }

      const firstHeader = columns[0]?.trim() ?? '';
      const secondHeader = columns[1]?.trim() ?? '';
      if (/^(jersey(\s*number)?|number|#)$/i.test(firstHeader) && /^(player(\s*name)?|name)$/i.test(secondHeader)) continue;
      if (columns.length < 2 || columns.length > 3) {
        this.bulkImportErrors.push(`Line ${index + 1}: Enter a jersey number, player name, and optional position.`);
        continue;
      }

      const jerseyText = columns[0].trim();
      const name = columns[1].trim();
      const positionText = columns[2]?.trim().toUpperCase() || 'OH';
      const jerseyNumber = Number(jerseyText);

      if (!/^\d{1,2}$/.test(jerseyText) || jerseyNumber > 99) {
        this.bulkImportErrors.push(`Line ${index + 1}: Enter a jersey number from 0 to 99.`);
        continue;
      }
      if (!name) {
        this.bulkImportErrors.push(`Line ${index + 1}: Enter a player name.`);
        continue;
      }
      if (!this.primaryPositions.includes(positionText as PrimaryPosition)) {
        this.bulkImportErrors.push(`Line ${index + 1}: Use one of ${this.primaryPositions.join(', ')} for the position.`);
        continue;
      }

      parsedPlayers.push({ name, jerseyNumber, primaryPosition: positionText as PrimaryPosition });
    }

    if (this.bulkImportErrors.length > 0) return;
    if (parsedPlayers.length === 0) {
      this.bulkImportStatus = 'Paste at least one player row before adding the roster.';
      return;
    }

    const addedPlayers = this.teamRoster.addPlayers(parsedPlayers);
    this.bulkRosterText = '';
    this.bulkImportStatus = `Added ${addedPlayers.length} ${addedPlayers.length === 1 ? 'player' : 'players'} to the saved roster.`;
  }

  clearBulkImportFeedback(): void {
    this.bulkImportErrors = [];
    this.bulkImportStatus = '';
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
    const nameInput = this.playerNameInput().nativeElement;
    nameInput.focus({ preventScroll: true });
    nameInput.scrollIntoView({ block: 'center', behavior: 'instant' });
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

  private parseRosterLine(line: string): string[] | null {
    if (line.includes('\t')) return line.split('\t');

    const columns: string[] = [];
    let value = '';
    let inQuotes = false;
    for (let index = 0; index < line.length; index += 1) {
      const character = line[index];
      if (character === '"' && line[index + 1] === '"' && inQuotes) {
        value += '"';
        index += 1;
      } else if (character === '"') {
        inQuotes = !inQuotes;
      } else if (character === ',' && !inQuotes) {
        columns.push(value);
        value = '';
      } else {
        value += character;
      }
    }

    if (inQuotes) return null;
    columns.push(value);
    return columns;
  }
}
