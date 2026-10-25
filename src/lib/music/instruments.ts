// The string instruments a student can practise on: tuning, chord shapes for the
// diagrams, how hard each shape is, and which capo makes a song easiest.
// Guitar uses its hand-picked table (guitar.ts); other chord instruments use a
// small table of standard shapes and fall back to a search over the fretboard.
// Bass shows where to play the bass note of each chord.

import { Chord, chordTones, formatChord, mod12, parseChord, simplifyChord, transposeChord } from "./chords";
import { guitarShapes, type Shape } from "./guitar";

export type { Frets, Shape } from "./guitar";

export type InstrumentId = "guitar" | "ukulele" | "baritone" | "mandolin" | "bass";

export interface Instrument {
  id: InstrumentId;
  name: string;
  /** Open strings as MIDI notes, in diagram order (left to right). */
  tuning: number[];
  /** Open string names, same order, for the "tuned …" line. */
  strings: string[];
  /** Strums chords, or plays the bass note. */
  role: "chords" | "bass";
  capo: boolean;
  /** Top string higher than the next (ukulele), so the lowest string isn't the bass. */
  reentrant?: boolean;
}

export const INSTRUMENTS: Instrument[] = [
  { id: "guitar", name: "Guitar", tuning: [40, 45, 50, 55, 59, 64], strings: ["E", "A", "D", "G", "B", "E"], role: "chords", capo: true },
  { id: "ukulele", name: "Ukulele", tuning: [67, 60, 64, 69], strings: ["G", "C", "E", "A"], role: "chords", capo: true, reentrant: true },
  { id: "baritone", name: "Baritone ukulele", tuning: [50, 55, 59, 64], strings: ["D", "G", "B", "E"], role: "chords", capo: true },
  { id: "mandolin", name: "Mandolin", tuning: [55, 62, 69, 76], strings: ["G", "D", "A", "E"], role: "chords", capo: true },
  { id: "bass", name: "Bass guitar", tuning: [28, 33, 38, 43], strings: ["E", "A", "D", "G"], role: "bass", capo: false },
];

export const GUITAR = INSTRUMENTS[0];

export function getInstrument(id: string | null | undefined): Instrument {
  return INSTRUMENTS.find((i) => i.id === id) ?? GUITAR;
}

const b = (frets: number[], barre?: number, note?: string): Shape => ({ frets, barre, note });

// Standard beginner shapes, G C E A. The search finds the rest.
const UKULELE: Record<string, Shape[]> = {
  C: [b([0, 0, 0, 3])], Cm: [b([0, 3, 3, 3], 3)], C7: [b([0, 0, 0, 1])], Cmaj7: [b([0, 0, 0, 2])],
  Cadd9: [b([0, 2, 0, 3])], Csus4: [b([0, 0, 1, 3])], Csus2: [b([0, 2, 3, 3])],
  D: [b([2, 2, 2, 0])], Dm: [b([2, 2, 1, 0])], D7: [b([2, 2, 2, 3])], Dm7: [b([2, 2, 1, 3])],
  Dsus4: [b([0, 2, 3, 0])], Dsus2: [b([2, 2, 0, 0])],
  E: [b([1, 4, 0, 2]), b([4, 4, 4, 2])], Em: [b([0, 4, 3, 2])], E7: [b([1, 2, 0, 2])], Em7: [b([0, 2, 0, 2])],
  F: [b([2, 0, 1, 0])], Fm: [b([1, 0, 1, 3])], F7: [b([2, 3, 1, 3])],
  G: [b([0, 2, 3, 2])], Gm: [b([0, 2, 3, 1])], G7: [b([0, 2, 1, 2])], Gmaj7: [b([0, 2, 2, 2])], Gsus4: [b([0, 2, 3, 3])],
  A: [b([2, 1, 0, 0])], Am: [b([2, 0, 0, 0])], A7: [b([0, 1, 0, 0])], Am7: [b([0, 0, 0, 0])], Asus4: [b([2, 2, 0, 0])],
  "A#": [b([3, 2, 1, 1], 1)], "A#m": [b([3, 1, 1, 1], 1)],
  B: [b([4, 3, 2, 2], 2)], Bm: [b([4, 2, 2, 2], 2)], B7: [b([2, 3, 2, 2], 2)], Bm7: [b([2, 2, 2, 2], 2)],
};

