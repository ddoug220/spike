import { DatePipe, NgClass, NgFor, NgIf, TitleCasePipe } from '@angular/common';
import { Component } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import {
  IonActionSheet,
  IonButton,
  IonContent,
  IonHeader,
  IonIcon,
  IonTitle,
  IonToolbar,
} from '@ionic/angular/standalone';
import { addIcons } from 'ionicons';
import { addCircle, arrowUndo, baseball, closeCircle, flash, handLeft, playForward } from 'ionicons/icons';
import { MatchEngineService } from '../../services/match-engine.service';
import { MatchStateService } from '../../services/match-state.service';
import { MatchStatsService, StatsAction } from '../../services/match-stats.service';
import { OfflineSyncService } from '../../services/offline-sync.service';
import { RosterPlayer, TeamRosterService } from '../../services/team-roster.service';

type QuickAction = StatsAction;
type EventProfile = 'simple' | 'standard' | 'advanced';
type StandardOutcomeAction = 'kill' | 'attack-error' | 'block' | 'opponent-point';
type SurfaceMode = 'live' | 'review';
type PlayerListFilter = 'all' | 'starters' | 'bench';
type AnalyticsTabId = 'efficiency' | 'rotation' | 'serve-receive' | 'errors' | 'sets';
type ExitAction = 'home' | 'lineup' | 'history' | 'end-home';
type MatchEvent =
  | { kind: 'player-action'; playerId: number; action: QuickAction; impactedScore: boolean; impactedStats: boolean }
  | { kind: 'opponent-point'; impactedScore: true; impactedStats: boolean }
  | { kind: 'manual-rotation'; impactedScore: false; impactedStats: false }
  | { kind: 'timeout'; team: 'team' | 'opponent'; impactedScore: false; impactedStats: false };

interface PlayerPosition {
  id: number;
  label: string;
  top: string;
  left: string;
}

interface BoxScoreRow {
  player: RosterPlayer;
  kills: number;
  attackErrors: number;
  totalAttacks: number;
  hittingEfficiency: number | null;
  sideOutPercentage: number | null;
  serveAttempts: number;
  serveInPercentage: number | null;
}

interface ActionMeta {
  label: string;
  icon: string;
  accent: string;
  minProfile: EventProfile;
}

interface PrimaryActionGroup {
  id: string;
  label: string;
  icon: string;
  actionIds: QuickAction[];
}

interface StandardOutcomeMeta {
  id: StandardOutcomeAction;
  label: string;
  icon: string;
  accent: string;
}

interface LiveEventRow {
  id: string;
  createdAt: string;
  label: string;
}

interface ReviewPlayerRow {
  id: string;
  name: string;
  jerseyNumber: number;
  primaryPosition: string;
  kills: number;
  attackErrors: number;
  efficiency: number | null;
  efficiencyText: string;
  efficiencyRating: string;
  sideOutConversions: number;
  sideOutOpportunities: number;
  isStarter: boolean;
}

interface ReviewBarDatum {
  label: string;
  detail: string;
  value: number;
  width: number;
  displayValue: string;
}

interface SetBreakdownRow {
  setNumber: number;
  kills: number;
  attackErrors: number;
  totalAttacks: number;
  efficiency: number | null;
}

@Component({
  selector: 'app-court',
  templateUrl: './court.page.html',
  styleUrls: ['./court.page.scss'],
  standalone: true,
  imports: [
    IonHeader,
    IonToolbar,
    IonTitle,
    IonContent,
    IonButton,
    NgFor,
    NgClass,
    NgIf,
    TitleCasePipe,
    DatePipe,
    IonIcon,
    FormsModule,
    IonActionSheet,
  ],
})
export class CourtPage {
  public activePlayer = 1;
  public lastEvent?: MatchEvent;
  public selectedProfile: EventProfile = 'standard';
  public activePrimaryGroupId = 'attack';
  public isSubMode = false;
  public substitutionOutPlayerId: string | null = null;
  public substitutionInPlayerId: string | null = null;
  public substitutionStatus = '';
  public showAdvancedControls = false;
  public activeSurfaceMode: SurfaceMode = 'live';
  public playerListFilter: PlayerListFilter = 'all';
  public playerSearchQuery = '';
  public activeAnalyticsTab: AnalyticsTabId = 'efficiency';
  public reviewLoadMs = 0;
  public isExitSheetOpen = false;

