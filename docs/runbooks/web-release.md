# Web release

Publish Spike with Cloudflare Pages so coaches can open an HTTPS link and add the app to their iPad Home Screen. The Cloudflare project is `spike-volleyball`. Accounts, match data, Firestore rules, and the optional Match Review callable function continue to use the existing Firebase project, `volleyballdb-9223f`.

The current Cloudflare address is [spike-volleyball-ct5.pages.dev](https://spike-volleyball-ct5.pages.dev).

## Sign in

Install the project dependencies if they are missing, then check Cloudflare access:

```sh
pnpm install
npx --yes --package=wrangler@4.146.0 wrangler whoami
```

If Wrangler reports that you are not signed in, sign in with the Cloudflare account that owns the website:

```sh
npx --yes --package=wrangler@4.146.0 wrangler login
```

## Create the Pages project once

List the existing projects before creating one:

```sh
npx --yes --package=wrangler@4.146.0 wrangler pages project list
```

If `spike-volleyball` does not exist, create it:

```sh
npx --yes --package=wrangler@4.146.0 wrangler pages project create spike-volleyball --production-branch main
```

This release uses [Direct Upload](https://developers.cloudflare.com/pages/get-started/direct-upload/) from the local production build. Cloudflare does not allow a Direct Upload project to switch to Git integration later. Automatic deployments can instead run the same release command from a separate build service, or use a new Git-integrated Pages project.

## Publish the app

Run from the repository root:

```sh
npm run deploy:web
```

The release command builds the production app into `www` and uploads that directory to Cloudflare Pages. It runs Wrangler from `www` so the repository's Firebase `functions` directory is not treated as Cloudflare Pages Functions. Cloudflare's default single-page-app routing serves `index.html` for app URLs such as `/team`.

The build includes `src/_headers` at the website root. Browsers revalidate online files so an old app shell or service-worker manifest does not remain cached by HTTP. Angular's service worker still caches the app for offline use.

Use the URL printed by the successful deployment. This command deploys the website only. Release Firebase rules and callable functions separately when their code changes. Follow [Beta match-data cutover](beta-match-cutover.md) if a release also replaces beta match data.

## Connect the chosen domain

Add the chosen subdomain under the Pages project's Custom domains in Cloudflare. Follow [Cloudflare's domain setup](https://developers.cloudflare.com/pages/configuration/custom-domains/) so the hostname is associated with the Pages project before configuring its DNS record.

Add the exact deployed hostname to Firebase Console under Authentication, Settings, Authorized domains. The current Cloudflare hostname is `spike-volleyball-ct5.pages.dev`. Include the chosen custom hostname when people will sign in through that address too. Google sign-in requires an authorized hostname.

Use one primary address for scoring. Device storage and offline caches belong to a hostname. A match saved only on the Cloudflare-provided address does not automatically appear offline on a new custom domain. Let pending cloud saves sync before changing the address used on a scoring device.

## Verify the hosted release

1. Open the deployed HTTPS URL in a new browser session and confirm the sign-in screen appears.
2. Sign in with email and password and with Google. For Google sign-in, confirm the deployed hostname appears in Firebase Console under Authentication, Settings, Authorized domains. If Firebase reports `auth/unauthorized-domain`, add that exact hostname and retry.
3. Open `/team` directly and refresh it. Confirm the app opens instead of a hosting 404.
4. Save a Team Roster, start a match, and record a rally. Wait for cloud sync, then reopen the app and confirm the saved match returns.
5. Complete [iPad offline qualification](ipad-offline-qualification.md) on the intended scoring iPad before relying on the release at a tournament.

## App Store follow-up

The web release supports Home Screen installation without an App Store submission. A later App Store release needs a native iOS project, Apple signing and developer membership, a privacy policy and App Store privacy disclosures, account deletion, and device testing through TestFlight. Check Apple's current [enrollment requirements](https://developer.apple.com/programs/enroll/), [review guidelines](https://developer.apple.com/app-store/review/guidelines/), and [account deletion requirement](https://developer.apple.com/support/offering-account-deletion-in-your-app) before preparing that release.
