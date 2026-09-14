---
target: Home and first-run flow
total_score: 23
max_score: 40
na_heuristics: 
p0_count: 0
p1_count: 2
timestamp: 2026-09-04T22-31-57Z
slug: src-app-pages-home-home-page-html
---
Method: dual-agent (A: /root/design_review · B: /root/detector_evidence)

**Spike’s court-based onboarding has a clear identity, but its strongest visual element needs correction before further polish.** The main problems are unreadable saved-player numbers in light mode, contradictory court markings, and friction when correcting an entry.

Scope: Home and its first-run court, selected from the current local changes. Reviewed desktop at 1280×720 and phone at 375×667 in light mode. The phone walkthrough covered adding six example players and continuing into Match Setup.

**Design specificity and overall impression**

This feels authored for volleyball: spatial player placement, jersey numerals, and lineup progress serve the actual task. Preserve that direction. The oversized introduction and repeated instructions give the surrounding layout more of a landing-page feel than the compact working tool described in PRODUCT.md.

The detector found **22 advisory findings: 19 font-size departures and 3 color departures**, across [first-run court styles](/Users/danieldouglas/Repos/spike/src/app/pages/home/first-run-court/first-run-court.component.scss:26) and [Home styles](/Users/danieldouglas/Repos/spike/src/app/pages/home/home.page.scss:10). These are not 22 usability defects. Some are false positives: the hover blue and 1.5rem size are already documented. The scan supports investigating typography consistency; browser inspection exposed the more consequential readability and interaction problems.

**Design health: 23/40 — Acceptable, with significant targeted improvements needed.** Scores combine the independent design assessment with additional browser evidence.

| Heuristic | Score | Main finding |
|---|---:|---|
| System status | 3/4 | Progress and save status are visible; draft status is unclear. |
| Match with the real world | 2/4 | Court markings contradict the six-player arrangement. |
| User control | 2/4 | Drafts disappear; placement correction requires another surface. |
| Consistency | 2/4 | Saved-preview text breaks in light mode; “Position” has two meanings. |
| Error prevention | 2/4 | Jersey validation works, but changing spots discards input. |
| Recognition over recall | 3/4 | Spatial labels help; role abbreviations need context. |
| Efficiency | 2/4 | Reusing players helps; repeated entry keeps reopening the form. |
| Aesthetic and minimalist design | 2/4 | Court focus is strong; readability and duplicate instructions weaken it. |
| Error recovery | 3/4 | Validation gives a clear fix; lost drafts cannot be recovered. |
| Help and documentation | 2/4 | Basic guidance exists; orientation and correction are unexplained. |
| **Total** | **23/40** | **Acceptable** |

**What works**

- The court makes the first action concrete. Buttons name both the numbered position and its physical zone.
- Selection and entry have clear feedback: a highlighted tile, a focused labeled field, and “Add to P1.” Desktop court targets measured 94×78px; inputs and the primary action were 48px tall.
- The successful path preserves work. In the phone walkthrough, the count advanced to six, Home offered “Set Up Match,” and Match Setup retained all six starters. Invalid jersey 100 was blocked with a useful message during the independent review.

**Priority issues**

1. **[P1] Saved lineup numbers become unreadable in light mode.** After the sixth player, the new preview uses dark tiles but renders jersey numbers black. Names are also subdued. This removes the information a coach needs to verify the lineup at a glance. Give the dark court tiles explicit readable text colors in both themes, then check occupied previews. Browser-computed values confirmed black numbers over `rgba(14,15,17,0.9)`. [Source](/Users/danieldouglas/Repos/spike/src/app/pages/home/home.page.scss:17). Suggested command: `$impeccable harden`.

2. **[P1] Court markings contradict the player layout.** The vertical centerline passes through P3 and P6 while one team’s front and back rows spread across both apparent court halves. The signature interface creates doubt about orientation. Show one team’s half-court, put the net at the front edge, and align the attack line with the front row. Use that same orientation in the saved preview. [Source](/Users/danieldouglas/Repos/spike/src/app/pages/home/first-run-court/first-run-court.component.scss:108). Suggested command: `$impeccable shape`.

3. **[P2] A stray court tap erases an unfinished player entry.** The independent walkthrough entered a name at P1, tapped P2, and lost the name. The fresh form then displayed “Enter a player name” before new input. Preserve the draft until save or explicit cancel, and reset validation when opening a new entry. This protects interrupted users without adding a confirmation to every tap. [Source](/Users/danieldouglas/Repos/spike/src/app/pages/home/first-run-court/first-run-court.component.ts:68). Suggested command: `$impeccable harden`.

4. **[P2] The court supports placement but offers no direct way to correct placement.** An occupied spot edits player details; it cannot move or clear that player. Once six players exist, the interactive court is replaced with a static preview. Provide a clear correction route at the spot where the mistake is visible, with clearing a spot retaining the roster player. This limitation is source-confirmed; the six-player transition was also observed live. [Editor source](/Users/danieldouglas/Repos/spike/src/app/pages/home/first-run-court/first-run-court.component.html:66), [completion condition](/Users/danieldouglas/Repos/spike/src/app/pages/home/home.page.html:13). Suggested command: `$impeccable shape`.

5. **[P2] Repeated instructions consume the working area.** The introductory sentence, court caption, and empty sidebar explain the same action. At 1280×720, the heading rendered at 64px and the roster link and save status fell below the first viewport. Keep one instruction, reduce the heading, and show the editor when a spot is selected. Move progress beside the court title. [Source](/Users/danieldouglas/Repos/spike/src/app/pages/home/first-run-court/first-run-court.component.html:132). Suggested command: `$impeccable distill`.

**Cognitive load and emotional journey**

Load is moderate. The six court choices form two meaningful groups of three; hiding them would damage the spatial task. The avoidable burdens are rebuilding a lost draft, finding a separate correction route, and interpreting “Position” as both court location and player role. The role selector contains six abbreviations; use “Player role” to distinguish it from P1–P6.

Arrival and first selection are confident and clear. Repeated entry becomes more fragile when interrupted. Completing six players provides a real next action, but the sudden switch to a static, low-contrast preview weakens the completion moment.

**Persona red flags**

- **Jordan, first-timer:** The vertical court divider and two meanings of “Position” create uncertainty before the first player is saved.
- **Casey, distracted phone user:** An accidental spot change discards typing. The 375px layout stacks the editor below the court; repeated entries move between those regions. A real phone keyboard was not tested.
- **Sam, keyboard or low-vision user:** Focus transfer and native controls are helpful, but the completed preview loses contrast. Keyboard order P1→P6 also jumps around a visual layout beginning P4→P3→P2.

**Smaller observations and limits**

- The desktop close control shrank to 38.75×44px despite a declared 44px width. Prevent flex shrinking to meet the product’s touch-target standard.
- Dark-theme source colors predict 3.27:1 contrast for the white primary-button label, below the product’s normal-text baseline. This was calculated from source, not verified in a dark browser session.
- Onboarding ends at six roster players, even if fewer than six positions are assigned. The all-six-assigned path worked; the partially assigned completion case was not exercised.
- Live-match resume, cloud failures, and real device keyboard behavior remain untested. No implementation changes were made.

**Design decisions to resolve**

Should onboarding end when six players exist or when the starting lineup is complete? Should the court remain editable after that milestone so corrections happen where the player is shown?