// G D A E, tuned like a violin.
const MANDOLIN: Record<string, Shape[]> = {
  G: [b([0, 0, 2, 3])], C: [b([0, 2, 3, 0])], D: [b([2, 0, 0, 2])], Em: [b([0, 2, 2, 0])],
  A: [b([2, 2, 4, 5])], Am: [b([2, 2, 3, 5])], E: [b([1, 2, 2, 4])],
};

const TABLES: Partial<Record<InstrumentId, Record<string, Shape[]>>> = { ukulele: UKULELE, mandolin: MANDOLIN };

const cache = new Map<string, Shape[]>();

/** Shapes for a chord symbol on an instrument, best first. Empty if the symbol isn't a chord. */
export function shapesFor(symbol: string, inst: Instrument = GUITAR): Shape[] {
  const id = `${inst.id}:${symbol}`;
  const hit = cache.get(id);
  if (hit) return hit;
  const shapes = findShapes(symbol, inst);
  cache.set(id, shapes);
  return shapes;
}

function findShapes(symbol: string, inst: Instrument): Shape[] {
  if (inst.id === "guitar") return guitarShapes(symbol);
  const chord = parseChord(symbol);
  if (!chord) return [];
  if (inst.role === "bass") return bassShapes(chord, inst);

  // A four-string instrument can't add much under a slash chord: play the chord.
  const plain: Chord = { root: chord.root, quality: chord.quality };
  const table = TABLES[inst.id]?.[formatChord(plain, false)] ?? [];
  const out = [...table];
  for (const s of searchShapes(plain, inst)) {
    if (out.length >= 3) break;
    if (!out.some((o) => o.frets.join() === s.frets.join())) out.push(s);
  }
  return out;
}

interface Scored {
  shape: Shape;
  score: number;
}

/** Search a four-fret window up the neck for playable shapes using only chord tones. */
function searchShapes(chord: Chord, inst: Instrument): Shape[] {
  const tones = chordTones(chord);
  const fifth = mod12(chord.root + 7);
  let required = tones.length > 2 ? tones.filter((t) => t !== fifth) : tones;
  // More notes than strings (9ths, 13ths): leave out the root, as players do.
  if (required.length > inst.tuning.length) required = required.filter((t) => t !== chord.root);
  required = required.slice(0, inst.tuning.length);

  const found = new Map<string, Scored>();
  for (const allowMute of [false, true]) {
    for (let lo = 1; lo <= 10; lo++) {
      const options = inst.tuning.map((open) => {
        const o: number[] = [];
        if (tones.includes(mod12(open))) o.push(0);
        for (let f = lo; f <= lo + 3; f++) if (tones.includes(mod12(open + f))) o.push(f);
        if (allowMute) o.push(-1);
        return o;
      });
      const walk = (s: number, frets: number[]) => {
        if (s === options.length) {
          const scored = scoreShape(frets, chord, required, inst);
          if (scored && !found.has(frets.join())) found.set(frets.join(), scored);
          return;
        }
        for (const f of options[s]) walk(s + 1, [...frets, f]);
      };
      walk(0, []);
    }
    if (found.size) break;
  }

  const ranked = [...found.values()].sort((x, y) => x.score - y.score);
  // The best, then the best of another kind: open versus barre, or further up the neck.
  const out: Shape[] = [];
  for (const r of ranked) {
    if (out.length >= 3) break;
    const pos = lowest(r.shape.frets);
    const differs = out.every((o) => Boolean(o.barre) !== Boolean(r.shape.barre) || Math.abs(lowest(o.frets) - pos) >= 3);
    if (!out.length || differs) out.push(r.shape);
  }
  return out;
}

const lowest = (frets: number[]) => Math.min(99, ...frets.filter((f) => f > 0));

