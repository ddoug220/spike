import { DatePipe, NgFor, NgIf } from '@angular/common';
import { Component } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { IonButton, IonContent, IonHeader, IonTitle, IonToolbar } from '@ionic/angular/standalone';
import { OfflineSyncService } from '../../services/offline-sync.service';
import { MatchReviewData, buildMatchReview } from './review-data';

@Component({
  selector: 'app-review',
  templateUrl: './review.page.html',
  styleUrls: ['./review.page.scss'],
  standalone: true,
  imports: [IonHeader, IonToolbar, IonTitle, IonContent, IonButton, NgFor, NgIf, RouterLink, DatePipe],
})
export class ReviewPage {
  readonly matchId: string;

  constructor(
    route: ActivatedRoute,
    private readonly offlineSync: OfflineSyncService,
    private readonly router: Router,
  ) {
    this.matchId = route.snapshot.paramMap.get('matchId') ?? '';
  }

  get review(): MatchReviewData | null {
    const summary = this.offlineSync.getMatchSummaries().find((match) => match.matchId === this.matchId) ?? null;
    return buildMatchReview(
      this.offlineSync.getGame(this.matchId),
      summary,
      this.offlineSync.getMatchEvents(this.matchId),
      this.offlineSync.getPlayerSetStats(this.matchId),
    );
  }

  get canResume(): boolean {
    return this.review?.status === 'live' &&
      this.offlineSync.getActiveMatchId() === this.matchId &&
      this.offlineSync.isCurrentScoringDevice(this.matchId);
  }

  get canTakeOver(): boolean {
    return this.review?.status === 'live' &&
      this.offlineSync.getActiveMatchId() === this.matchId &&
      !this.offlineSync.isCurrentScoringDevice(this.matchId) &&
      (typeof navigator === 'undefined' || navigator.onLine);
  }

  async takeOver(): Promise<void> {
    if (this.offlineSync.takeOverScoring(this.matchId)) {
      await this.router.navigate(['/court']);
    }
  }

  statusLabel(status: MatchReviewData['status']): string {
    if (status === 'ended-early') {
      return 'Ended early';
    }
    return status === 'final' ? 'Final' : 'Live';
  }

  formatRate(rate: number | null): string {
    return rate === null ? '–' : `${Math.round(rate * 100)}%`;
  }

  serveRate(attempts: number, servesIn: number): string {
    return attempts === 0 ? '–' : `${Math.round((servesIn / attempts) * 100)}%`;
  }
}
