import { Injectable, signal } from '@angular/core';
import { GameEvent, PlayerSetStats } from '../models/firestore.models';

export type StatsAction =
  | 'kill'
  | 'service-error'
  | 'attack-error'
  | 'ace'
  | 'block'
  | 'opponent-error'
  | 'dig';

export interface PlayerStatLine {
  kills: number;
  attackErrors: number;
  totalAttacks: number;
  aces: number;
  serveAttempts: number;
  servesIn: number;
  blocks: number;
  digs: number;
  serviceErrors: number;
  sideOutOpportunities: number;
  sideOutConversions: number;
}

export type StatsState = Record<string, PlayerStatLine>;
export type SetStatsState = Record<string, Record<number, { kills: number; attackErrors: number; totalAttacks: number }>>;
interface StatsSnapshot {
  stats: StatsState;
  setStats: SetStatsState;
}

@Injectable({
  providedIn: 'root',
})
export class MatchStatsService {
  private static readonly STORAGE_KEY = 'spike-match-stats-v1';
  private readonly historySignal = signal<StatsSnapshot[]>([]);
  private readonly statsSignal = signal<StatsState>({});
  private readonly setStatsSignal = signal<SetStatsState>({});

  constructor() {
    this.restore();
  }

  getPlayerStats(playerId: string): PlayerStatLine {
    return this.statsSignal()[playerId] ?? this.createEmptyLine();
  }

  getHittingEfficiency(playerId: string): number | null {
    const stats = this.getPlayerStats(playerId);
    if (stats.totalAttacks === 0) {
      return null;
    }

    return (stats.kills - stats.attackErrors) / stats.totalAttacks;
  }

  getSideOutPercentage(playerId: string): number | null {
    const stats = this.getPlayerStats(playerId);
    if (stats.sideOutOpportunities === 0) {
      return null;
    }

    return stats.sideOutConversions / stats.sideOutOpportunities;
  }

  getServeInPercentage(playerId: string): number | null {
    const stats = this.getPlayerStats(playerId);
    if (stats.serveAttempts === 0) {
      return null;
    }

    return stats.servesIn / stats.serveAttempts;
  }

  getPlayerSetStats(
    playerId: string,
    setNumber: number,
  ): { kills: number; attackErrors: number; totalAttacks: number } {
    const playerSets = this.setStatsSignal()[playerId];
    if (!playerSets || !playerSets[setNumber]) {
      return { kills: 0, attackErrors: 0, totalAttacks: 0 };
    }

    return playerSets[setNumber];
  }

  recordPlayerAction(
    playerId: string,
    action: StatsAction,
    context: {
      wasReceiving: boolean;
      sideOutWon: boolean;
      inferredServeInServerPlayerId?: string;
      currentSet: number;
    },
  ): void {
    this.historySignal.update((history) => [...history, this.snapshot()]);

    this.statsSignal.update((state) => {
      const nextState = this.cloneState(state);

      if (context.inferredServeInServerPlayerId) {
        const serverId = context.inferredServeInServerPlayerId;
        const serveLine = { ...(nextState[serverId] ?? this.createEmptyLine()) };
        serveLine.serveAttempts += 1;
        serveLine.servesIn += 1;
        nextState[serverId] = serveLine;
      }

      const line = { ...(nextState[playerId] ?? this.createEmptyLine()) };

      if (context.wasReceiving) {
        line.sideOutOpportunities += 1;
      }
      if (context.sideOutWon) {
        line.sideOutConversions += 1;
      }

      if (action === 'kill') {
        line.kills += 1;
        line.totalAttacks += 1;
      } else if (action === 'attack-error') {
        line.attackErrors += 1;
        line.totalAttacks += 1;
      } else if (action === 'ace') {
        line.aces += 1;
        line.serveAttempts += 1;
        line.servesIn += 1;
      } else if (action === 'block') {
        line.blocks += 1;
      } else if (action === 'dig') {
        line.digs += 1;
      } else if (action === 'service-error') {
        line.serviceErrors += 1;
        line.serveAttempts += 1;
      }

      nextState[playerId] = line;
      return nextState;
    });

    if (action === 'kill' || action === 'attack-error') {
      this.setStatsSignal.update((setState) => {
        const nextSetState = this.cloneSetState(setState);
        const current = nextSetState[playerId]?.[context.currentSet] ?? {
          kills: 0,
          attackErrors: 0,
          totalAttacks: 0,
        };

        const nextLine = { ...current };
        if (action === 'kill') {
          nextLine.kills += 1;
          nextLine.totalAttacks += 1;
        }
        if (action === 'attack-error') {
          nextLine.attackErrors += 1;
          nextLine.totalAttacks += 1;
        }

        nextSetState[playerId] = {
          ...(nextSetState[playerId] ?? {}),
          [context.currentSet]: nextLine,
        };
        return nextSetState;
      });
    }

    this.persist();
  }

