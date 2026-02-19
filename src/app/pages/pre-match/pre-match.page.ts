import { NgClass, NgFor, NgIf } from '@angular/common';
import { Component } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { IonButton, IonContent, IonHeader, IonIcon, IonTitle, IonToolbar } from '@ionic/angular/standalone';
import { addIcons } from 'ionicons';
import { close, create, flask, play, personAdd, trash } from 'ionicons/icons';
import { MatchEngineService } from '../../services/match-engine.service';
import {
  NewRosterPlayer,
  PrimaryPosition,
  RosterPlayer,
  TeamRosterService,
} from '../../services/team-roster.service';

interface CourtSlot {
  position: number;
  roleLabel: string;
  row: 'front' | 'back';
  isServingFirst: boolean;
  top: string;
  left: string;
}

@Component({
  selector: 'app-pre-match',
  templateUrl: './pre-match.page.html',
  styleUrls: ['./pre-match.page.scss'],
  standalone: true,
  imports: [
    IonHeader,
    IonToolbar,
    IonTitle,
    IonContent,
    IonButton,
    IonIcon,
    NgFor,
    NgIf,
    NgClass,
    FormsModule,
    RouterLink,
  ],
})
export class PreMatchPage {
  private static readonly QA_FAKE_TEAM: NewRosterPlayer[] = [
    { name: 'Ava Johnson', jerseyNumber: 1, primaryPosition: 'S' },
    { name: 'Mia Patel', jerseyNumber: 2, primaryPosition: 'OH' },
    { name: 'Zoe Ramirez', jerseyNumber: 3, primaryPosition: 'MB' },
    { name: 'Nora Kim', jerseyNumber: 4, primaryPosition: 'OH' },
    { name: 'Ella Nguyen', jerseyNumber: 5, primaryPosition: 'OPP' },
    { name: 'Lily Carter', jerseyNumber: 6, primaryPosition: 'MB' },
    { name: 'Ruby Brooks', jerseyNumber: 7, primaryPosition: 'DS' },
    { name: 'Emma Cooper', jerseyNumber: 8, primaryPosition: 'L' },
    { name: 'Chloe Diaz', jerseyNumber: 9, primaryPosition: 'OH' },
    { name: 'Sofia Price', jerseyNumber: 10, primaryPosition: 'MB' },
  ];

  readonly primaryPositions: PrimaryPosition[] = ['S', 'OH', 'MB', 'OPP', 'L', 'DS'];
  readonly courtSlots: CourtSlot[] = [
    { position: 4, roleLabel: 'Front Left', row: 'front', isServingFirst: false, top: '24%', left: '18%' },
    { position: 3, roleLabel: 'Front Middle', row: 'front', isServingFirst: false, top: '24%', left: '50%' },
    { position: 2, roleLabel: 'Front Right', row: 'front', isServingFirst: false, top: '24%', left: '82%' },
    { position: 5, roleLabel: 'Back Left', row: 'back', isServingFirst: false, top: '76%', left: '18%' },
    { position: 6, roleLabel: 'Back Middle', row: 'back', isServingFirst: false, top: '76%', left: '50%' },
    { position: 1, roleLabel: 'Back Right', row: 'back', isServingFirst: true, top: '76%', left: '82%' },
  ];

  draft: NewRosterPlayer = {
    name: '',
    jerseyNumber: 1,
    primaryPosition: 'OH',
  };

  private draggedPlayerId: string | null = null;
  public selectedBenchPlayerId: string | null = null;
  public editingPlayerId: string | null = null;

  constructor(
    public readonly teamRoster: TeamRosterService,
    private readonly matchEngine: MatchEngineService,
    private readonly router: Router,
  ) {
    addIcons({ personAdd, trash, play, flask, create, close });
  }

  get players(): RosterPlayer[] {
    return this.teamRoster.players();
  }

  get hasAssignedStarters(): boolean {
    return this.teamRoster.lineup().some((playerId) => !!playerId);
  }

  get isLineupReady(): boolean {
    return this.teamRoster.lineup().every((playerId) => !!playerId);
  }

  get isRotationValid(): boolean {
    const lineup = this.teamRoster.lineup();
    const assigned = lineup.filter((playerId): playerId is string => !!playerId);
    if (assigned.length !== 6 || new Set(assigned).size !== 6) {
      return false;
    }

    return assigned.every((playerId) => !!this.teamRoster.getPlayerById(playerId));
  }

  get canStartMatch(): boolean {
    return this.isLineupReady && this.isRotationValid;
  }

  get startMatchDisabledReason(): string {
    if (!this.isLineupReady) {
      return 'Assign 6 starters to begin';
    }

    if (!this.isRotationValid) {
      return 'Resolve lineup issues before starting the match';
    }

    return '';
  }

