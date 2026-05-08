import { Injectable, Optional, computed, signal } from '@angular/core';
import { Player, PrimaryPosition, Roster, Team } from '../models/firestore.models';
import { BetaIdentityService } from './beta-identity.service';
import { FirebaseDbService, TeamRosterSnapshot } from './firebase-db.service';
import { OfflineSyncService } from './offline-sync.service';
import { RotationService } from './rotation.service';

export type { PrimaryPosition };

export interface RosterPlayer {
  id: string;
  name: string;
  jerseyNumber: number;
  primaryPosition: PrimaryPosition;
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface RosterTeam {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
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
  team?: Partial<RosterTeam>;
  players: Array<Partial<RosterPlayer>>;
  lineup: Array<string | null>;
}

type RosterSyncScope = 'all' | 'roster';

@Injectable({
  providedIn: 'root',
})
export class TeamRosterService {
  private static readonly STORAGE_KEY = 'spike-volleyball-roster-v1';
  private readonly teamSignal = signal<RosterTeam>(this.createDefaultTeam());
  private readonly playersSignal = signal<RosterPlayer[]>([]);
  private readonly lineupSignal = signal<Array<string | null>>([null, null, null, null, null, null]);
  private restoredLocalState = false;

  readonly team = computed(() => this.teamSignal());
  readonly players = computed(() => this.playersSignal());
  readonly lineup = computed(() => this.lineupSignal());

  constructor(
    private readonly rotationService: RotationService,
    @Optional() private readonly offlineSync?: OfflineSyncService,
    @Optional() private readonly firebaseDb?: FirebaseDbService,
    @Optional() private readonly betaIdentity: BetaIdentityService = new BetaIdentityService(),
  ) {
    this.restore();
    void this.restoreFromFirebase();
  }

  updateTeamName(name: string): boolean {
    const trimmedName = name.trim();
    if (!trimmedName) {
      return false;
    }

    this.teamSignal.update((team) => ({
      ...team,
      name: trimmedName,
      updatedAt: new Date().toISOString(),
    }));
    this.persist('all');
    return true;
  }

  addPlayer(player: NewRosterPlayer): void {
    const now = new Date().toISOString();
    const nextPlayer: RosterPlayer = {
      id: this.createPlayerId(),
      name: player.name.trim(),
      jerseyNumber: player.jerseyNumber,
      primaryPosition: player.primaryPosition,
      active: true,
      createdAt: now,
      updatedAt: now,
    };

    this.playersSignal.update((players) => [...players, nextPlayer]);
    this.persist('all');
  }

  updatePlayer(playerId: string, player: NewRosterPlayer): boolean {
    const name = player.name.trim();
    if (!name) {
      return false;
    }

    let didUpdate = false;
    const updatedAt = new Date().toISOString();
    this.playersSignal.update((players) =>
      players.map((existingPlayer) => {
        if (existingPlayer.id !== playerId) {
          return existingPlayer;
        }

        didUpdate = true;
        return {
          ...existingPlayer,
          name,
          jerseyNumber: player.jerseyNumber,
          primaryPosition: player.primaryPosition,
          active: true,
          updatedAt,
        };
      }),
    );

    if (didUpdate) {
      this.persist('all');
    }

    return didUpdate;
  }

  removePlayer(playerId: string): void {
    const removedPlayer = this.getPlayerById(playerId);
    this.playersSignal.update((players) => players.filter((player) => player.id !== playerId));
    this.lineupSignal.update((lineup) => lineup.map((id) => (id === playerId ? null : id)));
    this.persist('all');
    if (removedPlayer) {
      this.queueInactivePlayer(removedPlayer);
    }
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

    this.persist('roster');
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

    this.persist('roster');
  }

  unassignPlayer(playerId: string): void {
    this.lineupSignal.update((lineup) => lineup.map((id) => (id === playerId ? null : id)));
    this.persist('roster');
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

    this.persist('roster');
    return true;
  }

