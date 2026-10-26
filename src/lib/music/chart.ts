// Bar-chart format used by the song editor.
//
//   [Verse 1]
//   > Amazing grace
//   | G . . . | C . G . | Em D | C |
//
// A line in square brackets starts a section. A line starting with ">" is a lyric cue
// for the next bar. Bars are separated by "|". Inside a bar, either one token per beat
// ("." holds the previous chord) or a few chords that split the bar evenly. "%" repeats
// the previous bar, "N.C." means no chord. Inline ChordPro lines ("[G]Amazing [C]grace")
// are accepted too and become one bar per chord.

import { parseChord } from "./chords";

export interface ChartEvent {
  /** Chord symbol, or null for "no chord". */
  chord: string | null;
  /** Beat within the bar where this chord starts, from 0. */
  beat: number;
  /** Position in the song's flat list of chord changes; timings are stored by this. */
  index: number;
}

export interface ChartBar {
  events: ChartEvent[];
  cue?: string;
}

export interface ChartSection {
  label: string;
  /** Section name without numbers, used to share strum patterns: "Verse 2" -> "verse". */
  kind: string;
  bars: ChartBar[];
}

export interface ChartError {
  line: number;
  message: string;
}

export interface ParsedChart {
  sections: ChartSection[];
  events: ChartEvent[];
  errors: ChartError[];
}

const SECTION_RE = /^\s*\[([^\]]+)\]\s*$/;
const INLINE_CHORD_RE = /\[([^\]]+)\]/g;

export function sectionKind(label: string): string {
  return label.toLowerCase().replace(/[\d.:()]+/g, "").replace(/\s+/g, " ").trim() || "section";
}

function isChordToken(t: string): boolean {
  return parseChord(t) !== null;
}

function isNoChord(t: string): boolean {
  return /^(n\.?c\.?|-)$/i.test(t);
}

export function parseChart(text: string, beatsPerBar: number): ParsedChart {
  const sections: ChartSection[] = [];
  const errors: ChartError[] = [];
  let current: ChartSection | null = null;
  let pendingCue: string | undefined;
  let lastBar: ChartBar | null = null;

  const ensureSection = () => {
    if (!current) {
      current = { label: "Song", kind: "song", bars: [] };
      sections.push(current);
    }
    return current;
  };

  const pushBar = (events: Omit<ChartEvent, "index">[], cue?: string) => {
    const bar: ChartBar = { events: events.map((e) => ({ ...e, index: -1 })) };
    if (cue) bar.cue = cue;
    ensureSection().bars.push(bar);
    lastBar = bar;
  };

  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  lines.forEach((raw, i) => {
    const lineNo = i + 1;
    const line = raw.trim();
    if (!line || line.startsWith("//") || /^\{.*\}$/.test(line)) return;

    const section = SECTION_RE.exec(line);
    if (section && !isChordToken(section[1].trim())) {
      const label = section[1].trim();
      current = { label, kind: sectionKind(label), bars: [] };
      sections.push(current);
      pendingCue = undefined;
      return;
    }

    if (line.startsWith(">")) {
      pendingCue = line.slice(1).trim() || undefined;
      return;
    }

    if (line.includes("|")) {
      const segments = line.split("|").map((s) => s.trim());
      if (segments[0] === "") segments.shift();
      if (segments[segments.length - 1] === "") segments.pop();
      for (const seg of segments) {
        const tokens = seg.split(/\s+/).filter(Boolean);
        if (tokens.length === 1 && tokens[0] === "%") {
          if (!lastBar) {
            errors.push({ line: lineNo, message: "\"%\" repeats the previous bar, but there isn't one yet." });
            continue;
          }
          pushBar(lastBar.events.map(({ chord, beat }) => ({ chord, beat })), pendingCue);
          pendingCue = undefined;
          continue;
        }
        const events = barTokensToEvents(tokens, beatsPerBar, lineNo, errors);
        pushBar(events, pendingCue);
        pendingCue = undefined;
      }
      return;
    }

    if (line.includes("[")) {
      // Inline ChordPro: one bar per chord, the lyric line becomes the cue of the first bar.
      const lyric = line.replace(INLINE_CHORD_RE, "").replace(/\s+/g, " ").trim();
      let first = true;
      for (const m of line.matchAll(INLINE_CHORD_RE)) {
        const sym = m[1].trim();
        if (!isChordToken(sym)) {
          errors.push({ line: lineNo, message: `"${sym}" isn't a chord I recognise.` });
          continue;
        }
        pushBar([{ chord: sym, beat: 0 }], first ? pendingCue ?? (lyric || undefined) : undefined);
        first = false;
        pendingCue = undefined;
      }
      return;
    }

    // A bare line of chords: one bar each.
    const tokens = line.split(/\s+/);
    if (tokens.every((t) => isChordToken(t) || isNoChord(t))) {
      tokens.forEach((t, k) => {
        pushBar([{ chord: isNoChord(t) ? null : t, beat: 0 }], k === 0 ? pendingCue : undefined);
      });
      pendingCue = undefined;
      return;
    }

    errors.push({ line: lineNo, message: "I couldn't read this line. Bars need \"|\" between them, and cues start with \">\"." });
  });

  const events: ChartEvent[] = [];
  for (const s of sections) {
    for (const b of s.bars) {
      for (const e of b.events) {
        e.index = events.length;
        events.push(e);
      }
    }
  }
  return { sections, events, errors };
}

