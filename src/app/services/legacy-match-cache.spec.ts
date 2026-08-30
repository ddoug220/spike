import { purgeLegacyMatchCaches } from './legacy-match-cache';

describe('legacy match cache cutover', () => {
  beforeEach(() => window.localStorage.clear());

  it('removes v1 match caches for every owner but preserves Team Roster and identity caches', () => {
    const legacyMatchKeys = [
      'spike-active-match-id-v1:owner-1',
      'spike-sync-queue-v1:owner-1',
      'spike-sync-last-success-v1:owner-2',
      'spike-sync-archive-v1:signed-out',
      'spike-match-state-v1:owner-1',
      'spike-match-stats-v1:owner-2',
    ];
    const protectedKeys = [
      'spike-beta-owner-id-v1',
      'spike-volleyball-roster-v1:owner-1',
      'spike-scoring-device-v2:owner-1',
      'unrelated-key',
    ];

    [...legacyMatchKeys, ...protectedKeys].forEach((key) => window.localStorage.setItem(key, 'saved'));

    expect(purgeLegacyMatchCaches(window.localStorage)).toBe(legacyMatchKeys.length);
    legacyMatchKeys.forEach((key) => expect(window.localStorage.getItem(key)).toBeNull());
    protectedKeys.forEach((key) => expect(window.localStorage.getItem(key)).toBe('saved'));
  });
});