  rotateLineupClockwise(): void {
    const wrappedLineup = this.lineupSignal().map((playerId) => ({ playerId }));
    const rotated = this.rotationService.rotate(wrappedLineup, true).map((slot) => slot.playerId);
    this.lineupSignal.set(rotated);
    this.persist('roster');
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
    this.persist('roster');
  }

  getLineupSnapshot(): Array<string | null> {
    return [...this.lineupSignal()];
  }

  setLineup(lineup: Array<string | null>): void {
    if (lineup.length !== 6) {
      return;
    }
    this.lineupSignal.set([...lineup]);
    this.persist('roster');
  }

  syncRosterToFirebase(offlineSync = this.offlineSync): void {
    this.syncToFirebase('all', offlineSync);
  }

  private persist(syncScope: RosterSyncScope): void {
    if (typeof window === 'undefined' || !window.localStorage) {
      this.syncToFirebase(syncScope);
      return;
    }

    const state: PersistedRosterState = {
      team: this.teamSignal(),
      players: this.playersSignal(),
      lineup: this.lineupSignal(),
    };
    window.localStorage.setItem(TeamRosterService.STORAGE_KEY, JSON.stringify(state));
    this.syncToFirebase(syncScope);
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

      const normalizedTeam = this.normalizeTeam(parsed.team);
      this.teamSignal.set(normalizedTeam);
      this.playersSignal.set(this.normalizePlayers(parsed.players, normalizedTeam.createdAt));
      this.lineupSignal.set(parsed.lineup.map((id) => (typeof id === 'string' ? id : null)));
      this.restoredLocalState = true;
    } catch {
      // Ignore invalid persisted data and continue with defaults.
    }
  }

  private async restoreFromFirebase(): Promise<void> {
    if (!this.firebaseDb?.isConfigured()) {
      return;
    }

    const result = await this.firebaseDb.readTeamRosterSnapshot(this.betaIdentity.ownerId);
    if (!result.ok || !result.data) {
      return;
    }

    this.applyCloudRosterSnapshot(result.data);
  }

  private applyCloudRosterSnapshot(snapshot: TeamRosterSnapshot): void {
    const team = snapshot.teams.slice().sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0];
    if (!team) {
      return;
    }

    if (this.restoredLocalState && team.updatedAt < this.teamSignal().updatedAt) {
      return;
    }