function barTokensToEvents(
  tokens: string[],
  beatsPerBar: number,
  lineNo: number,
  errors: ChartError[],
): Omit<ChartEvent, "index">[] {
  const valid: { tok: string; pos: number }[] = [];
  tokens.forEach((tok, pos) => {
    if (tok === ".") return;
    if (isNoChord(tok) || isChordToken(tok)) valid.push({ tok, pos });
    else errors.push({ line: lineNo, message: `"${tok}" isn't a chord I recognise.` });
  });
  if (valid.length === 0) return [];
  const perBeat = tokens.length === beatsPerBar || tokens.includes(".");
  const events: Omit<ChartEvent, "index">[] = [];
  valid.forEach(({ tok, pos }, k) => {
    const beat = perBeat
      ? Math.min(beatsPerBar - 1, Math.round((pos * beatsPerBar) / Math.max(tokens.length, 1)))
      : Math.floor((k * beatsPerBar) / valid.length);
    const chord = isNoChord(tok) ? null : tok;
    const prev = events[events.length - 1];
    if (prev && prev.beat === beat) prev.chord = chord;
    else events.push({ chord, beat });
  });
  return events;
}

/** Write sections back to chart text, four bars to a line. */
export function serializeChart(sections: ChartSection[], beatsPerBar: number): string {
  const out: string[] = [];
  for (const s of sections) {
    if (out.length) out.push("");
    out.push(`[${s.label}]`);
    let row: string[] = [];
    const flush = () => {
      if (row.length) out.push("| " + row.join(" | ") + " |");
      row = [];
    };
    s.bars.forEach((bar) => {
      if (bar.cue) {
        flush();
        out.push("> " + bar.cue);
      }
      row.push(barToText(bar, beatsPerBar));
      if (row.length === 4) flush();
    });
    flush();
  }
  return out.join("\n") + "\n";
}

function barToText(bar: ChartBar, beatsPerBar: number): string {
  if (bar.events.length === 0) return "N.C.";
  if (bar.events.length === 1 && bar.events[0].beat === 0) return bar.events[0].chord ?? "N.C.";
  const evenSplit = bar.events.every((e, k) => e.beat === Math.floor((k * beatsPerBar) / bar.events.length));
  if (evenSplit) return bar.events.map((e) => e.chord ?? "N.C.").join(" ");
  const slots: string[] = Array(beatsPerBar).fill(".");
  for (const e of bar.events) slots[e.beat] = e.chord ?? "N.C.";
  return slots.join(" ");
}

/** All distinct chord symbols in order of first appearance. */
export function distinctChords(chart: ParsedChart): string[] {
  const seen = new Set<string>();
  for (const e of chart.events) if (e.chord && !seen.has(e.chord)) seen.add(e.chord);
  return [...seen];
}

/**
 * Renames section `index` (as parseChart numbers them) in the chart text. With
 * `everywhere`, every section with the same name is renamed too, so fixing one
 * chorus fixes them all. Bars before any [name] get a new heading at the top.
 */
export function renameSection(text: string, index: number, label: string, everywhere: boolean): string {
  const name = label.replace(/[[\]]/g, "").trim();
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  const headers: { line: number; label: string }[] = [];
  lines.forEach((raw, i) => {
    const m = SECTION_RE.exec(raw.trim());
    if (m && !isChordToken(m[1].trim())) headers.push({ line: i, label: m[1].trim() });
  });
  if (!name) return text;
  const implicit = parseChart(text, 4).sections.length > headers.length;
  const at = index - (implicit ? 1 : 0);
  if (at < 0) return `[${name}]\n${text}`;
  const target = headers[at];
  if (!target) return text;
  const same = (l: string) => l.toLowerCase() === target.label.toLowerCase();
  for (const h of headers) {
    if (h === target || (everywhere && same(h.label))) lines[h.line] = lines[h.line].replace(/\[[^\]]+\]/, `[${name}]`);
  }
  return lines.join("\n");
}
