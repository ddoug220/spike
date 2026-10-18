# Spike

Spike is an Ionic/Angular volleyball match tracker. It helps a coach or stat keeper save a team roster, set a starting six, track a live match from a court view, and review completed matches later.

## Quick start

1. Install dependencies:

   ```bash
   pnpm install
   ```

2. Start the local app:

   ```bash
   npm start
   ```

   To run the end-to-end tests, install Chromium once:

   ```bash
   npx playwright install chromium
   ```

3. Open the local Angular URL printed by the dev server, usually `http://localhost:4200`.

4. Sign in or create an account. Spike saves match data on the device first and syncs to Firebase when cloud access is available.

## Use Spike

Think of the app as three steps:

1. **Build the saved player pool**

   Open **Team & Lineup** and enter your team name. Add players one at a time, or paste the roster from a spreadsheet as rows of `jersey, player name, position` (tabs work too). Positions are `S`, `OH`, `MB`, `OPP`, `L`, or `DS`; if omitted, a player's position defaults to `OH`. Spike checks every row before saving the roster. This pool is saved and reused, so you do not need to rebuild the team before every match.

2. **Set today's starting six**

   Tap a player in the saved pool, then tap a court spot. You can also drag a player onto a court spot. Spike needs six unique starters before it can start a match.

3. **Track the live match**

   Enter the opponent name, choose who serves first, then press **Start Match**. On the Live Court, tap a player to select them before recording player-specific actions.

## Live Court basics

- **Point to [team name]** columns identify which team receives the point. Select a player for individual stats. Ace and Service error automatically record against the named P1 server.
- **Dig · Record stat · no point** records a player stat without changing the score.
- **Undo** removes the most recent tracked action.
- **Substitute** opens the bench panel. Pick the player coming out, then tap the bench player going in.
- **Exit** leaves the court. After a finished match, use **Set Up Next Match** to confirm the next opponent and match details.
- **Team & Stats** opens the full Match Squad box score, including bench players, jersey numbers, positions, every recorded player stat, and team totals. Choose **Entire match** or an individual set. Close the panel to return to scoring.

Live Court keeps player selection, outcomes, Dig, and the latest-action receipt with Undo visible together on phones and landscape tablets. On phones, **More** opens the expanded court, substitutions, match controls, statistics, and navigation. Those secondary panels may scroll.

## Cloud save

For publishing and device checks, follow the [web release runbook](docs/runbooks/web-release.md).

Spike writes locally first, then queues cloud sync. The Home and Team & Lineup screens show whether changes are synced, waiting, or need a retry. If Firebase is unavailable, you can keep using the app and retry sync later.

Reopening Spike restores the saved Team Roster, Match Setup lineup, active match, substitutions, timeouts, and recorded statistics. Pending cloud saves retry automatically when the app restarts online or reconnects. Previously loaded saved teams remain available on this device. Each match keeps its team name and player details, so later Team Roster edits do not rewrite old box scores. Match History retains earlier matches when you start the next one.

Open the deployed HTTPS app while connected before arriving courtside. When the save indicator shows **Ready offline**, the app's screens are cached and can reopen offline, including the active match and saved reviews. Offline startup is enabled in production builds; the development server does not cache the app.

If device storage fails, Spike displays a warning and **Retry**. Keep the app open until Retry succeeds; changes that have not reached device storage or the cloud cannot survive closing it.

## Firebase Security Rules

The app uses Firebase project `volleyballdb-9223f` and the default Firestore database. Rules in `firestore.rules` restrict team, player, match, lineup, event, and statistics access to the authenticated owner. Events and statistics also require ownership of their parent match. Their client queries include the owner's UID. The app sorts the returned events by creation date, keeping the event query on a single indexed field. Events are immutable, with unchanged retries allowed; a scoring takeover advances the writer generation before the new device can append events. Client match deletion is denied because deleting a parent document leaves its event collection behind.

Install Firebase's official agent plugin for Codex:

```bash
codex plugin marketplace add firebase/agent-skills
codex plugin add firebase@firebase
```

For later updates, run `codex plugin marketplace upgrade firebase` followed by `codex plugin add firebase@firebase`. Newly installed skills are available on the next turn. Reload the desktop app if it does not show the new plugin. Use its Firestore and Security Rules skills when changing Firebase code.

The rules tests require Node.js 20 or later and Java 21 or later. They use Firebase's official rules-testing library against a local Firestore emulator on `127.0.0.1:8085`, with an isolated demo project and no production writes:

```bash
pnpm install
npm run test:rules
```

Review existing cloud documents against the validators before releasing a stricter schema. The rules preserve the app's ISO date strings and allow delayed offline writes; creation dates cannot change on updates. Variable squad lists have size limits, while their individual entries are not all validated. Six-position lineups are validated individually. Writer device IDs are client-provided identifiers, so generation checks stop stale normal clients; they do not authenticate separate devices belonging to the same account.

Only proceed to deployment when all rules tests pass. Sign in with a Firebase account that can deploy this project's rules, validate with the live compiler, then deploy only the Firestore rules:

```bash
npx --yes firebase-tools@15.32.1 login
npx --yes firebase-tools@15.32.1 deploy --only firestore:rules --project volleyballdb-9223f --dry-run
npx --yes firebase-tools@15.32.1 deploy --only firestore:rules --project volleyballdb-9223f
```

Deploy the owner-scoped query and statistics creation-date fixes with the web app when releasing these rules. Follow the existing beta cutover runbook if the release also replaces beta match data. Admin SDK access bypasses Security Rules and requires separate IAM permissions.

## Match Review focus

Match Review can use TypeSafe Jev to prioritize up to three recorded facts for a coach to inspect first. Spike builds every displayed sentence and figure from the match event history. Jev only scores those candidate facts; it does not generate statistics or change match data. The rest of Match Review remains available when this optional online request fails.

The integration runs in the `prioritizeMatchReviewInsights` Firebase callable function so the TypeSafe credential never reaches the browser. Configure and deploy it with:

```bash
firebase functions:secrets:set TYPESAFE_API_KEY
npm run build:functions
firebase deploy --only functions:prioritizeMatchReviewInsights
```

## Useful commands

```bash
npm start
npm run build
npm run build:functions
npm test
npm run test:functions
npm run lint
npm run test:e2e
npm run test:e2e:offline
```

For a fast TypeScript check without launching the browser test runner:

```bash
./node_modules/.bin/tsc -p tsconfig.spec.json --noEmit
```

The end-to-end command starts an isolated app with test authentication and does not write to Firebase. It verifies the Match Setup and Live Court workflows in Chromium.

`test:e2e:offline` uses the optimized production build with the same test authentication. Its full-match journey also refreshes offline and reopens the court in a new tab before checking resumed stats, a completed match, and the next match. These checks do not write to the real Firebase project.

## Project structure

- `src/app/pages/home` - next-step dashboard and match status
- `src/app/pages/pre-match` - team, roster, lineup, opponent, and first serve setup
- `src/app/pages/court` - live scoring, substitutions, undo, and review surface
- `src/app/pages/history` - completed match recaps
- `src/app/services/team-roster.service.ts` - saved team, player pool, and lineup owner
- `src/app/services/match-engine.service.ts` - match start, scoring, undo, and event flow
- `src/app/services/offline-sync.service.ts` - local-first sync queue and Firebase writes
