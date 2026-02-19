import { Injectable, computed, signal } from '@angular/core';
import { RotationService } from './rotation.service';

export type PrimaryPosition = 'S' | 'OH' | 'MB' | 'OPP' | 'L' | 'DS';

export interface RosterPlayer {
  id: string;
  name: string;
  jerseyNumber: number;
  primaryPosition: PrimaryPosition;
}

export interface NewRosterPlayer {
  name: string;
  jerseyNumber: number;
  primaryPosition: PrimaryPosition;
}

export interface LineupSlot {
  position: number;
  player: RosterPlayer | null;
}

interface PersistedRosterState {
  players: RosterPlayer[];
  lineup: Array<string | null>;
}

@Injectable({
  providedIn: 'root',
})
export class TeamRosterService {
  private static readonly STORAGE_KEY = 'spike-volleyball-roster-v1';
  private readonly playersSignal = signal<RosterPlayer[]>([]);
  private readonly lineupSignal = signal<Array<string | null>>([null, null, null, null, null, null]);

  readonly players = computed(() => this.playersSignal());
  readonly lineup = computed(() => this.lineupSignal());

  constructor(private readonly rotationService: RotationService) {
    this.restore();
  }

  addPlayer(player: NewRosterPlayer): void {
    const nextPlayer: RosterPlayer = {
      id: this.createPlayerId(),
      name: player.name.trim(),
      jerseyNumber: player.jerseyNumber,
      primaryPosition: player.primaryPosition,
    };

    this.playersSignal.update((players) => [...players, nextPlayer]);
    this.persist();
  }

  removePlayer(playerId: string): void {
    this.playersSignal.update((players) => players.filter((player) => player.id !== playerId));
    this.lineupSignal.update((lineup) => lineup.map((id) => (id === playerId ? null : id)));
    this.persist();
  }

  assignPlayerToPosition(playerId: string, position: number): void {
    const targetIndex = position - 1;
    if (targetIndex < 0 || targetIndex >= 6) {
      return;
    }

    this.lineupSignal.update((lineup) => {
      const nextLineup = [...lineup];
      const currentIndex = nextLineup.findIndex((id) => id === playerId);
      if (currentIndex >= 0) {
        nextLineup[currentIndex] = null;
      }
      nextLineup[targetIndex] = playerId;
      return nextLineup;
    });

    this.persist();
  }

  unassignPosition(position: number): void {
    const targetIndex = position - 1;
    if (targetIndex < 0 || targetIndex >= 6) {
      return;
    }

    this.lineupSignal.update((lineup) => {
      const nextLineup = [...lineup];
      nextLineup[targetIndex] = null;
      return nextLineup;
    });

    this.persist();
  }

  unassignPlayer(playerId: string): void {
    this.lineupSignal.update((lineup) => lineup.map((id) => (id === playerId ? null : id)));
    this.persist();
  }

  getPlayerById(playerId: string | null): RosterPlayer | null {
    if (!playerId) {
      return null;
    }

    return this.playersSignal().find((player) => player.id === playerId) ?? null;
  }

  getLineupSlots(): LineupSlot[] {
    return this.lineupSignal().map((playerId, index) => ({
      position: index + 1,
      player: this.getPlayerById(playerId),
    }));
  }

  isAssigned(playerId: string): boolean {
    return this.lineupSignal().includes(playerId);
  }

  hasCompleteLineup(): boolean {
    return this.lineupSignal().every((playerId) => !!playerId);
  }

  getOnCourtPlayers(): RosterPlayer[] {
    return this.lineupSignal()
      .map((playerId) => this.getPlayerById(playerId))
      .filter((player): player is RosterPlayer => player !== null);
  }

  getBenchPlayers(): RosterPlayer[] {
    return this.playersSignal().filter((player) => !this.isAssigned(player.id));
  }

  substitutePlayers(outPlayerId: string, inPlayerId: string): boolean {
    if (outPlayerId === inPlayerId) {
      return false;
    }

    const outIndex = this.lineupSignal().findIndex((playerId) => playerId === outPlayerId);
    const inIsAssigned = this.isAssigned(inPlayerId);
    const inExists = !!this.getPlayerById(inPlayerId);

    if (outIndex < 0 || inIsAssigned || !inExists) {
      return false;
    }

    this.lineupSignal.update((lineup) => {
      const nextLineup = [...lineup];
      nextLineup[outIndex] = inPlayerId;
      return nextLineup;
    });

    this.persist();
    return true;
  }

  rotateLineupClockwise(): void {
    const wrappedLineup = this.lineupSignal().map((playerId) => ({ playerId }));
    const rotated = this.rotationService.rotate(wrappedLineup, true).map((slot) => slot.playerId);
    this.lineupSignal.set(rotated);
    this.persist();
  }

  rotateLineupCounterClockwise(): void {
    this.lineupSignal.update((lineup) => {
      const nextLineup = [...lineup];
      return [
        nextLineup[5],
        nextLineup[0],
        nextLineup[1],
        nextLineup[2],
        nextLineup[3],
        nextLineup[4],
      ];
    });
    this.persist();
  }

  getLineupSnapshot(): Array<string | null> {
    return [...this.lineupSignal()];
  }

  setLineup(lineup: Array<string | null>): void {
    if (lineup.length !== 6) {
      return;
    }
    this.lineupSignal.set([...lineup]);
    this.persist();
  }

  private persist(): void {
    if (typeof window === 'undefined' || !window.localStorage) {
      return;
    }

    const state: PersistedRosterState = {
      players: this.playersSignal(),
      lineup: this.lineupSignal(),
    };
    window.localStorage.setItem(TeamRosterService.STORAGE_KEY, JSON.stringify(state));
  }

  private restore(): void {
    if (typeof window === 'undefined' || !window.localStorage) {
      return;
    }

    const raw = window.localStorage.getItem(TeamRosterService.STORAGE_KEY);
    if (!raw) {
      return;
    }

    try {
      const parsed = JSON.parse(raw) as PersistedRosterState;
      if (!Array.isArray(parsed.players) || !Array.isArray(parsed.lineup) || parsed.lineup.length !== 6) {
        return;
      }

      this.playersSignal.set(parsed.players);
      this.lineupSignal.set(parsed.lineup.map((id) => (typeof id === 'string' ? id : null)));
    } catch {
      // Ignore invalid persisted data and continue with defaults.
    }
  }

  private createPlayerId(): string {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID();
    }

    return `p-${Date.now()}-${Math.floor(Math.random() * 10000)}`;
  }
}
