import assert from 'node:assert/strict';
import test from 'node:test';
import { HttpsError } from 'firebase-functions/v2/https';
import {
  MAX_REVIEW_INSIGHT_CANDIDATES,
  buildReviewInsightQuestions,
  parseReviewInsightRequest,
} from './review-insights.js';

const candidate = {
  id: 'rotation-4',
  kind: 'rotation' as const,
  title: 'R4 rally win rate',
  statement: 'North High won 2 of 9 completed rallies in R4 (22%).',
  evidence: '2/9 completed rallies',
  sampleSize: 9,
};

test('parses bounded factual review input', () => {
  const parsed = parseReviewInsightRequest({
    match: {
      status: 'final', teamName: 'North High', opponentName: 'Central',
      teamSets: 3, opponentSets: 1, completedSets: 4,
    },
    candidates: [candidate],
  });

  assert.deepEqual(parsed.candidates, [candidate]);
  assert.equal(parsed.match.status, 'final');
});

test('builds one independent score question per candidate', () => {
  const questions = buildReviewInsightQuestions([
    candidate,
    { ...candidate, id: 'side-out', kind: 'side-out' },
  ]);

  assert.deepEqual(Object.keys(questions), ['priority_0', 'priority_1']);
  assert.equal(questions.priority_0.type, 'score');
  assert.equal(questions.priority_1.type, 'score');
});

test('rejects oversized or duplicate candidate input', () => {
  const match = {
    status: 'live', teamName: 'North High', opponentName: 'Central',
    teamSets: 0, opponentSets: 0, completedSets: 0,
  };
  const oversized = Array.from({ length: MAX_REVIEW_INSIGHT_CANDIDATES + 1 }, (_, index) => ({
    ...candidate, id: `rotation-${index}`,
  }));

  assert.throws(() => parseReviewInsightRequest({ match, candidates: oversized }), HttpsError);
  assert.throws(() => parseReviewInsightRequest({ match, candidates: [candidate, candidate] }), HttpsError);
});
