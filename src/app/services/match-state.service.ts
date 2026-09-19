import { Injectable, Optional, computed, signal } from '@angular/core';
import { AuthService } from './auth.service';
import { OfflineSyncService } from './offline-sync.service';
import { purgeLegacyMatchCaches } from './legacy-match-cache';

export interface MatchScoreState {
  teamPoints: number;
  opponentPoints: number;
  teamSets: number;
  opponentSets: number;
  currentSet: number;
  servingTeam: PointWinner;
  isMatchOver: boolean;
  isSetBreak: boolean;
  teamTimeoutsRemaining: number;
  opponentTimeoutsRemaining: number;
  teamRotation: number;
}

type PointWinner = 'team' | 'opponent';
export interface PointResult {
  sideOut: boolean;
  setEnded: boolean;
  matchEnded: boolean;
}

@Injectable({
  providedIn: 'root',
})
export class MatchStateService {
  private static readonly STORAGE_KEY = 'spike-match-state-v2';
  private readonly setsToWin = 3;
  private readonly standardSetPoints = 25;
  private readonly decidingSetPoints = 15;
  private readonly timeoutsPerSet = 2;

  private readonly historySignal = signal<MatchScoreState[]>([]);
  private readonly stateSignal = signal<MatchScoreState>(this.createInitialState());

  readonly state = computed(() => this.stateSignal());

  constructor(
    @Optional() private readonly auth?: AuthService,
    @Optional() private readonly offlineSync?: OfflineSyncService,
  ) {
    purgeLegacyMatchCaches();
    this.restore();
  }

  setServingTeam(servingTeam: PointWinner, recordHistory = false): void {
    if (this.stateSignal().isSetBreak) {
      return;
    }
    if (recordHistory && servingTeam !== this.stateSignal().servingTeam) {
      this.historySignal.update((history) => [...history, this.stateSignal()]);
    }
    this.stateSignal.update((state) => ({
      ...state,
      servingTeam,
    }));
    this.persist();
  }

  recordTeamPoint(): PointResult {
    return this.recordPoint('team');
  }

  recordOpponentPoint(): PointResult {
    return this.recordPoint('opponent');
  }

  callTimeout(team: PointWinner): boolean {
    const current = this.stateSignal();
    if (current.isMatchOver || current.isSetBreak) {
      return false;
    }

    if (team === 'team' && current.teamTimeoutsRemaining <= 0) {
      return false;
    }
    if (team === 'opponent' && current.opponentTimeoutsRemaining <= 0) {
      return false;
    }

    this.historySignal.update((history) => [...history, current]);
    this.stateSignal.set({
      ...current,
      teamTimeoutsRemaining: team === 'team' ? current.teamTimeoutsRemaining - 1 : current.teamTimeoutsRemaining,
      opponentTimeoutsRemaining:
        team === 'opponent' ? current.opponentTimeoutsRemaining - 1 : current.opponentTimeoutsRemaining,
    });
    this.persist();
    return true;
  }

  rotateTeam(): boolean {
    const current = this.stateSignal();
    if (current.isMatchOver || current.isSetBreak) {
      return false;
    }

    this.historySignal.update((history) => [...history, current]);
    this.stateSignal.set({
      ...current,
      teamRotation: this.incrementRotation(current.teamRotation),
    });
    this.persist();
    return true;
  }

  setTeamRotation(teamRotation: number): boolean {
    const current = this.stateSignal();
    const normalized = this.normalizeRotation(teamRotation);
    if (current.isMatchOver || normalized === current.teamRotation) {
      return false;
    }
    this.historySignal.update((history) => [...history, current]);
    this.stateSignal.set({ ...current, teamRotation: normalized });
    this.persist();
    return true;
  }

  undoLastPoint(): void {
    const history = this.historySignal();
    if (history.length === 0) {
      return;
    }

    const previous = history[history.length - 1];
    this.historySignal.set(history.slice(0, history.length - 1));
    this.stateSignal.set(previous);
    this.persist();
  }

  resetMatch(): void {
    this.historySignal.set([]);
    this.stateSignal.set(this.createInitialState());
    this.persist();
  }

  endMatch(): void {
    const current = this.stateSignal();
    if (current.isMatchOver) {
      return;
    }

    this.stateSignal.set({
      ...current,
      isMatchOver: true,
    });
    this.persist();
  }

  startNextSet(servingTeam: PointWinner): boolean {
    const current = this.stateSignal();
    if (current.isMatchOver || !current.isSetBreak || current.currentSet >= 5) {
      return false;
    }
    this.historySignal.update((history) => [...history, current]);
    this.stateSignal.set({
      ...current,
      currentSet: current.currentSet + 1,
      teamPoints: 0,
      opponentPoints: 0,
      servingTeam,
      teamRotation: 1,
      teamTimeoutsRemaining: this.timeoutsPerSet,
      opponentTimeoutsRemaining: this.timeoutsPerSet,
      isSetBreak: false,
    });
    this.persist();
    return true;
  }

  hydrateState(state: MatchScoreState): void {
    this.historySignal.set([]);
    this.stateSignal.set(this.normalizeState(state));
    this.persist();
  }

