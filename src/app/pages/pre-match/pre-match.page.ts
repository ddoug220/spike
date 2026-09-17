import { NgClass } from '@angular/common';
import { Component } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import {
  IonButton,
  IonContent,
  IonFooter,
  IonIcon,
  IonModal,
} from '@ionic/angular/standalone';
import { addIcons } from 'ionicons';
import { arrowBack, checkmarkCircle, ellipseOutline, peopleOutline, play } from 'ionicons/icons';
import { MatchEngineService } from '../../services/match-engine.service';
import { EquipmentRailComponent } from '../../components/equipment-rail/equipment-rail.component';
import { OfflineSyncService } from '../../services/offline-sync.service';
import { RosterPlayer, TeamRosterService } from '../../services/team-roster.service';

interface CourtSlot {
  position: number;
  roleLabel: string;
  row: 'front' | 'back';
  isServerSpot: boolean;
  top: string;
  left: string;
}

type FirstServeTeam = 'team' | 'opponent';

@Component({
  selector: 'app-pre-match',
  templateUrl: './pre-match.page.html',
  styleUrls: ['./pre-match.page.scss'],
  standalone: true,
  imports: [
    IonContent,
    IonFooter,
    IonButton,
    IonIcon,
    IonModal,
    NgClass,
    FormsModule,
    RouterLink,
    EquipmentRailComponent,
  ],
})
export class PreMatchPage {
  readonly courtSlots: CourtSlot[] = [
    { position: 4, roleLabel: 'Front Left', row: 'front', isServerSpot: false, top: '24%', left: '18%' },
    { position: 3, roleLabel: 'Front Middle', row: 'front', isServerSpot: false, top: '24%', left: '50%' },
    { position: 2, roleLabel: 'Front Right', row: 'front', isServerSpot: false, top: '24%', left: '82%' },
    { position: 5, roleLabel: 'Back Left', row: 'back', isServerSpot: false, top: '76%', left: '18%' },
    { position: 6, roleLabel: 'Back Middle', row: 'back', isServerSpot: false, top: '76%', left: '50%' },
    { position: 1, roleLabel: 'Back Right', row: 'back', isServerSpot: true, top: '76%', left: '82%' },
  ];

  opponentName = '';
  firstServeTeam: FirstServeTeam = 'team';
  selectedPlayerId: string | null = null;
  editingPosition: number | null = null;
  private draggedPlayerId: string | null = null;
  private positionPickerTrigger: HTMLElement | null = null;

  constructor(
    public readonly teamRoster: TeamRosterService,
    private readonly matchEngine: MatchEngineService,
    private readonly offlineSync: OfflineSyncService,
    private readonly router: Router,
    private readonly route: ActivatedRoute,
  ) {
    addIcons({ arrowBack, checkmarkCircle, ellipseOutline, peopleOutline, play });
  }

