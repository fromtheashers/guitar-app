// Builds what a student sees from a stored song and their chosen options:
// chords transposed to the band's key, moved under a capo, simplified in easy mode,
// or written as Nashville numbers. The capo is chosen for the student's instrument.

import { Chord, formatChord, Key, keyName, mod12, nashville, parseChord, parseKey, prefersFlats, simplifyChord, transposeChord, transposeKey } from "./music/chords";
import { ChartSection, parseChart } from "./music/chart";
import { bestCapo, getInstrument, type InstrumentId } from "./music/instruments";
import { defaultPresetFor, presetPattern, StrumPattern } from "./music/strum";

export type Mode = "easy" | "advanced";

export interface ViewOptions {
  mode: Mode;
  /** Key the song should sound in. */
  key: string;
  /** Capo fret, or "auto" to pick the easiest. */
  capo: number | "auto";
  numbers: boolean;
  /** What the student plays; guitar when left out. */
  instrument?: InstrumentId;
}

export interface ViewEvent {
  index: number;
  beat: number;
  label: string;
  /** Chord the student plays (shape name), for diagrams. */
  shape: string | null;
  time: number | null;
}

export interface ViewBar {
  events: ViewEvent[];
  cue?: string;
  start: number | null;
  end: number | null;
}

export interface ViewSection {
  label: string;
  kind: string;
  bars: ViewBar[];
  pattern: StrumPattern;
  start: number | null;
  end: number | null;
}

export interface SongView {
  sections: ViewSection[];
  events: ViewEvent[];
  shapes: string[];
  capo: number;
  soundingKey: string;
  shapeKey: string;
  errors: { line: number; message: string }[];
}

export interface SongLike {
  originalKey: string;
  beatsPerBar: number;
  chart: string;
  timings: (number | null)[];
  patterns: Record<string, StrumPattern>;
}

/** Semitones from one key to another, the short way round (-5..+6). */
export function keyDistance(from: Key, to: Key): number {
  const d = mod12(to.tonic - from.tonic);
  return d > 6 ? d - 12 : d;
}

export function buildView(song: SongLike, opts: ViewOptions): SongView {
  const chart = parseChart(song.chart, song.beatsPerBar);
  const original = parseKey(song.originalKey) ?? { tonic: 7, minor: false };
  const sounding = parseKey(opts.key) ?? original;
  const shift = keyDistance(original, sounding);

  const soundingChords = new Map<string, Chord>();
  for (const e of chart.events) {
    if (!e.chord || soundingChords.has(e.chord)) continue;
    const c = parseChord(e.chord);
    if (c) soundingChords.set(e.chord, transposeChord(c, shift));
  }
  const inst = getInstrument(opts.instrument);
  const capo = !inst.capo ? 0 : opts.capo === "auto" ? bestCapo([...soundingChords.values()], opts.mode === "easy", inst).capo : opts.capo;
  const shapeKey = transposeKey(sounding, -capo);
  const flats = prefersFlats(shapeKey);

  const shapeName = (sym: string | null): string | null => {
    if (!sym) return null;
    const c = soundingChords.get(sym);
    if (!c) return sym;
    let shape = transposeChord(c, -capo);
    if (opts.mode === "easy") shape = simplifyChord(shape);
    return formatChord(shape, flats);
  };
  const label = (sym: string | null): string => {
    if (!sym) return "N.C.";
    const c = soundingChords.get(sym);
    if (!c) return sym;
    if (opts.numbers) {
      const shown = opts.mode === "easy" ? simplifyChord(c) : c;
      return nashville(shown, sounding, opts.mode === "advanced");
    }
    return shapeName(sym)!;
  };

  const timeOf = (index: number) => {
    const t = song.timings[index];
    return typeof t === "number" ? t : null;
  };

  const events: ViewEvent[] = [];
  const sections: ViewSection[] = chart.sections.map((s: ChartSection) => {
    const bars: ViewBar[] = s.bars.map((b) => {
      const evs = b.events.map((e) => {
        const ev: ViewEvent = { index: e.index, beat: e.beat, label: label(e.chord), shape: shapeName(e.chord), time: timeOf(e.index) };
        events.push(ev);
        return ev;
      });
      return { events: evs, cue: b.cue, start: evs[0]?.time ?? null, end: null };
    });
    const pattern = song.patterns[s.kind] ?? song.patterns.default ?? presetPattern(defaultPresetFor(song.beatsPerBar), song.beatsPerBar);
    return { label: s.label, kind: s.kind, bars, pattern, start: null, end: null };
  });

  // Bar and section spans, so the player can loop a section and follow along.
  const allBars = sections.flatMap((s) => s.bars);
  allBars.forEach((b, i) => {
    const next = allBars.slice(i + 1).find((x) => x.start !== null);
    b.end = next?.start ?? null;
  });
  for (const s of sections) {
    s.start = s.bars.find((b) => b.start !== null)?.start ?? null;
    const lastTimed = [...s.bars].reverse().find((b) => b.end !== null || b.start !== null);
    s.end = lastTimed?.end ?? null;
  }

  const shapes: string[] = [];
  for (const e of events) if (e.shape && !shapes.includes(e.shape)) shapes.push(e.shape);

  return { sections, events, shapes, capo, soundingKey: keyName(sounding), shapeKey: keyName(shapeKey), errors: chart.errors };
}

/** Index of the chord change playing at time t, or -1. */
export function eventAt(events: ViewEvent[], t: number): number {
  let lo = -1;
  for (let i = 0; i < events.length; i++) {
    const et = events[i].time;
    if (et === null) continue;
    if (et <= t + 0.05) lo = i;
    else break;
  }
  return lo;
}

export const ALL_KEYS = ["C", "Db", "D", "Eb", "E", "F", "F#", "G", "Ab", "A", "Bb", "B"];
export const ALL_MINOR_KEYS = ["Cm", "C#m", "Dm", "Ebm", "Em", "Fm", "F#m", "Gm", "G#m", "Am", "Bbm", "Bm"];
