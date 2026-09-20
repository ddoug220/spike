import { MatchReviewData } from './review-data';
import {
  buildReviewInsightCandidates,
  prioritizeReviewInsights,
} from './review-insights';

describe('review insights', () => {
  it('builds exact candidate facts from the event-derived review', () => {
    const candidates = buildReviewInsightCandidates(review());

    expect(candidates.find((candidate) => candidate.id === 'side-out')).toEqual(jasmine.objectContaining({
      statement: 'North High won 4 of 8 side-out opportunities (50%).',
      sampleSize: 8,
    }));
    expect(candidates.find((candidate) => candidate.id === 'rotation-4')).toEqual(jasmine.objectContaining({
      statement: 'North High won 2 of 9 completed rallies in R4 (22%).',
      sampleSize: 9,
    }));
    expect(candidates.find((candidate) => candidate.id === 'error-service-errors')).toEqual(jasmine.objectContaining({
      statement: '#7 Maya Chen recorded the most service errors in the match: 3.',
    }));
  });

  it('returns at most three sufficiently strong and confident judgments', () => {
    const candidates = buildReviewInsightCandidates(review());
    const prioritized = prioritizeReviewInsights(candidates, [
      { id: 'rotation-4', score: 2.8, confidence: 0.82 },
      { id: 'side-out', score: 2.2, confidence: 0.7 },
      { id: 'leader-kills', score: 1.8, confidence: 0.6 },
      { id: 'error-service-errors', score: 1.7, confidence: 0.5 },
      { id: 'rotation-1', score: 1.4, confidence: 0.9 },
      { id: 'unknown', score: 3, confidence: 1 },
    ]);

    expect(prioritized.map((insight) => insight.id)).toEqual(['rotation-4', 'side-out', 'leader-kills']);
  });

  it('rejects low-confidence, malformed, and duplicate judgments', () => {
    const candidates = buildReviewInsightCandidates(review());
    const prioritized = prioritizeReviewInsights(candidates, [
      { id: 'side-out', score: 2.9, confidence: 0.1 },
      { id: 'rotation-4', score: Number.NaN, confidence: 1 },
      { id: 'leader-kills', score: 1.6, confidence: 0.4 },
      { id: 'leader-kills', score: 2.1, confidence: 0.5 },
    ]);

    expect(prioritized.map((insight) => insight.id)).toEqual(['leader-kills']);
    expect(prioritized[0].score).toBe(2.1);
  });

  function review(): MatchReviewData {
    return {
      status: 'final',
      opponentName: 'Central High',
      teamName: 'North High',
      currentSet: 4,
      startedAt: '2026-09-20T12:00:00.000Z',
      teamSets: 3,
      opponentSets: 1,
      teamPoints: 25,
      opponentPoints: 20,
      sideOutWins: 4,
      sideOutChances: 8,
      sideOutRate: 0.5,
      rotations: [
        { rotation: 1, wins: 5, rallies: 7, rate: 5 / 7 },
        { rotation: 2, wins: 0, rallies: 0, rate: null },
        { rotation: 3, wins: 0, rallies: 0, rate: null },
        { rotation: 4, wins: 2, rallies: 9, rate: 2 / 9 },
        { rotation: 5, wins: 0, rallies: 0, rate: null },
        { rotation: 6, wins: 0, rallies: 0, rate: null },
      ],
      leaders: [{ label: 'Kills', count: 7, players: '#7 Maya Chen' }],
      boxScore: [{
        playerId: 'p7', playerName: 'Maya Chen', jerseyNumber: 7,
        kills: 7, attackErrors: 1, aces: 0, blocks: 0, digs: 2,
        serviceErrors: 3, receiveErrors: 0, serveAttempts: 8, servesIn: 5,
      }],
      sets: [{ setNumber: 1, teamPoints: 25, opponentPoints: 20, won: true }],
      timeline: [],
    };
  }
});
