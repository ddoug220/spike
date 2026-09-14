import { Component, ElementRef, Input, QueryList, ViewChild, ViewChildren, inject } from '@angular/core';
import { FormsModule, NgForm } from '@angular/forms';
import type { CourtPosition } from '../../../domain/match-v2/match-event';
import {
  NewRosterPlayer,
  PrimaryPosition,
  RosterPlayer,
  TeamRosterService,
} from '../../../services/team-roster.service';

const COURT_POSITIONS = [4, 3, 2, 5, 6, 1] as const satisfies readonly CourtPosition[];

const COURT_ZONES: Record<CourtPosition, string> = {
  1: 'Right back',
  2: 'Right front',
  3: 'Middle front',
  4: 'Left front',
  5: 'Left back',
  6: 'Middle back',
};

@Component({
  selector: 'app-first-run-court',
  templateUrl: './first-run-court.component.html',
  styleUrls: ['./first-run-court.component.scss'],
  standalone: true,
  imports: [FormsModule],
})
export class FirstRunCourtComponent {
  @Input({ required: true }) teamName = 'My Team';
  @ViewChild('slotEditor') private readonly slotEditor?: ElementRef<HTMLElement>;
  @ViewChild('newPlayerForm') private readonly playerForm?: NgForm;
  @ViewChild('savedPlayerSelect') private readonly savedPlayerSelect?: ElementRef<HTMLSelectElement>;
  @ViewChild('playerNameInput') private readonly playerNameInput?: ElementRef<HTMLInputElement>;
  @ViewChildren('courtSlotButton') private readonly courtSlotButtons!: QueryList<ElementRef<HTMLButtonElement>>;

  readonly teamRoster = inject(TeamRosterService);
  readonly positions: PrimaryPosition[] = ['S', 'OH', 'MB', 'OPP', 'L', 'DS'];
  selectedPosition: CourtPosition | null = null;
  selectedExistingPlayerId = '';
  get draft(): NewRosterPlayer {
    return this.drafts.get(this.activeDraftKey)?.value ?? this.emptyPlayer();
  }

  set draft(value: NewRosterPlayer) {
    const entry = this.drafts.get(this.activeDraftKey);
    if (entry) entry.value = value;
  }

  movingFrom: CourtPosition | null = null;
  announcement = '';
  operationError = '';
  private activeDraftKey = '';
  private readonly drafts = new Map<string, { value: NewRosterPlayer; original: NewRosterPlayer }>();

  get editorKeys(): string[] { return this.selectedPosition === null ? [] : [this.activeDraftKey]; }
  get hasUnsavedChanges(): boolean { return this.hasDraft(this.activeDraftKey); }
  get hasDrafts(): boolean { return [...this.drafts.keys()].some((key) => this.hasDraft(key)); }
  get readinessText(): string {
    return this.teamRoster.isMatchLineupReady ? 'Starting lineup ready' :
      `Assign ${6 - this.assignedCount} more position${this.assignedCount === 5 ? '' : 's'}`;
  }

  hasDraft(key: string): boolean {
    const entry = this.drafts.get(key);
    return !!entry && (entry.value.name !== entry.original.name ||
      entry.value.jerseyNumber !== entry.original.jerseyNumber || entry.value.primaryPosition !== entry.original.primaryPosition);
  }

  slotHasDraft(position: CourtPosition): boolean {
    const player = this.slots.find((slot) => slot.position === position)?.player;
    return this.hasDraft(player ? `player:${player.id}` : `slot:${position}`);
  }

  discardChanges(): void {
    const entry = this.drafts.get(this.activeDraftKey);
    if (!entry) return;
    const player = this.selectedSlot?.player;
    if (player && this.activeDraftKey === `player:${player.id}`) entry.original = { ...player };
    this.draft = { ...entry.original };
    this.operationError = '';
    this.playerForm?.resetForm({ courtPlayerName: this.draft.name, courtJersey: this.draft.jerseyNumber, courtPosition: this.draft.primaryPosition });
  }

  resetVisit(): void {
    this.drafts.clear();
    this.selectedPosition = null;
    this.movingFrom = null;
    this.activeDraftKey = '';
    this.announcement = '';
    this.operationError = '';
  }

  startMove(): void {
    if (!this.selectionIsCurrent() || !this.selectedSlot?.player) return;
    this.movingFrom = this.selectedPosition;
    this.closeEditor();
    this.announcement = 'Choose a position. Occupied positions swap players.';
  }

  cancelMove(): void {
    const position = this.movingFrom;
    this.movingFrom = null;
    this.announcement = 'Move cancelled.';
    this.focusSlot(position);
  }

  clearPosition(): void {
    if (!this.selectionIsCurrent() || !this.selectedSlot?.player || this.selectedPosition === null) return;
    this.announcement = `${this.selectedSlot.player.name} cleared from P${this.selectedPosition}. Player remains in the squad.`;
    this.teamRoster.unassignMatchStarter(this.selectedPosition);
    this.closeEditor();
  }

  private focusSlot(position: CourtPosition | null): void {
    requestAnimationFrame(() => this.courtSlotButtons
      .find((button) => button.nativeElement.dataset['position'] === String(position))?.nativeElement.focus());
  }