  public readonly analyticsTabs: Array<{ id: AnalyticsTabId; label: string }> = [
    { id: 'efficiency', label: 'Efficiency' },
    { id: 'rotation', label: 'Rotation Performance' },
    { id: 'serve-receive', label: 'Serve Receive' },
    { id: 'errors', label: 'Error Breakdown' },
    { id: 'sets', label: 'Set Breakdown' },
  ];

  public readonly actionMeta: Record<QuickAction, ActionMeta> = {
    kill: { label: '+ Kill', icon: 'flash', accent: 'action-kill', minProfile: 'simple' },
    'attack-error': {
      label: '\u2212 Att Error',
      icon: 'close-circle',
      accent: 'action-error',
      minProfile: 'simple',
    },
    ace: { label: '+ Ace', icon: 'baseball', accent: 'action-ace', minProfile: 'simple' },
    'service-error': {
      label: '\u2212 Svc Error',
      icon: 'close-circle',
      accent: 'action-error',
      minProfile: 'standard',
    },
    block: { label: '+ Block', icon: 'hand-left', accent: 'action-block', minProfile: 'standard' },
    dig: { label: 'Dig', icon: 'baseball', accent: 'action-dig', minProfile: 'standard' },
    'opponent-error': {
      label: '+ Opp Error',
      icon: 'close-circle',
      accent: 'action-opponent-error',
      minProfile: 'simple',
    },
  };

  public readonly primaryActionGroups: PrimaryActionGroup[] = [
    { id: 'attack', label: 'Attack', icon: 'flash', actionIds: ['kill', 'attack-error', 'block'] },
    { id: 'serve', label: 'Serve', icon: 'baseball', actionIds: ['ace', 'service-error'] },
    { id: 'rally', label: 'Rally', icon: 'close-circle', actionIds: ['opponent-error', 'dig'] },
  ];

  public readonly playerPositions: PlayerPosition[] = [
    { id: 4, label: 'LF', top: '24%', left: '18%' },
    { id: 3, label: 'MF', top: '24%', left: '50%' },
    { id: 2, label: 'RF', top: '24%', left: '82%' },
    { id: 5, label: 'LB', top: '76%', left: '18%' },
    { id: 6, label: 'MB', top: '76%', left: '50%' },
    { id: 1, label: 'RB', top: '76%', left: '82%' },
  ];

  constructor(
    public readonly teamRoster: TeamRosterService,
    public readonly matchState: MatchStateService,
    public readonly matchStats: MatchStatsService,
    public readonly offlineSync: OfflineSyncService,
    private readonly matchEngine: MatchEngineService,
    private readonly router: Router,
  ) {
    addIcons({'arrowUndo':arrowUndo,flash,'closeCircle':closeCircle,baseball,'handLeft':handLeft,'addCircle':addCircle,'playForward':playForward,});
  }

  get exitSheetSubHeader(): string {
    if (this.isMatchOver) {
      return 'Match is final. Choose where to go next.';
    }

    return 'Match stays live unless you choose End Match.';
  }

  get exitSheetButtons(): Array<{ text: string; role?: 'cancel' | 'destructive'; data?: { action: ExitAction } }> {
    const buttons: Array<{ text: string; role?: 'cancel' | 'destructive'; data?: { action: ExitAction } }> = [
      {
        text: 'Go Home',
        data: { action: 'home' },
      },
      {
        text: 'Lineup Selection',
        data: { action: 'lineup' },
      },
      {
        text: 'Match History',
        data: { action: 'history' },
      },
      {
        text: 'Cancel',
        role: 'cancel',
      },
    ];

    if (!this.isMatchOver) {
      buttons.splice(3, 0, {
        text: 'End Match + Go Home',
        role: 'destructive',
        data: { action: 'end-home' },
      });
    }

    return buttons;
  }

  openExitSheet(): void {
    this.isExitSheetOpen = true;
  }

  handleExitSheetDismiss(event: Event): void {
    this.isExitSheetOpen = false;
    const detail = (event as CustomEvent<{ role?: string; data?: { action?: ExitAction } }>).detail;
    if (detail?.role === 'cancel') {
      return;
    }

    const action = detail?.data?.action;
    if (!action) {
      return;
    }

    void this.navigateFromExitSheet(action);
  }