function scoreShape(frets: number[], chord: Chord, required: number[], inst: Instrument): Scored | null {
  const sounded = frets.map((f, s) => (f < 0 ? null : inst.tuning[s] + f)).filter((n): n is number => n !== null);
  if (sounded.length < Math.min(3, frets.length)) return null;
  const pcs = new Set(sounded.map(mod12));
  if (!required.every((t) => pcs.has(t))) return null;

  const fretted = frets.filter((f) => f > 0);
  const min = fretted.length ? Math.min(...fretted) : 0;
  const max = fretted.length ? Math.max(...fretted) : 0;
  const mutes = frets.filter((f) => f < 0).length;

  // Four fingers with the lowest fret on two or more strings: lay one finger across.
  let barre: number | undefined;
  const atMin = frets.map((f, s) => (f === min ? s : -1)).filter((s) => s >= 0);
  if (fretted.length >= 4 && atMin.length >= 2) {
    const first = atMin[0];
    const last = atMin[atMin.length - 1];
    const blocked = frets.slice(first, last + 1).some((f) => f < min);
    if (!blocked) barre = min;
    else if (fretted.length > 4) return null;
  } else if (fretted.length > 4) return null;

  let score = min * 0.45 + fretted.length * 0.35 + (max - min) * 0.4 + mutes * 2.5;
  if (barre) score += 0.8;
  if (!pcs.has(mod12(chord.root + 7)) && chordTones(chord).includes(mod12(chord.root + 7))) score += 0.15;
  if (!inst.reentrant && mod12(Math.min(...sounded)) === chord.root) score -= 0.4;
  return { shape: { frets, barre }, score };
}

/** Bass: one note, the chord's bass note, low on the neck and on the thicker strings. */
function bassShapes(chord: Chord, inst: Instrument): Shape[] {
  const note = chord.bass ?? chord.root;
  let best = { s: -1, f: 0, cost: Infinity };
  for (let s = 0; s < inst.tuning.length; s++) {
    for (let f = 0; f <= 7; f++) {
      if (mod12(inst.tuning[s] + f) !== note) continue;
      const cost = f + s * 1.2;
      if (cost < best.cost) best = { s, f, cost };
    }
  }
  if (best.s < 0) return [];
  return [{ frets: inst.tuning.map((_, i) => (i === best.s ? best.f : -1)) }];
}

/** 0 = beginner-friendly open chord, higher = harder. */
export function difficulty(symbol: string, inst: Instrument = GUITAR): number {
  const shapes = shapesFor(symbol, inst);
  if (!shapes.length) return 3;
  if (inst.role === "bass") return 0;
  const s = shapes[0];
  if (inst.id === "guitar") {
    if (!s.barre) return 0;
    return shapes.some((x) => !x.barre) ? 1 : s.barre <= 3 ? 2 : 3;
  }
  return Math.min(...shapes.map(shapeCost));
}

function shapeCost(s: Shape): number {
  const fretted = s.frets.filter((f) => f > 0);
  const top = Math.max(0, ...fretted);
  if (!s.barre && top <= 4) return fretted.length >= 4 ? 0.5 : 0;
  if (!s.barre) return 1.5;
  return s.barre <= 3 ? 2 : 3;
}

export interface CapoChoice {
  capo: number;
  /** Semitones from the sounding key to the key of the shapes the student plays. */
  shapeShift: number;
  cost: number;
}

/**
 * For chords that should sound in some key, find the capo that lets the student
 * play the easiest shapes. `easy` simplifies chords first (as easy mode does).
 */
export function bestCapo(soundingChords: Chord[], easy: boolean, inst: Instrument = GUITAR, maxCapo = 7): CapoChoice {
  if (!inst.capo) return { capo: 0, shapeShift: 0, cost: 0 };
  let best: CapoChoice = { capo: 0, shapeShift: 0, cost: Infinity };
  for (let capo = 0; capo <= maxCapo; capo++) {
    let cost = capo * 0.15;
    for (const c of soundingChords) {
      const shape = transposeChord(easy ? simplifyChord(c) : c, -capo);
      cost += difficulty(formatChord(shape, false), inst);
    }
    if (cost < best.cost - 1e-9) best = { capo, shapeShift: -capo, cost };
  }
  return best;
}

/** True if every note in the shape belongs to the chord; used by tests to check the tables. */
export function shapeMatchesChord(shape: Shape, chord: Chord, inst: Instrument = GUITAR): boolean {
  const tones = new Set(chordTones(chord));
  return shape.frets.every((f, s) => f < 0 || tones.has(mod12(inst.tuning[s] + f)));
}