    const roster = snapshot.rosters
      .filter((entry) => entry.teamId === team.id && entry.gameId === null)
      .slice()
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0];
    const playerIds = new Set(snapshot.players.filter((player) => player.teamId === team.id).map((player) => player.id));
    const cloudLineup = roster?.lineup.length === 6 ? roster.lineup.map((id) => (typeof id === 'string' && playerIds.has(id) ? id : null)) : this.lineupSignal();

    this.teamSignal.set({
      id: team.id,
      name: team.name,
      createdAt: team.createdAt,
      updatedAt: team.updatedAt,
    });
    this.playersSignal.set(
      snapshot.players
        .filter((player) => player.teamId === team.id && player.active)
        .map((player) => this.fromFirestorePlayer(player)),
    );
    this.lineupSignal.set(cloudLineup);
    this.persist('all');
  }

  private createDefaultTeam(): RosterTeam {
    const now = new Date().toISOString();
    return {
      id: this.createTeamId(),
      name: 'My Team',
      createdAt: now,
      updatedAt: now,
    };
  }

  private normalizeTeam(team: Partial<RosterTeam> | undefined): RosterTeam {
    const fallback = this.teamSignal();
    const name = typeof team?.name === 'string' && team.name.trim() ? team.name.trim() : fallback.name;
    const id = typeof team?.id === 'string' && team.id.trim() ? team.id : fallback.id;
    const createdAt = typeof team?.createdAt === 'string' && team.createdAt ? team.createdAt : fallback.createdAt;
    const updatedAt = typeof team?.updatedAt === 'string' && team.updatedAt ? team.updatedAt : fallback.updatedAt;

    return {
      id,
      name,
      createdAt,
      updatedAt,
    };
  }

  private normalizePlayers(players: Array<Partial<RosterPlayer>>, fallbackTimestamp: string): RosterPlayer[] {
    return players
      .map((player) => this.normalizePlayer(player, fallbackTimestamp))
      .filter((player): player is RosterPlayer => !!player);
  }

  private normalizePlayer(player: Partial<RosterPlayer>, fallbackTimestamp: string): RosterPlayer | null {
    if (
      typeof player.id !== 'string' ||
      !player.id.trim() ||
      typeof player.name !== 'string' ||
      !player.name.trim() ||
      typeof player.jerseyNumber !== 'number' ||
      !this.isPrimaryPosition(player.primaryPosition)
    ) {
      return null;
    }

    return {
      id: player.id,
      name: player.name.trim(),
      jerseyNumber: player.jerseyNumber,
      primaryPosition: player.primaryPosition,
      active: player.active !== false,
      createdAt: typeof player.createdAt === 'string' && player.createdAt ? player.createdAt : fallbackTimestamp,
      updatedAt: typeof player.updatedAt === 'string' && player.updatedAt ? player.updatedAt : fallbackTimestamp,
    };
  }

  private isPrimaryPosition(value: unknown): value is PrimaryPosition {
    return value === 'S' || value === 'OH' || value === 'MB' || value === 'OPP' || value === 'L' || value === 'DS';
  }

  private syncToFirebase(scope: RosterSyncScope, offlineSync = this.offlineSync): void {
    if (!offlineSync) {
      return;
    }

    const team = this.teamSignal();
    const now = new Date().toISOString();

    if (scope === 'all') {
      offlineSync.queueTeam(this.toFirestoreTeam(team));
      this.playersSignal().forEach((player) => {
        offlineSync.queuePlayer(this.toFirestorePlayer(player, team.id));
      });
    }

    offlineSync.queueRoster(this.toFirestoreRoster(team.id, now));
  }

  private queueInactivePlayer(player: RosterPlayer): void {
    if (!this.offlineSync) {
      return;
    }

    this.offlineSync.queuePlayer({
      ...this.toFirestorePlayer(player, this.teamSignal().id),
      active: false,
      updatedAt: new Date().toISOString(),
    });
  }

  private toFirestoreTeam(team: RosterTeam): Team {
    return {
      id: team.id,
      ownerId: this.betaIdentity.ownerId,
      name: team.name,
      createdAt: team.createdAt,
      updatedAt: team.updatedAt,
    };
  }

  private toFirestorePlayer(player: RosterPlayer, teamId: string): Player {
    return {
      id: player.id,
      ownerId: this.betaIdentity.ownerId,
      teamId,
      name: player.name,
      jerseyNumber: player.jerseyNumber,
      primaryPosition: player.primaryPosition,
      active: player.active,
      createdAt: player.createdAt,
      updatedAt: player.updatedAt,
    };
  }

  private toFirestoreRoster(teamId: string, timestamp: string): Roster {
    return {
      id: this.createRosterId(teamId),
      ownerId: this.betaIdentity.ownerId,
      teamId,
      gameId: null,
      lineup: [...this.lineupSignal()],
      createdAt: this.teamSignal().createdAt,
      updatedAt: timestamp,
    };
  }

  private createRosterId(teamId: string): string {
    return `${teamId}-active-roster`;
  }

  private fromFirestorePlayer(player: Player): RosterPlayer {
    return {
      id: player.id,
      name: player.name,
      jerseyNumber: player.jerseyNumber,
      primaryPosition: player.primaryPosition,
      active: player.active,
      createdAt: player.createdAt,
      updatedAt: player.updatedAt,
    };
  }

  private createTeamId(): string {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return `team-${crypto.randomUUID()}`;
    }

    return `team-${Date.now()}-${Math.floor(Math.random() * 10000)}`;
  }

  private createPlayerId(): string {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID();
    }

    return `p-${Date.now()}-${Math.floor(Math.random() * 10000)}`;
  }
}
