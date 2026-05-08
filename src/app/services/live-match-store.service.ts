import { Injectable, OnDestroy, computed, signal } from '@angular/core';
import { Unsubscribe } from 'firebase/firestore';
import { Game, GameEvent, PlayerSetStats } from '../models/firestore.models';
import { FirebaseDbService } from './firebase-db.service';
import { MatchScoreState, MatchStateService } from './match-state.service';
import { MatchStatsService, PlayerStatLine, StatsAction } from './match-stats.service';
import { OfflineSyncService } from './offline-sync.service';

export type SurfaceMode = 'live' | 'review';
export type PlayerListFilter = 'all' | 'starters' | 'bench';
export type AnalyticsTabId = 'efficiency' | 'rotation' | 'serve-receive' | 'errors' | 'sets';

export type LiveLastEvent =
  | { kind: 'player-action'; playerId: number; action: StatsAction; impactedScore: boolean; impactedStats: boolean }
  | { kind: 'opponent-error-point'; impactedScore: boolean; impactedStats: boolean }
  | { kind: 'opponent-point'; impactedScore: true; impactedStats: boolean }
  | { kind: 'manual-rotation'; impactedScore: false; impactedStats: false }
  | { kind: 'timeout'; team: 'team' | 'opponent'; impactedScore: false; impactedStats: false };

export interface LiveMatchUiState {
  activePlayer: number;
  lastEvent?: LiveLastEvent;
  isSubOverlayOpen: boolean;
  substitutionOutPlayerId: string | null;
  substitutionStatus: string;
  activeSurfaceMode: SurfaceMode;
  playerListFilter: PlayerListFilter;
  playerSearchQuery: string;
  activeAnalyticsTab: AnalyticsTabId;
  reviewLoadMs: number;
  isExitSheetOpen: boolean;
}

export interface LiveMatchState {
  gameState: MatchScoreState;
  game: Game | null;
  stats: PlayerSetStats[];
  events: GameEvent[];
  ui: LiveMatchUiState;
}

@Injectable({
  providedIn: 'root',
})
export class LiveMatchStoreService implements OnDestroy {
  private readonly uiSignal = signal<LiveMatchUiState>(this.createInitialUiState());
  private readonly firestoreGameSignal = signal<Game | null>(null);
  private readonly firestoreEventsSignal = signal<GameEvent[]>([]);
  private readonly firestoreStatsSignal = signal<PlayerSetStats[]>([]);
  private readonly unsubscribers: Unsubscribe[] = [];
  private subscribedGameId: string | null = null;

  readonly ui = computed(() => this.uiSignal());
  readonly game = computed(() => this.latestGame(this.offlineSync.getGame(this.activeGameId()), this.firestoreGameSignal()));
  readonly gameState = computed(() => this.toGameState(this.game()) ?? this.matchState.state());
  readonly stats = computed(() => this.firestoreStatsSignal());
  readonly events = computed(() => this.mergeEvents(this.offlineSync.getMatchEvents(this.activeGameId()), this.firestoreEventsSignal()));
  readonly state = computed<LiveMatchState>(() => ({
    gameState: this.gameState(),
    game: this.game(),
    stats: this.stats(),
    events: this.events(),
    ui: this.ui(),
  }));

  constructor(
    private readonly matchState: MatchStateService,
    private readonly matchStats: MatchStatsService,
    private readonly offlineSync: OfflineSyncService,
    private readonly firebaseDb: FirebaseDbService,
  ) {}

  ngOnDestroy(): void {
    this.unsubscribeFirestore();
  }

  syncActiveGame(): void {
    const gameId = this.activeGameId();
    if (this.subscribedGameId === gameId) {
      return;
    }

    this.unsubscribeFirestore();
    this.subscribedGameId = gameId;
    this.unsubscribers.push(
      this.firebaseDb.subscribeGame(gameId, (game) => {
        this.firestoreGameSignal.set(game);
        const gameState = this.toGameState(game);
        if (gameState) {
          this.matchState.hydrateState(gameState);
        }
      }),
      this.firebaseDb.subscribeEvents(gameId, (events) => {
        this.firestoreEventsSignal.set(events);
        if (events.length > 0) {
          this.matchStats.hydrateFromEvents(events);
        }
      }),
      this.firebaseDb.subscribePlayerSetStats(gameId, (stats) => {
        this.firestoreStatsSignal.set(stats);
        if (stats.length > 0) {
          this.matchStats.hydrateFromPlayerSetStats(stats);
        }
      }),
    );
  }

