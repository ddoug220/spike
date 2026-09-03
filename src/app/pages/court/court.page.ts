import { DatePipe, NgClass, NgFor, NgIf } from '@angular/common';
import { Component, HostListener } from '@angular/core';
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
import { addCircle, arrowUndo, baseball, closeCircle, flash, handLeft, playForward, star } from 'ionicons/icons';
import { MatchPlayer, selectTeamSideOut } from '../../domain/match-v2';
import { LiveLastEvent, LiveMatchStoreService } from '../../services/live-match-store.service';
import { MatchEngineService } from '../../services/match-engine.service';
import { MatchScoreState } from '../../services/match-state.service';
import { StatsAction } from '../../services/match-stats.service';
import { OfflineSyncService } from '../../services/offline-sync.service';
import { TeamRosterService } from '../../services/team-roster.service';

type QuickAction = StatsAction;
type StandardOutcomeAction =
  | 'kill'
  | 'attack-error'
  | 'block'
  | 'ace'
  | 'service-error'
  | 'opponent-error'
  | 'opponent-point'
  | 'receive-error';
type StatOnlyAction = 'dig';
type ExitAction = 'home' | 'lineup' | 'history' | 'end-home' | 'new-match';

interface PlayerPosition {
  id: number;
  label: string;
  top: string;
  left: string;
}

interface ActionMeta {
  label: string;
  icon: string;
  accent: string;
}

interface StandardOutcomeMeta {
  id: StandardOutcomeAction;
  label: string;
  icon: string;
  accent: string;
}

interface StatOnlyActionMeta {
  id: StatOnlyAction;
  label: string;
  icon: string;
  accent: string;
}

interface LiveEventRow {
  id: string;
  createdAt: string;
  label: string;
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
    DatePipe,
    IonIcon,
    IonActionSheet,
  ],
})
export class CourtPage {
  readonly rotationChoices = [1, 2, 3, 4, 5, 6];
  isMatchControlsOpen = false;
  nextSetLineup: Array<string | null> = [];
  nextSetServe: 'team' | 'opponent' = 'team';
  public readonly actionMeta: Record<QuickAction, ActionMeta> = {
    kill: { label: 'Kill', icon: 'flash', accent: 'action-kill' },
    'attack-error': {
      label: 'Attack Error',
      icon: 'close-circle',
      accent: 'action-error',
    },
    ace: { label: 'Ace', icon: 'baseball', accent: 'action-ace' },
    'service-error': {
      label: 'Service Error',
      icon: 'close-circle',
      accent: 'action-error',
    },
    block: { label: 'Block', icon: 'hand-left', accent: 'action-block' },
    dig: { label: 'Dig', icon: 'baseball', accent: 'action-dig' },
    'opponent-error': {
      label: 'Opponent Error',
      icon: 'close-circle',
      accent: 'action-opponent-error',
    },
    'receive-error': {
      label: 'Receive Error',
      icon: 'close-circle',
      accent: 'action-receive-error',
    },
  };

  public readonly playerPositions: PlayerPosition[] = [
    { id: 4, label: 'LF', top: '34%', left: '19%' },
    { id: 3, label: 'MF', top: '34%', left: '50%' },
    { id: 2, label: 'RF', top: '34%', left: '81%' },
    { id: 5, label: 'LB', top: '68%', left: '19%' },
    { id: 6, label: 'MB', top: '68%', left: '50%' },
    { id: 1, label: 'RB', top: '68%', left: '81%' },
  ];

  constructor(
    public readonly teamRoster: TeamRosterService,
    public readonly liveStore: LiveMatchStoreService,
    public readonly offlineSync: OfflineSyncService,
    private readonly matchEngine: MatchEngineService,
    private readonly router: Router,
  ) {
    addIcons({'arrowUndo':arrowUndo,flash,'closeCircle':closeCircle,baseball,'handLeft':handLeft,'addCircle':addCircle,'playForward':playForward,star});
    this.liveStore.syncActiveGame();
    this.prepareNextSetDraft();
  }