  handleCourtPlayerTap(playerId: number): void {
    if (!this.isSubMode) {
      this.activePlayer = playerId;
      return;
    }

    const player = this.getPlayerForPosition(playerId);
    if (!player) {
      return;
    }

    this.substitutionOutPlayerId = player.id;
    if (this.substitutionInPlayerId === player.id) {
      this.substitutionInPlayerId = null;
    }
  }

  handleBenchPlayerTap(playerId: string): void {
    if (!this.isSubMode) {
      return;
    }

    this.substitutionInPlayerId = playerId;
  }

  startNewMatch(): void {
    const confirmed =
      typeof window === 'undefined' ? true : window.confirm('Start a new match? Current in-progress stats will reset.');
    if (!confirmed) {
      return;
    }

    this.matchEngine.startMatch(this.matchState.state().servingTeam);
    this.lastEvent = undefined;
    this.substitutionStatus = '';
    this.isSubMode = false;
    this.resetSubSelection();
    this.refreshReviewLoadMetricIfVisible();
  }

  endMatch(): void {
    this.matchEngine.endMatch();
    this.refreshReviewLoadMetricIfVisible();
  }

  recordAction(action: QuickAction): void {
    if (this.isMatchOver) {
      return;
    }

    const event = this.matchEngine.recordPlayerAction(this.activePlayer, action);
    this.lastEvent = {
      kind: 'player-action',
      playerId: this.activePlayer,
      action,
      impactedScore: event.impactedScore,
      impactedStats: event.impactedStats,
    };
    this.refreshReviewLoadMetricIfVisible();
  }

  recordOpponentPoint(): void {
    if (this.isMatchOver) {
      return;
    }

    const event = this.matchEngine.recordOpponentPoint();
    this.lastEvent = {
      kind: 'opponent-point',
      impactedScore: true,
      impactedStats: event.impactedStats,
    };
    this.refreshReviewLoadMetricIfVisible();
  }

  undoLastAction(): void {
    if (this.isMatchOver) {
      return;
    }

    this.matchEngine.undoLastEvent();
    this.lastEvent = undefined;
    this.refreshReviewLoadMetricIfVisible();
  }

  getPlayerForPosition(position: number): RosterPlayer | null {
    const playerId = this.teamRoster.lineup()[position - 1] ?? null;
    return this.teamRoster.getPlayerById(playerId);
  }

  isFrontRow(position: number): boolean {
    return position === 2 || position === 3 || position === 4;
  }

  getServeIndicatorClass(): string {
    return this.matchState.state().servingTeam === 'team' ? 'serve-team' : 'serve-opponent';
  }

  getPlayerDisplayHeader(position: number): string {
    const player = this.getPlayerForPosition(position);
    if (!player) {
      return `[${position}] Open`;
    }
    return `[${player.primaryPosition}] #${player.jerseyNumber}`;
  }

  getSelectedPlayerSetLine(position: number): string {
    if (position !== this.activePlayer) {
      return '';
    }
    const player = this.getPlayerForPosition(position);
    if (!player) {
      return '';
    }
    const setStats = this.matchStats.getPlayerSetStats(player.id, this.matchState.state().currentSet);
    return `K ${setStats.kills} | E ${setStats.attackErrors}`;
  }

  getSelectedPlayerText(): string {
    const selectedPlayer = this.getPlayerForPosition(this.activePlayer);
    if (!selectedPlayer) {
      return `P${this.activePlayer}`;
    }

    return `P${this.activePlayer}: ${selectedPlayer.name}`;
  }

  getLastEventText(): string {
    if (!this.lastEvent) {
      return 'No actions yet';
    }

    if (this.lastEvent.kind === 'opponent-point') {
      return 'Last: Opponent Point';
    }
    if (this.lastEvent.kind === 'manual-rotation') {
      return 'Last: Manual Rotation';
    }
    if (this.lastEvent.kind === 'timeout') {
      return `Last: ${this.lastEvent.team === 'team' ? 'Our' : 'Opponent'} Timeout`;
    }

    return `Last: Player #${this.lastEvent.playerId} - ${this.getActionLabel(this.lastEvent.action)}`;
  }

  setServingTeam(team: 'team' | 'opponent'): void {
    if (this.isMatchOver) {
      return;
    }

    this.matchEngine.setServingTeam(team);
    this.refreshReviewLoadMetricIfVisible();
  }