  undoLastAction(): void {
    const history = this.historySignal();
    if (history.length === 0) {
      return;
    }

    const previous = history[history.length - 1];
    this.historySignal.set(history.slice(0, history.length - 1));
    this.statsSignal.set(previous.stats);
    this.setStatsSignal.set(previous.setStats);
    this.persist();
  }

  resetMatch(): void {
    this.historySignal.set([]);
    this.statsSignal.set({});
    this.setStatsSignal.set({});
    this.persist();
  }

  hydrateFromPlayerSetStats(playerSetStats: PlayerSetStats[]): void {
    const stats: StatsState = {};
    const setStats: SetStatsState = {};

    playerSetStats.forEach((entry) => {
      if (entry.setNumber === null) {
        stats[entry.playerId] = {
          kills: entry.kills,
          attackErrors: entry.attackErrors,
          totalAttacks: entry.totalAttacks,
          aces: entry.aces,
          serveAttempts: entry.serveAttempts,
          servesIn: entry.servesIn,
          blocks: entry.blocks,
          digs: entry.digs,
          serviceErrors: entry.serviceErrors,
          sideOutOpportunities: entry.sideOutOpportunities,
          sideOutConversions: entry.sideOutConversions,
        };
        return;
      }

      setStats[entry.playerId] = {
        ...(setStats[entry.playerId] ?? {}),
        [entry.setNumber]: {
          kills: entry.kills,
          attackErrors: entry.attackErrors,
          totalAttacks: entry.totalAttacks,
        },
      };
    });

    this.replaceSnapshot(stats, setStats);
  }

  hydrateFromEvents(events: GameEvent[]): void {
    const stats: StatsState = {};
    const setStats: SetStatsState = {};

    events
      .filter((event) => !event.isDeleted)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
      .forEach((event) => {
        if (event.type !== 'playerAction' || !event.playerId || !this.isStatsAction(event.action)) {
          return;
        }

        const line = stats[event.playerId] ?? this.createEmptyLine();
        if (event.wasReceiving) {
          line.sideOutOpportunities += 1;
        }
        if (event.sideOutWon) {
          line.sideOutConversions += 1;
        }
        if (event.action === 'kill') {
          line.kills += 1;
          line.totalAttacks += 1;
        }
        if (event.action === 'attack-error') {
          line.attackErrors += 1;
          line.totalAttacks += 1;
        }
        if (event.action === 'ace') {
          line.aces += 1;
          line.serveAttempts += 1;
          line.servesIn += 1;
        }
        if (event.action === 'block') {
          line.blocks += 1;
        }
        if (event.action === 'dig') {
          line.digs += 1;
        }
        if (event.action === 'service-error') {
          line.serviceErrors += 1;
          line.serveAttempts += 1;
        }
        stats[event.playerId] = line;

        if (event.inferredServeInServerPlayerId) {
          const serveLine = stats[event.inferredServeInServerPlayerId] ?? this.createEmptyLine();
          serveLine.serveAttempts += 1;
          serveLine.servesIn += 1;
          stats[event.inferredServeInServerPlayerId] = serveLine;
        }

        if (event.action === 'kill' || event.action === 'attack-error') {
          const setNumber = event.actionSetNumber ?? event.currentSet ?? 1;
          const current = setStats[event.playerId]?.[setNumber] ?? { kills: 0, attackErrors: 0, totalAttacks: 0 };
          setStats[event.playerId] = {
            ...(setStats[event.playerId] ?? {}),
            [setNumber]: {
              kills: current.kills + (event.action === 'kill' ? 1 : 0),
              attackErrors: current.attackErrors + (event.action === 'attack-error' ? 1 : 0),
              totalAttacks: current.totalAttacks + 1,
            },
          };
        }
      });

    this.replaceSnapshot(stats, setStats);
  }