  private recordPoint(winner: PointWinner): PointResult {
    const current = this.stateSignal();
    if (current.isMatchOver || current.isSetBreak) {
      return { sideOut: false, setEnded: false, matchEnded: true };
    }

    const sideOut = current.servingTeam !== winner;
    this.historySignal.update((history) => [...history, current]);

    let next: MatchScoreState = {
      ...current,
      teamPoints: current.teamPoints + (winner === 'team' ? 1 : 0),
      opponentPoints: current.opponentPoints + (winner === 'opponent' ? 1 : 0),
      servingTeam: winner,
      teamRotation: winner === 'team' && sideOut ? this.incrementRotation(current.teamRotation) : current.teamRotation,
    };

    let setEnded = false;
    let matchEnded = false;
    if (this.hasSetWinner(next)) {
      setEnded = true;
      const teamWonSet = next.teamPoints > next.opponentPoints;
      next = {
        ...next,
        teamSets: next.teamSets + (teamWonSet ? 1 : 0),
        opponentSets: next.opponentSets + (teamWonSet ? 0 : 1),
        isSetBreak: true,
      };

      if (next.teamSets >= this.setsToWin || next.opponentSets >= this.setsToWin) {
        matchEnded = true;
        next = {
          ...next,
          isMatchOver: true,
          isSetBreak: false,
        };
      }
    }

    this.stateSignal.set(next);
    this.persist();
    return {
      sideOut,
      setEnded,
      matchEnded,
    };
  }

  private persist(): void {
    if (typeof window === 'undefined' || !window.localStorage) {
      return;
    }

    const value = JSON.stringify({ state: this.stateSignal(), history: this.historySignal() });
    if (this.offlineSync) {
      this.offlineSync.saveLocalData(this.ownerKey(), value);
    } else {
      window.localStorage.setItem(this.ownerKey(), value);
    }
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
      const parsed = JSON.parse(raw) as { state: Partial<MatchScoreState>; history: Array<Partial<MatchScoreState>> };
      if (!parsed?.state || !Array.isArray(parsed.history)) {
        return;
      }
      this.stateSignal.set(this.normalizeState(parsed.state));
      this.historySignal.set(parsed.history.map((entry) => this.normalizeState(entry)));
    } catch {
      // Ignore corrupt local state.
    }
  }

  clearOwnerLocalData(): void {
    if (typeof window !== 'undefined' && window.localStorage) {
      window.localStorage.removeItem(this.ownerKey());
    }
    this.historySignal.set([]);
    this.stateSignal.set(this.createInitialState());
  }

  private ownerKey(): string {
    return `${MatchStateService.STORAGE_KEY}:${this.auth?.uid ?? 'signed-out'}`;
  }

  private createInitialState(): MatchScoreState {
    return {
      teamPoints: 0,
      opponentPoints: 0,
      teamSets: 0,
      opponentSets: 0,
      currentSet: 1,
      servingTeam: 'team',
      isMatchOver: false,
      isSetBreak: false,
      teamTimeoutsRemaining: this.timeoutsPerSet,
      opponentTimeoutsRemaining: this.timeoutsPerSet,
      teamRotation: 1,
    };
  }

  private normalizeState(state: Partial<MatchScoreState>): MatchScoreState {
    const defaults = this.createInitialState();
    return {
      teamPoints: this.readWholeNumber(state.teamPoints, defaults.teamPoints),
      opponentPoints: this.readWholeNumber(state.opponentPoints, defaults.opponentPoints),
      teamSets: this.readWholeNumber(state.teamSets, defaults.teamSets),
      opponentSets: this.readWholeNumber(state.opponentSets, defaults.opponentSets),
      currentSet: Math.max(1, this.readWholeNumber(state.currentSet, defaults.currentSet)),
      servingTeam: this.isPointWinner(state.servingTeam) ? state.servingTeam : defaults.servingTeam,
      isMatchOver: state.isMatchOver === true,
      isSetBreak: state.isSetBreak === true,
      teamTimeoutsRemaining: this.readTimeoutCount(state.teamTimeoutsRemaining),
      opponentTimeoutsRemaining: this.readTimeoutCount(state.opponentTimeoutsRemaining),
      teamRotation: this.normalizeRotation(state.teamRotation),
    };
  }

  private readWholeNumber(value: unknown, fallback: number): number {
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
      return fallback;
    }
    return Math.floor(value);
  }

  private readTimeoutCount(value: unknown): number {
    const count = this.readWholeNumber(value, this.timeoutsPerSet);
    return Math.min(this.timeoutsPerSet, count);
  }

  private normalizeRotation(value: unknown): number {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      return 1;
    }
    const floored = Math.floor(value);
    return ((floored - 1) % 6 + 6) % 6 + 1;
  }

  private isPointWinner(value: unknown): value is PointWinner {
    return value === 'team' || value === 'opponent';
  }

  private incrementRotation(rotation: number): number {
    return rotation >= 6 ? 1 : rotation + 1;
  }

  private hasSetWinner(state: MatchScoreState): boolean {
    const target = state.currentSet === 5 ? this.decidingSetPoints : this.standardSetPoints;
    const maxScore = Math.max(state.teamPoints, state.opponentPoints);
    const scoreGap = Math.abs(state.teamPoints - state.opponentPoints);
    return maxScore >= target && scoreGap >= 2;
  }
}