  submitPlayer(): void {
    const name = this.draft.name.trim();
    if (!name) {
      return;
    }

    const nextPlayer: NewRosterPlayer = {
      name,
      jerseyNumber: this.draft.jerseyNumber,
      primaryPosition: this.draft.primaryPosition,
    };

    if (this.editingPlayerId) {
      const didUpdate = this.teamRoster.updatePlayer(this.editingPlayerId, nextPlayer);
      if (!didUpdate) {
        return;
      }
      this.editingPlayerId = null;
    } else {
      this.teamRoster.addPlayer(nextPlayer);
    }

    this.resetDraft(nextPlayer.primaryPosition);
  }

  startEditPlayer(playerId: string, event?: Event): void {
    event?.stopPropagation();
    const player = this.teamRoster.getPlayerById(playerId);
    if (!player) {
      return;
    }

    this.editingPlayerId = player.id;
    this.selectedBenchPlayerId = player.id;
    this.draft = {
      name: player.name,
      jerseyNumber: player.jerseyNumber,
      primaryPosition: player.primaryPosition,
    };
  }

  cancelEdit(): void {
    this.editingPlayerId = null;
    this.resetDraft(this.draft.primaryPosition);
  }

  removePlayer(playerId: string, event?: Event): void {
    event?.stopPropagation();
    this.teamRoster.removePlayer(playerId);
    if (this.selectedBenchPlayerId === playerId) {
      this.selectedBenchPlayerId = null;
    }
    if (this.editingPlayerId === playerId) {
      this.cancelEdit();
    }
  }

  generateFakeTeam(): void {
    this.cancelEdit();
    const existingPlayers = this.teamRoster.players().map((player) => player.id);
    existingPlayers.forEach((playerId) => this.teamRoster.removePlayer(playerId));

    PreMatchPage.QA_FAKE_TEAM.forEach((player) => this.teamRoster.addPlayer(player));

    const seededPlayers = this.teamRoster.players();
    this.courtSlots.forEach((slot, index) => {
      const starter = seededPlayers[index];
      if (starter) {
        this.teamRoster.assignPlayerToPosition(starter.id, slot.position);
      }
    });
  }

  allowDrop(event: DragEvent): void {
    event.preventDefault();
  }

  onDragStart(event: DragEvent, playerId: string): void {
    this.draggedPlayerId = playerId;
    event.dataTransfer?.setData('text/player-id', playerId);
    event.dataTransfer?.setData('text/plain', playerId);
  }

  dropOnPosition(event: DragEvent, position: number): void {
    event.preventDefault();
    const playerId = this.readDraggedPlayerId(event);
    if (!playerId) {
      return;
    }

    this.teamRoster.assignPlayerToPosition(playerId, position);
    this.selectedBenchPlayerId = null;
    this.draggedPlayerId = null;
  }

  dropToBench(event: DragEvent): void {
    event.preventDefault();
    const playerId = this.readDraggedPlayerId(event);
    if (!playerId) {
      return;
    }

    this.teamRoster.unassignPlayer(playerId);
    this.selectedBenchPlayerId = playerId;
    this.draggedPlayerId = null;
  }

  selectBenchPlayer(playerId: string): void {
    this.selectedBenchPlayerId = this.selectedBenchPlayerId === playerId ? null : playerId;
  }

  assignSelectedToPosition(position: number): void {
    if (!this.selectedBenchPlayerId) {
      return;
    }

    this.teamRoster.assignPlayerToPosition(this.selectedBenchPlayerId, position);
    this.selectedBenchPlayerId = null;
  }

  moveSelectedToBench(): void {
    if (!this.selectedBenchPlayerId) {
      return;
    }

    this.teamRoster.unassignPlayer(this.selectedBenchPlayerId);
    this.selectedBenchPlayerId = null;
  }

  async startMatch(): Promise<void> {
    if (!this.canStartMatch) {
      return;
    }

    this.matchEngine.startMatch('team');
    await this.router.navigate(['/court']);
  }

  getSlotPlayer(position: number): RosterPlayer | null {
    const playerId = this.teamRoster.lineup()[position - 1] ?? null;
    return this.teamRoster.getPlayerById(playerId);
  }

  trackByPosition(_: number, slot: CourtSlot): number {
    return slot.position;
  }

  trackByPlayer(_: number, player: RosterPlayer): string {
    return player.id;
  }

  private readDraggedPlayerId(event: DragEvent): string | null {
    const fromEvent =
      event.dataTransfer?.getData('text/player-id') || event.dataTransfer?.getData('text/plain') || '';
    return (fromEvent || this.draggedPlayerId || '').trim() || null;
  }

  private resetDraft(primaryPosition: PrimaryPosition): void {
    this.draft = {
      name: '',
      jerseyNumber: 1,
      primaryPosition,
    };
  }
}
