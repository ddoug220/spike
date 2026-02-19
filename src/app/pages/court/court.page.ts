import { DatePipe, NgClass, NgFor, NgIf, TitleCasePipe } from '@angular/common';
import { Component } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import {
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
type MatchEvent =
  | { kind: 'player-action'; playerId: number; action: QuickAction; impactedScore: boolean; impactedStats: boolean }
  | { kind: 'opponent-point'; impactedScore: true; impactedStats: boolean };

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
    RouterLink,
    FormsModule,
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
  ) {
    addIcons({
      'arrow-undo': arrowUndo,
      flash,
      'close-circle': closeCircle,
      baseball,
      'hand-left': handLeft,
      'add-circle': addCircle,
      'play-forward': playForward,
    });
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
  }

  endMatch(): void {
    this.matchEngine.endMatch();
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
  }

  undoLastAction(): void {
    if (this.isMatchOver) {
      return;
    }

    this.matchEngine.undoLastEvent();
    this.lastEvent = undefined;
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

    return `Last: Player #${this.lastEvent.playerId} - ${this.getActionLabel(this.lastEvent.action)}`;
  }

  setServingTeam(team: 'team' | 'opponent'): void {
    if (this.isMatchOver) {
      return;
    }

    this.matchEngine.setServingTeam(team);
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

  formatRate(value: number | null): string {
    if (value === null) {
      return '--';
    }

    return `${(value * 100).toFixed(1)}%`;
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
}