  callTimeout(team: 'team' | 'opponent'): void {
    if (this.isMatchOver) {
      return;
    }

    const didCallTimeout = this.matchEngine.recordTimeout(team);
    if (!didCallTimeout) {
      return;
    }

    this.lastEvent = {
      kind: 'timeout',
      team,
      impactedScore: false,
      impactedStats: false,
    };
    this.refreshReviewLoadMetricIfVisible();
  }

  manualRotate(): void {
    if (this.isMatchOver) {
      return;
    }

    const didRotate = this.matchEngine.manualRotateTeam();
    if (!didRotate) {
      return;
    }

    this.lastEvent = {
      kind: 'manual-rotation',
      impactedScore: false,
      impactedStats: false,
    };
    this.refreshReviewLoadMetricIfVisible();
  }

  setProfile(profile: EventProfile): void {
    if (this.isMatchOver) {
      return;
    }

    this.selectedProfile = profile;
  }

  setPrimaryGroup(groupId: string): void {
    this.activePrimaryGroupId = this.activePrimaryGroupId === groupId ? '' : groupId;
  }

  setSurfaceMode(mode: SurfaceMode): void {
    if (this.activeSurfaceMode === mode) {
      return;
    }

    this.activeSurfaceMode = mode;
    if (mode === 'review') {
      this.measureReviewSurfaceLoad();
    }
  }

  setPlayerListFilter(filter: PlayerListFilter): void {
    this.playerListFilter = filter;
  }

  setAnalyticsTab(tabId: AnalyticsTabId): void {
    this.activeAnalyticsTab = tabId;
  }

  toggleAdvancedControls(): void {
    this.showAdvancedControls = !this.showAdvancedControls;
  }

  get isStandardMode(): boolean {
    return this.selectedProfile === 'standard';
  }

  get standardOutcomeActions(): StandardOutcomeMeta[] {
    return [
      {
        id: 'kill',
        label: this.actionMeta.kill.label,
        icon: this.actionMeta.kill.icon,
        accent: this.actionMeta.kill.accent,
      },
      {
        id: 'attack-error',
        label: this.actionMeta['attack-error'].label,
        icon: this.actionMeta['attack-error'].icon,
        accent: this.actionMeta['attack-error'].accent,
      },
      {
        id: 'block',
        label: this.actionMeta.block.label,
        icon: this.actionMeta.block.icon,
        accent: this.actionMeta.block.accent,
      },
      {
        id: 'opponent-point',
        label: '\u2212 Opp Point',
        icon: 'add-circle',
        accent: 'action-opponent-point',
      },
    ];
  }

  recordStandardOutcome(action: StandardOutcomeAction): void {
    if (action === 'opponent-point') {
      this.recordOpponentPoint();
      return;
    }

    this.recordAction(action);
  }

  get visibleContextActions(): Array<{ id: QuickAction; label: string; icon: string; accent: string }> {
    const group = this.primaryActionGroups.find((item) => item.id === this.activePrimaryGroupId);
    if (!group) {
      return [];
    }

    return group.actionIds
      .filter((actionId) => this.isActionVisible(actionId))
      .map((actionId) => ({
        id: actionId,
        label: this.actionMeta[actionId].label,
        icon: this.actionMeta[actionId].icon,
        accent: this.actionMeta[actionId].accent,
      }));
  }

  get visiblePrimaryGroups(): PrimaryActionGroup[] {
    return this.primaryActionGroups.filter((group) =>
      group.actionIds.some((actionId) => this.isActionVisible(actionId)),
    );
  }

  get onCourtPlayers(): RosterPlayer[] {
    return this.teamRoster.getOnCourtPlayers();
  }

  get benchPlayers(): RosterPlayer[] {
    return this.teamRoster.getBenchPlayers();
  }

  toggleSubMode(): void {
    if (this.isMatchOver) {
      return;
    }

    this.isSubMode = !this.isSubMode;
    if (this.isSubMode) {
      this.substitutionStatus = 'Sub Mode active: tap OUT on court, then IN from bench.';
      return;
    }

    this.resetSubSelection();
    this.refreshReviewLoadMetricIfVisible();
  }

