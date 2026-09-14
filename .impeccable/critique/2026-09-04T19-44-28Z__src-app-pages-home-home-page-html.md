---
target: authenticated first-run home screen
total_score: 23
max_score: 40
na_heuristics: 
p0_count: 0
p1_count: 3
timestamp: 2026-09-04T19-44-28Z
slug: src-app-pages-home-home-page-html
---
# Spike first-run home critique

## Design Health Score

| # | Heuristic | Score | Key Issue |
|---|-----------|------:|-----------|
| 1 | Visibility of System Status | 3 | `0/6` and local-save status are useful, but setup progress is reduced to a count rather than a clear sequence. |
| 2 | Match Between System and Real World | 3 | The court and roster language fit volleyball, but `P1–P6`, “Match Squad,” and “Next-match default” assume prior knowledge. |
| 3 | User Control and Freedom | 3 | Navigation and Back are available; this state has no meaningful need for undo, though the destination exposes premature exits into match setup. |
| 4 | Consistency and Standards | 1 | Home and Team render as different visual systems, and missing tokens remove the intended wordmark and court treatment. |
| 5 | Error Prevention | 2 | Home routes a short roster to Team, but Team still offers match setup before the six-player prerequisite is met. |
| 6 | Recognition Rather Than Recall | 3 | The primary CTA is explicit and sign out has an accessible name, but position abbreviations and setup concepts are unexplained. |
| 7 | Flexibility and Efficiency | 1 | There is no direct-add or court-slot shortcut; first-run entry always detours through the full Team form. |
| 8 | Aesthetic and Minimalist Design | 2 | The surface is uncluttered, but the inert empty preview outranks the task on mobile and the rendered result lacks control-room authority. |
| 9 | Error Recovery | 3 | Sync and sign-out failures have specific recovery copy in source, but live failure states were not exercised. |
| 10 | Help and Documentation | 2 | The page names the next step but offers no contextual explanation of positions, Match Squad, or setup order. |
| **Total** | | **23/40** | **Acceptable — significant improvements needed** |

## Design Specificity Verdict

**Partly product-authored in content, category-interchangeable in execution.** The six volleyball positions, `0/6` lineup count, state-aware next action, and court geometry clearly belong to Spike. The rendered composition does not. With the court material and Volt wordmark broken, the screen becomes a generic light SaaS hero beside a bordered card. The strongest product idea—the court as the interface—is present only as a passive preview.

**Unanchored design assessment:** The home screen is coherent and readable, but it does not express the fast, precise broadcast-control-room character promised by the product. The abrupt switch to a separate hard-coded dark Team surface makes the first navigation feel like a product change.

**Deterministic scan:** The CLI detector returned exit `0` with `[]`: zero findings, zero rules, and no false positives for `src/app/pages/home/home.page.html`. Browser inspection found five issues outside its rule coverage. In particular, `--color-court` and `--color-volt` are undefined in the rendered theme, toolbar hit areas are undersized, mobile content order delays the CTA, and the desktop composition lacks urgency.

**Visual overlays:** No reliable user-visible overlay is available. The browser evaluation API rejected the required title mutation, so script injection was not possible. Screenshot, accessibility-tree, geometry, computed-style, and source/token evidence were used instead.

## Overall Impression

The state-aware next-action model is strong product thinking, but the visual execution suppresses the very things that could make the screen unmistakably Spike. The biggest opportunity is to turn the court from an inert preview into the organizing first-run interaction, while restoring one shared visual system.

## What's Working

1. **The next action adapts to real match state.** The headline, detail, and CTA change for incomplete rosters, live matches, set breaks, and completed matches. That is more useful than a static dashboard.
2. **The volleyball structure is immediately present.** Six correctly arranged positions and a monospace lineup count provide a credible domain-specific foundation.
3. **Offline confidence is handled well.** “Saved on this device,” pending-sync language, and a direct Retry path fit unreliable courtside connectivity.

## Priority Issues

### [P1] The signature court is visually broken and its tile labels fail contrast

**Why it matters:** The court should be the strongest product cue and the fastest scanning surface. Instead it renders as dark boxes on a white card. In light mode, inherited dark text on the dark player tiles is difficult to read and fails the intended high-contrast courtside requirement.

**Fix:** Replace the invalid `--color-court` reference with the established court surface token and line tokens. Give dark player tiles an explicit high-contrast foreground in both themes.

**Suggested command:** `$impeccable audit`, then `$impeccable colorize`.

### [P1] Home and Team do not share one visual world

