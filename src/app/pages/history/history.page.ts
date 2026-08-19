import { DatePipe, NgFor, NgIf } from '@angular/common';
import { Component } from '@angular/core';
import { RouterLink } from '@angular/router';
import { IonButton, IonContent, IonHeader, IonTitle, IonToolbar } from '@ionic/angular/standalone';
import { MatchArchiveSummary, OfflineSyncService } from '../../services/offline-sync.service';

@Component({
  selector: 'app-history',
  templateUrl: './history.page.html',
  styleUrls: ['./history.page.scss'],
  standalone: true,
  imports: [IonHeader, IonToolbar, IonTitle, IonContent, IonButton, NgFor, NgIf, RouterLink, DatePipe],
})
export class HistoryPage {
  constructor(private readonly offlineSync: OfflineSyncService) {}

  get matches(): MatchArchiveSummary[] {
    return this.offlineSync.getMatchSummaries();
  }

  get hasPendingSync(): boolean {
    return this.offlineSync.pendingCount() > 0;
  }

  statusLabel(match: MatchArchiveSummary): string {
    const game = this.offlineSync.getGame(match.matchId);
    if (game?.status === 'ended-early') {
      return 'Ended early';
    }
    return match.isFinal ? 'Final' : 'Live';
  }

  scoreLabel(match: MatchArchiveSummary): string {
    if (match.isFinal) {
      return `${match.finalTeamSets ?? match.teamSets}–${match.finalOpponentSets ?? match.opponentSets}`;
    }
    return `${match.teamPoints}–${match.opponentPoints}`;
  }

  syncLabel(match: MatchArchiveSummary): string {
    const isActive = this.offlineSync.getActiveMatchId() === match.matchId;
    return isActive && this.hasPendingSync ? 'Pending sync' : 'Saved';
  }
}