  confirmSubstitution(): void {
    if (this.isMatchOver) {
      return;
    }

    if (!this.isSubstitutionReady) {
      return;
    }

    const outId = this.substitutionOutPlayerId as string;
    const inId = this.substitutionInPlayerId as string;
    const didSubstitute = this.matchEngine.recordSubstitution(outId, inId);
    if (!didSubstitute) {
      this.substitutionStatus = 'Substitution could not be applied.';
      return;
    }

    const inPlayer = this.teamRoster.getPlayerById(inId);
    const outPlayer = this.teamRoster.getPlayerById(outId);
    this.substitutionStatus = `Substituted: ${inPlayer?.name ?? 'Player'} in for ${outPlayer?.name ?? 'player'}.`;
    this.isSubMode = false;
    this.resetSubSelection();
    this.refreshReviewLoadMetricIfVisible();
  }

  cancelSubstitution(): void {
    this.substitutionStatus = 'Substitution cancelled.';
    this.isSubMode = false;
    this.resetSubSelection();
  }

  isSelectedOutPlayer(position: number): boolean {
    const player = this.getPlayerForPosition(position);
    return !!player && player.id === this.substitutionOutPlayerId;
  }

  isSelectedInBenchPlayer(playerId: string): boolean {
    return this.substitutionInPlayerId === playerId;
  }

  get selectedOutPlayer(): RosterPlayer | null {
    return this.teamRoster.getPlayerById(this.substitutionOutPlayerId);
  }

  get selectedInPlayer(): RosterPlayer | null {
    return this.teamRoster.getPlayerById(this.substitutionInPlayerId);
  }

  get isSubstitutionReady(): boolean {
    return !!this.substitutionOutPlayerId && !!this.substitutionInPlayerId;
  }

  get isMatchOver(): boolean {
    return this.matchState.state().isMatchOver;
  }

  get rotationIndicatorText(): string {
    const rotation = this.matchState.state().teamRotation;
    const server = this.getPlayerForPosition(1);
    const serverText = server ? `#${server.jerseyNumber}` : 'P1 Open';
    return `R${rotation} ${serverText}`;
  }

  get timeoutIndicatorText(): string {
    const state = this.matchState.state();
    return `${state.teamTimeoutsRemaining} / ${state.opponentTimeoutsRemaining}`;
  }

  get servePossessionText(): string {
    return this.matchState.state().servingTeam === 'team' ? 'Home' : 'Away';
  }

  get teamSetKills(): number {
    const currentSet = this.matchState.state().currentSet;
    return this.teamRoster
      .players()
      .reduce((total, player) => total + this.matchStats.getPlayerSetStats(player.id, currentSet).kills, 0);
  }

  get teamSetAttackErrors(): number {
    const currentSet = this.matchState.state().currentSet;
    return this.teamRoster
      .players()
      .reduce((total, player) => total + this.matchStats.getPlayerSetStats(player.id, currentSet).attackErrors, 0);
  }

  get teamSideOutRate(): number | null {
    const totals = this.teamRoster.players().reduce(
      (acc, player) => {
        const stats = this.matchStats.getPlayerStats(player.id);
        return {
          opportunities: acc.opportunities + stats.sideOutOpportunities,
          conversions: acc.conversions + stats.sideOutConversions,
        };
      },
      { opportunities: 0, conversions: 0 },
    );
    if (totals.opportunities === 0) {
      return null;
    }
    return totals.conversions / totals.opportunities;
  }

  get recentEvents(): LiveEventRow[] {
    const matchId = this.offlineSync.getActiveMatchId();
    const events = this.offlineSync.getMatchEvents(matchId);
    return events
      .slice(-8)
      .reverse()
      .map((event) => ({
        id:
          this.readString(event['id']) ??
          `${this.readString(event['event_type']) ?? 'event'}-${this.readString(event['created_at']) ?? ''}`,
        createdAt: this.readString(event['created_at']) ?? '',
        label: this.describeEvent(event),
      }));
  }

  get syncStatusText(): string {
    if (this.offlineSync.isSyncing()) {
      return 'Syncing...';
    }
    if (this.offlineSync.pendingCount() > 0) {
      return 'Pending sync';
    }
    return 'All changes synced';
  }

  get lastSyncText(): string {
    const lastSyncAt = this.offlineSync.lastSuccessfulSyncAt();
    if (!lastSyncAt) {
      return 'No successful sync yet';
    }
    const date = new Date(lastSyncAt);
    return Number.isNaN(date.getTime()) ? 'No successful sync yet' : `Last successful sync: ${date.toLocaleString()}`;
  }

