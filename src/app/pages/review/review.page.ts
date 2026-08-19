import { DatePipe, NgFor, NgIf } from '@angular/common';
import { Component, OnDestroy, signal } from '@angular/core';
import { Unsubscribe } from 'firebase/firestore';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { IonButton, IonContent, IonHeader, IonTitle, IonToolbar } from '@ionic/angular/standalone';
import { OfflineSyncService } from '../../services/offline-sync.service';
import { FirebaseDbService } from '../../services/firebase-db.service';
import { Game, GameEvent } from '../../models/firestore.models';
import { MatchReviewData, buildMatchReview } from './review-data';

@Component({
  selector: 'app-review',
  templateUrl: './review.page.html',
  styleUrls: ['./review.page.scss'],
  standalone: true,
  imports: [IonHeader, IonToolbar, IonTitle, IonContent, IonButton, NgFor, NgIf, RouterLink, DatePipe],
})
export class ReviewPage implements OnDestroy {
  readonly matchId: string;
  private readonly cloudGame = signal<Game | null>(null);
  private readonly cloudEvents = signal<GameEvent[]>([]);
  private readonly unsubscribers: Unsubscribe[] = [];

  constructor(
    route: ActivatedRoute,
    private readonly offlineSync: OfflineSyncService,
    private readonly firebaseDb: FirebaseDbService,
    private readonly router: Router,
  ) {
    this.matchId = route.snapshot.paramMap.get('matchId') ?? '';
    if (this.matchId) {
      this.unsubscribers.push(
        this.firebaseDb.subscribeGame(this.matchId, (game) => {
          this.cloudGame.set(game);
          if (game) this.offlineSync.cacheRemoteGame(game);
        }),
        this.firebaseDb.subscribeEvents(this.matchId, (events) => {
          this.cloudEvents.set(events);
          this.offlineSync.cacheRemoteEvents(this.matchId, events);
        }),
      );
    }
  }

  ngOnDestroy(): void {
    this.unsubscribers.forEach((unsubscribe) => unsubscribe());
  }

  get review(): MatchReviewData | null {
    return buildMatchReview(
      this.cloudGame() ?? this.offlineSync.getGame(this.matchId),
      this.mergedEvents(),
    );
  }

  get canResume(): boolean {
    return this.review?.status === 'live' &&
      this.offlineSync.getActiveMatchId() === this.matchId &&
      this.offlineSync.isCurrentScoringDevice(this.matchId);
  }

  get canTakeOver(): boolean {
    return this.review?.status === 'live' &&
      !this.offlineSync.isCurrentScoringDevice(this.matchId) &&
      (typeof navigator === 'undefined' || navigator.onLine);
  }

  get writerConflictCount(): number {
    return this.offlineSync.getWriterConflictCount(this.matchId);
  }

  async takeOver(): Promise<void> {
    if (await this.offlineSync.takeOverScoring(this.matchId)) {
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

  private mergedEvents(): GameEvent[] {
    const events = new Map<string, GameEvent>();
    this.offlineSync.getMatchEvents(this.matchId).forEach((event) => events.set(event.id, event));
    this.cloudEvents().forEach((event) => events.set(event.id, event));
    return [...events.values()];
  }
}
