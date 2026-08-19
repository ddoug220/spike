---
name: Spike
description: Volleyball match tracking for coaches and stat keepers
colors:
  ink-dark: "#0e0f11"
  surface-1-dark: "#141618"
  surface-2-dark: "#1b1d21"
  surface-3-dark: "#23262b"
  text-primary-dark: "#edf0f4"
  text-secondary-dark: "#7e8899"
  text-tertiary-dark: "#4d5562"
  accent-blue-dark: "#3d8ef8"
  signal-green-dark: "#21d07a"
  signal-red-dark: "#f25757"
  signal-amber-dark: "#f5a623"
  ink-light: "#0d0f11"
  surface-1-light: "#ffffff"
  surface-2-light: "#f8f9fa"
  surface-3-light: "#eef0f2"
  text-primary-light: "#0d0f11"
  text-secondary-light: "#5a6270"
  accent-blue-light: "#1d6fe8"
  volt: "#c8ff00"
  court-wood-dark: "#3f2c12"
  court-wood-light: "#c9903a"
typography:
  display:
    fontFamily: "DM Sans, ui-sans-serif, system-ui, sans-serif"
    fontWeight: 800
    lineHeight: 1.04
    letterSpacing: "-0.03em"
  headline:
    fontFamily: "DM Sans, ui-sans-serif, system-ui, sans-serif"
    fontWeight: 700
    lineHeight: 1.1
    letterSpacing: "-0.01em"
  body:
    fontFamily: "DM Sans, ui-sans-serif, system-ui, sans-serif"
    fontWeight: 400
    fontSize: "1rem"
    lineHeight: 1.55
  label:
    fontFamily: "DM Sans, ui-sans-serif, system-ui, sans-serif"
    fontWeight: 800
    fontSize: "0.72rem"
    letterSpacing: "0.08em"
    textTransform: "uppercase"
  mono:
    fontFamily: "DM Mono, ui-monospace, monospace"
    fontWeight: 500
    lineHeight: 1
rounded:
  sm: "8px"
  md: "12px"
  lg: "16px"
  xl: "22px"
  full: "999px"
spacing:
  xs: "8px"
  sm: "12px"
  md: "16px"
  lg: "24px"
  xl: "32px"
components:
  button-primary:
    backgroundColor: "{colors.accent-blue-dark}"
    textColor: "#ffffff"
    rounded: "{rounded.sm}"
    padding: "12px 20px"
  button-primary-hover:
    backgroundColor: "#2a7ae6"
  chip-status:
    backgroundColor: "rgba(33, 208, 122, 0.14)"
    textColor: "{colors.signal-green-dark}"
    rounded: "{rounded.full}"
    padding: "6px 12px"
  panel:
    backgroundColor: "{colors.surface-1-dark}"
    rounded: "{rounded.sm}"
    padding: "16px"
---

# Design System: Spike

## 1. Overview

**Creative North Star: "The Broadcast Control Room"**

Spike's interface is built for game-speed decision making. Like a broadcast control room during a live match, information is dense but instantly scannable. Every element earns its place by being either actionable or immediately informative. There is no decoration for decoration's sake.

The system is dark-first because coaches track matches in variable gym lighting, often under bright overheads or afternoon sun through windows. High contrast text on deep surfaces cuts through the chaos. The court visualization grounds the interface in the physical space coaches already understand.

This is not enterprise software. It's not a dashboard full of charts. It's a tool that disappears into the workflow, letting the coach focus on the game, not the screen.

**Key Characteristics:**
- Dense information, instant readability
- Dark surfaces with high-contrast text
- Court-centric spatial organization
- Monospace numerals for stats (DM Mono)
- Tonal surface layering instead of shadows
- Large touch targets for courtside taps

## 2. Colors

A dark-first palette with high contrast for gym lighting. Signal colors (green, red, amber) are reserved for match state and never decorative.

### Primary

