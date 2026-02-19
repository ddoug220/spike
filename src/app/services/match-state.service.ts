import { Injectable, computed, signal } from '@angular/core';

export interface MatchScoreState {
  teamPoints: number;
  opponentPoints: number;
  teamSets: number;
  opponentSets: number;
  currentSet: number;
  servingTeam: PointWinner;
  isMatchOver: boolean;
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
  private static readonly STORAGE_KEY = 'spike-match-state-v1';
  private readonly setsToWin = 3;
  private readonly standardSetPoints = 25;
  private readonly decidingSetPoints = 15;

  private readonly historySignal = signal<MatchScoreState[]>([]);
  private readonly stateSignal = signal<MatchScoreState>({
    teamPoints: 0,
    opponentPoints: 0,
    teamSets: 0,
    opponentSets: 0,
    currentSet: 1,
    servingTeam: 'team',
    isMatchOver: false,
  });

  readonly state = computed(() => this.stateSignal());

  constructor() {
    this.restore();
  }

  setServingTeam(servingTeam: PointWinner): void {
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
    this.stateSignal.set({
      teamPoints: 0,
      opponentPoints: 0,
      teamSets: 0,
      opponentSets: 0,
      currentSet: 1,
      servingTeam: 'team',
      isMatchOver: false,
    });
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

  private recordPoint(winner: PointWinner): PointResult {
    const current = this.stateSignal();
    if (current.isMatchOver) {
      return { sideOut: false, setEnded: false, matchEnded: true };
    }

    const sideOut = current.servingTeam !== winner;
    this.historySignal.update((history) => [...history, current]);

    let next: MatchScoreState = {
      ...current,
      teamPoints: current.teamPoints + (winner === 'team' ? 1 : 0),
      opponentPoints: current.opponentPoints + (winner === 'opponent' ? 1 : 0),
      servingTeam: winner,
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
        teamPoints: 0,
        opponentPoints: 0,
        currentSet: next.currentSet + 1,
      };

      if (next.teamSets >= this.setsToWin || next.opponentSets >= this.setsToWin) {
        matchEnded = true;
        next = {
          ...next,
          isMatchOver: true,
          currentSet: Math.min(next.currentSet - 1, 5),
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

    window.localStorage.setItem(
      MatchStateService.STORAGE_KEY,
      JSON.stringify({
        state: this.stateSignal(),
        history: this.historySignal(),
      }),
    );
  }

  private restore(): void {
    if (typeof window === 'undefined' || !window.localStorage) {
      return;
    }

    const raw = window.localStorage.getItem(MatchStateService.STORAGE_KEY);
    if (!raw) {
      return;
    }

    try {
      const parsed = JSON.parse(raw) as { state: MatchScoreState; history: MatchScoreState[] };
      if (!parsed?.state || !Array.isArray(parsed.history)) {
        return;
      }
      this.stateSignal.set(parsed.state);
      this.historySignal.set(parsed.history);
    } catch {
      // Ignore corrupt local state.
    }
  }

  private hasSetWinner(state: MatchScoreState): boolean {
    const target = state.currentSet === 5 ? this.decidingSetPoints : this.standardSetPoints;
    const maxScore = Math.max(state.teamPoints, state.opponentPoints);
    const scoreGap = Math.abs(state.teamPoints - state.opponentPoints);
    return maxScore >= target && scoreGap >= 2;
  }
}
