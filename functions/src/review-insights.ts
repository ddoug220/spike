import { score } from '@typesafe-ai/sdk';
import { HttpsError } from 'firebase-functions/v2/https';

export const MAX_REVIEW_INSIGHT_CANDIDATES = 20;

const REVIEW_PRIORITY_CRITERIA = [
  'Routine or too thinly supported to deserve space in a short match review.',
  'Useful background, but unlikely to be among the first facts a coach should review.',
  'Worth reviewing because it identifies a meaningful recorded strength, concern, or match pattern.',
  'A top review priority because it is strongly supported and likely to affect the coach’s next preparation or decision.',
] as const;

const candidateKinds = ['side-out', 'rotation', 'leader', 'error'] as const;

export interface ReviewInsightCandidateInput {
  id: string;
  kind: typeof candidateKinds[number];
  title: string;
  statement: string;
  evidence: string;
  sampleSize: number;
}

export interface ReviewInsightMatchInput {
  status: 'live' | 'final' | 'ended-early';
  teamName: string;
  opponentName: string;
  teamSets: number;
  opponentSets: number;
  completedSets: number;
}

export interface ReviewInsightRequest {
  match: ReviewInsightMatchInput;
  candidates: ReviewInsightCandidateInput[];
}

export function parseReviewInsightRequest(value: unknown): ReviewInsightRequest {
  if (!isRecord(value) || !isRecord(value.match) || !Array.isArray(value.candidates)) {
    throw invalidArgument();
  }
  if (value.candidates.length === 0 || value.candidates.length > MAX_REVIEW_INSIGHT_CANDIDATES) {
    throw invalidArgument();
  }

  const match = value.match;
  const status = match.status;
  if (status !== 'live' && status !== 'final' && status !== 'ended-early') throw invalidArgument();

  const parsedMatch: ReviewInsightMatchInput = {
    status,
    teamName: readString(match.teamName, 80),
    opponentName: readString(match.opponentName, 80),
    teamSets: readCount(match.teamSets, 5),
    opponentSets: readCount(match.opponentSets, 5),
    completedSets: readCount(match.completedSets, 5),
  };

  const ids = new Set<string>();
  const candidates = value.candidates.map((candidate): ReviewInsightCandidateInput => {
    if (!isRecord(candidate) || !candidateKinds.includes(candidate.kind as typeof candidateKinds[number])) {
      throw invalidArgument();
    }
    const id = readString(candidate.id, 64);
    if (!/^[a-z0-9-]+$/.test(id) || ids.has(id)) throw invalidArgument();
    ids.add(id);
    return {
      id,
      kind: candidate.kind as ReviewInsightCandidateInput['kind'],
      title: readString(candidate.title, 100),
      statement: readString(candidate.statement, 320),
      evidence: readString(candidate.evidence, 160),
      sampleSize: readCount(candidate.sampleSize, 10000),
    };
  });

  return { match: parsedMatch, candidates };
}

export function buildReviewInsightQuestions(candidates: ReviewInsightCandidateInput[]) {
  return Object.fromEntries(candidates.map((candidate, index) => [
    questionId(index),
    score(
      `Rate how valuable \`candidates[${index}]\` is as one of at most three facts a volleyball coach should review from this match. Compare it with the other facts in \`candidates\`. Use only the recorded statement, evidence, and sample size; do not infer unrecorded performance or intent.`,
      REVIEW_PRIORITY_CRITERIA,
    ),
  ]));
}

export function questionId(index: number): string {
  return `priority_${index}`;
}

function invalidArgument(): HttpsError {
  return new HttpsError('invalid-argument', 'Review insight facts are invalid.');
}

function readString(value: unknown, maxLength: number): string {
  if (typeof value !== 'string') throw invalidArgument();
  const normalized = value.trim();
  if (!normalized || normalized.length > maxLength) throw invalidArgument();
  return normalized;
}

function readCount(value: unknown, max: number): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0 || value > max) {
    throw invalidArgument();
  }
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}
