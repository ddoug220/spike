---
target: Home lineup after distill
total_score: 31
max_score: 40
na_heuristics: 
p0_count: 0
p1_count: 0
timestamp: 2026-09-04T23-32-39Z
slug: src-app-pages-home-home-page-html
---
Method: dual-agent (A: critique_design · B: critique_evidence)

Home is clear and recognizably built for volleyball. The remaining opportunity is to make corrections feel dependable: explain draft lifetime and keep the desktop editor closer to the selected court.

## Design specificity

The net, six spatial positions, jersey emphasis, and explicit match setup action belong to volleyball preparation. The simplified surface avoids generic dashboard structure. Preserve this direction.

The detector found 20 advisories: 16 font-size and four color discrepancies against the documented system, across first-run-court.component.scss and home.page.scss. These are documentation/style reconciliation items, not verified accessibility failures. In particular, the brighter secondary text on dark tiles should not be replaced mechanically with a dimmer token.

## Design health

| Heuristic | Score | Assessment |
|---|---:|---|
| System status | 3 | Readiness is clear; draft lifetime is not. |
| Match with real world | 4 | Court geometry matches the coach’s task. |
| User control | 3 | Close, discard, move, and clear are available. |
| Consistency | 3 | Predictable controls; some style deviations. |
| Error prevention | 3 | Validation and stale-edit checks are present. |
| Recognition over recall | 3 | Spatial positions and named actions help. |
| Efficiency | 3 | Inline editing and saved-player reuse. |
| Minimalist design | 3 | Clean surface; desktop spacing weakens grouping. |
| Error recovery | 3 | Specific messages preserve unfinished work. |
| Contextual help | 3 | Useful instructions; draft expiry needs explanation. |
| **Total** | **31/40 — Good** | **Two focused refinements.** |

## What works

- Court positions and net orientation make the first action obvious.
- Editing appears only when needed; move, clear, save, and close remain discoverable.
- Inspected controls retain generous targets, visible focus, and focus return. Mobile editing comes into view; tablet editing keeps the court available.

## Priority issues

### P2 — “Draft” does not explain when work disappears

Closing an unfinished form leaves a Draft marker while Home still says Synced. Nothing explains that leaving Home discards these edits. A distracted coach may expect to recover them after returning.

Keep the approved per-visit behavior. Add contextual wording such as “Unsaved edits stay here until you leave Home.” If necessary, clarify that Synced describes saved data. Suggested command: impeccable clarify.

Evidence: first-run-court.component.html draft marker and draft-status; home.page.html sync footer; first-run-court.component.ts resetVisit.

### P2 — Desktop spacing separates the editor from its court

At 1280×720, the court measured 300×300 inside a 1120 px content region. Opening P4 left a 268 px gap between court and editor. Both controls work, but their grouping weakens and player information stays small despite available width.

Keep the court and editor in a compact shared composition. Replace the fixed viewport-height subtraction with sizing that uses available space while keeping setup actions reachable. Suggested command: impeccable layout.

Evidence: first-run-court.component.scss desktop court sizing and court-workspace grid; live element geometry.

## Cognitive load and personas

Cognitive load is low. Six positions and five move destinations exceed a literal four-option checklist, but the volleyball map groups them naturally; hiding positions would make the task worse.

- Jordan, first-time stat keeper: the first action is clear; draft lifetime is uncertain.
- Casey, distracted mobile coach: departure after an interruption exposes the draft-copy issue.
- Sam, keyboard/low-vision user: labeled controls and focus return work in inspected states. Small court labels deserve zoom testing; a full screen-reader audit was not performed.

## Minor observations

Court labels measured 12 px and form labels 11.52 px at desktop size. This merits a readability check in gym conditions, not a claimed contrast violation. Extreme team names wrapped; extreme player names truncated inside tiles and remained available in the editor.

## Questions to consider

Can a coach distinguish saved, synced data from a temporary draft without reopening the form? Does the desktop arrangement make the selected player and editor feel like one task?

The review used light-theme browser evidence at 375×667, 1024×768, and 1280×720. Dark mode, real-device keyboards, and a complete screen-reader walkthrough were not reverified. No application code was changed.
