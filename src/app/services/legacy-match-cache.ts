const LEGACY_MATCH_CACHE_PREFIXES = [
  'spike-active-match-id-v1:',
  'spike-sync-queue-v1:',
  'spike-sync-last-success-v1:',
  'spike-sync-archive-v1:',
  'spike-match-state-v1:',
  'spike-match-stats-v1:',
] as const;

export function purgeLegacyMatchCaches(storage?: Storage): number {
  const localStorage = storage ?? (typeof window === 'undefined' ? undefined : window.localStorage);
  if (!localStorage) return 0;

  const staleKeys = Array.from({ length: localStorage.length }, (_, index) => localStorage.key(index))
    .filter((key): key is string => !!key)
    .filter((key) => LEGACY_MATCH_CACHE_PREFIXES.some((prefix) => key.startsWith(prefix)));

  staleKeys.forEach((key) => localStorage.removeItem(key));
  return staleKeys.length;
}
