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
  serveAttempts: number;
  serveInPercentage: number | null;
  sideOutPercentage: number | null;
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
      const type = this.readString(event['event_type']) || 'event';
      return {
        id: this.readString(event['id']) || `${type}-${this.readString(event['created_at'])}`,
        createdAt: this.readString(event['created_at']) || '',
        type,
        summary: this.describeEvent(type, event),
      };
    });
  }

  get boxScoreRows(): BoxScoreRow[] {
    if (!this.selectedMatchId) {
      return [];
    }

    const latest = this.offlineSync.getMatchBoxScores(this.selectedMatchId)[0];
    if (!latest || !Array.isArray(latest['stats'])) {
      return [];
    }

    return (latest['stats'] as Array<Record<string, unknown>>)
      .map((row) => ({
        playerName: this.readString(row['player_name']) || 'Player',
        jerseyNumber: this.readNumber(row['jersey_number']),
        kills: this.readNumber(row['kills']) ?? 0,
        attackErrors: this.readNumber(row['attack_errors']) ?? 0,
        totalAttacks: this.readNumber(row['total_attacks']) ?? 0,
        serveAttempts: this.readNumber(row['serve_attempts']) ?? 0,
        serveInPercentage: this.readNumber(row['serve_in_percentage']),
        sideOutPercentage: this.readNumber(row['side_out_percentage']),
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

  private describeEvent(type: string, event: Record<string, unknown>): string {
    switch (type) {
      case 'match_started':
        return 'Match started';
      case 'match_ended':
        return `Match ended (${this.readNumber(event['team_sets']) ?? 0}-${this.readNumber(event['opponent_sets']) ?? 0})`;
      case 'player_action':
        return `Player action: ${this.toTitle(this.readString(event['action']) || 'unknown')}`;
      case 'opponent_point':
        return 'Opponent point';
      case 'substitution':
        return 'Substitution';
      case 'undo':
        return 'Undo action';
      case 'serve_team_set':
        return `Serve switched: ${this.toTitle(this.readString(event['serving_team']) || 'unknown')}`;
      case 'timeout_called':
        return `Timeout: ${this.toTitle(this.readString(event['timeout_team']) || 'unknown')}`;
      case 'manual_rotation':
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

  private readString(value: unknown): string | null {
    return typeof value === 'string' ? value : null;
  }

  private readNumber(value: unknown): number | null {
    return typeof value === 'number' ? value : null;
  }
}