  retrySync(): void {
    void this.offlineSync.retryNow();
  }

  private async navigateFromExitSheet(action: ExitAction): Promise<void> {
    if (action === 'end-home') {
      const confirmed =
        typeof window === 'undefined'
          ? true
          : window.confirm('End this match and return home? You can still review it in match history.');
      if (!confirmed) {
        return;
      }

      this.matchEngine.endMatch();
      await this.router.navigate(['/home']);
      return;
    }

    if (action === 'home') {
      await this.router.navigate(['/home']);
      return;
    }

    if (action === 'lineup') {
      await this.router.navigate(['/pre-match']);
      return;
    }

    await this.router.navigate(['/history']);
  }

  private resetSubSelection(): void {
    this.substitutionOutPlayerId = null;
    this.substitutionInPlayerId = null;
  }

  get boxScoreRows(): BoxScoreRow[] {
    return this.teamRoster
      .players()
      .slice()
      .sort((a, b) => a.jerseyNumber - b.jerseyNumber)
      .map((player) => {
        const stats = this.matchStats.getPlayerStats(player.id);
        return {
          player,
          kills: stats.kills,
          attackErrors: stats.attackErrors,
          totalAttacks: stats.totalAttacks,
          hittingEfficiency: this.matchStats.getHittingEfficiency(player.id),
          sideOutPercentage: this.matchStats.getSideOutPercentage(player.id),
          serveAttempts: stats.serveAttempts,
          serveInPercentage: this.matchStats.getServeInPercentage(player.id),
        };
      });
  }

  get reviewPlayers(): ReviewPlayerRow[] {
    const starters = new Set(this.onCourtPlayers.map((player) => player.id));
    return this.boxScoreRows.map((row) => {
      const sideOutStats = this.matchStats.getPlayerStats(row.player.id);
      return {
        id: row.player.id,
        name: row.player.name,
        jerseyNumber: row.player.jerseyNumber,
        primaryPosition: row.player.primaryPosition,
        kills: row.kills,
        attackErrors: row.attackErrors,
        efficiency: row.hittingEfficiency,
        efficiencyText: this.formatEfficiencyDecimal(row.hittingEfficiency),
        efficiencyRating: this.getEfficiencyRating(row.hittingEfficiency),
        sideOutConversions: sideOutStats.sideOutConversions,
        sideOutOpportunities: sideOutStats.sideOutOpportunities,
        isStarter: starters.has(row.player.id),
      };
    });
  }

  get filteredReviewPlayers(): ReviewPlayerRow[] {
    const query = this.playerSearchQuery.trim().toLowerCase();
    return this.reviewPlayers.filter((player) => {
      if (this.playerListFilter === 'starters' && !player.isStarter) {
        return false;
      }
      if (this.playerListFilter === 'bench' && player.isStarter) {
        return false;
      }
      if (!query) {
        return true;
      }

      return (
        player.name.toLowerCase().includes(query) ||
        `${player.jerseyNumber}`.includes(query) ||
        player.primaryPosition.toLowerCase().includes(query)
      );
    });
  }

  get efficiencyChartBars(): ReviewBarDatum[] {
    const source = this.reviewPlayers
      .slice()
      .sort((a, b) => (b.efficiency ?? Number.NEGATIVE_INFINITY) - (a.efficiency ?? Number.NEGATIVE_INFINITY));
    return this.toBarData(
      source.map((player) => ({
        label: `#${player.jerseyNumber} ${player.name}`,
        detail: `${player.kills}K ${player.attackErrors}E`,
        value: player.efficiency === null ? 0 : Math.max(0, player.efficiency * 100),
        displayValue: player.efficiencyText,
      })),
    );
  }

