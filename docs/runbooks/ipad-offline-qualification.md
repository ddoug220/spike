# iPad offline qualification

Use this runbook before relying on Spike at a tournament. Complete it with the exact production build and iPad that will be used courtside.

## Prepare the build

1. Run `npm run build` and confirm the production build completes.
2. Serve the `www` directory over HTTPS from the intended production origin.
3. On the iPad, open that origin in Safari, sign in as the tournament coach, and finish the team, match-squad, and P1–P6 setup.
4. Wait until the equipment rail says **Ready offline**. Do not treat **Preparing offline…** or **Offline setup incomplete** as ready.
5. Use Safari's Share menu to choose **Add to Home Screen**, then launch Spike from its Home Screen icon.

For the automated production-browser rehearsal, first run `npm run build -- --configuration=production,offline-e2e --output-path=.angular/offline-e2e`, then run `npm run test:e2e:offline`.

## Prove a cold offline launch

1. Start a match, record one rally, and return to the iPad Home Screen.
2. Enable Airplane Mode and confirm both Wi-Fi and cellular data are unavailable.
3. Force-quit Spike from the app switcher.
4. Launch Spike from its Home Screen icon.
5. Confirm the signed-in coach reaches the active court without a network request, and that the saved score, lineup, serve, rotation, timeouts, and player statistics are intact.
6. Record an Ace while the team serves, an opponent point, a Receive Error for a selected player, a substitution, a timeout, and an Undo.
7. Force-quit and reopen Spike again while still offline. Confirm every action appears exactly once.

## Prove recovery and safe updates

1. Restore connectivity and wait for the pending count to reach zero.
2. Reload the match review and confirm the score, timeline, box score, and corrected player attribution agree with the court record.
3. If a new app version is available during a live match, finish or deliberately leave the match before reloading. Spike must not reload itself during scoring.
4. Repeat the cold-launch check after the update.

## Supervised tournament trial

Run one complete real match with a designated primary scoring iPad and a backup device available but not scoring. Record the build identifier, iPad model, iPadOS version, match format, offline intervals, any Retry Save use, final score, and whether the paper score sheet agreed. Treat any lost, duplicated, or misattributed action as a release blocker.