  replaceSnapshot(stats: StatsState, setStats: SetStatsState): void {
    this.historySignal.set([]);
    this.statsSignal.set(this.cloneState(stats));
    this.setStatsSignal.set(this.cloneSetState(setStats));
    this.persist();
  }

  recordInferredServeIn(playerId: string): void {
    this.historySignal.update((history) => [...history, this.snapshot()]);
    this.statsSignal.update((state) => {
      const nextState = this.cloneState(state);
      const line = { ...(nextState[playerId] ?? this.createEmptyLine()) };
      line.serveAttempts += 1;
      line.servesIn += 1;
      nextState[playerId] = line;
      return nextState;
    });
    this.persist();
  }

  private createEmptyLine(): PlayerStatLine {
    return {
      kills: 0,
      attackErrors: 0,
      totalAttacks: 0,
      aces: 0,
      serveAttempts: 0,
      servesIn: 0,
      blocks: 0,
      digs: 0,
      serviceErrors: 0,
      sideOutOpportunities: 0,
      sideOutConversions: 0,
    };
  }

  private isStatsAction(action: string): action is StatsAction {
    return (
      action === 'kill' ||
      action === 'service-error' ||
      action === 'attack-error' ||
      action === 'ace' ||
      action === 'block' ||
      action === 'opponent-error' ||
      action === 'dig'
    );
  }

  private cloneState(state: StatsState): StatsState {
    const nextState: StatsState = {};
    Object.keys(state).forEach((playerId) => {
      nextState[playerId] = { ...state[playerId] };
    });
    return nextState;
  }

  private cloneSetState(state: SetStatsState): SetStatsState {
    const nextState: SetStatsState = {};
    Object.keys(state).forEach((playerId) => {
      const perSet: Record<number, { kills: number; attackErrors: number; totalAttacks: number }> = {};
      Object.keys(state[playerId]).forEach((setKey) => {
        const setNumber = Number(setKey);
        perSet[setNumber] = { ...state[playerId][setNumber] };
      });
      nextState[playerId] = perSet;
    });
    return nextState;
  }

  private snapshot(): StatsSnapshot {
    return {
      stats: this.cloneState(this.statsSignal()),
      setStats: this.cloneSetState(this.setStatsSignal()),
    };
  }

  private persist(): void {
    if (typeof window === 'undefined' || !window.localStorage) {
      return;
    }

    window.localStorage.setItem(
      MatchStatsService.STORAGE_KEY,
      JSON.stringify({
        history: this.historySignal(),
        stats: this.statsSignal(),
        setStats: this.setStatsSignal(),
      }),
    );
  }

  private restore(): void {
    if (typeof window === 'undefined' || !window.localStorage) {
      return;
    }
    const raw = window.localStorage.getItem(MatchStatsService.STORAGE_KEY);
    if (!raw) {
      return;
    }

    try {
      const parsed = JSON.parse(raw) as { history: StatsSnapshot[]; stats: StatsState; setStats?: SetStatsState };
      if (!parsed || !parsed.stats || !Array.isArray(parsed.history)) {
        return;
      }
      this.historySignal.set(parsed.history);
      this.statsSignal.set(parsed.stats);
      this.setStatsSignal.set(parsed.setStats ?? {});
    } catch {
      // Ignore corrupt local state.
    }
  }
}
