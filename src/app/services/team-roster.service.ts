import { Injectable, Injector, Optional, computed, effect, signal } from '@angular/core';
import { Player, PrimaryPosition, Roster, Team } from '../models/firestore.models';
import { AuthService } from './auth.service';
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

export interface MatchDefaults {
  squadPlayerIds: string[];
  startingLineup: Array<string | null>;
}

interface PersistedRosterState {
  team?: Partial<RosterTeam>;
  players: Array<Partial<RosterPlayer>>;
  lineup: Array<string | null>;
  matchDefaultsByTeam?: Record<string, Partial<MatchDefaults>>;
}

interface MatchDefaultsRoster extends Roster {
  squadPlayerIds?: string[];
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
  private readonly matchDefaultsByTeamSignal = signal<Record<string, MatchDefaults>>({});
  private restoredLocalState = false;

  private readonly cloudSnapshotSignal = signal<TeamRosterSnapshot | null>(null);

  readonly team = computed(() => this.teamSignal());
  readonly players = computed(() => this.playersSignal());
  readonly lineup = computed(() => this.lineupSignal());
  readonly matchDefaults = computed(() => this.getMatchDefaults(this.teamSignal().id));
  readonly cloudTeams = computed<RosterTeam[]>(() => {
    const snapshot = this.cloudSnapshotSignal();
    if (!snapshot) return [];
    return snapshot.teams
      .slice()
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .map((team) => ({ id: team.id, name: team.name, createdAt: team.createdAt, updatedAt: team.updatedAt }));
  });

  constructor(
    private readonly rotationService: RotationService,
    private readonly auth: AuthService,
    @Optional() private readonly offlineSync?: OfflineSyncService,
    @Optional() private readonly firebaseDb?: FirebaseDbService,
    @Optional() injector?: Injector,
  ) {
    this.restore();
    if (injector) {
      effect(() => {
        const uid = this.auth.user()?.uid ?? null;
        if (uid) {
          void this.restoreFromFirebase(uid);
        }
      }, { injector });
    } else {
      const uid = this.auth.user()?.uid ?? null;
      if (uid) {
        void this.restoreFromFirebase(uid);
      }
    }
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
    this.matchDefaultsByTeamSignal.update((defaultsByTeam) => {
      const nextDefaults: Record<string, MatchDefaults> = {};
      for (const [teamId, defaults] of Object.entries(defaultsByTeam)) {
        nextDefaults[teamId] = {
          squadPlayerIds: defaults.squadPlayerIds.filter((id) => id !== playerId),
          startingLineup: defaults.startingLineup.map((id) => (id === playerId ? null : id)),
        };
      }
      return nextDefaults;
    });
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

  getMatchStartingSlots(): LineupSlot[] {
    return this.matchDefaults().startingLineup.map((playerId, index) => ({
      position: index + 1,
      player: this.getPlayerById(playerId),
    }));
  }

  getMatchSquadPlayers(): RosterPlayer[] {
    const squadIds = new Set(this.matchDefaults().squadPlayerIds);
    return this.playersSignal().filter((player) => squadIds.has(player.id));
  }

  isInMatchSquad(playerId: string): boolean {
    return this.matchDefaults().squadPlayerIds.includes(playerId);
  }

  setMatchSquadPlayer(playerId: string, selected: boolean): void {
    if (!this.getPlayerById(playerId)) {
      return;
    }

    const defaults = this.matchDefaults();
    const squad = new Set(defaults.squadPlayerIds);
    if (selected) {
      squad.add(playerId);
    } else {
      squad.delete(playerId);
    }

    this.setCurrentMatchDefaults({
      squadPlayerIds: [...squad],
      startingLineup: defaults.startingLineup.map((id) => (id === playerId ? null : id)),
    });
  }

  assignMatchStarter(playerId: string, position: number): void {
    const targetIndex = position - 1;
    if (targetIndex < 0 || targetIndex >= 6 || !this.isInMatchSquad(playerId)) {
      return;
    }

    const defaults = this.matchDefaults();
    const startingLineup = [...defaults.startingLineup];
    const currentIndex = startingLineup.indexOf(playerId);
    if (currentIndex >= 0) {
      startingLineup[currentIndex] = null;
    }
    startingLineup[targetIndex] = playerId;
    this.setCurrentMatchDefaults({ ...defaults, startingLineup });
  }

  unassignMatchStarter(position: number): void {
    const targetIndex = position - 1;
    if (targetIndex < 0 || targetIndex >= 6) {
      return;
    }

    const defaults = this.matchDefaults();
    const startingLineup = [...defaults.startingLineup];
    startingLineup[targetIndex] = null;
    this.setCurrentMatchDefaults({ ...defaults, startingLineup });
  }

  reuseMatchDefaults(squadPlayerIds: string[], startingLineup: Array<string | null>): void {
    const currentPlayerIds = new Set(this.playersSignal().map((player) => player.id));
    const availableSquadIds = [...new Set(squadPlayerIds)].filter((id) => currentPlayerIds.has(id));
    const availableSquad = new Set(availableSquadIds);
    const reusableLineup = startingLineup.length === 6
      ? startingLineup.map((id) => (id && availableSquad.has(id) ? id : null))
      : [null, null, null, null, null, null];

    this.setCurrentMatchDefaults({
      squadPlayerIds: availableSquadIds,
      startingLineup: reusableLineup,
    });
  }

  activateMatchLineup(): boolean {
    const startingLineup = this.matchDefaults().startingLineup;
    const assigned = startingLineup.filter((id): id is string => !!id);
    if (
      assigned.length !== 6 ||
      new Set(assigned).size !== 6 ||
      assigned.some((id) => !this.getPlayerById(id))
    ) {
      return false;
    }

    this.lineupSignal.set([...startingLineup]);
    this.persist('roster');
    return true;
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
      matchDefaultsByTeam: this.matchDefaultsByTeamSignal(),
    };
    window.localStorage.setItem(this.ownerKey(), JSON.stringify(state));
    this.syncToFirebase(syncScope);
  }