  setUi(patch: Partial<LiveMatchUiState>): void {
    this.uiSignal.update((ui) => ({ ...ui, ...patch }));
  }

  updateUi(updater: (ui: LiveMatchUiState) => LiveMatchUiState): void {
    this.uiSignal.update(updater);
  }

  activeGameId(): string {
    return this.offlineSync.getActiveMatchId();
  }

  getPlayerStats(playerId: string): PlayerStatLine {
    const synced = this.stats().find((entry) => entry.playerId === playerId && entry.setNumber === null);
    if (!synced) {
      return this.matchStats.getPlayerStats(playerId);
    }

    return {
      kills: synced.kills,
      attackErrors: synced.attackErrors,
      totalAttacks: synced.totalAttacks,
      aces: synced.aces,
      serveAttempts: synced.serveAttempts,
      servesIn: synced.servesIn,
      blocks: synced.blocks,
      digs: synced.digs,
      serviceErrors: synced.serviceErrors,
      receiveErrors: synced.receiveErrors ?? 0,
      sideOutOpportunities: synced.sideOutOpportunities,
      sideOutConversions: synced.sideOutConversions,
    };
  }

  getHittingEfficiency(playerId: string): number | null {
    const synced = this.stats().find((entry) => entry.playerId === playerId && entry.setNumber === null);
    return synced ? synced.hittingEfficiency : this.matchStats.getHittingEfficiency(playerId);
  }

  getSideOutPercentage(playerId: string): number | null {
    const synced = this.stats().find((entry) => entry.playerId === playerId && entry.setNumber === null);
    return synced ? synced.sideOutPercentage : this.matchStats.getSideOutPercentage(playerId);
  }

  getServeInPercentage(playerId: string): number | null {
    const synced = this.stats().find((entry) => entry.playerId === playerId && entry.setNumber === null);
    return synced ? synced.serveInPercentage : this.matchStats.getServeInPercentage(playerId);
  }

  getPlayerSetStats(playerId: string, setNumber: number): { kills: number; attackErrors: number; totalAttacks: number } {
    const synced = this.stats().find((entry) => entry.playerId === playerId && entry.setNumber === setNumber);
    if (!synced) {
      return this.matchStats.getPlayerSetStats(playerId, setNumber);
    }

    return {
      kills: synced.kills,
      attackErrors: synced.attackErrors,
      totalAttacks: synced.totalAttacks,
    };
  }

  private unsubscribeFirestore(): void {
    this.unsubscribers.splice(0).forEach((unsubscribe) => unsubscribe());
    this.firestoreGameSignal.set(null);
    this.firestoreEventsSignal.set([]);
    this.firestoreStatsSignal.set([]);
  }

  private toGameState(game: Game | null): MatchScoreState | null {
    if (!game) {
      return null;
    }

    return {
      teamPoints: game.teamPoints,
      opponentPoints: game.opponentPoints,
      teamSets: game.teamSets,
      opponentSets: game.opponentSets,
      currentSet: game.currentSet,
      servingTeam: game.servingTeam,
      isMatchOver: game.isMatchOver,
      teamTimeoutsRemaining: game.teamTimeoutsRemaining,
      opponentTimeoutsRemaining: game.opponentTimeoutsRemaining,
      teamRotation: game.teamRotation,
    };
  }

  private mergeEvents(localEvents: GameEvent[], firestoreEvents: GameEvent[]): GameEvent[] {
    const byId = new Map<string, GameEvent>();
    firestoreEvents.forEach((event) => byId.set(event.id, event));
    localEvents.forEach((event) => byId.set(event.id, event));
    return Array.from(byId.values())
      .filter((event) => !event.isDeleted)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  private latestGame(localGame: Game | null, firestoreGame: Game | null): Game | null {
    if (!localGame) {
      return firestoreGame;
    }
    if (!firestoreGame) {
      return localGame;
    }
    return localGame.updatedAt >= firestoreGame.updatedAt ? localGame : firestoreGame;
  }

  private createInitialUiState(): LiveMatchUiState {
    return {
      activePlayer: 1,
      isSubOverlayOpen: false,
      substitutionOutPlayerId: null,
      substitutionStatus: '',
      activeSurfaceMode: 'live',
      playerListFilter: 'all',
      playerSearchQuery: '',
      activeAnalyticsTab: 'efficiency',
      reviewLoadMs: 0,
      isExitSheetOpen: false,
    };
  }
}
