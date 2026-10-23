---
name: Chord Window
description: Stained-glass practice screens for worship guitar students
colors:
  lead: "#121212"
  surface: "#1b1b1c"
  surface-2: "#242425"
  surface-3: "#2e2e30"
  line: "#2c2c2e"
  line-strong: "#444447"
  ink: "#f2f2f0"
  ink-2: "#b6b3ad"
  ink-3: "#8f8c86"
  ruby: "#d8434e"
  ruby-tint: "#3a1a1d"
  cobalt: "#3f86e8"
  cobalt-tint: "#16263d"
  amber: "#f0b43c"
  amber-tint: "#3a2c12"
  green: "#3fae78"
  green-tint: "#15301f"
  danger: "#ff6b6b"
  ok: "#5fcf95"
typography:
  title:
    fontFamily: "Schibsted Grotesk, ui-sans-serif, system-ui, sans-serif"
    fontSize: "28px"
    fontWeight: 650
    lineHeight: 1.15
    letterSpacing: "-0.01em"
  chord:
    fontFamily: "Schibsted Grotesk, ui-sans-serif, system-ui, sans-serif"
    fontSize: "20px"
    fontWeight: 650
  body:
    fontFamily: "Schibsted Grotesk, ui-sans-serif, system-ui, sans-serif"
    fontSize: "15px"
    fontWeight: 400
    lineHeight: 1.5
rounded:
  sm: "4px"
  md: "8px"
  lg: "12px"
spacing:
  pane-gap: "4px"
  block: "16px"
  section: "32px"
components:
  button-primary:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.lead}"
    rounded: "{rounded.md}"
  panel:
    backgroundColor: "{colors.surface}"
    rounded: "{rounded.lg}"
    padding: "20px"
  bar-pane:
    backgroundColor: "{colors.cobalt-tint}"
    textColor: "{colors.ink}"
    rounded: "{rounded.md}"
    height: "64px"
---

## Overview

A dark church window at rehearsal: a near-black lead ground with panes of jewel colour set into it. The chart and the strum grid are literally built as panes separated by thin lead gaps. Colour carries meaning, never decoration, and the one bright thing on screen is the amber of "now".

## Colors

- **Lead** is the ground and the 3–4px gap between panes.
- **Ruby** = chorus and kick drum. **Cobalt** = verse and snare. **Green** = bridge. **Amber** = the current bar, step and chord, plus the hi-hat row. Primary buttons are plain ink, so amber stays reserved for "now". Plain surfaces = intro, outro and anything unnamed.
- Each hue has a dark `-tint` for filled panes; the full hue is used for small labels (lifted 22% toward white so text clears 4.5:1) and drum hits.

## Typography

One family, Schibsted Grotesk. Chords are the loudest type on the page (20px in bars, 40px beside the shape in the player). Tabular figures only on numeric UI (`.tnum`, strum grid, timers): the font's tabular full stop reads as a stray space in prose.

## Layout

Practice screen: video, settings and the chart on the left; on the right the player pane (section, current chord with its diagram, next chord, strum grid, song position, transport, auto-scroll) stays in view while the chart scrolls. At 960px and below it is one column and the player docks to the bottom of the screen, with only the strum row of the grid. The chart is where the chord names live, so the player shows the chord name at a modest size beside its shape. Charts keep four bars to a line at every width because players read in four-bar phrases.

## Elevation & Depth

Flat. No shadows or glows. Depth comes from surface steps (lead → surface → surface-2) and the lead gaps between panes. The active bar uses a 2px amber outline, not a shadow.

## Shapes

8px panes, 12px panels, 4px small controls. No pills except segmented controls.

## Components

- **Bar pane**: section tint fill, chord(s) laid on a per-beat grid, optional lyric cue above. Clickable to seek when the song is synced.
- **Strum grid**: rows for count, kick, snare, hi-hat and strum; drum panes tinted by strength; arrows for down/up, × for a chuck, · for rest.
- **Buttons**: scale to 0.97 on press; transitions under 300ms with `--ease-out`; none on keyboard-triggered actions.

## Do's and Don'ts

- Do keep each hue tied to its one meaning.
- Do keep amber rare: if more than one thing is amber, nothing is "now".
- Don't add gradients, glass, glows, emoji or monospace.
- Don't outline panels that are already filled surfaces.
