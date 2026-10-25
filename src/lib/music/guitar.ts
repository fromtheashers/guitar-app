// Guitar chord shapes for diagrams: hand-picked open and worship voicings, then
// movable E and A barre shapes. Other instruments live in instruments.ts.

import { formatChord, mod12, parseChord, qualityFamily } from "./chords";

/** Fret per string, in diagram order (lowest string on the left). -1 = muted, 0 = open. */
export type Frets = number[];

export interface Shape {
  frets: Frets;
  /** Fret of a full or partial barre, if the shape uses one. */
  barre?: number;
  /** Short note shown under the diagram, e.g. "easy version". */
  note?: string;
}

// Open shapes keyed by chord symbol as written in sharps. The first entry is the
// standard voicing; "worship" voicings that keep the top two strings ringing are
// listed as advanced alternatives.
const OPEN: Record<string, Shape[]> = {
  C: [{ frets: [-1, 3, 2, 0, 1, 0] }],
  Cadd9: [{ frets: [-1, 3, 2, 0, 3, 3] }],
  Cmaj7: [{ frets: [-1, 3, 2, 0, 0, 0] }],
  C7: [{ frets: [-1, 3, 2, 3, 1, 0] }],
  "C/E": [{ frets: [0, 3, 2, 0, 1, 0] }],
  "C/G": [{ frets: [3, 3, 2, 0, 1, 0] }],
  D: [{ frets: [-1, -1, 0, 2, 3, 2] }],
  Dsus4: [{ frets: [-1, -1, 0, 2, 3, 3] }],
  Dsus2: [{ frets: [-1, -1, 0, 2, 3, 0] }],
  D7: [{ frets: [-1, -1, 0, 2, 1, 2] }],
  Dmaj7: [{ frets: [-1, -1, 0, 2, 2, 2] }],
  "D/F#": [{ frets: [2, 0, 0, 2, 3, 2] }],
  Dm: [{ frets: [-1, -1, 0, 2, 3, 1] }],
  Dm7: [{ frets: [-1, -1, 0, 2, 1, 1] }],
  E: [{ frets: [0, 2, 2, 1, 0, 0] }],
  E7: [{ frets: [0, 2, 0, 1, 0, 0] }],
  Esus4: [{ frets: [0, 2, 2, 2, 0, 0] }],
  Em: [{ frets: [0, 2, 2, 0, 0, 0] }],
  Em7: [{ frets: [0, 2, 2, 0, 3, 3] }, { frets: [0, 2, 0, 0, 0, 0] }],
  F: [{ frets: [1, 3, 3, 2, 1, 1], barre: 1 }, { frets: [-1, -1, 3, 2, 1, 1], note: "easy version" }],
  Fmaj7: [{ frets: [-1, -1, 3, 2, 1, 0] }],
  G: [{ frets: [3, 2, 0, 0, 0, 3] }, { frets: [3, 2, 0, 0, 3, 3], note: "worship voicing" }],
  G7: [{ frets: [3, 2, 0, 0, 0, 1] }],
  "G/B": [{ frets: [-1, 2, 0, 0, 3, 3] }],
  Gsus4: [{ frets: [3, 3, 0, 0, 1, 3] }],
  A: [{ frets: [-1, 0, 2, 2, 2, 0] }],
  Asus2: [{ frets: [-1, 0, 2, 2, 0, 0] }],
  Asus4: [{ frets: [-1, 0, 2, 2, 3, 0] }],
  A7: [{ frets: [-1, 0, 2, 0, 2, 0] }],
  "A/C#": [{ frets: [-1, 4, 2, 2, 2, 0] }],
  Am: [{ frets: [-1, 0, 2, 2, 1, 0] }],
  Am7: [{ frets: [-1, 0, 2, 0, 1, 0] }],
  "Am/G": [{ frets: [3, 0, 2, 2, 1, 0] }],
  B7: [{ frets: [-1, 2, 1, 2, 0, 2] }],
  Bm: [{ frets: [-1, 2, 4, 4, 3, 2], barre: 2 }, { frets: [-1, -1, 4, 4, 3, 2], note: "easy version" }],
  Bm7: [{ frets: [-1, 2, 0, 2, 0, 2] }],
};

// Movable barre templates relative to the root fret. E-shape roots on string 6, A-shape on string 5.
const E_SHAPES: Record<string, number[]> = {
  "": [0, 2, 2, 1, 0, 0], m: [0, 2, 2, 0, 0, 0], "7": [0, 2, 0, 1, 0, 0], m7: [0, 2, 0, 0, 0, 0],
  sus4: [0, 2, 2, 2, 0, 0], maj7: [0, -9, 1, 1, 0, -9],
};
const A_SHAPES: Record<string, number[]> = {
  "": [-9, 0, 2, 2, 2, 0], m: [-9, 0, 2, 2, 1, 0], "7": [-9, 0, 2, 0, 2, 0], m7: [-9, 0, 2, 0, 1, 0],
  sus4: [-9, 0, 2, 2, 3, 0], sus2: [-9, 0, 2, 2, 0, 0], maj7: [-9, 0, 2, 1, 2, 0],
};

const E_STRING_ROOT = 4; // E
const A_STRING_ROOT = 9; // A

function barreShape(template: number[], rootFret: number): Shape {
  const frets = template.map((f) => (f < -1 ? -1 : f + rootFret)) as Frets;
  return { frets, barre: rootFret > 0 ? rootFret : undefined };
}

function nearestQuality(quality: string): string {
  if (quality in E_SHAPES || quality in A_SHAPES) return quality;
  const fam = qualityFamily(quality);
  if (quality === "add9" || quality === "6" || quality === "9" || quality === "5") return "";
  if (quality === "madd9" || quality === "m9" || quality === "m6" || quality === "m11") return "m";
  if (fam === "sus") return quality.includes("2") ? "sus2" : "sus4";
  return fam === "minor" ? "m" : "";
}

/** Guitar shapes for a chord symbol, best first. Always returns at least one shape. */
export function guitarShapes(symbol: string): Shape[] {
  const chord = parseChord(symbol);
  if (!chord) return [];
  const key = formatChord(chord, false);
  if (OPEN[key]) return OPEN[key];

  // Slash chords without an open voicing: play the chord, mention the bass.
  if (chord.bass !== undefined) {
    const base = guitarShapes(formatChord({ root: chord.root, quality: chord.quality }, false));
    return base.map((s) => ({ ...s, note: "bass note optional" }));
  }

  const q = nearestQuality(chord.quality);
  const out: Shape[] = [];
  const eFret = mod12(chord.root - E_STRING_ROOT);
  const aFret = mod12(chord.root - A_STRING_ROOT);
  const eT = E_SHAPES[q];
  const aT = A_SHAPES[q];
  const options: Shape[] = [];
  if (aT) options.push(barreShape(aT, aFret === 0 ? 12 : aFret));
  if (eT) options.push(barreShape(eT, eFret === 0 ? 12 : eFret));
  options.sort((x, y) => (x.barre ?? 0) - (y.barre ?? 0));
  out.push(...options);
  if (q !== chord.quality && out.length) out[0] = { ...out[0], note: `played as ${formatChord({ root: chord.root, quality: q }, false)}` };
  return out;
}
