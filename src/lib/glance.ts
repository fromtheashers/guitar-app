// The whole song folded down for "Song at a glance": each section once, four bars
// to a line, back-to-back repeats shown once with a count.

import type { SongView } from "./songView";

export interface GlanceGroup {
  /** One or two lines of up to four cells; "–" means keep holding. */
  lines: string[][];
  times: number;
}

export interface GlanceSection {
  label: string;
  kind: string;
  groups: GlanceGroup[];
}

/** Bar cells in lines of four. A bar that only repeats the chord before it in its line reads "–". */
export function glanceLines(view: SongView, sectionIndex: number): string[][] {
  const lines: string[][] = [];
  const bars = view.sections[sectionIndex].bars;
  for (let i = 0; i < bars.length; i += 4) {
    let last: string | null = null;
    lines.push(
      bars.slice(i, i + 4).map((b) => {
        const labels = b.events.map((e) => e.label);
        const held = labels.length === 0 || (labels.length === 1 && b.events[0].beat === 0 && labels[0] === last);
        if (labels.length) last = labels[labels.length - 1];
        return held && last !== null ? "–" : labels.join(" ") || "–";
      }),
    );
  }
  return lines;
}

/** Folds a line repeated back to back, or a two-line phrase played twice in a row. */
export function foldLines(lines: string[][]): GlanceGroup[] {
  const key = (l: string[] | undefined) => (l ? l.join("|") : null);
  const out: GlanceGroup[] = [];
  let i = 0;
  while (i < lines.length) {
    const a = key(lines[i]);
    const b = key(lines[i + 1]);
    if (b !== null && a !== b && key(lines[i + 2]) === a && key(lines[i + 3]) === b) {
      out.push({ lines: [lines[i], lines[i + 1]], times: 2 });
      i += 4;
      continue;
    }
    let n = 1;
    while (key(lines[i + n]) === a) n++;
    out.push({ lines: [lines[i]], times: n });
    i += n;
  }
  return out;
}

export function glance(view: SongView): GlanceSection[] {
  return view.sections.map((s, si) => ({ label: s.label, kind: s.kind, groups: foldLines(glanceLines(view, si)) }));
}

/** Chord names in the order they first appear. */
export function glanceChords(view: SongView): string[] {
  const seen: string[] = [];
  for (const e of view.events) if (e.label !== "N.C." && !seen.includes(e.label)) seen.push(e.label);
  return seen;
}
