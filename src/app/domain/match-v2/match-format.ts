export type MatchFormat = 'best-of-3' | 'best-of-5';

export const DEFAULT_MATCH_FORMAT: MatchFormat = 'best-of-3';
export const LEGACY_MATCH_FORMAT: MatchFormat = 'best-of-5';

export function setsToWin(format: MatchFormat): 2 | 3 {
  return format === 'best-of-3' ? 2 : 3;
}

export function decidingSetNumber(format: MatchFormat): 3 | 5 {
  return format === 'best-of-3' ? 3 : 5;
}

export function setPointTarget(format: MatchFormat, setNumber: number): 15 | 25 {
  return setNumber === decidingSetNumber(format) ? 15 : 25;
}

export function isMatchFormat(value: unknown): value is MatchFormat {
  return value === 'best-of-3' || value === 'best-of-5';
}
