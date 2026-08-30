export const DELETE_OPERATIONS = Object.freeze([
  Object.freeze({ kind: 'collection', path: 'games' }),
  Object.freeze({ kind: 'collection', path: 'sets' }),
  Object.freeze({ kind: 'collection', path: 'playerSetStats' }),
  Object.freeze({ kind: 'query', path: 'roster', field: 'gameId', operator: '!=', value: null }),
]);

export const PROTECTED_RESOURCES = Object.freeze([
  'firebase-auth-users',
  'teams',
  'players',
  'roster-defaults',
  'rosters-without-game-id',
]);

const EXPECTED_PLAN = JSON.stringify(DELETE_OPERATIONS);

export function validateDeleteOperations(operations) {
  if (JSON.stringify(operations) !== EXPECTED_PLAN) {
    throw new Error('Refusing unsafe deletion plan: targets must match the fixed beta match-data allowlist.');
  }
}

export function assertExecutionAuthorized(options) {
  if (!options.execute) {
    throw new Error('Execution requires --execute. Without it, the tool is dry-run only.');
  }
  if (!options.writesPaused) {
    throw new Error('Execution requires --writes-paused after beta access and privileged writers are stopped.');
  }
  if (options.confirmProject !== options.projectId) {
    throw new Error('Execution requires --confirm-project=<exact project id>.');
  }
}

export function classifyRoster(gameId) {
  if (gameId === null) return 'default';
  if (gameId === undefined) return 'ambiguous';
  return 'legacy-match';
}