  get rotationPerformanceBars(): ReviewBarDatum[] {
    const byRotation = new Map<number, { wins: number; errors: number }>();
    for (let position = 1; position <= 6; position += 1) {
      byRotation.set(position, { wins: 0, errors: 0 });
    }

    this.getActiveMatchEvents().forEach((event) => {
      if (this.readString(event['event_type']) !== 'player_action') {
        return;
      }
      const action = this.readString(event['action']);
      const rotationPosition = this.readNumber(event['rotation_position']);
      if (!action || !rotationPosition || !byRotation.has(rotationPosition)) {
        return;
      }

      const bucket = byRotation.get(rotationPosition);
      if (!bucket) {
        return;
      }

      if (action === 'kill' || action === 'ace' || action === 'block' || action === 'opponent-error') {
        bucket.wins += 1;
      }
      if (action === 'attack-error' || action === 'service-error') {
        bucket.errors += 1;
      }
    });

    return this.toBarData(
      Array.from(byRotation.entries()).map(([position, totals]) => {
        const attempts = totals.wins + totals.errors;
        const ratio = attempts === 0 ? 0 : (totals.wins / attempts) * 100;
        return {
          label: `Rotation P${position}`,
          detail: `${totals.wins} won | ${totals.errors} errors`,
          value: ratio,
          displayValue: attempts === 0 ? '--' : `${ratio.toFixed(0)}%`,
        };
      }),
    );
  }

  get serveReceiveBars(): ReviewBarDatum[] {
    return this.toBarData(
      this.reviewPlayers.map((player) => {
        const value =
          player.sideOutOpportunities === 0 ? 0 : (player.sideOutConversions / player.sideOutOpportunities) * 100;
        return {
          label: `#${player.jerseyNumber} ${player.name}`,
          detail: `${player.sideOutConversions}/${player.sideOutOpportunities} side-outs`,
          value,
          displayValue: player.sideOutOpportunities === 0 ? '--' : `${value.toFixed(0)}%`,
        };
      }),
    );
  }

  get errorBreakdownBars(): ReviewBarDatum[] {
    const totals = this.teamRoster.players().reduce(
      (acc, player) => {
        const stats = this.matchStats.getPlayerStats(player.id);
        return {
          attackErrors: acc.attackErrors + stats.attackErrors,
          serviceErrors: acc.serviceErrors + stats.serviceErrors,
        };
      },
      {
        attackErrors: 0,
        serviceErrors: 0,
      },
    );
    const opponentPoints = this.getActiveMatchEvents().filter(
      (event) => this.readString(event['event_type']) === 'opponent_point',
    ).length;

    return this.toBarData([
      {
        label: 'Attack Errors',
        detail: 'Missed attack outcomes',
        value: totals.attackErrors,
        displayValue: `${totals.attackErrors}`,
      },
      {
        label: 'Service Errors',
        detail: 'Missed serves',
        value: totals.serviceErrors,
        displayValue: `${totals.serviceErrors}`,
      },
      {
        label: 'Opponent Point Events',
        detail: 'Logged opponent points',
        value: opponentPoints,
        displayValue: `${opponentPoints}`,
      },
    ]);
  }

  get setBreakdownRows(): SetBreakdownRow[] {
    const maxSet = Math.max(1, this.matchState.state().currentSet);
    const players = this.teamRoster.players();
    const rows: SetBreakdownRow[] = [];
    for (let setNumber = 1; setNumber <= maxSet; setNumber += 1) {
      const totals = players.reduce(
        (acc, player) => {
          const setStats = this.matchStats.getPlayerSetStats(player.id, setNumber);
          return {
            kills: acc.kills + setStats.kills,
            attackErrors: acc.attackErrors + setStats.attackErrors,
            totalAttacks: acc.totalAttacks + setStats.totalAttacks,
          };
        },
        {
          kills: 0,
          attackErrors: 0,
          totalAttacks: 0,
        },
      );

      rows.push({
        setNumber,
        kills: totals.kills,
        attackErrors: totals.attackErrors,
        totalAttacks: totals.totalAttacks,
        efficiency:
          totals.totalAttacks === 0 ? null : (totals.kills - totals.attackErrors) / totals.totalAttacks,
      });
    }
    return rows;
  }

  get setKillsLinePoints(): string {
    return this.toLinePoints(this.setBreakdownRows.map((row) => row.kills));
  }

  get setErrorsLinePoints(): string {
    return this.toLinePoints(this.setBreakdownRows.map((row) => row.attackErrors));
  }

  get setChartHasData(): boolean {
    return this.setBreakdownRows.some((row) => row.kills > 0 || row.attackErrors > 0);
  }

  get reviewLoadTargetHit(): boolean {
    return this.reviewLoadMs <= 500;
  }

  formatRate(value: number | null): string {
    if (value === null) {
      return '--';
    }

    return `${(value * 100).toFixed(1)}%`;
  }