**Why it matters:** Home follows the OS light theme while Team uses a separate hard-coded dark palette. The undefined `--color-volt` also reduces the Spike wordmark to ordinary toolbar text. The transition weakens trust at the moment the coach commits to setup.

**Fix:** Establish one shared theme policy, define the missing Volt token, explicitly style the Ionic title typography, and remove the parallel local palette from Team.

**Suggested command:** `$impeccable document` or `$impeccable bolder`.

### [P1] First-run sequencing foregrounds a future lineup before the achievable task

**Why it matters:** At 375×667, the empty preview consumes roughly 230 px before “Build your team” appears. A zero-player coach cannot act on that preview, so the largest first object communicates absence instead of progress.

**Fix:** Lead with “Add your first player” and immediate entry. Collapse or suppress the full lineup until it carries useful information, or make each empty court slot the add-player interaction.

**Suggested command:** `$impeccable onboard` or `$impeccable layout`.

### [P2] Secondary navigation misses the documented touch-target floor

**Why it matters:** On mobile, Team and History render at about 27 px high and Sign out at about 28×28 px, below the 44×44 px product requirement. These are easy to miss in one-handed courtside use.

**Fix:** Give every toolbar action a minimum 44×44 hit area while keeping its visible treatment compact.

**Suggested command:** `$impeccable adapt`.

### [P2] The setup destination exposes invalid and visually unreadable actions

**Why it matters:** With zero players, Team presents two Match Setup actions before the prerequisite is satisfied, and the toolbar variant renders with unreadable blue-on-blue styling. That creates both a false affordance and a visual defect.

**Fix:** Hide or disable match setup until eligibility is met, explain the requirement beside the disabled state, and scope primary-button styling so clear toolbar actions remain legible.

**Suggested command:** `$impeccable harden`.

## Persona Red Flags

### Jordan — first-time user

- Encounters `P1–P6`, “Match Squad,” and “Next-match default” without explanation.
- Sees an empty lineup before the instruction to add players.
- After choosing Manage Team, encounters team naming, player creation, and match setup simultaneously.
- The Team toolbar's Match Setup control appears as an unreadable blue block.

### Casey — distracted mobile/courtside user

- Must scan past a 230 px inert preview before reaching the primary task.
- Team, History, and Sign out have 27–28 px rendered heights.
- The primary action moves beneath preview and explanatory copy rather than occupying a stable thumb-zone position.
- The white-to-dark transition requires reorientation after a single tap.

### Sam — accessibility-dependent user

- Player-number and supporting-label contrast fail on the dark tiles in light mode.
- Toolbar controls fall below the 44×44 motor-access target.
- Sign out is icon-only visually, although its `aria-label` is correct.
- Focus visibility and live announcements for sync-state changes were not fully exercised.

## Cognitive Load

The home screen alone has low cognitive load: seven of eight checks pass. The failure is mobile visual hierarchy, because the empty lineup appears before the task. The Home-to-Team first-run flow reaches high load with four failures: hierarchy, one thing at a time, minimal choices, and progressive disclosure. The first Team viewport exposes at least seven controls and three concepts at once.

## Emotional Journey

- **Arrival:** “Build your team” is decisive, but the blank light canvas and broken court feel unfinished rather than authoritative.
- **Orientation:** `0/6` gives progress context, yet the preview leads with what is missing rather than the next achievable action.
- **Commitment:** “Manage Team” is prominent and the local-save message reduces fear of lost work.
- **Transition:** The visual system changes abruptly on Team, and an unreadable Match Setup action appears at the moment confidence should increase.
- **End state:** The user reaches a functional form, but team identity, player identity, and match setup compete for attention.

## Minor Observations

- “My Team,” “Build your team,” “Manage Team,” “Team Roster,” “Saved team,” and “Team Name” create more terminology than this simple first-run task needs.
- “Next-match default” is system language for someone who has never created a match.
- The six empty slots repeat “Open” without adding decision value.
- The saved-on-device message is excellent operational copy and should stay visually secondary.
- Desktop is readable but leaves a large low-energy field; the status is detached from the action it qualifies.

## Questions to Consider

- Should first-run Home preview a future lineup, or help the coach add the first player immediately?
- What if the empty court slots were the setup interaction instead of a passive preview plus a separate Team form?
- Why should Home follow the OS theme when Team forces dark mode one tap later?
- Does a zero-player coach need History and Match Setup yet, or would progressive navigation build more confidence?
- Could `0/6` become a short visible sequence—team name, six players, starting lineup—without turning setup into a wizard?
