# Product

## Register

product

## Users

Volleyball coaches and stat keepers tracking live matches. They're courtside during games, glancing at screens between plays, needing instant readability without missing action. Context is chaotic: gym noise, bright overhead lights, split-second decisions. The interface must match game speed.

## Product Purpose

Spike replaces paper stat sheets and clunky legacy apps with a fast, precise volleyball match tracker. Coaches build rosters, set lineups, and track live matches from a court view. Every kill, error, and rotation is recorded in real time. Post-match, the data tells the story: who performed, what patterns emerged, where to improve.

Success looks like: a coach tracks an entire match without ever feeling lost, frustrated, or behind the play.

## Brand Personality

**Fast, precise, confident.**

Spike feels like a broadcast control room, not a form to fill out. The interface anticipates the next action. Information appears where eyes already look. No decoration for decoration's sake. The confidence of a well-called game.

Voice: Direct, economical, zero filler. "Tap player, tap spot" not "Please select a player and then choose a location on the court."

## Anti-references

- **Generic SaaS dashboards**: White/gray grids, muted colors, corporate blandness. Spike is a sports tool, not enterprise software.
- **Toy-like sports apps**: Cartoon mascots, rounded bubbly UI, gamification excess. Coaches are professionals; the tool respects that.
- **Cluttered legacy scorekeepers**: Paper forms digitized with tabs everywhere, tiny buttons, no hierarchy. If it feels like data entry, it's wrong.

## Design Principles

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
