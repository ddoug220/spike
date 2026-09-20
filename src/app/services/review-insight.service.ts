import { Injectable } from '@angular/core';
import { FirebaseApp, getApps, initializeApp } from 'firebase/app';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { environment } from '../../environments/environment';
import { MatchReviewData } from '../pages/review/review-data';
import { ReviewInsightCandidate, ReviewInsightScore } from '../pages/review/review-insights';

interface PrioritizeReviewInsightsRequest {
  match: {
    status: MatchReviewData['status'];
    teamName: string;
    opponentName: string;
    teamSets: number;
    opponentSets: number;
    completedSets: number;
  };
  candidates: ReviewInsightCandidate[];
}

interface PrioritizeReviewInsightsResponse {
  scores?: unknown;
}

@Injectable({ providedIn: 'root' })
export class ReviewInsightService {
  private static readonly appName = 'spike-firebase';
  private readonly prioritizeCallable: ReturnType<typeof httpsCallable<PrioritizeReviewInsightsRequest, PrioritizeReviewInsightsResponse>>;

  constructor() {
    const app: FirebaseApp =
      getApps().find((candidate) => candidate.name === ReviewInsightService.appName) ??
      initializeApp(environment.firebase, ReviewInsightService.appName);
    this.prioritizeCallable = httpsCallable<PrioritizeReviewInsightsRequest, PrioritizeReviewInsightsResponse>(
      getFunctions(app),
      'prioritizeMatchReviewInsights',
    );
  }

  async prioritize(review: MatchReviewData, candidates: ReviewInsightCandidate[]): Promise<ReviewInsightScore[]> {
    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      throw new Error('Review focus needs an internet connection.');
    }

    const result = await this.prioritizeCallable({
      match: {
        status: review.status,
        teamName: review.teamName,
        opponentName: review.opponentName,
        teamSets: review.teamSets,
        opponentSets: review.opponentSets,
        completedSets: review.sets.length,
      },
      candidates,
    });

    if (!Array.isArray(result.data.scores)) {
      throw new Error('Review focus returned an invalid response.');
    }

    return result.data.scores.filter(isReviewInsightScore);
  }
}

function isReviewInsightScore(value: unknown): value is ReviewInsightScore {
  if (!value || typeof value !== 'object') return false;
  const score = value as Partial<ReviewInsightScore>;
  return typeof score.id === 'string' &&
    typeof score.score === 'number' &&
    typeof score.confidence === 'number';
}