  @HostListener('document:keydown', ['$event'])
  handleGlobalKeydown(event: KeyboardEvent): void {
    if (this.isMatchOver) {
      return;
    }

    const target = event.target as HTMLElement;
    const isInputFocused = target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable;

    if (isInputFocused) {
      return;
    }

    if ((event.ctrlKey || event.metaKey) && event.key === 'z') {
      event.preventDefault();
      this.undoLastAction();
      return;
    }

    if (event.key === 's' && !event.ctrlKey && !event.metaKey) {
      event.preventDefault();
      this.toggleSubMode();
      return;
    }

    if (event.key === 'Escape') {
      if (this.isSubOverlayOpen) {
        event.preventDefault();
        this.closeSubOverlay('Substitution cancelled.');
      } else if (this.isExitSheetOpen) {
        event.preventDefault();
        this.isExitSheetOpen = false;
      }
    }
  }

  get gameState(): MatchScoreState {
    return this.liveStore.gameState();
  }

  get activePlayer(): number | null {
    return this.liveStore.ui().activePlayer;
  }

  set activePlayer(activePlayer: number | null) {
    this.liveStore.setUi({ activePlayer });
  }

  get lastEvent(): LiveLastEvent | undefined {
    return this.liveStore.ui().lastEvent;
  }

  set lastEvent(lastEvent: LiveLastEvent | undefined) {
    this.liveStore.setUi({ lastEvent });
  }

  get isSubOverlayOpen(): boolean {
    return this.liveStore.ui().isSubOverlayOpen;
  }

  set isSubOverlayOpen(isSubOverlayOpen: boolean) {
    this.liveStore.setUi({ isSubOverlayOpen });
  }

  get substitutionOutPlayerId(): string | null {
    return this.liveStore.ui().substitutionOutPlayerId;
  }

  set substitutionOutPlayerId(substitutionOutPlayerId: string | null) {
    this.liveStore.setUi({ substitutionOutPlayerId });
  }

  get substitutionStatus(): string {
    return this.liveStore.ui().substitutionStatus;
  }

  set substitutionStatus(substitutionStatus: string) {
    this.liveStore.setUi({ substitutionStatus });
  }

  get isExitSheetOpen(): boolean {
    return this.liveStore.ui().isExitSheetOpen;
  }

