#!/usr/bin/env node

import { spawn } from 'node:child_process';
import process from 'node:process';

import {
  DELETE_OPERATIONS,
  PROTECTED_RESOURCES,
  assertExecutionAuthorized,
  classifyRoster,
  validateDeleteOperations,
} from './beta-match-cutover-plan.mjs';

const HELP = `Usage:
  npm run cutover:beta-match -- --project=<firebase-project-id> --export-uri=gs://<bucket>/<unique-prefix> [options]

Options:
  --database=<database-id>       Firestore database. Default: (default)
  --environment=staging         Default. Labels the run output.
  --environment=production      Labels the run output as production.
  --execute                     Export and delete. Omit for the default read-only dry run.
  --writes-paused               Acknowledge that client and Admin SDK writes are stopped.
  --confirm-project=<project>   Required for every execution; must exactly match --project.
  --help                        Show this help.
`;

function parseArgs(argv) {
  const options = {
    databaseId: '(default)',
    environment: 'staging',
    execute: false,
    writesPaused: false,
  };

  for (const argument of argv) {
    if (argument === '--help') options.help = true;
    else if (argument === '--execute') options.execute = true;
    else if (argument === '--writes-paused') options.writesPaused = true;
    else if (argument.startsWith('--project=')) options.projectId = argument.slice('--project='.length);
    else if (argument.startsWith('--export-uri=')) options.exportUri = argument.slice('--export-uri='.length);
    else if (argument.startsWith('--database=')) options.databaseId = argument.slice('--database='.length);
    else if (argument.startsWith('--environment=')) options.environment = argument.slice('--environment='.length);
    else if (argument.startsWith('--confirm-project=')) options.confirmProject = argument.slice('--confirm-project='.length);
    else throw new Error(`Unknown argument: ${argument}`);
  }

  if (options.help) return options;
  if (!options.projectId) throw new Error('--project=<firebase-project-id> is required.');
  if (!options.exportUri?.match(/^gs:\/\/[a-z0-9][a-z0-9._-]+\/.+/)) {
    throw new Error('--export-uri must be a gs:// bucket URI with a unique path prefix.');
  }
  if (!['staging', 'production'].includes(options.environment)) {
    throw new Error('--environment must be staging or production.');
  }
  return options;
}

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: 'inherit', shell: false });
    child.once('error', reject);
    child.once('exit', (code, signal) => {
      if (code === 0) resolve();
      else reject(new Error(`${command} failed with ${signal ? `signal ${signal}` : `exit code ${code}`}.`));
    });
  });
}

async function countAuthUsers(auth) {
  let count = 0;
  let pageToken;
  do {
    const page = await auth.listUsers(1000, pageToken);
    count += page.users.length;
    pageToken = page.pageToken;
  } while (pageToken);
  return count;
}

async function rosterPartitions(db) {
  const snapshot = await db.collection('roster').select('gameId').get();
  return {
    legacy: snapshot.docs.filter((document) => classifyRoster(document.get('gameId')) === 'legacy-match'),
    defaults: snapshot.docs.filter((document) => classifyRoster(document.get('gameId')) === 'default'),
    ambiguous: snapshot.docs.filter((document) => classifyRoster(document.get('gameId')) === 'ambiguous'),
  };
}

async function countNestedGameEvents(db) {
  const snapshot = await db.collectionGroup('events').get();
  return snapshot.docs.filter((document) => /^games\/[^/]+\/events\/[^/]+$/.test(document.ref.path)).length;
}

async function readCounts(db, auth) {
  const [games, events, sets, playerSetStats, roster, teams, players, authUsers] = await Promise.all([
    db.collection('games').count().get().then((result) => result.data().count),
    countNestedGameEvents(db),
    db.collection('sets').count().get().then((result) => result.data().count),
    db.collection('playerSetStats').count().get().then((result) => result.data().count),
    rosterPartitions(db),
    db.collection('teams').count().get().then((result) => result.data().count),
    db.collection('players').count().get().then((result) => result.data().count),
    countAuthUsers(auth),
  ]);

  return {
    targets: { games, nestedGameEvents: events, sets, playerSetStats, legacyMatchRosters: roster.legacy.length },
    protected: {
      authUsers,
      teams,
      players,
      matchSetupDefaults: roster.defaults.length,
      rostersWithoutGameId: roster.ambiguous.length,
    },
  };
}

async function deleteTargets(db) {
  validateDeleteOperations(DELETE_OPERATIONS);
  for (const operation of DELETE_OPERATIONS) {
    if (operation.kind === 'collection') {
      await db.recursiveDelete(db.collection(operation.path));
      continue;
    }
    const { legacy: rosterDocuments } = await rosterPartitions(db);
    for (const document of rosterDocuments) {
      await db.recursiveDelete(document.ref);
    }
  }
}

function verifyCounts(before, after) {
  const remainingTargets = Object.entries(after.targets).filter(([, count]) => count !== 0);
  if (remainingTargets.length > 0) {
    throw new Error(`Reset incomplete: target counts are not zero: ${JSON.stringify(Object.fromEntries(remainingTargets))}`);
  }
  if (JSON.stringify(before.protected) !== JSON.stringify(after.protected)) {
    throw new Error(`Protected counts changed: before=${JSON.stringify(before.protected)} after=${JSON.stringify(after.protected)}`);
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    process.stdout.write(HELP);
    return;
  }

  validateDeleteOperations(DELETE_OPERATIONS);
  if (options.execute) assertExecutionAuthorized(options);
  const { applicationDefault, deleteApp, initializeApp } = await import('firebase-admin/app');
  const { getAuth } = await import('firebase-admin/auth');
  const { getFirestore } = await import('firebase-admin/firestore');
  const app = initializeApp({ credential: applicationDefault(), projectId: options.projectId }, `beta-cutover-${Date.now()}`);

  try {
    const db = getFirestore(app, options.databaseId);
    const auth = getAuth(app);
    const before = await readCounts(db, auth);
    console.log(JSON.stringify({ mode: options.execute ? 'execute' : 'dry-run', environment: options.environment, projectId: options.projectId, databaseId: options.databaseId, exportUri: options.exportUri, deleteOperations: DELETE_OPERATIONS, protectedResources: PROTECTED_RESOURCES, before }, null, 2));

    if (!options.execute) {
      console.log('Dry run complete. No export or deletion was started.');
      return;
    }

    if (before.protected.rostersWithoutGameId > 0) {
      throw new Error('Refusing reset: roster documents without gameId need manual classification.');
    }

    await run('gcloud', [
      'firestore',
      'export',
      options.exportUri,
      `--project=${options.projectId}`,
      `--database=${options.databaseId}`,
    ]);
    await deleteTargets(db);

    const after = await readCounts(db, auth);
    verifyCounts(before, after);
    console.log(JSON.stringify({ result: 'cutover-complete', exportUri: options.exportUri, before, after }, null, 2));
  } finally {
    await deleteApp(app);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
