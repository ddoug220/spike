import { DatePipe, NgFor, NgIf } from '@angular/common';
import { Component, OnDestroy, OnInit, signal } from '@angular/core';
import { Unsubscribe } from 'firebase/firestore';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { IonContent } from '@ionic/angular/standalone';
import { OfflineSyncService } from '../../services/offline-sync.service';
import { FirebaseDbService } from '../../services/firebase-db.service';
import { Game, GameEvent } from '../../models/firestore.models';
import { MatchReviewData, buildMatchReview } from './review-data';
import { EquipmentRailComponent } from '../../components/equipment-rail/equipment-rail.component';
import { MatchBoxScoreComponent } from '../../components/match-box-score/match-box-score.component';
import { projectionFromFirestore } from '../../services/match-v2.adapter';
import { MatchEngineService } from '../../services/match-engine.service';
import { ReviewInsightService } from '../../services/review-insight.service';
import {
  PrioritizedReviewInsight,
  buildReviewInsightCandidates,
  prioritizeReviewInsights,
} from './review-insights';

type ReviewInsightStatus = 'idle' | 'loading' | 'ready' | 'empty' | 'unavailable';

@Component({
  selector: 'app-review',
  templateUrl: './review.page.html',
  styleUrls: ['./review.page.scss'],
  standalone: true,
  imports: [IonContent, NgFor, NgIf, RouterLink, DatePipe, EquipmentRailComponent, MatchBoxScoreComponent],
})
export class ReviewPage implements OnDestroy, OnInit {
  readonly matchId: string;
  readonly reviewInsights = signal<PrioritizedReviewInsight[]>([]);
  readonly reviewInsightStatus = signal<ReviewInsightStatus>('idle');
  readonly reviewInsightNotice = signal('');
  private readonly cloudGame = signal<Game | null>(null);
  private readonly cloudEvents = signal<GameEvent[]>([]);
  private readonly unsubscribers: Unsubscribe[] = [];
  private insightRequestId = 0;

  constructor(
    route: ActivatedRoute,
    private readonly offlineSync: OfflineSyncService,
    private readonly firebaseDb: FirebaseDbService,
    private readonly matchEngine: MatchEngineService,
    private readonly reviewInsightService: ReviewInsightService,
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

  ngOnInit(): void {
    void this.refreshReviewInsights();
  }

  ngOnDestroy(): void {
    this.insightRequestId += 1;
    this.unsubscribers.forEach((unsubscribe) => unsubscribe());
  }

  async refreshReviewInsights(): Promise<void> {
    const review = this.review;
    if (!review) return;

    const candidates = buildReviewInsightCandidates(review);
    if (candidates.length === 0) {
      this.reviewInsights.set([]);
      this.reviewInsightStatus.set('empty');
      this.reviewInsightNotice.set('Record completed rallies to create review focus.');
      return;
    }

    const requestId = ++this.insightRequestId;
    this.reviewInsightStatus.set('loading');
    this.reviewInsightNotice.set('Prioritizing recorded match facts…');

    try {
      const scores = await this.reviewInsightService.prioritize(review, candidates);
      if (requestId !== this.insightRequestId) return;
      const prioritized = prioritizeReviewInsights(candidates, scores);
      this.reviewInsights.set(prioritized);
      this.reviewInsightStatus.set(prioritized.length > 0 ? 'ready' : 'empty');
      this.reviewInsightNotice.set(prioritized.length > 0
        ? 'Ranked from recorded match facts. The figures below come directly from the event history.'
        : 'No recorded fact had enough evidence to prioritize.');
    } catch {
      if (requestId !== this.insightRequestId) return;
      this.reviewInsights.set([]);
      this.reviewInsightStatus.set('unavailable');
      this.reviewInsightNotice.set('Review focus is unavailable. All recorded match facts remain below.');
    }
  }

  get review(): MatchReviewData | null {
    return buildMatchReview(
      this.offlineSync.getGame(this.matchId) ?? this.cloudGame(),
      this.mergedEvents(),
    );
  }

  get projection() {
    const game = this.offlineSync.getGame(this.matchId) ?? this.cloudGame();
    return game ? projectionFromFirestore(game, this.mergedEvents()) : null;
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

  get canCorrectAttribution(): boolean {
    return !!this.projection &&
      this.offlineSync.isCurrentScoringDevice(this.matchId) &&
      !this.offlineSync.mutationBlocked();
  }

  correctAttribution(targetEventId: string, currentPlayerId: string | null, domEvent: Event): void {
    const replacementPlayerId = (domEvent.target as HTMLSelectElement).value;
    if (!replacementPlayerId || replacementPlayerId === currentPlayerId || !this.canCorrectAttribution) return;
    this.matchEngine.correctPlayerAttribution(this.matchId, targetEventId, replacementPlayerId);
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
    this.cloudEvents().forEach((event) => {
      if (!events.has(event.id)) events.set(event.id, event);
    });
    return [...events.values()];
  }
}
