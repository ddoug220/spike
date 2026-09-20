import { TypeSafeClient } from '@typesafe-ai/sdk';
import { logger } from 'firebase-functions';
import { defineSecret } from 'firebase-functions/params';
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import {
  buildReviewInsightQuestions,
  parseReviewInsightRequest,
  questionId,
} from './review-insights.js';

const typeSafeApiKey = defineSecret('TYPESAFE_API_KEY');

export const prioritizeMatchReviewInsights = onCall(
  {
    secrets: [typeSafeApiKey],
    timeoutSeconds: 30,
    maxInstances: 10,
  },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'Sign in to prioritize Match Review facts.');
    }

    const input = parseReviewInsightRequest(request.data);

    try {
      const client = new TypeSafeClient({
        apiKey: typeSafeApiKey.value(),
        defaultModel: 'jev-latest',
        timeout: 8000,
      });
      const response = await client.systemOne({
        state: {
          match: { ...input.match },
          candidates: input.candidates.map((candidate) => ({ ...candidate })),
        },
        questions: buildReviewInsightQuestions(input.candidates),
      });

      const scores = input.candidates.map((candidate, index) => {
        const answer = response.answers[questionId(index)];
        if (!answer || answer.type !== 'score') {
          throw new Error('TypeSafe returned a non-score answer.');
        }
        return {
          id: candidate.id,
          score: answer.score,
          confidence: answer.confidence,
        };
      });

      return { scores, model: response.model };
    } catch (error) {
      logger.error('Match Review insight prioritization failed.', {
        errorType: error instanceof Error ? error.name : 'unknown',
      });
      throw new HttpsError('unavailable', 'Review focus is temporarily unavailable.');
    }
  },
);
