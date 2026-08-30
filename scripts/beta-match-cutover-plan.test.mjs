import assert from 'node:assert/strict';
import test from 'node:test';

import {
  DELETE_OPERATIONS,
  PROTECTED_RESOURCES,
  assertExecutionAuthorized,
  classifyRoster,
  validateDeleteOperations,
} from './beta-match-cutover-plan.mjs';

test('the fixed deletion plan excludes protected account and Team Roster data', () => {
  assert.doesNotThrow(() => validateDeleteOperations(DELETE_OPERATIONS));

  const serializedPlan = JSON.stringify(DELETE_OPERATIONS);
  for (const resource of PROTECTED_RESOURCES) {
    assert.equal(serializedPlan.includes(resource), false, `${resource} appeared in the deletion plan`);
  }
});

test('the validator rejects every protected resource and arbitrary paths', () => {
  for (const resource of PROTECTED_RESOURCES) {
    assert.throws(
      () => validateDeleteOperations([{ kind: 'collection', path: resource }]),
      /Refusing unsafe deletion plan/,
    );
  }

  assert.throws(
    () => validateDeleteOperations([{ kind: 'collection', path: 'games/example' }]),
    /Refusing unsafe deletion plan/,
  );
  assert.throws(
    () => validateDeleteOperations([{ kind: 'collection', path: 'roster' }]),
    /Refusing unsafe deletion plan/,
  );
  assert.throws(
    () => validateDeleteOperations([{ kind: 'query', path: 'roster', field: 'gameId', operator: '==', value: null }]),
    /Refusing unsafe deletion plan/,
  );
});

test('production execution requires three independent acknowledgements', () => {
  const base = {
    environment: 'production',
    projectId: 'spike-production',
    execute: true,
    writesPaused: true,
    confirmProject: 'spike-production',
  };

  assert.doesNotThrow(() => assertExecutionAuthorized(base));
  assert.throws(() => assertExecutionAuthorized({ ...base, execute: false }), /--execute/);
  assert.throws(() => assertExecutionAuthorized({ ...base, writesPaused: false }), /--writes-paused/);
  assert.throws(() => assertExecutionAuthorized({ ...base, confirmProject: 'another-project' }), /--confirm-project/);
});

test('every destructive run requires the exact project confirmation', () => {
  const staging = {
    environment: 'staging',
    projectId: 'spike-staging',
    execute: true,
    writesPaused: true,
  };

  assert.throws(() => assertExecutionAuthorized(staging), /--confirm-project/);
  assert.doesNotThrow(() => assertExecutionAuthorized({ ...staging, confirmProject: staging.projectId }));
});

test('only roster documents with an explicit match id are legacy targets', () => {
  assert.equal(classifyRoster('game-1'), 'legacy-match');
  assert.equal(classifyRoster(null), 'default');
  assert.equal(classifyRoster(undefined), 'ambiguous');
});
