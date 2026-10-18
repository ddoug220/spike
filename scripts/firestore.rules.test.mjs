import { readFile } from 'node:fs/promises';
import { after, before, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
} from '@firebase/rules-unit-testing';
import {
  collection, deleteDoc, deleteField, doc, getDoc, getDocs,
  query, setDoc, updateDoc, where,
} from 'firebase/firestore';

const timestamp = '2026-10-03T12:00:00.000Z';
const later = '2026-10-03T12:01:00.000Z';
let environment;
let alice;
let bob;
let signedOut;

const team = (id, ownerId) => ({ id, ownerId, name: 'North High', createdAt: timestamp, updatedAt: timestamp });
const player = (id, ownerId, teamId) => ({
  id, ownerId, teamId, name: 'Ava Johnson', jerseyNumber: 12,
  primaryPosition: 'OH', active: true, createdAt: timestamp, updatedAt: timestamp,
});
const game = (id, ownerId, teamId) => ({
  id, ownerId, teamId, teamName: 'North High', opponentName: 'South High',
  status: 'live', servingTeam: 'team', teamPoints: 0, opponentPoints: 0,
  teamSets: 0, opponentSets: 0, currentSet: 1, isMatchOver: false,
  isSetBreak: false, teamTimeoutsRemaining: 2, opponentTimeoutsRemaining: 2,
  teamRotation: 1, startedAt: timestamp, endedAt: null,
  createdAt: timestamp, updatedAt: timestamp, schemaVersion: 2,
  writerDeviceId: 'device-1', writerGeneration: 1,
  matchFormat: 'best-of-3',
  matchSquad: Array.from({ length: 6 }, (_, index) => ({
    id: `squad-${index + 1}`, name: `Player ${index + 1}`,
    jerseyNumber: index + 1, primaryPosition: 'OH',
  })),
  startingLineup: ['squad-1', 'squad-2', 'squad-3', 'squad-4', 'squad-5', 'squad-6'],
});
const roster = (id, ownerId, teamId) => ({
  id, ownerId, teamId, gameId: null, lineup: [null, null, null, null, null, null],
  squadPlayerIds: [], matchFormat: 'best-of-3', createdAt: timestamp, updatedAt: timestamp,
});
const gameSet = (id, ownerId, gameId) => ({
  id, ownerId, gameId, setNumber: 1, teamPoints: 0, opponentPoints: 0,
  teamWon: false, completedAt: null, createdAt: timestamp, updatedAt: timestamp,
});
const event = (id, ownerId, gameId, overrides = {}) => ({
  id, ownerId, gameId, type: 'matchStarted', action: 'match-started',
  createdAt: timestamp, isDeleted: false, deletedAt: null, schemaVersion: 2,
  sequence: 1, writerDeviceId: 'device-1', writerGeneration: 1,
  eventKind: 'match-started', servingTeam: 'team',
  lineup: ['squad-1', 'squad-2', 'squad-3', 'squad-4', 'squad-5', 'squad-6'],
  ...overrides,
});
const stats = (id, ownerId, gameId, playerId) => ({
  id, ownerId, gameId, playerId, playerName: 'Ava Johnson', jerseyNumber: 12,
  setNumber: null, kills: 0, attackErrors: 0, totalAttacks: 0, aces: 0,
  serveAttempts: 0, servesIn: 0, serveInPercentage: null, blocks: 0, digs: 0,
  serviceErrors: 0, receiveErrors: 0, createdAt: timestamp, updatedAt: timestamp,
  writerDeviceId: 'device-1', writerGeneration: 1,
});

