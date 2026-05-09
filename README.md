# Spike

Spike is an Ionic/Angular volleyball match tracker. It helps a coach or stat keeper save a team roster, set a starting six, track a live match from a court view, and review completed matches later.

## Quick Start

1. Install dependencies:

   ```bash
   npm install
   ```

2. Start the local app:

   ```bash
   npm start
   ```

3. Open the local Angular URL printed by the dev server, usually `http://localhost:4200`.

4. Sign in or create an account. Spike saves match data on the device first and syncs to Firebase when cloud access is available.

## How To Use Spike

Think of the app as three steps:

1. **Build the saved player pool**

   Open **Team & Lineup**, enter your team name, then add every player you may use in a match. This pool is saved and reused, so you do not need to rebuild the team before every match.

2. **Set today's starting six**

   Tap a player in the saved pool, then tap a court spot. You can also drag a player onto a court spot. Spike needs six unique starters before it can start a match.

3. **Track the live match**

   Enter the opponent name, choose who serves first, then press **Start Match**. On the Live Court, tap a player to select them before recording player-specific actions.

## Live Court Basics

- **Point outcome** buttons change the score and record the volleyball event.
- **Stat tap - score stays the same** buttons record a player stat without changing the score.
- **Undo** removes the most recent tracked action.
- **Substitute** opens the bench panel. Pick the player coming out, then tap the bench player going in.
- **Exit** leaves the court or starts a new match after a final.

## Cloud Save

Spike writes locally first, then queues cloud sync. The Home and Team & Lineup screens show whether changes are synced, waiting, or need a retry. If Firebase is unavailable, you can keep using the app and retry sync later.

## Useful Commands

```bash
npm start
npm run build
npm test
npm run lint
```

For a fast TypeScript check without launching the browser test runner:

```bash
./node_modules/.bin/tsc -p tsconfig.spec.json --noEmit
```

## Project Shape

- `src/app/pages/home` - next-step dashboard and match status
- `src/app/pages/pre-match` - team, roster, lineup, opponent, and first serve setup
- `src/app/pages/court` - live scoring, substitutions, undo, and review surface
- `src/app/pages/history` - completed match recaps
- `src/app/services/team-roster.service.ts` - saved team, player pool, and lineup owner
- `src/app/services/match-engine.service.ts` - match start, scoring, undo, and event flow
- `src/app/services/offline-sync.service.ts` - local-first sync queue and Firebase writes
