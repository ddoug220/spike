import { MatchReviewData, ReviewBoxRow } from './review-data';

export type ReviewInsightKind = 'side-out' | 'rotation' | 'leader' | 'error';

export interface ReviewInsightCandidate {
  id: string;
  kind: ReviewInsightKind;
  title: string;
  statement: string;
  evidence: string;
  sampleSize: number;
}

export interface ReviewInsightScore {
  id: string;
  score: number;
  confidence: number;
}

export interface PrioritizedReviewInsight extends ReviewInsightCandidate {
  score: number;
  confidence: number;
}

export const REVIEW_INSIGHT_MIN_SCORE = 1.5;
export const REVIEW_INSIGHT_MIN_CONFIDENCE = 0.25;
export const REVIEW_INSIGHT_LIMIT = 3;

export function buildReviewInsightCandidates(review: MatchReviewData): ReviewInsightCandidate[] {
  const candidates: ReviewInsightCandidate[] = [];

  if (review.sideOutRate !== null && review.sideOutChances > 0) {
    candidates.push({
      id: 'side-out',
      kind: 'side-out',
      title: 'Side-out conversion',
      statement: `${review.teamName} won ${review.sideOutWins} of ${review.sideOutChances} side-out opportunities (${formatRate(review.sideOutRate)}).`,
      evidence: `${review.sideOutWins}/${review.sideOutChances} completed side-out opportunities`,
      sampleSize: review.sideOutChances,
    });
  }

  review.rotations
    .filter((rotation) => rotation.rate !== null && rotation.rallies > 0)
    .forEach((rotation) => {
      candidates.push({
        id: `rotation-${rotation.rotation}`,
        kind: 'rotation',
        title: `R${rotation.rotation} rally win rate`,
        statement: `${review.teamName} won ${rotation.wins} of ${rotation.rallies} completed rallies in R${rotation.rotation} (${formatRate(rotation.rate!)}).`,
        evidence: `${rotation.wins}/${rotation.rallies} completed rallies`,
        sampleSize: rotation.rallies,
      });
    });

  review.leaders.forEach((leader) => {
    const noun = leader.label.toLowerCase();
    candidates.push({
      id: `leader-${slug(leader.label)}`,
      kind: 'leader',
      title: `${leader.label} leader`,
      statement: `${leader.players} led the match with ${leader.count} ${noun}.`,
      evidence: `${leader.count} recorded ${noun}`,
      sampleSize: leader.count,
    });
  });

  const errorFields: Array<{ id: string; title: string; noun: string; read: (row: ReviewBoxRow) => number }> = [
    { id: 'attack-errors', title: 'Attack errors', noun: 'attack errors', read: (row) => row.attackErrors },
    { id: 'service-errors', title: 'Service errors', noun: 'service errors', read: (row) => row.serviceErrors },
    { id: 'receive-errors', title: 'Receive errors', noun: 'receive errors', read: (row) => row.receiveErrors },
  ];

  errorFields.forEach(({ id, title, noun, read }) => {
    const count = Math.max(0, ...review.boxScore.map(read));
    if (count === 0) return;
    const players = review.boxScore.filter((row) => read(row) === count).map(playerLabel).join(', ');
    candidates.push({
      id: `error-${id}`,
      kind: 'error',
      title,
      statement: `${players} recorded the most ${noun} in the match: ${count}.`,
      evidence: `${count} recorded ${noun}`,
      sampleSize: count,
    });
  });

  return candidates;
}

export function prioritizeReviewInsights(
  candidates: ReviewInsightCandidate[],
  scores: ReviewInsightScore[],
): PrioritizedReviewInsight[] {
  const candidatesById = new Map(candidates.map((candidate) => [candidate.id, candidate]));
  const bestScoreById = new Map<string, ReviewInsightScore>();

  scores.forEach((result) => {
    if (!isValidScore(result) || !candidatesById.has(result.id)) return;
    const current = bestScoreById.get(result.id);
    if (!current || result.score > current.score ||
      (result.score === current.score && result.confidence > current.confidence)) {
      bestScoreById.set(result.id, result);
    }
  });

  return [...bestScoreById.values()]
    .filter((result) => result.score >= REVIEW_INSIGHT_MIN_SCORE && result.confidence >= REVIEW_INSIGHT_MIN_CONFIDENCE)
    .sort((left, right) => right.score - left.score || right.confidence - left.confidence || left.id.localeCompare(right.id))
    .slice(0, REVIEW_INSIGHT_LIMIT)
    .map((result) => ({ ...candidatesById.get(result.id)!, ...result }));
}

function isValidScore(result: ReviewInsightScore): boolean {
  return typeof result.id === 'string' &&
    Number.isFinite(result.score) && result.score >= 0 && result.score <= 3 &&
    Number.isFinite(result.confidence) && result.confidence >= 0 && result.confidence <= 1;
}

function playerLabel(row: ReviewBoxRow): string {
  return `${row.jerseyNumber === null ? '' : `#${row.jerseyNumber} `}${row.playerName}`;
}

function formatRate(rate: number): string {
  return `${Math.round(rate * 100)}%`;
}

function slug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
}