const documents = {
  'teams/team-alice': team('team-alice', 'alice'),
  'teams/team-bob': team('team-bob', 'bob'),
  'players/player-alice': player('player-alice', 'alice', 'team-alice'),
  'players/player-bob': player('player-bob', 'bob', 'team-bob'),
  'games/game-alice': game('game-alice', 'alice', 'team-alice'),
  'games/game-bob': game('game-bob', 'bob', 'team-bob'),
  'roster/roster-alice': roster('roster-alice', 'alice', 'team-alice'),
  'roster/roster-bob': roster('roster-bob', 'bob', 'team-bob'),
  'sets/set-alice': gameSet('set-alice', 'alice', 'game-alice'),
  'sets/set-bob': gameSet('set-bob', 'bob', 'game-bob'),
  'games/game-alice/events/event-alice': event('event-alice', 'alice', 'game-alice'),
  'games/game-bob/events/event-bob': event('event-bob', 'bob', 'game-bob'),
  'playerSetStats/stats-alice': stats('stats-alice', 'alice', 'game-alice', 'player-alice'),
  'playerSetStats/stats-bob': stats('stats-bob', 'bob', 'game-bob', 'player-bob'),
};
const alicePaths = Object.keys(documents).filter((path) => documents[path].ownerId === 'alice');

before(async () => {
  const rulesPath = process.env.SPIKE_FIRESTORE_RULES ?? new URL('../firestore.rules', import.meta.url);
  environment = await initializeTestEnvironment({
    projectId: 'demo-spike-rules',
    firestore: { rules: await readFile(rulesPath, 'utf8') },
  });
  alice = environment.authenticatedContext('alice').firestore();
  bob = environment.authenticatedContext('bob').firestore();
  signedOut = environment.unauthenticatedContext().firestore();
});

beforeEach(async () => {
  await environment.clearFirestore();
  await environment.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    await Promise.all(Object.entries(documents).map(([path, data]) => setDoc(doc(db, path), data)));
  });
});

after(async () => { await environment?.cleanup(); });

test('signed-out clients cannot read, query, create, update, or delete private data', async () => {
  for (const path of alicePaths) {
    await assertFails(getDoc(doc(signedOut, path)));
    await assertFails(setDoc(doc(signedOut, path), documents[path]));
    await assertFails(updateDoc(doc(signedOut, path), { updatedAt: later }));
    await assertFails(deleteDoc(doc(signedOut, path)));
  }
  for (const name of ['teams', 'players', 'games', 'roster', 'sets', 'playerSetStats']) {
    await assertFails(getDocs(collection(signedOut, name)));
  }
});

test('another account cannot read, overwrite, or delete private documents', async () => {
  for (const path of alicePaths) {
    await assertFails(getDoc(doc(bob, path)));
    await assertFails(setDoc(doc(bob, path), documents[path]));
    await assertFails(deleteDoc(doc(bob, path)));
  }
  await assertFails(setDoc(doc(bob, 'teams/forged'), team('forged', 'alice')));
});

test('owner-scoped team, player, roster, match, and set queries succeed', async () => {
  for (const name of ['teams', 'players', 'roster', 'games', 'sets']) {
    const result = await assertSucceeds(getDocs(query(collection(alice, name), where('ownerId', '==', 'alice'))));
    assert.equal(result.size, 1);
    await assertFails(getDocs(collection(alice, name)));
  }
});

test('the app can query its own match statistics and events', async () => {
  const result = await assertSucceeds(getDocs(query(collection(alice, 'playerSetStats'), where('gameId', '==', 'game-alice'), where('ownerId', '==', 'alice'))));
  assert.equal(result.docs[0].id, 'stats-alice');
  const events = await assertSucceeds(getDocs(query(collection(alice, 'games/game-alice/events'), where('ownerId', '==', 'alice'))));
  assert.equal(events.docs[0].id, 'event-alice');
  await assertFails(getDocs(query(collection(bob, 'playerSetStats'), where('gameId', '==', 'game-alice'))));
  await assertFails(getDocs(collection(alice, 'playerSetStats')));
});

test('reusing a legacy orphaned match ID does not reveal the previous owner’s events or statistics', async () => {
  await environment.withSecurityRulesDisabled((context) => deleteDoc(doc(context.firestore(), 'games/game-alice')));
  await assertSucceeds(setDoc(doc(bob, 'games/game-alice'), game('game-alice', 'bob', 'team-bob')));
  await assertFails(getDoc(doc(bob, 'games/game-alice/events/event-alice')));
  await assertFails(getDoc(doc(bob, 'playerSetStats/stats-alice')));
  const events = await assertSucceeds(getDocs(query(collection(bob, 'games/game-alice/events'), where('ownerId', '==', 'bob'))));
  const statistics = await assertSucceeds(getDocs(query(collection(bob, 'playerSetStats'), where('gameId', '==', 'game-alice'), where('ownerId', '==', 'bob'))));
  assert.equal(events.empty, true);
  assert.equal(statistics.empty, true);
});

