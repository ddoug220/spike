import { Injectable, OnDestroy, computed, signal } from '@angular/core';
import { Unsubscribe } from 'firebase/firestore';
import { Game, GameEvent, PlayerSetStats } from '../models/firestore.models';
import { FirebaseDbService } from './firebase-db.service';
import { MatchScoreState, MatchStateService } from './match-state.service';
import { MatchStatsService, PlayerStatLine, StatsAction } from './match-stats.service';
import {
  projectionFromFirestore,
  scoreStateFromProjection,
  setStatsStateFromProjection,
  statsStateFromProjection,
} from './match-v2.adapter';
import { OfflineSyncService } from './offline-sync.service';

export type LiveLastEvent =
  | { kind: 'player-action'; playerId: number; playerName: string; action: StatsAction; impactedScore: boolean; impactedStats: boolean }
  | { kind: 'opponent-error-point'; impactedScore: boolean; impactedStats: boolean }
  | { kind: 'opponent-point'; impactedScore: true; impactedStats: boolean }
  | { kind: 'manual-rotation'; impactedScore: false; impactedStats: false }
  | { kind: 'timeout'; team: 'team' | 'opponent'; impactedScore: false; impactedStats: false };

export interface LiveMatchUiState {
  activePlayer: number | null;
  lastEvent?: LiveLastEvent;
  isSubOverlayOpen: boolean;
  substitutionOutPlayerId: string | null;
  substitutionStatus: string;
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
  readonly events = computed(() => this.mergeEvents(this.offlineSync.getMatchEvents(this.activeGameId()), this.firestoreEventsSignal()));
  readonly projection = computed(() => {
    const game = this.game();
    return game ? projectionFromFirestore(game, this.events()) : null;
  });
  readonly gameState = computed(() => {
    const projection = this.projection();
    return projection ? scoreStateFromProjection(projection) : this.toGameState(this.game()) ?? this.matchState.state();
  });
  readonly stats = computed(() => this.firestoreStatsSignal());
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
        this.hydrateMirrorsFromProjection();
      }),
      this.firebaseDb.subscribeEvents(gameId, (events) => {
        this.firestoreEventsSignal.set(events);
        this.hydrateMirrorsFromProjection();
      }),
      this.firebaseDb.subscribePlayerSetStats(gameId, (stats) => {
        this.firestoreStatsSignal.set(stats);
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

  getPlayerIdAtPosition(position: number): string | null {
    return this.projection()?.lineup?.[position - 1] ?? null;
  }

  getPlayerStats(playerId: string): PlayerStatLine {
    const projection = this.projection();
    if (projection) {
      const projected = statsStateFromProjection(projection)[playerId];
      if (projected) {
        return projected;
      }
    }
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
    };
  }

  getServeInPercentage(playerId: string): number | null {
    const projection = this.projection();
    if (projection) {
      const stats = this.getPlayerStats(playerId);
      return stats.serveAttempts === 0 ? null : stats.servesIn / stats.serveAttempts;
    }
    const synced = this.stats().find((entry) => entry.playerId === playerId && entry.setNumber === null);
    return synced ? synced.serveInPercentage : this.matchStats.getServeInPercentage(playerId);
  }

  getPlayerSetStats(playerId: string, setNumber: number): { kills: number; attackErrors: number; totalAttacks: number } {
    const projection = this.projection();
    if (projection) {
      return setStatsStateFromProjection(projection)[playerId]?.[setNumber] ?? {
        kills: 0,
        attackErrors: 0,
        totalAttacks: 0,
      };
    }
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

  private hydrateMirrorsFromProjection(): void {
    const projection = this.projection();
    if (!projection) return;
    this.matchState.hydrateState(scoreStateFromProjection(projection));
    this.matchStats.replaceSnapshot(
      statsStateFromProjection(projection),
      setStatsStateFromProjection(projection),
    );
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
      isSetBreak: game.isSetBreak === true,
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
      activePlayer: null,
      isSubOverlayOpen: false,
      substitutionOutPlayerId: null,
      substitutionStatus: '',
      isExitSheetOpen: false,
    };
  }
}
