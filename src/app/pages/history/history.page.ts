import { DatePipe, NgClass, NgFor, NgIf } from '@angular/common';
import { Component } from '@angular/core';
import { RouterLink } from '@angular/router';
import { IonButton, IonContent, IonHeader, IonTitle, IonToolbar } from '@ionic/angular/standalone';
import { MatchArchiveSummary, OfflineSyncService } from '../../services/offline-sync.service';

interface TimelineItem {
  id: string;
  createdAt: string;
  type: string;
  summary: string;
}

interface BoxScoreRow {
  playerName: string;
  jerseyNumber: number | null;
  kills: number;
  attackErrors: number;
  totalAttacks: number;
  aces: number;
  hittingEfficiency: number | null;
  serveAttempts: number;
  receiveErrors: number;
  serveInPercentage: number | null;
  sideOutPercentage: number | null;
}

interface RecapLeader {
  label: string;
  value: string;
}

@Component({
  selector: 'app-history',
  templateUrl: './history.page.html',
  styleUrls: ['./history.page.scss'],
  standalone: true,
  imports: [IonHeader, IonToolbar, IonTitle, IonContent, IonButton, NgFor, NgIf, NgClass, RouterLink, DatePipe],
})
export class HistoryPage {
  public selectedMatchId: string | null = null;

  constructor(private readonly offlineSync: OfflineSyncService) {
    const first = this.matches[0];
    this.selectedMatchId = first?.matchId ?? null;
  }

  get matches(): MatchArchiveSummary[] {
    return this.offlineSync.getMatchSummaries();
  }

  get selectedMatchSummary(): MatchArchiveSummary | null {
    const matchId = this.selectedMatchId;
    if (!matchId) {
      return null;
    }
    return this.matches.find((summary) => summary.matchId === matchId) ?? null;
  }

  get timeline(): TimelineItem[] {
    if (!this.selectedMatchId) {
      return [];
    }

    return this.offlineSync.getMatchEvents(this.selectedMatchId).map((event) => {
      const type = event.type;
      return {
        id: event.id || `${type}-${event.createdAt}`,
        createdAt: event.createdAt,
        type,
        summary: this.describeEvent(type, event),
      };
    });
  }

  get boxScoreRows(): BoxScoreRow[] {
    if (!this.selectedMatchId) {
      return [];
    }

    return this.offlineSync
      .getPlayerSetStats(this.selectedMatchId)
      .map((row) => ({
        playerName: row.playerName,
        jerseyNumber: row.jerseyNumber,
        kills: row.kills,
        attackErrors: row.attackErrors,
        totalAttacks: row.totalAttacks,
        aces: row.aces,
        hittingEfficiency: row.hittingEfficiency,
        serveAttempts: row.serveAttempts,
        receiveErrors: row.receiveErrors ?? 0,
        serveInPercentage: row.serveInPercentage,
        sideOutPercentage: row.sideOutPercentage,
      }))
      .sort((a, b) => (a.jerseyNumber ?? 999) - (b.jerseyNumber ?? 999));
  }

  selectMatch(matchId: string): void {
    this.selectedMatchId = matchId;
  }

  formatRate(rate: number | null): string {
    if (rate === null) {
      return '--';
    }
    return `${(rate * 100).toFixed(1)}%`;
  }

  formatEfficiency(value: number | null): string {
    if (value === null) {
      return '--';
    }
    const rounded = Math.round(value * 1000) / 1000;
    const fixed = Math.abs(rounded).toFixed(3).replace(/^0/, '');
    return rounded < 0 ? `-${fixed}` : fixed;
  }

  get selectedLeaders(): RecapLeader[] {
    const rows = this.boxScoreRows;
    if (rows.length === 0) {
      return [];
    }

    const killLeader = rows.slice().sort((a, b) => b.kills - a.kills)[0];
    const aceLeader = rows.slice().sort((a, b) => b.aces - a.aces)[0];
    const efficiencyLeader = rows
      .filter((row) => row.hittingEfficiency !== null)
      .sort((a, b) => (b.hittingEfficiency ?? -999) - (a.hittingEfficiency ?? -999))[0];

    return [
      {
        label: 'Kills',
        value: `${this.playerLabel(killLeader)} ${killLeader.kills}`,
      },
      {
        label: 'Aces',
        value: `${this.playerLabel(aceLeader)} ${aceLeader.aces}`,
      },
      {
        label: 'Hit Eff',
        value: efficiencyLeader ? `${this.playerLabel(efficiencyLeader)} ${this.formatEfficiency(efficiencyLeader.hittingEfficiency)}` : '--',
      },
    ];
  }

  private describeEvent(type: string, event: { action: string; teamSets?: number; opponentSets?: number; servingTeam?: string; timeoutTeam?: string }): string {
    switch (type) {
      case 'matchStarted':
        return 'Match started';
      case 'matchEnded':
        return `Match ended (${event.teamSets ?? 0}-${event.opponentSets ?? 0})`;
      case 'playerAction':
        if (event.action === 'opponent-error') {
          return 'Team point: Opponent unforced error';
        }
        return `Player action: ${this.toTitle(event.action || 'unknown')}`;
      case 'opponentPoint':
        return 'Opponent point';
      case 'substitution':
        return 'Substitution';
      case 'undo':
        return 'Undo action';
      case 'serveTeamSet':
        return `Serve switched: ${this.toTitle(event.servingTeam || 'unknown')}`;
      case 'timeoutCalled':
        return `Timeout: ${this.toTitle(event.timeoutTeam || 'unknown')}`;
      case 'manualRotation':
        return 'Manual rotation';
      default:
        return this.toTitle(type);
    }
  }

  private toTitle(value: string): string {
    return value
      .replace(/[-_]/g, ' ')
      .trim()
      .replace(/\b\w/g, (char) => char.toUpperCase());
  }

  private playerLabel(row: BoxScoreRow): string {
    return `#${row.jerseyNumber ?? '--'} ${row.playerName}`;
  }
}