test('an attacker cannot claim another account’s statistics by replacing owner and match', async () => {
  await assertFails(setDoc(doc(bob, 'playerSetStats/stats-alice'), stats('stats-alice', 'bob', 'game-bob', 'player-bob')));
});

test('owners can create, update, and delete saved teams, players, and match setup', async () => {
  const data = [
    ['teams/new-team', team('new-team', 'alice')],
    ['players/new-player', player('new-player', 'alice', 'new-team')],
    ['roster/new-roster', roster('new-roster', 'alice', 'new-team')],
  ];
  for (const [path, value] of data) {
    await assertSucceeds(setDoc(doc(alice, path), value));
    await assertSucceeds(updateDoc(doc(alice, path), { updatedAt: later }));
  }
  for (const [path] of data.toReversed()) await assertSucceeds(deleteDoc(doc(alice, path)));
});

test('owners can create a match, append events, and update projected statistics', async () => {
  await assertSucceeds(setDoc(doc(alice, 'games/new-game'), game('new-game', 'alice', 'team-alice')));
  await assertSucceeds(setDoc(doc(alice, 'games/new-game/events/new-event'), event('new-event', 'alice', 'new-game')));
  await assertSucceeds(setDoc(doc(alice, 'playerSetStats/new-stats'), stats('new-stats', 'alice', 'new-game', 'player-alice')));
  await assertSucceeds(updateDoc(doc(alice, 'playerSetStats/new-stats'), { digs: 1, updatedAt: later }));
  await assertSucceeds(updateDoc(doc(alice, 'games/new-game'), { teamPoints: 1, updatedAt: later }));
});

test('document identity, owner, and creation date cannot change', async () => {
  for (const path of alicePaths.filter((path) => !path.includes('/events/'))) {
    for (const patch of [{ id: 'replaced' }, { ownerId: 'bob' }, { createdAt: later }]) {
      await assertFails(updateDoc(doc(alice, path), patch));
    }
  }
});

test('unknown collections and nested paths stay inaccessible', async () => {
  for (const path of ['users/alice', 'events/legacy-event', 'games/game-alice/private/secret']) {
    await assertFails(setDoc(doc(alice, path), { ownerId: 'alice' }));
    await assertFails(getDoc(doc(alice, path)));
  }
});

test('events can be retried unchanged but cannot be edited or deleted', async () => {
  const path = 'games/game-alice/events/event-alice';
  await assertSucceeds(setDoc(doc(alice, path), documents[path], { merge: true }));
  await assertFails(updateDoc(doc(alice, path), { action: 'Rewritten score' }));
  await assertFails(updateDoc(doc(alice, path), { isDeleted: true, deletedAt: later }));
  await assertFails(deleteDoc(doc(alice, path)));
});

test('events must match their parent and cannot be orphaned', async () => {
  await assertFails(setDoc(doc(alice, 'games/game-alice/events/wrong-match'), event('wrong-match', 'alice', 'game-bob')));
  await assertFails(setDoc(doc(alice, 'games/missing/events/orphan'), event('orphan', 'alice', 'missing')));
  await assertFails(setDoc(doc(bob, 'games/game-alice/events/forged'), event('forged', 'bob', 'game-alice')));
});