  get assignedCount(): number {
    return this.slots.filter((slot) => slot.player).length;
  }

  get slots() {
    const savedSlots = this.teamRoster.getMatchStartingSlots();
    return COURT_POSITIONS.map((position) => ({
      ...savedSlots[position - 1],
      position,
      className: `p${position}`,
      zone: COURT_ZONES[position],
    }));
  }

  get selectedSlot() {
    return this.slots.find((slot) => slot.position === this.selectedPosition) ?? null;
  }

  get unassignedPlayers(): RosterPlayer[] {
    const assignedPlayerIds = new Set(
      this.slots.map((slot) => slot.player?.id).filter((playerId): playerId is string => !!playerId),
    );
    return this.teamRoster.players().filter((player) => !assignedPlayerIds.has(player.id));
  }

  selectSlot(position: CourtPosition): void {
    const slot = this.slots.find((candidate) => candidate.position === position);
    if (!slot) return;
    this.operationError = '';

    if (this.movingFrom !== null) {
      const source = this.slots.find((candidate) => candidate.position === this.movingFrom);
      if (!source?.player || this.activeDraftKey !== `player:${source.player.id}`) {
        this.operationError = 'The lineup changed before the move. Select the player again to choose a new destination.';
        this.movingFrom = null;
        return;
      }
      if (this.teamRoster.moveMatchStarter(this.movingFrom, position)) {
        this.announcement = slot.player ? `${source?.player?.name} swapped with ${slot.player.name}.` : `${source?.player?.name} moved to P${position}.`;
        this.movingFrom = null;
        this.focusSlot(position);
      }
      return;
    }
    this.selectedPosition = position;
    this.selectedExistingPlayerId = this.unassignedPlayers[0]?.id ?? '';
    this.activeDraftKey = slot.player ? `player:${slot.player.id}` : `slot:${position}`;
    if (!this.drafts.has(this.activeDraftKey)) {
      const original = slot.player ? { ...slot.player } : this.emptyPlayer(position);
      this.drafts.set(this.activeDraftKey, { original, value: { ...original } });
    }
    this.revealEditor();
  }

  savePlayer(): void {
    if (!this.selectionIsCurrent()) return;
    const name = this.draft.name.trim();
    if (!name || this.selectedPosition === null || !Number.isInteger(this.draft.jerseyNumber) ||
      this.draft.jerseyNumber < 0 || this.draft.jerseyNumber > 99) return;

    const player = this.selectedSlot?.player;
    if (player) {
      this.teamRoster.updatePlayer(player.id, { ...this.draft, name });
    } else {
      const addedPlayer = this.teamRoster.addPlayer({ ...this.draft, name });
      this.placePlayer(addedPlayer.id);
    }

    this.drafts.delete(this.activeDraftKey);
    this.announcement = `${name} saved in P${this.selectedPosition}.`;
    this.closeEditor();
  }

  placeExistingPlayer(): void {
    if (!this.selectionIsCurrent()) return;
    if (!this.unassignedPlayers.some((player) => player.id === this.selectedExistingPlayerId)) {
      this.operationError = 'That player is no longer available for this position. Choose another saved player.';
      return;
    }
    this.placePlayer(this.selectedExistingPlayerId);
    this.announcement = `Saved player placed in P${this.selectedPosition}.`;
    this.closeEditor();
  }

  closeEditor(): void {
    const position = this.selectedPosition;
    this.selectedPosition = null;
    this.selectedExistingPlayerId = '';
    this.focusSlot(position);
  }

  private selectionIsCurrent(): boolean {
    const slot = this.selectedSlot;
    if (!slot) return false;
    const key = slot.player ? `player:${slot.player.id}` : `slot:${slot.position}`;
    if (key !== this.activeDraftKey) {
      this.operationError = 'The lineup changed while this form was open. Your draft is kept. Close the form and select the player again.';
      return false;
    }
    const original = this.drafts.get(key)?.original;
    if (slot.player && original && (slot.player.name !== original.name ||
      slot.player.jerseyNumber !== original.jerseyNumber || slot.player.primaryPosition !== original.primaryPosition)) {
      this.operationError = 'This player’s saved details changed. Your draft is kept. Copy anything you need, then discard changes to load the saved details.';
      return false;
    }
    this.operationError = '';
    return true;
  }

  private placePlayer(playerId: string): void {
    if (this.selectedPosition === null) return;
    this.teamRoster.setMatchSquadPlayer(playerId, true);
    this.teamRoster.assignMatchStarter(playerId, this.selectedPosition);
  }

  private revealEditor(): void {
    requestAnimationFrame(() => {
      if (window.matchMedia('(max-width: 820px)').matches) {
        const behavior = window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth';
        this.slotEditor?.nativeElement.scrollIntoView({ behavior, block: 'start' });
      }
      (this.savedPlayerSelect ?? this.playerNameInput)?.nativeElement.focus({ preventScroll: true });
    });
  }

  private emptyPlayer(position: CourtPosition = 1): NewRosterPlayer {
    return { name: '', jerseyNumber: position, primaryPosition: 'OH' };
  }
}