  ionViewWillEnter(): void {
    if (this.route.snapshot.queryParamMap.get('newMatch') === '1') {
      this.opponentName = '';
      this.firstServeTeam = 'team';
      void this.router.navigate([], {
        relativeTo: this.route,
        queryParams: { newMatch: null, nextMatch: null },
        queryParamsHandling: 'merge',
        replaceUrl: true,
      });
      return;
    }
    const finishedMatchId = this.route.snapshot.queryParamMap.get('nextMatch');
    if (!finishedMatchId) return;

    this.opponentName = '';
    const finishedGame = this.offlineSync.getGame(finishedMatchId);
    if (finishedGame?.matchSquad && finishedGame.startingLineup) {
      this.teamRoster.reuseMatchDefaults(
        finishedGame.matchSquad.map((player) => player.id),
        finishedGame.startingLineup,
      );
    }
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { nextMatch: null },
      queryParamsHandling: 'merge',
      replaceUrl: true,
    });
  }

  get players(): RosterPlayer[] {
    return this.teamRoster.players();
  }

  get squadPlayers(): RosterPlayer[] {
    return this.teamRoster.getMatchSquadPlayers();
  }

  get squadCount(): number {
    return this.squadPlayers.length;
  }

  get assignedStarterCount(): number {
    return this.teamRoster.matchDefaults().startingLineup.filter((id) => !!id).length;
  }

  get hasAssignedStarters(): boolean {
    return this.assignedStarterCount > 0;
  }

  get isLineupReady(): boolean {
    return this.teamRoster.isMatchLineupReady;
  }

  get hasOpponent(): boolean {
    return this.opponentName.trim().length > 0;
  }

  get canStartMatch(): boolean {
    return this.hasOpponent && this.isLineupReady;
  }

  get startMatchDisabledReason(): string {
    if (!this.hasOpponent) {
      return 'Enter the opponent name';
    }
    if (this.squadCount < 6) {
      const missing = 6 - this.squadCount;
      return `Select ${missing} more squad player${missing === 1 ? '' : 's'}`;
    }
    if (!this.isLineupReady) {
      return 'Assign 6 unique starters to P1–P6';
    }
    return '';
  }

  get selectedPlayerText(): string {
    const player = this.teamRoster.getPlayerById(this.selectedPlayerId);
    return player
      ? `Selected: #${player.jerseyNumber} ${player.name}. Tap a court position.`
      : 'Select a squad player, then tap a court position.';
  }

  get positionPickerTitle(): string {
    return this.editingPosition === null ? 'Choose player' : `Choose player for P${this.editingPosition}`;
  }

  toggleSquadPlayer(playerId: string, event: Event): void {
    const selected = (event.target as HTMLInputElement).checked;
    this.teamRoster.setMatchSquadPlayer(playerId, selected);
    if (!selected && this.selectedPlayerId === playerId) {
      this.selectedPlayerId = null;
    }
  }

  selectPlayer(playerId: string): void {
    if (!this.teamRoster.isInMatchSquad(playerId)) {
      return;
    }
    this.selectedPlayerId = this.selectedPlayerId === playerId ? null : playerId;
  }

  handleCourtPositionClick(position: number, event: Event): void {
    if (window.matchMedia('(max-width: 820px)').matches) {
      this.openPositionPicker(position, event.currentTarget);
      return;
    }
    this.assignSelectedToPosition(position);
  }

  openPositionPicker(position: number, trigger: EventTarget | null = null): void {
    if (!Number.isInteger(position) || position < 1 || position > 6) {
      return;
    }
    this.positionPickerTrigger = trigger instanceof HTMLElement ? trigger : null;
    this.editingPosition = position;
  }

  closePositionPicker(): void {
    this.editingPosition = null;
  }

  handlePositionPickerDismiss(): void {
    this.editingPosition = null;
    const trigger = this.positionPickerTrigger;
    this.positionPickerTrigger = null;
    trigger?.focus();
  }

  choosePlayerForEditingPosition(playerId: string): void {
    if (this.editingPosition === null || !this.teamRoster.isInMatchSquad(playerId)) {
      return;
    }
    this.teamRoster.assignMatchStarter(playerId, this.editingPosition);
    this.closePositionPicker();
  }

  clearEditingPosition(): void {
    if (this.editingPosition === null) {
      return;
    }
    this.teamRoster.unassignMatchStarter(this.editingPosition);
    this.closePositionPicker();
  }

  assignSelectedToPosition(position: number): void {
    if (!this.selectedPlayerId) {
      if (this.getSlotPlayer(position)) {
        this.teamRoster.unassignMatchStarter(position);
      }
      return;
    }
    this.teamRoster.assignMatchStarter(this.selectedPlayerId, position);
    this.selectedPlayerId = null;
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
    const playerId =
      event.dataTransfer?.getData('text/player-id') ||
      event.dataTransfer?.getData('text/plain') ||
      this.draggedPlayerId;
    if (playerId) {
      this.teamRoster.assignMatchStarter(playerId, position);
    }
    this.draggedPlayerId = null;
    this.selectedPlayerId = null;
  }

  setFirstServeTeam(team: FirstServeTeam): void {
    this.firstServeTeam = team;
  }

  getSlotPlayer(position: number): RosterPlayer | null {
    const id = this.teamRoster.matchDefaults().startingLineup[position - 1] ?? null;
    return this.teamRoster.getPlayerById(id);
  }

  getPlayerAssignedPosition(playerId: string): number | null {
    const index = this.teamRoster.matchDefaults().startingLineup.indexOf(playerId);
    return index < 0 ? null : index + 1;
  }

  getCourtSlotAriaLabel(position: number): string {
    const player = this.getSlotPlayer(position);
    if (!player) {
      return `P${position}, open position. Choose player`;
    }
    return `P${position}, #${player.jerseyNumber} ${player.name}, ${player.primaryPosition}. Change player`;
  }

  getPlayerPickerAriaLabel(player: RosterPlayer): string {
    const assignedPosition = this.getPlayerAssignedPosition(player.id);
    const assignment = assignedPosition === null ? 'unassigned' : `currently P${assignedPosition}`;
    return `#${player.jerseyNumber} ${player.name}, ${player.primaryPosition}, ${assignment}`;
  }

  async startMatch(): Promise<void> {
    if (!this.canStartMatch || !this.teamRoster.activateMatchLineup()) {
      return;
    }

    this.matchEngine.startMatch(this.firstServeTeam, { opponentName: this.opponentName.trim() });
    await this.router.navigate(['/court']);
  }
}