- **Broadcast Blue** (#3d8ef8 dark / #1d6fe8 light): Primary interactive accent. Buttons, links, focus rings. Used sparingly—never as a surface color.

### Secondary

- **Volt** (#c8ff00): Brand accent for the SPIKE wordmark and celebratory moments only. Its rarity is the point.

### Signal

- **Signal Green** (#21d07a dark / #16a85a light): Points scored, successful actions, sync status OK. Functional only.
- **Signal Red** (#f25757 dark / #d63c3c light): Errors, opponent points, warnings. Never decoration.
- **Signal Amber** (#f5a623 dark / #d4820a light): Pending states, timeouts, caution.

### Neutral

- **Ink** (#0e0f11 dark / #0d0f11 light): Base background. Pure darkness.
- **Surface 1** (#141618 dark / #ffffff light): Primary panels and cards.
- **Surface 2** (#1b1d21 dark / #f8f9fa light): Nested containers, secondary panels.
- **Surface 3** (#23262b dark / #eef0f2 light): Tertiary surfaces, input backgrounds.
- **Text Primary** (#edf0f4 dark / #0d0f11 light): Headlines, primary content. WCAG AAA contrast.
- **Text Secondary** (#7e8899 dark / #5a6270 light): Body text, descriptions. WCAG AA minimum.
- **Text Tertiary** (#4d5562 dark / #9aa1ab light): Disabled, placeholder, timestamps.

### Special

- **Court Wood** (gradient #2e1f0a → #3f2c12 → #2a1b09 dark / #c9903a → #b07830 → #c49040 light): The hardwood court surface. Warm brown tones ground the interface in the physical gym.

### Named Rules

**The Signal Color Rule.** Green, red, and amber are reserved for match state and system status. They never appear as decorative accents, button backgrounds, or brand elements. If a color communicates scoring or errors, it must be one of the three signals.

**The Volt Scarcity Rule.** The volt accent (#c8ff00) appears only on the SPIKE wordmark and match-winning celebrations. Its rarity is the point. Overuse dilutes its impact.

## 3. Typography

**Display Font:** DM Sans (weight 800, with ui-sans-serif, system-ui fallbacks)
**Body Font:** DM Sans (weight 400-700)
**Stats Font:** DM Mono (weight 400-500)

**Character:** DM Sans is a geometric sans with optical sizing that stays readable at any scale. Its high x-height and open apertures work in dim gym lighting. DM Mono is reserved exclusively for statistics—scores, jersey numbers, timestamps—where tabular alignment matters.

### Hierarchy

- **Display** (800, clamp(2rem, 3vw, 2.5rem), 1.04): Hero headlines on home and pre-match. Maximum impact, minimum words.
- **Headline** (700, 1.5rem, 1.1): Section headers, panel titles. Clear hierarchy without shouting.
- **Title** (700, 1.125rem, 1.2): Card headers, list item primaries. Scannable anchors.
- **Body** (400, 1rem, 1.55): Descriptions, instructions. Max line length 65ch.
- **Label** (800, 0.72rem, 0.08em tracking, uppercase): Status badges, kickers, metadata. Always uppercase, always tracked.
- **Stats** (DM Mono 500, tabular): Scores, jersey numbers, timestamps. Monospace ensures columns align.

### Named Rules

**The Mono Rule.** Any number that a coach might need to scan quickly—score, jersey number, match time, stat count—uses DM Mono. Body text uses DM Sans even when numbers appear inline.

## 4. Elevation

This system uses **tonal layering**, not shadows. Depth is conveyed by stepping through surface colors (surface-1 → surface-2 → surface-3), not by box-shadows. The result is flatter and faster to render, with no ambient blur calculations.

Shadows appear only as feedback:
- Focus rings on inputs (subtle glow)
- Active drag states
- Modal overlays (backdrop dimming, not card shadow)

### Named Rules

**The Flat Default Rule.** Surfaces are flat at rest. If a card "pops" visually, it's because its surface color is lighter than its container, not because it has a shadow. Shadows are earned through interaction, not inheritance.

## 5. Components

### Buttons

- **Shape:** Consistent 8px radius (--radius-sm) on all buttons.
- **Primary:** Broadcast Blue background, white text, 12px 20px padding. Used for main CTAs only.
- **Hover / Focus:** Background shifts to darker blue (#2a7ae6), 2px solid focus ring matching the button color.
- **Ghost:** Transparent background, accent-colored text and border. For secondary actions.
- **Large Touch Target:** Minimum 44x44px touch area for all buttons. Courtside taps require margin for error.

### Chips / Status Badges

- **Style:** Pill-shaped (--radius-full), dim background color matching the signal (green-dim, red-dim, amber-dim), signal-colored text.
- **State:** No hover state—chips are status indicators, not interactive.
- **Label:** Uppercase, tracked, 800 weight.

### Cards / Panels

- **Corner Style:** 8px radius (--radius-sm)
- **Background:** Surface-1 in dark mode, white in light mode
- **Shadow Strategy:** None. Depth via tonal layering.
- **Border:** 1px solid at 7% white opacity (dark) or 8% black opacity (light)
- **Internal Padding:** 16px standard, 24px for hero cards

### Inputs / Fields

- **Style:** Surface-2 background with 1px border (--color-border)
- **Focus:** Border shifts to accent color, subtle glow ring
- **Error:** Border shifts to signal-red, error text below in signal-red
- **Radius:** 8px (--radius-sm)

### Navigation / Toolbar

- **Style:** Blurred glass effect (backdrop-filter: blur(20px) saturate(1.4)) over surface color
- **Height:** 52px minimum
- **Typography:** Display weight on title, secondary weight on nav buttons

### Court Visualization

The court component is the signature element. It renders a volleyball court in correct 9m x 18m proportions with:
- Wood-grain gradient background
- White court lines at 18% opacity (dark) or 55% opacity (light)
- Attack lines at 10% opacity
- Net centerline
- Player positions as interactive tiles

**Player Tiles:** 94px x 78px fixed size, positioned absolutely on the court. Jersey number in DM Mono, player name below.

## 6. Do's and Don'ts

### Do:

- **Do** use DM Mono for all numeric stats, scores, and jersey numbers.
- **Do** maintain 4.5:1 contrast minimum for all body text—gyms have variable lighting.
- **Do** use signal colors only for their designated purpose (green = success, red = error, amber = warning).
- **Do** provide 44x44px minimum touch targets for any button a coach might tap during a live match.
- **Do** use tonal surface stepping (surface-1 → surface-2 → surface-3) for visual hierarchy.
- **Do** respect the court's spatial logic—rotations, positions, and net orientation should match physical reality.

### Don't:

- **Don't** use shadows for visual hierarchy—this system is flat by default with tonal layering.
- **Don't** apply signal colors decoratively. If it's green, it means success. If it's red, it means error for all users.
- **Don't** use Volt (#c8ff00) anywhere except the wordmark and match-winning moments.
- **Don't** make it look like generic SaaS—white/gray grids, muted colors, corporate blandness. Spike is a sports tool.
- **Don't** make it look like a toy sports app—no cartoon mascots, no rounded bubbly UI, no gamification excess.
- **Don't** add shadows to cards at rest. If you're reaching for box-shadow, use a lighter surface color instead.
- **Don't** use the eyebrow/kicker pattern on every section. One deliberate kicker per page is voice; kickers on every section is scaffold.