  formatEfficiencyValue(value: number | null): string {
    return this.formatEfficiencyDecimal(value);
  }

  private getActionLabel(action: QuickAction): string {
    return this.actionMeta[action]?.label ?? action;
  }

  private isActionVisible(action: QuickAction): boolean {
    const rank: Record<EventProfile, number> = {
      simple: 1,
      standard: 2,
      advanced: 3,
    };

    return rank[this.selectedProfile] >= rank[this.actionMeta[action].minProfile];
  }

  private describeEvent(event: Record<string, unknown>): string {
    const type = this.readString(event['event_type']) ?? 'event';
    if (type === 'player_action') {
      const action = this.readString(event['action']) ?? 'action';
      return `Player: ${this.getActionLabel(action as QuickAction)}`;
    }
    if (type === 'opponent_point') {
      return 'Opponent Point';
    }
    if (type === 'substitution') {
      return 'Substitution';
    }
    if (type === 'serve_team_set') {
      const servingTeam = this.readString(event['serving_team']) ?? 'team';
      return `Serve: ${servingTeam === 'team' ? 'Our Team' : 'Opponent'}`;
    }
    if (type === 'timeout_called') {
      const timeoutTeam = this.readString(event['timeout_team']) ?? 'team';
      return `${timeoutTeam === 'team' ? 'Our' : 'Opponent'} Timeout`;
    }
    if (type === 'manual_rotation') {
      return 'Manual Rotation';
    }
    if (type === 'undo') {
      return 'Undo';
    }
    if (type === 'match_started') {
      return 'Match Started';
    }
    if (type === 'match_ended') {
      return 'Match Ended';
    }
    return 'Event';
  }

  private readString(value: unknown): string | null {
    return typeof value === 'string' ? value : null;
  }

  private readNumber(value: unknown): number | null {
    return typeof value === 'number' ? value : null;
  }

  private formatEfficiencyDecimal(value: number | null): string {
    if (value === null) {
      return '.000';
    }

    const rounded = Math.round(value * 1000) / 1000;
    const fixed = Math.abs(rounded).toFixed(3).replace(/^0/, '');
    return rounded < 0 ? `-${fixed}` : fixed;
  }

  private getEfficiencyRating(value: number | null): string {
    if (value === null) {
      return 'No Attempts';
    }
    if (value >= 0.35) {
      return 'Elite';
    }
    if (value >= 0.25) {
      return 'Strong';
    }
    if (value >= 0.12) {
      return 'Steady';
    }
    if (value >= 0) {
      return 'Developing';
    }
    return 'Needs Reset';
  }

  private getActiveMatchEvents(): Record<string, unknown>[] {
    return this.offlineSync.getMatchEvents(this.offlineSync.getActiveMatchId());
  }

  private toBarData(
    raw: Array<{
      label: string;
      detail: string;
      value: number;
      displayValue: string;
    }>,
  ): ReviewBarDatum[] {
    const maxValue = raw.reduce((peak, item) => Math.max(peak, item.value), 0);
    return raw.map((item) => ({
      ...item,
      width: maxValue === 0 ? 0 : (item.value / maxValue) * 100,
    }));
  }

  private toLinePoints(values: number[]): string {
    if (values.length === 0) {
      return '';
    }

    const max = values.reduce((peak, value) => Math.max(peak, value), 1);
    if (values.length === 1) {
      const y = 100 - (values[0] / max) * 100;
      return `0,${y} 100,${y}`;
    }

    return values
      .map((value, index) => {
        const x = (index / (values.length - 1)) * 100;
        const y = 100 - (value / max) * 100;
        return `${x},${y}`;
      })
      .join(' ');
  }

  private measureReviewSurfaceLoad(): void {
    const start = this.nowMs();
    void this.filteredReviewPlayers;
    void this.efficiencyChartBars;
    void this.rotationPerformanceBars;
    void this.serveReceiveBars;
    void this.errorBreakdownBars;
    void this.setBreakdownRows;
    this.reviewLoadMs = Math.round(this.nowMs() - start);
  }

  private refreshReviewLoadMetricIfVisible(): void {
    if (this.activeSurfaceMode !== 'review') {
      return;
    }

    this.measureReviewSurfaceLoad();
  }

  private nowMs(): number {
    if (typeof performance !== 'undefined' && typeof performance.now === 'function') {
      return performance.now();
    }
    return Date.now();
  }
}
