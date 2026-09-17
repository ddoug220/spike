---
name: "Spike"
description: "Volleyball match tracking for coaches and stat keepers"
colors:
  graphite: "#0f1418"
  graphite-frame: "#171d22"
  graphite-control: "#202830"
  graphite-control-strong: "#2a343d"
  enamel: "#f5f4ef"
  steel: "#b8c2c9"
  steel-faint: "#87949d"
  graphite-line: "rgba(245, 244, 239, 0.16)"
  graphite-line-strong: "rgba(245, 244, 239, 0.32)"
  competition-cobalt: "#1457d9"
  competition-cobalt-deep: "#0e3f9f"
  court-tape: "rgba(255, 255, 255, 0.88)"
  optic-stitch: "#e8f316"
  focus-dark: "#8fb4ff"
  signal-green: "#0c7a43"
  signal-red: "#b82d36"
  signal-amber: "#f1a51b"
  white: "#ffffff"
  enamel-control: "#e8e6df"
  enamel-control-strong: "#d9d7cf"
  ink: "#11161a"
  ink-muted: "#46535c"
  ink-faint: "#66737b"
  enamel-line: "rgba(17, 22, 26, 0.16)"
  enamel-line-strong: "rgba(17, 22, 26, 0.32)"
  focus-light: "#0e48bb"
  signal-green-light: "#086739"
  signal-red-light: "#a5222c"
  signal-amber-light: "#9a5b00"
typography:
  display:
    fontFamily: "'Barlow Condensed', 'Arial Narrow', sans-serif"
    fontSize: "clamp(2.75rem, 5vw, 4.75rem)"
    fontWeight: 800
    lineHeight: 0.9
    letterSpacing: "-0.02em"
  score:
    fontFamily: "'Barlow Condensed', 'Arial Narrow', sans-serif"
    fontSize: "clamp(3.4rem, 6vw, 5.25rem)"
    fontWeight: 800
    letterSpacing: "-0.02em"
  headline:
    fontFamily: "'Barlow Condensed', 'Arial Narrow', sans-serif"
    fontSize: "1.4rem"
    letterSpacing: "0.04em"
  body:
    fontFamily: "'Atkinson Hyperlegible', ui-sans-serif, system-ui, sans-serif"
    fontSize: "1rem"
    fontWeight: 400
  label:
    fontFamily: "'Barlow Condensed', 'Arial Narrow', sans-serif"
    fontSize: "0.875rem"
    letterSpacing: "0.05em"
  navigation:
    fontFamily: "'Barlow Condensed', 'Arial Narrow', sans-serif"
    fontSize: "0.88rem"
    fontWeight: 700
    letterSpacing: "0.045em"
rounded:
  xs: "2px"
  sm: "4px"
  md: "8px"
  full: "999px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "12px"
  base: "16px"
  lg: "20px"
  section: "24px"
  xl: "32px"
components:
  button-primary:
    backgroundColor: "{colors.competition-cobalt}"
    textColor: "{colors.white}"
    rounded: "{rounded.sm}"
  button-control:
    backgroundColor: "{colors.graphite-control}"
    textColor: "{colors.enamel}"
    rounded: "{rounded.sm}"
  panel:
    backgroundColor: "{colors.graphite-frame}"
    textColor: "{colors.enamel}"
    rounded: "{rounded.md}"
    padding: "16px"
  input-default:
    backgroundColor: "{colors.graphite-control}"
    textColor: "{colors.enamel}"
    rounded: "{rounded.sm}"
    height: "48px"
  equipment-nav:
    backgroundColor: "{colors.graphite-frame}"
    textColor: "{colors.steel}"
    typography: "{typography.navigation}"
  player-tag:
    textColor: "{colors.white}"
    rounded: "{rounded.sm}"
    width: "108px"
    height: "76px"
  action-receipt:
    backgroundColor: "{colors.graphite-control}"
    textColor: "{colors.enamel}"
    rounded: "{rounded.sm}"
---

# Design System: Spike

## Overview

**Creative North Star: "Competition Hardware"**

Spike feels like the equipment and officiating system used at an elite volleyball tournament: durable, exact, fast to read, and purpose-built for the court. The court is the instrument. Scores, player tags, rails, and action keys behave like a coherent scorer's console rather than a collection of app cards.

The system is designed for coaches and stat keepers working under variable gym lighting. Dark and light modes are equally intentional. Expression comes from court geometry, equipment labeling, structural framing, and decisive scale—not decoration, hype, or gamification.

**Key Characteristics:**

- Court geometry and structural equipment rails.
- Cobalt playing surfaces with graphite and enamel shells.
- Condensed display lettering with open, readable body text.
- Flat panels, tactile controls, and scarce selection markers.

## Colors

- **Competition Cobalt** owns the court and primary actions. It appears in large, decisive fields rather than scattered accents.
- **Graphite / Enamel** are the two equipment shells. Dark mode uses powder-coated graphite; light mode uses warm enamel with dark ink.
- **Optic Stitch** is scarce. It marks the Spike brand stitch and the current player or control selection only.
- **Signal Green, Red, and Amber** communicate outcomes and system state. They are never decorative.
- Secondary text follows the surrounding surface. `steel` and `steel-faint` are the dark-theme muted roles; `ink-muted` and `ink-faint` are their light-theme counterparts. The frontmatter preserves the exact values from `src/theme/variables.scss`.
- The default token block supplies the dark shell; `prefers-color-scheme: light` replaces canvas, frame, control, text, border, focus, and signal roles. Cobalt and optic stitch remain constant.
- Frontmatter component colors describe the dark baseline. Use the `--spike-*` semantic variables in implementation so components follow the active theme. Generated tonal ramps in the companion file are preview aids, not additional approved application colors.