  set isExitSheetOpen(isExitSheetOpen: boolean) {
    this.liveStore.setUi({ isExitSheetOpen });
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
        text: 'Start New Match',
        role: 'destructive',
        data: { action: 'new-match' },
      },
      {
        text: 'Cancel',
        role: 'cancel',
      },
    ];

    if (!this.isMatchOver) {
      buttons.splice(4, 0, {
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
    if (!this.isSubOverlayOpen) {
      this.activePlayer = playerId;
      return;
    }

    this.activePlayer = playerId;
    const player = this.getPlayerForPosition(playerId);
    if (!player) {
      this.substitutionOutPlayerId = null;
      this.substitutionStatus = 'Select an occupied on-court player first.';
      return;
    }

    this.substitutionOutPlayerId = player.id;
    this.substitutionStatus = `OUT selected: ${player.name}. Tap a bench player to swap.`;
  }

  handleBenchPlayerTap(playerId: string): void {
    if (!this.isSubOverlayOpen || this.isMatchOver) {
      return;
    }

    const outId = this.substitutionOutPlayerId;
    if (!outId) {
      this.substitutionStatus = 'Select an on-court player first.';
      return;
    }

    const didSubstitute = this.matchEngine.recordSubstitution(outId, playerId);
    if (!didSubstitute) {
      this.substitutionStatus = 'Substitution could not be applied.';
      return;
    }

    const inPlayer = this.liveStore.getMatchPlayerById(playerId);
    const outPlayer = this.liveStore.getMatchPlayerById(outId);
    this.substitutionStatus = `Substituted: ${inPlayer?.name ?? 'Player'} in for ${outPlayer?.name ?? 'player'}.`;
    this.isSubOverlayOpen = false;
    this.resetSubSelection();
  }

  startNewMatch(): void {
    const confirmed =
      typeof window === 'undefined' ? true : window.confirm('Start a new match? Current in-progress stats will reset.');
    if (!confirmed) {
      return;
    }

    this.matchEngine.startMatch(this.gameState.servingTeam);
    this.liveStore.syncActiveGame();
    this.lastEvent = undefined;
    this.substitutionStatus = '';
    this.isSubOverlayOpen = false;
    this.resetSubSelection();
  }

  endMatch(): void {
    this.matchEngine.endMatch();
  }

  recordAction(action: QuickAction): void {
    if (this.isMatchOver) {
      return;
    }

    if (action !== 'opponent-error' && this.activePlayer === null) {
      return;
    }

    const selectedPosition = this.activePlayer ?? 1;
    const selectedPlayer = this.getPlayerForPosition(selectedPosition);
    const event = this.matchEngine.recordPlayerAction(selectedPosition, action);
    if (action === 'opponent-error') {
      this.lastEvent = {
        kind: 'opponent-error-point',
        impactedScore: event.impactedScore,
        impactedStats: event.impactedStats,
      };
      this.activePlayer = null;
      this.prepareNextSetDraft();
      return;
    }

    this.lastEvent = {
      kind: 'player-action',
      playerId: selectedPosition,
      playerName: selectedPlayer?.name ?? `P${selectedPosition}`,
      action,
      impactedScore: event.impactedScore,
      impactedStats: event.impactedStats,
    };
    this.activePlayer = null;
    this.prepareNextSetDraft();
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
    this.activePlayer = null;
    this.prepareNextSetDraft();
  }

  undoLastAction(): void {
    if (this.isEndedEarly) {
      return;
    }

    this.matchEngine.undoLastEvent(this.liveStore.events());
    this.lastEvent = undefined;
  }

  getPlayerForPosition(position: number): MatchPlayer | null {
    const playerId = this.liveStore.getPlayerIdAtPosition(position) ?? this.teamRoster.lineup()[position - 1] ?? null;
    return this.liveStore.getMatchPlayerById(playerId);
  }

  isFrontRow(position: number | null): boolean {
    return position === 2 || position === 3 || position === 4;
  }

  getServeIndicatorClass(): string {
    return this.gameState.servingTeam === 'team' ? 'serve-team' : 'serve-opponent';
  }

  getPlayerTileStatLine(position: number): string {
    const player = this.getPlayerForPosition(position);
    if (!player) {
      return '0K / 0E';
    }
    const setStats = this.liveStore.getPlayerSetStats(player.id, this.gameState.currentSet);
    return `${setStats.kills}K / ${setStats.attackErrors}E`;
  }

  getPlayerTileAriaLabel(position: number): string {
    const player = this.getPlayerForPosition(position);
    const positionLabel = this.playerPositions.find((p) => p.id === position)?.label ?? `P${position}`;
    const isServer = position === 1 && this.gameState.servingTeam === 'team';
    const isSelected = position === this.activePlayer;

    if (!player) {
      return `Position ${positionLabel}, empty. ${isSelected ? 'Selected.' : ''}`;
    }

    const parts = [
      `${player.name}`,
      `Jersey ${player.jerseyNumber}`,
      player.primaryPosition,
      positionLabel,
    ];

    if (isServer) {
      parts.push('Currently serving');
    }
    if (isSelected) {
      parts.push('Selected');
    }
    if (this.isSubOverlayOpen && this.isSelectedOutPlayer(position)) {
      parts.push('Selected for substitution out');
    }

    return parts.join(', ') + '.';
  }

  handleCourtKeydown(event: KeyboardEvent, currentPosition: number): void {
    const navigationMap: Record<string, Record<number, number>> = {
      ArrowRight: { 4: 3, 3: 2, 5: 6, 6: 1 },
      ArrowLeft: { 3: 4, 2: 3, 6: 5, 1: 6 },
      ArrowUp: { 5: 4, 6: 3, 1: 2 },
      ArrowDown: { 4: 5, 3: 6, 2: 1 },
    };

    const nextPosition = navigationMap[event.key]?.[currentPosition];

    if (nextPosition) {
      event.preventDefault();
      this.activePlayer = nextPosition;
      this.focusPlayerTile(nextPosition);
      return;
    }

    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      this.handleCourtPlayerTap(currentPosition);
      return;
    }

    if (event.key === 'Escape' && this.isSubOverlayOpen) {
      event.preventDefault();
      this.closeSubOverlay('Substitution cancelled.');
    }
  }

  private focusPlayerTile(position: number): void {
    requestAnimationFrame(() => {
      const tile = document.querySelector(`[data-position="${position}"]`) as HTMLElement;
      tile?.focus();
    });
  }

  getSelectedPlayerText(): string {
    if (this.activePlayer === null) {
      return 'No player selected';
    }
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

    let action: string;
    if (this.lastEvent.kind === 'opponent-point') action = 'Opponent Winner';
    else if (this.lastEvent.kind === 'opponent-error-point') action = 'Opponent Unforced Error';
    else if (this.lastEvent.kind === 'manual-rotation') action = 'Manual Rotation';
    else if (this.lastEvent.kind === 'timeout') action = `${this.lastEvent.team === 'team' ? 'Our' : 'Opponent'} Timeout`;
    else action = `${this.getActionLabel(this.lastEvent.action)} · ${this.lastEvent.playerName}`;
    return `Last: ${action} · ${this.gameState.teamPoints}–${this.gameState.opponentPoints} · R${this.gameState.teamRotation}`;
  }

  setServingTeam(team: 'team' | 'opponent'): void {
    if (this.isMatchOver) {
      return;
    }

    this.matchEngine.setServingTeam(team);
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
  }

  openMatchControls(): void {
    if (!this.isMatchOver) {
      this.isMatchControlsOpen = true;
    }
  }

  closeMatchControls(): void {
    this.isMatchControlsOpen = false;
  }

  manualRotateTo(rotation: number): void {
    if (!this.matchEngine.manualRotateTeamTo(rotation)) {
      return;
    }
    this.lastEvent = { kind: 'manual-rotation', impactedScore: false, impactedStats: false };
  }

  endMatchEarly(): void {
    const confirmed = typeof window === 'undefined' || window.confirm('End this match early? It will have no final result.');
    if (!confirmed) {
      return;
    }
    this.matchEngine.endMatchEarly();
    this.isMatchControlsOpen = false;
  }

  async openMatchReview(): Promise<void> {
    await this.router.navigate(['/review', this.offlineSync.getActiveMatchId()]);
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
        id: 'ace',
        label: this.actionMeta.ace.label,
        icon: this.actionMeta.ace.icon,
        accent: this.actionMeta.ace.accent,
      },
      {
        id: 'service-error',
        label: this.actionMeta['service-error'].label,
        icon: this.actionMeta['service-error'].icon,
        accent: this.actionMeta['service-error'].accent,
      },
      {
        id: 'opponent-error',
        label: this.actionMeta['opponent-error'].label,
        icon: this.actionMeta['opponent-error'].icon,
        accent: this.actionMeta['opponent-error'].accent,
      },
      {
        id: 'opponent-point',
        label: 'Opponent Winner',
        icon: 'add-circle',
        accent: 'action-opponent-point',
      },
      {
        id: 'receive-error',
        label: this.actionMeta['receive-error'].label,
        icon: this.actionMeta['receive-error'].icon,
        accent: this.actionMeta['receive-error'].accent,
      },
    ];
  }

  get statOnlyActions(): StatOnlyActionMeta[] {
    return [
      {
        id: 'dig',
        label: this.actionMeta.dig.label,
        icon: this.actionMeta.dig.icon,
        accent: this.actionMeta.dig.accent,
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

  get onCourtPlayers(): MatchPlayer[] {
    const playerIds = this.liveStore.projection()?.lineup ?? [];
    return playerIds
      .map((playerId) => this.liveStore.getMatchPlayerById(playerId))
      .filter((player): player is MatchPlayer => player !== null);
  }

  get benchPlayers(): MatchPlayer[] {
    const onCourt = new Set(this.liveStore.projection()?.lineup ?? []);
    return this.liveStore.matchSquad().filter((player) => !onCourt.has(player.id));
  }

  toggleSubMode(): void {
    if (this.isMatchOver) {
      return;
    }

    if (this.isSubOverlayOpen) {
      this.closeSubOverlay('Substitution cancelled.');
      return;
    }

    this.openSubOverlay();
  }

  closeSubOverlay(status?: string): void {
    this.isSubOverlayOpen = false;
    this.resetSubSelection();
    if (status) {
      this.substitutionStatus = status;
    }
  }

  isSelectedOutPlayer(position: number): boolean {
    const player = this.getPlayerForPosition(position);
    return !!player && player.id === this.substitutionOutPlayerId;
  }

  get selectedOutPlayer(): MatchPlayer | null {
    return this.liveStore.getMatchPlayerById(this.substitutionOutPlayerId);
  }

  get isMatchOver(): boolean {
    return this.gameState.isMatchOver;
  }

  get isEndedEarly(): boolean {
    return this.liveStore.game()?.status === 'ended-early';
  }

  get isSetBreak(): boolean {
    return this.gameState.isSetBreak;
  }

  get canStartNextSet(): boolean {
    const assigned = this.nextSetLineup.filter((playerId): playerId is string => typeof playerId === 'string');
    return assigned.length === 6 && new Set(assigned).size === 6;
  }

  setNextSetPlayer(position: number, playerId: string): void {
    const next = this.nextSetLineup.length === 6
      ? [...this.nextSetLineup]
      : this.matchEngine.getNextSetDefaultLineup();
    next[position - 1] = playerId || null;
    this.nextSetLineup = next;
  }

  startNextSet(): void {
    if (!this.canStartNextSet || !this.matchEngine.startNextSet(this.nextSetLineup, this.nextSetServe)) {
      return;
    }
    this.nextSetLineup = [];
    this.activePlayer = null;
  }

  private prepareNextSetDraft(): void {
    if (this.gameState.isSetBreak && this.nextSetLineup.length !== 6) {
      this.nextSetLineup = this.matchEngine.getNextSetDefaultLineup();
      this.nextSetServe = 'team';
    }
  }

  get opponentName(): string {
    return this.liveStore.game()?.opponentName?.trim() || 'Opponent';
  }

  get teamDisplayName(): string {
    return this.teamRoster.team().name.trim() || 'Your Team';
  }

  get liveCourtSubtitle(): string {
    if (this.isMatchOver) {
      return 'Match is final. Review stats or start a new match from Exit.';
    }

    return 'Tap a player on the court, then tap the outcome of the rally.';
  }

  get scoreSituationText(): string {
    if (this.isMatchOver) {
      return 'Final';
    }

    const servingName = this.gameState.servingTeam === 'team' ? this.teamDisplayName : this.opponentName;
    return `${servingName} serving`;
  }

  get selectedPlayerDetail(): string {
    if (this.activePlayer === null) {
      return 'Select a player for player-specific actions';
    }
    const selectedPlayer = this.getPlayerForPosition(this.activePlayer);
    if (!selectedPlayer) {
      return `Position ${this.activePlayer} is empty`;
    }

    return `#${selectedPlayer.jerseyNumber} ${selectedPlayer.name} - ${selectedPlayer.primaryPosition}`;
  }

  get commandInstructionText(): string {
    if (this.isMatchOver) {
      return 'Scoring is locked because the match is final.';
    }

    if (this.activePlayer === null) {
      return 'Select a player, then record their action. Team-only outcomes stay available.';
    }

    return 'Record one action. Player selection clears after the tap.';
  }

  requiresPlayerAttribution(action: StandardOutcomeAction): boolean {
    return action !== 'opponent-error' && action !== 'opponent-point';
  }

  get rotationIndicatorText(): string {
    const rotation = this.gameState.teamRotation;
    const server = this.getPlayerForPosition(1);
    const serverText = server ? `#${server.jerseyNumber}` : 'P1 Open';
    return `R${rotation} ${serverText}`;
  }

  get timeoutIndicatorText(): string {
    const state = this.gameState;
    return `${state.teamTimeoutsRemaining} / ${state.opponentTimeoutsRemaining}`;
  }

  get servePossessionText(): string {
    return this.gameState.servingTeam === 'team' ? 'Home' : 'Away';
  }

  get teamSetKills(): number {
    const currentSet = this.gameState.currentSet;
    return this.teamRoster
      .players()
      .reduce((total, player) => total + this.liveStore.getPlayerSetStats(player.id, currentSet).kills, 0);
  }

  get teamSetAttackErrors(): number {
    const currentSet = this.gameState.currentSet;
    return this.teamRoster
      .players()
      .reduce((total, player) => total + this.liveStore.getPlayerSetStats(player.id, currentSet).attackErrors, 0);
  }

  get teamSideOutRate(): number | null {
    const projection = this.liveStore.projection();
    if (!projection) return null;
    const rate = selectTeamSideOut(projection);
    return rate.total === 0 ? null : rate.won / rate.total;
  }

  get recentEvents(): LiveEventRow[] {
    return this.liveStore
      .events()
      .slice(-8)
      .reverse()
      .map((event) => ({
        id: event.id || `${event.type}-${event.createdAt}`,
        createdAt: event.createdAt,
        label: this.describeEvent(event),
      }));
  }

  get recentCommandEvents(): LiveEventRow[] {
    return this.recentEvents.slice(0, 5);
  }

  get syncStatusText(): string {
    if (this.offlineSync.lastError()) {
      return 'Saved on this device. Cloud sync failed.';
    }
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

      this.matchEngine.endMatchEarly();
      await this.router.navigate(['/home']);
      return;
    }

    if (action === 'home') {
      await this.router.navigate(['/home']);
      return;
    }

    if (action === 'new-match') {
      this.startNewMatch();
      return;
    }

    if (action === 'lineup') {
      await this.router.navigate(['/pre-match']);
      return;
    }

    await this.router.navigate(['/history']);
  }

  private openSubOverlay(): void {
    this.isSubOverlayOpen = true;
    const selectedOutPlayer = this.activePlayer === null ? null : this.getPlayerForPosition(this.activePlayer);
    this.substitutionOutPlayerId = selectedOutPlayer?.id ?? null;
    this.substitutionStatus = selectedOutPlayer
      ? `OUT selected: ${selectedOutPlayer.name}. Tap a bench player to swap.`
      : 'Tap an on-court player, then tap a bench player.';
  }

  private resetSubSelection(): void {
    this.substitutionOutPlayerId = null;
  }

  formatRate(value: number | null): string {
    if (value === null) {
      return '--';
    }

    return `${(value * 100).toFixed(1)}%`;
  }

  private getActionLabel(action: QuickAction): string {
    return this.actionMeta[action]?.label ?? action;
  }

  private describeEvent(event: { type: string; action: string; servingTeam?: string; timeoutTeam?: string }): string {
    const type = event.type;
    if (type === 'playerAction') {
      const action = event.action || 'action';
      if (action === 'opponent-error') {
        return 'Team: Opponent Unforced Error';
      }
      return `Player: ${this.getActionLabel(action as QuickAction)}`;
    }
    if (type === 'opponentPoint') {
      return 'Opponent Winner';
    }
    if (type === 'substitution') {
      return 'Substitution';
    }
    if (type === 'serveTeamSet') {
      const servingTeam = event.servingTeam ?? 'team';
      return `Serve: ${servingTeam === 'team' ? 'Our Team' : 'Opponent'}`;
    }
    if (type === 'timeoutCalled') {
      const timeoutTeam = event.timeoutTeam ?? 'team';
      return `${timeoutTeam === 'team' ? 'Our' : 'Opponent'} Timeout`;
    }
    if (type === 'manualRotation') {
      return 'Manual Rotation';
    }
    if (type === 'undo') {
      return 'Undo';
    }
    if (type === 'matchStarted') {
      return 'Match Started';
    }
    if (type === 'matchEnded') {
      return 'Match Ended';
    }
    return 'Event';
  }

}
