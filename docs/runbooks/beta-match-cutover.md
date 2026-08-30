# Beta match-data cutover

Use this runbook to replace beta match data without deleting Firebase Auth users, teams, players, or reusable Match Setup defaults. The reset tool is dry-run by default. Never use it while beta clients or privileged services can write.

## What the tool can delete

The deletion plan is fixed in code. It recursively deletes these Firestore targets:

- `games`, including every nested `games/{gameId}/events` subcollection
- `sets`
- `playerSetStats`
- `roster` documents whose `gameId` is not `null`, including any nested data

It cannot accept a collection path from the command line. `teams`, `players`, Firebase Auth users, and `roster` documents whose `gameId` is `null` are protected. A roster document with no `gameId` blocks execution for manual review. The client release also removes owner-scoped v1 match caches and starts clean v2 caches. It does not remove the Team Roster cache, beta identity, or scoring-device identity.

## Preconditions

1. Keep the previous application artifact or revision and the previous `firestore.rules` available.
2. Create a unique Cloud Storage export prefix in a bucket near the Firestore database. Confirm billing and the Firestore service agent's bucket access.
3. Authenticate both tools:
   - `gcloud auth application-default login` for the Firebase Admin SDK reads and deletes.
   - `gcloud auth login` for the managed Firestore export.
4. Confirm every beta device reports zero pending sync writes. An offline-only match is not in the Firestore export and cannot be recovered after its v1 cache is cleared.
5. Pass the complete staging smoke path: a full match, set transition, offline refresh, reconnect, Match Review, and scoring takeover.
6. Close beta access. Deploy rules that deny client writes and stop any Admin SDK or server writers. Firestore rules do not stop privileged Admin SDK writes.

## Preview the exact scope

Run the read-only dry run and save its output. It counts target documents plus protected Auth users, teams, players, and Match Setup defaults. It does not start an export or delete anything.

```sh
npm run cutover:beta-match -- \
  --project=YOUR_STAGING_PROJECT \
  --export-uri=gs://YOUR_BUCKET/beta-cutover/STAGING_UNIQUE_PREFIX
```

Review the printed `deleteOperations`, `before.targets`, and `before.protected`. Stop if any count or project is unexpected.

## Rehearse in staging

With staging writes still paused, run the same command with all execution acknowledgements:

```sh
npm run cutover:beta-match -- \
  --project=YOUR_STAGING_PROJECT \
  --export-uri=gs://YOUR_BUCKET/beta-cutover/STAGING_UNIQUE_PREFIX \
  --execute \
  --writes-paused \
  --confirm-project=YOUR_STAGING_PROJECT
```

The tool counts first, waits for a complete managed Firestore export, recursively deletes the allowlisted data, recounts, and fails unless every target count is zero and every protected count is unchanged. Keep the terminal output and exact export URI with the release record.

Deploy the application and `firestore.rules` in the same closed-access release window. This repository has no Firebase Hosting target, so use the application's real release command and `firebase deploy --only firestore:rules --project YOUR_PROJECT`; do not reopen access unless both deploys succeed. Restore normal write rules only as part of that coordinated release.

Repeat the full staging smoke path against the deployed release.

## Execute in production

Every destructive run requires an exact project-ID confirmation. Label the production run explicitly in its saved output, re-run the dry run immediately before execution, keep writes paused, and use a new export prefix.

```sh
npm run cutover:beta-match -- \
  --project=YOUR_PRODUCTION_PROJECT \
  --export-uri=gs://YOUR_BUCKET/beta-cutover/PRODUCTION_UNIQUE_PREFIX \
  --environment=production \
  --execute \
  --writes-paused \
  --confirm-project=YOUR_PRODUCTION_PROJECT
```

Deploy the application and rules together while access remains closed. Run one production smoke match through completion, refresh, reconnect, Match Review, and takeover. Reopen beta access only after that smoke match passes and the saved output shows zero target counts with unchanged protected counts.

## Roll back

Keep writes paused throughout rollback.

1. Redeploy the previous application and its matching previous Firestore rules.
2. Import the exact completed export recorded by the tool:

   ```sh
   gcloud firestore import gs://YOUR_BUCKET/beta-cutover/RECORDED_PREFIX \
     --project=YOUR_PROJECT \
     --database='(default)'
   ```

3. Wait for the import to complete. Re-run the cutover tool without `--execute` to inspect restored collection counts.
4. Smoke-test the previous release, then reopen beta access.

The export covers the entire Firestore database, so it includes protected collections even though the tool never deletes them. Firebase Auth users are outside Firestore and are never targeted. Managed import overwrites matching documents but does not remove unrelated documents; this is why writes must remain paused. Cleared browser v1 caches are not restored by a Firestore import.