test('a takeover advances the generation and rejects stale scoring writes', async () => {
  await assertSucceeds(updateDoc(doc(alice, 'games/game-alice'), { writerDeviceId: 'device-2', writerGeneration: 2, updatedAt: later }));
  await assertFails(setDoc(doc(alice, 'games/game-alice/events/stale'), event('stale', 'alice', 'game-alice', { sequence: 2 })));
  await assertFails(updateDoc(doc(alice, 'playerSetStats/stats-alice'), { digs: 1 }));
  await assertSucceeds(setDoc(doc(alice, 'games/game-alice/events/current'), event('current', 'alice', 'game-alice', {
    writerDeviceId: 'device-2', writerGeneration: 2, sequence: 2,
    type: 'undo', action: 'undo', eventKind: 'undo', targetEventId: 'event-alice',
  })));
  await assertSucceeds(updateDoc(doc(alice, 'playerSetStats/stats-alice'), { writerDeviceId: 'device-2', writerGeneration: 2, digs: 1 }));
});

test('takeover cannot skip generations, reuse the old device, or rewrite scores', async () => {
  for (const patch of [
    { writerGeneration: 3, writerDeviceId: 'device-2' },
    { writerGeneration: 2, writerDeviceId: 'device-1' },
    { writerGeneration: 1, writerDeviceId: 'device-2' },
    { writerGeneration: 2, writerDeviceId: 'device-2', teamPoints: 99 },
  ]) await assertFails(updateDoc(doc(alice, 'games/game-alice'), patch));
  await assertFails(setDoc(doc(alice, 'games/invalid-generation'), {
    ...game('invalid-generation', 'alice', 'team-alice'), writerGeneration: 2,
  }));
});

test('writes cannot reference another owner’s team or match', async () => {
  await assertFails(setDoc(doc(alice, 'players/foreign-player'), player('foreign-player', 'alice', 'team-bob')));
  await assertFails(setDoc(doc(alice, 'games/foreign-game'), game('foreign-game', 'alice', 'team-bob')));
  await assertFails(setDoc(doc(alice, 'roster/foreign-roster'), roster('foreign-roster', 'alice', 'team-bob')));
  await assertFails(setDoc(doc(alice, 'sets/foreign-set'), gameSet('foreign-set', 'alice', 'game-bob')));
  await assertFails(setDoc(doc(alice, 'playerSetStats/foreign-stats'), stats('foreign-stats', 'alice', 'game-bob', 'player-alice')));
});

test('statistics cannot be moved between matches or players', async () => {
  await assertSucceeds(setDoc(doc(alice, 'games/second-game'), game('second-game', 'alice', 'team-alice')));
  await assertFails(updateDoc(doc(alice, 'playerSetStats/stats-alice'), { gameId: 'second-game' }));
  await assertFails(updateDoc(doc(alice, 'playerSetStats/stats-alice'), { playerId: 'another-player' }));
});

test('creates and updates reject missing fields, wrong types, and extra fields', async () => {
  for (const path of alicePaths.filter((path) => !path.includes('/events/'))) {
    const data = documents[path];
    await assertFails(updateDoc(doc(alice, path), { createdAt: deleteField() }));
    await assertFails(updateDoc(doc(alice, path), { updatedAt: 123 }));
    await assertFails(updateDoc(doc(alice, path), { isAdmin: true }));
    const malformed = { ...data, isAdmin: true };
    const newId = `invalid-${data.id}`;
    await assertFails(setDoc(doc(alice, `${path.split('/')[0]}/${newId}`), { ...malformed, id: newId }));
  }
});

test('large strings, negative counters, and invalid enumerations are denied', async () => {
  await assertFails(updateDoc(doc(alice, 'teams/team-alice'), { name: 'x'.repeat(10000) }));
  await assertFails(updateDoc(doc(alice, 'players/player-alice'), { jerseyNumber: -1 }));
  await assertFails(updateDoc(doc(alice, 'players/player-alice'), { primaryPosition: 'coach' }));
  await assertFails(updateDoc(doc(alice, 'games/game-alice'), { teamPoints: -1 }));
  await assertFails(updateDoc(doc(alice, 'games/game-alice'), { status: 'unknown' }));
  await assertFails(updateDoc(doc(alice, 'playerSetStats/stats-alice'), { serveInPercentage: 1.1 }));
  await assertFails(updateDoc(doc(alice, 'roster/roster-alice'), { lineup: Array(1000).fill('player-alice') }));
});
