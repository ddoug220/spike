# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Volleyball coaches and stat keepers tracking live matches. They're courtside during games, glancing at screens between plays, needing instant readability without missing action. Context is chaotic: gym noise, bright overhead lights, split-second decisions. The interface must match game speed.

## Product Purpose

Spike replaces paper stat sheets and clunky legacy apps with a fast, precise volleyball match tracker. Coaches build rosters, set lineups, and track live matches from a court view. Every kill, error, and rotation is recorded in real time. Post-match, the data tells the story: who performed, what patterns emerged, where to improve.

Success looks like: a coach tracks an entire match without ever feeling lost, frustrated, or behind the play.

## Positioning

Spike centers match tracking on volleyball's court positions and the operator's recorded events. The same event history drives the live score, serve, Team Rotation, On-court Lineup, player statistics, undo, and Match Review. Review statements must be traceable to recorded facts rather than inferred performance stories. This describes the product's mechanism, not a verified claim of competitive uniqueness.

## Operating Context

- Before play, a coach maintains a reusable Team Roster, then confirms the opponent, Match Squad, first serve, and Starting Lineup in Match Setup.
- During play, the operator selects a player for Player Attribution, records Rally Outcomes or Stat Observations, manages substitutions, and uses Undo to recover mistakes.
- Live Court prioritizes a 1024 × 768 landscape tablet, with the court, scoring controls, and Undo visible together without page scrolling. Narrower portrait screens use vertical scrolling without horizontal overflow or clipped controls.
- Match data saves on the device first and queues cloud synchronization when available. Connectivity must not interrupt an already available scoring workflow.
- Match Review provides a read-only factual account of a live, Completed, or Ended-early Match.

## Capabilities and Constraints

- **Separate reusable and match-specific data.** Team Roster edits must not rewrite historical matches. Each match owns its Match Squad snapshot and submitted set lineups. Live rotations and substitutions must not silently become the next match's Starting Lineup.
- **Six unique players.** A Starting Lineup consists of six Match Squad players assigned to P1–P6 Court Positions. The Match Squad becomes fixed when the match starts; both the lineup and bench come from it.
- **Distinguish points from observations.** A Rally Outcome awards one point and completes the rally. A Stat Observation records a player action without awarding a point or completing the rally.
- **One source for match facts.** Ordered, versioned events determine match state and Match Review. Saved game summaries support listing and synchronization; they are not independent scoring authorities.
- **One scoring device at a time.** Local data is isolated by authenticated user. An explicit online takeover transfers scoring authority; other devices remain read-only. Do not promise automatic merging of offline scoring from multiple devices.
- **Preserve result meaning.** A Completed Match reaches its configured winning condition. An Ended-early Match preserves recorded facts but has no final win or loss.
- Use the domain terms in `CONTEXT.md`. The decisions in `docs/adr/` define the confirmed team/match boundaries, event history, device ownership, and tablet priority.

## Brand Commitments

**Fast, precise, confident.**

Spike feels like a broadcast control room, not a form to fill out. The interface anticipates the next action. Information appears where eyes already look. No decoration for decoration's sake. The confidence of a well-called game.

Voice: Direct, economical, zero filler. "Tap player, tap spot" not "Please select a player and then choose a location on the court."

## Anti-references

- **Generic SaaS dashboards**: White/gray grids, muted colors, corporate blandness. Spike is a sports tool, not enterprise software.
- **Toy-like sports apps**: Cartoon mascots, rounded bubbly UI, gamification excess. Coaches are professionals; the tool respects that.
- **Cluttered legacy scorekeepers**: Paper forms digitized with tabs everywhere, tiny buttons, no hierarchy. If it feels like data entry, it's wrong.

## Evidence on Hand

- `CONTEXT.md` records the domain vocabulary; `docs/adr/0001-separate-team-and-match-state.md`, `0002-derive-match-state-from-events.md`, `0003-owner-scoped-offline-and-single-writer.md`, and `0004-prioritize-tablet-landscape-for-live-scoring.md` record accepted constraints.
- The runnable Ionic/Angular app contains Home, Team Roster, Match Setup, Live Court, History, and Match Review. `README.md` documents local startup and verification commands.
- `e2e/trustworthy-match-loop.spec.ts` provides repository checks for tablet and phone setup, scoring, and recovery. Match reducer, offline synchronization, and review tests provide additional implementation evidence in `src/app/domain/match-v2/`, `src/app/services/`, and `src/app/pages/review/`. The existence of these tests is not a claim that every check currently passes.
- **Open: customer validation.** No coach feedback, match footage, usage results, or verified customer claims have been supplied for this record. Test fixtures and demonstrations are not real match evidence. Do not fabricate customers, testimonials, adoption metrics, or measured performance benefits.

## Product Principles

1. **Game speed or nothing.** Every interaction must be completable faster than the next play starts. If a coach has to think about the UI, they've already missed something.

2. **Glanceable over discoverable.** Information hierarchy serves instant comprehension. The most important data is largest and highest contrast. Details are accessible but never compete.

3. **The court is the interface.** Spatial relationships matter in volleyball. The UI should reflect court geometry, rotations, and player positions—not abstract lists.

4. **Precision without friction.** Recording stats must be accurate (undo exists, corrections are easy) but never slow. Speed and correctness aren't trade-offs.

5. **Earned celebration.** Match results and milestones deserve acknowledgment, but celebrations are brief. The next point is always coming.

## Accessibility & Inclusion

- **High contrast priority**: Gyms have variable lighting—bright overheads, afternoon sun through windows. All text and interactive elements must be readable in challenging conditions.
- **Large touch targets**: Fast taps during live play. Minimum 44x44px touch areas for primary actions, no precision requirements.
- **WCAG AA baseline**: 4.5:1 contrast for body text, keyboard navigation support, screen reader compatibility for post-match review surfaces.
- **Reduced motion support**: Animations respect `prefers-reduced-motion` for users who need it.