  private restore(): void {
    if (typeof window === 'undefined' || !window.localStorage) {
      return;
    }

    const raw = window.localStorage.getItem(this.ownerKey());
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
      const players = this.normalizePlayers(parsed.players, normalizedTeam.createdAt);
      const lineup = parsed.lineup.map((id) => (typeof id === 'string' ? id : null));
      this.playersSignal.set(players);
      this.lineupSignal.set(lineup);
      this.matchDefaultsByTeamSignal.set(
        this.normalizeMatchDefaultsByTeam(parsed.matchDefaultsByTeam, normalizedTeam.id, players, lineup),
      );
      this.restoredLocalState = true;
    } catch {
      // Ignore invalid persisted data and continue with defaults.
    }
  }

  clearOwnerLocalData(): void {
    if (typeof window !== 'undefined' && window.localStorage) {
      window.localStorage.removeItem(this.ownerKey());
    }
    this.teamSignal.set(this.createDefaultTeam());
    this.playersSignal.set([]);
    this.lineupSignal.set([null, null, null, null, null, null]);
  }

  private ownerKey(): string {
    return `${TeamRosterService.STORAGE_KEY}:${this.auth.uid ?? 'signed-out'}`;
  }

  switchToTeam(teamId: string): boolean {
    const snapshot = this.cloudSnapshotSignal();
    if (!snapshot) {
      return false;
    }
    return this.applyTeamFromSnapshot(teamId, snapshot);
  }

  private async restoreFromFirebase(ownerId: string): Promise<void> {
    if (!this.firebaseDb?.isConfigured()) {
      return;
    }

    const result = await this.firebaseDb.readTeamRosterSnapshot(ownerId);
    if (!result.ok || !result.data) {
      return;
    }

    this.cloudSnapshotSignal.set(result.data);
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

    this.applyTeamFromSnapshot(team.id, snapshot);
  }

  private applyTeamFromSnapshot(teamId: string, snapshot: TeamRosterSnapshot): boolean {
    const team = snapshot.teams.find((t) => t.id === teamId);
    if (!team) {
      return false;
    }

    const roster = snapshot.rosters
      .filter((entry) => entry.teamId === team.id && entry.gameId === null)
      .slice()
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0] as MatchDefaultsRoster | undefined;
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
    this.matchDefaultsByTeamSignal.update((defaultsByTeam) => ({
      ...defaultsByTeam,
      [team.id]: defaultsByTeam[team.id] ?? {
        squadPlayerIds: Array.isArray(roster?.squadPlayerIds)
          ? roster.squadPlayerIds.filter((id) => playerIds.has(id))
          : snapshot.players
              .filter((player) => player.teamId === team.id && player.active)
              .map((player) => player.id),
        startingLineup: [...cloudLineup],
      },
    }));
    this.persist('all');
    return true;
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

  private normalizeMatchDefaultsByTeam(
    rawDefaults: Record<string, Partial<MatchDefaults>> | undefined,
    currentTeamId: string,
    players: RosterPlayer[],
    legacyLineup: Array<string | null>,
  ): Record<string, MatchDefaults> {
    const playerIds = new Set(players.map((player) => player.id));
    const defaultsByTeam: Record<string, MatchDefaults> = {};

    for (const [teamId, raw] of Object.entries(rawDefaults ?? {})) {
      const squadPlayerIds = Array.isArray(raw.squadPlayerIds)
        ? [...new Set(raw.squadPlayerIds.filter((id): id is string => typeof id === 'string'))]
        : [];
      const startingLineup = Array.isArray(raw.startingLineup) && raw.startingLineup.length === 6
        ? raw.startingLineup.map((id) => (typeof id === 'string' ? id : null))
        : [null, null, null, null, null, null];
      defaultsByTeam[teamId] = { squadPlayerIds, startingLineup };
    }

    if (!defaultsByTeam[currentTeamId]) {
      defaultsByTeam[currentTeamId] = {
        squadPlayerIds: players.map((player) => player.id),
        startingLineup: legacyLineup.map((id) => (typeof id === 'string' && playerIds.has(id) ? id : null)),
      };
    }

    return defaultsByTeam;
  }

  private getMatchDefaults(teamId: string): MatchDefaults {
    return this.matchDefaultsByTeamSignal()[teamId] ?? {
      squadPlayerIds: [],
      startingLineup: [null, null, null, null, null, null],
    };
  }

  private setCurrentMatchDefaults(defaults: MatchDefaults): void {
    this.matchDefaultsByTeamSignal.update((defaultsByTeam) => ({
      ...defaultsByTeam,
      [this.teamSignal().id]: {
        squadPlayerIds: [...defaults.squadPlayerIds],
        startingLineup: [...defaults.startingLineup],
      },
    }));
    this.persist('roster');
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
      ownerId: this.auth.uid ?? '',
      name: team.name,
      createdAt: team.createdAt,
      updatedAt: team.updatedAt,
    };
  }

  private toFirestorePlayer(player: RosterPlayer, teamId: string): Player {
    return {
      id: player.id,
      ownerId: this.auth.uid ?? '',
      teamId,
      name: player.name,
      jerseyNumber: player.jerseyNumber,
      primaryPosition: player.primaryPosition,
      active: player.active,
      createdAt: player.createdAt,
      updatedAt: player.updatedAt,
    };
  }

  private toFirestoreRoster(teamId: string, timestamp: string): MatchDefaultsRoster {
    const defaults = this.getMatchDefaults(teamId);
    const savedLineup = defaults.startingLineup;
    const hasSavedLineup = savedLineup.some((playerId) => !!playerId);
    return {
      id: this.createRosterId(teamId),
      ownerId: this.auth.uid ?? '',
      teamId,
      gameId: null,
      squadPlayerIds: [...defaults.squadPlayerIds],
      lineup: [...(hasSavedLineup ? savedLineup : this.lineupSignal())],
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