## Typography

- **Barlow Condensed** is the equipment face. Use it for scores, jersey numbers, route titles, action labels, and compact identifiers.
- **Atkinson Hyperlegible** carries instructions, names, form fields, and longer reading. Its open forms protect legibility at a glance.
- Scores and jersey numbers use tabular numerals. Do not use monospace as a technical costume.
- Route titles use `clamp(2.75rem, 5vw, 4.75rem)` at weight 800; the Home title uses `clamp(3rem, 6vw, 5.75rem)`. Live scores use `clamp(3.4rem, 6vw, 5.25rem)`.
- Supporting section headings are commonly 1.25–1.4rem. Form labels are 0.875rem; desktop rail links are 0.88rem. Smaller metadata varies by surface and viewport; there is no single enforced modular type scale.
- `--font-mono` is a compatibility alias for Barlow Condensed, not a separate monospace family.
- Hierarchy is created with decisive size and weight changes. Avoid tiny uppercase labels and excessive tracking.

## Layout

- The live-match desktop composition is a 58/42 split: one-team six-position court on the left, fixed scorer's control table on the right, joined by a structural scoreboard rail.
- Landscape tablets preserve simultaneous court, score, action, and Undo visibility. Portrait layouts stack court above a fixed-width action table.
- Live Court stacks at 980px and below; its phone controls compact further at 680px and 430px. Phones use a sticky compact scoreboard, reduced-height court, and two-column action grid. At 320×568, controlled vertical scrolling is preferable to shrinking controls.
- Supporting routes use rails, boards, records, and workbenches—not same-sized card grids.
- Content containers top out at 1180px; the live court may use the full viewport. Supporting pages normally have 20px outer gutters; compact page gutters vary from 6px to 12px. The spacing entries record recurring values, not existing CSS spacing variables.
- Equipment navigation changes from one 64px rail to 56px and 38px rows at 760px. Team and Match Setup stack their workbenches at 820px. History switches to two-column records at 900px.
- Match Review uses three rotation columns below 900px and two below 640px. Its box score scrolls horizontally inside the panel, with a fixed 180px player column; the page itself remains within the viewport.

## Elevation & Depth

Depth comes from structural layering: canvas → frame → control. Panels use one border or one inset highlight, never an ambient card shadow. Overlays may use a directional shadow because they physically cover working content. No glass, glow, or decorative blur. The match-controls overlay uses `0 20px 48px rgba(0, 0, 0, 0.6)`. Player selection and action receipts use inset signal marks rather than ambient elevation.

Transitions use 100ms, 140ms, or 160ms with `cubic-bezier(0.16, 1, 0.3, 1)`. The action receipt reveals with a horizontal clip. Global reduced-motion styles shorten animations and transitions to 0.01ms and remove smooth scrolling.

## Shapes

Corners are machined, not soft: 2px for tags, 4px for controls, and 8px for major frames. Full pills are limited to compact status indicators. Court lines, net tape, separator rails, and clipped tag corners provide the signature geometry.

## Components

- **Equipment rail:** compact navigation or scoreboard frame with clear separators and one current-state marker.
- **Player tag:** jersey number, name, position, and optional live stats; selection uses optic stitch plus a non-color shape change.
- **Outcome key:** rectangular Ionic button, normally 58px high, with a 4px radius. Kills and aces use success, errors use danger, blocks use deep cobalt, and stat-only or neutral actions use the control surface. Disabled state follows Ionic. Color states remain understandable through label and border treatment.
- **Action receipt:** persistent factual summary of the last operation with adjacent Undo.
- **Match record:** one desktop row containing opponent, date, result, status, and Review action; compact records put opponent and score first. Keyboard focus is inset 3px so the containing frame does not clip it.
- **Work bench:** stable editing region beside a roster, squad, or lineup surface. It does not appear as a modal unless focus protection is required.

- **Buttons and fields:** controls use 4px corners. Team fields are 48px high; the player name spans the form before Jersey, Position, and Add Player. Local-submit buttons use control surfaces and stronger control hover fills. Primary navigation actions use cobalt with white text.
- **Navigation state:** muted links brighten on hover and active state; the active link carries a 3px optic stitch beneath it. Text labels remain present.
- **Focus:** the global outline is 3px with a 2px offset; some components use local 2px outlines. Use the semantic focus color when extending the system.
- **Current implementation exception:** the compact landscape layout (width at least 981px, height at most 800px) reduces outcome buttons to 46px, some commands to 42px, and Undo to 38px. This falls below the product's 44px touch-target requirement for some controls; it is observed drift, not a new system minimum.

## Do's and Don'ts

- Do make the court and match state visible before controls.
- Do preserve 44px touch targets, keyboard focus, reduced motion, and full accessible names.
- Do use real volleyball geometry and the user's six-player rotation.

- Don't use photoreal court imagery, extra opponent players, invented match data, marketing slogans, decorative gradients, glass, neon glow, esports motifs, bubbly cards, or elastic motion. CSS gradients that draw court lines are structural geometry.
- Don't let Ionic defaults become the visual identity.
- Don't trade scoring speed for spectacle.
