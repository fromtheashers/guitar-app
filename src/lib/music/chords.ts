// Chord symbols: parsing, spelling, transposing, simplifying and Nashville numbers.

export const SHARP_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
export const FLAT_NAMES = ["C", "Db", "D", "Eb", "E", "F", "Gb", "G", "Ab", "A", "Bb", "B"];

const NOTE_INDEX: Record<string, number> = {
  C: 0, "B#": 0, "C#": 1, Db: 1, D: 2, "D#": 3, Eb: 3, E: 4, Fb: 4, "E#": 5, F: 5,
  "F#": 6, Gb: 6, G: 7, "G#": 8, Ab: 8, A: 9, "A#": 10, Bb: 10, B: 11, Cb: 11,
};

export interface Chord {
  root: number;
  /** Everything after the root, e.g. "m7", "sus4", "add9". Empty for a major triad. */
  quality: string;
  bass?: number;
}

export type QualityFamily = "major" | "minor" | "dim" | "aug" | "sus" | "power";

const CHORD_RE = /^([A-G])([#b]?)([^/]*)(?:\/([A-G][#b]?))?$/;

export function noteIndex(name: string): number | undefined {
  return NOTE_INDEX[name];
}

export function mod12(n: number): number {
  return ((n % 12) + 12) % 12;
}

export function parseChord(symbol: string): Chord | null {
  const m = CHORD_RE.exec(symbol.trim());
  if (!m) return null;
  const root = NOTE_INDEX[m[1] + m[2]];
  if (root === undefined) return null;
  const quality = normalizeQuality(m[3]);
  if (quality === null) return null;
  const chord: Chord = { root, quality };
  if (m[4]) {
    const bass = NOTE_INDEX[m[4]];
    if (bass === undefined) return null;
    if (bass !== root) chord.bass = bass;
  }
  return chord;
}

const KNOWN_QUALITIES = new Set([
  "", "m", "7", "maj7", "m7", "6", "m6", "9", "m9", "maj9", "add9", "madd9", "add2", "2",
  "sus", "sus2", "sus4", "7sus4", "dim", "dim7", "m7b5", "aug", "5", "11", "13", "m11",
]);

function normalizeQuality(q: string): string | null {
  let s = q.trim();
  s = s.replace(/^min(?!or)/, "m").replace(/^-/, "m").replace(/^M7/, "maj7").replace(/^Δ7?/, "maj7");
  s = s.replace(/^maj$/, "").replace(/^major$/, "").replace(/^minor$/, "m");
  s = s.replace(/^°7?/, (x) => (x === "°7" ? "dim7" : "dim")).replace(/^\+$/, "aug");
  s = s.replace(/^m\(add9\)$/, "madd9").replace(/^\(add9\)$/, "add9");
  if (s === "sus") s = "sus4";
  if (s === "2") s = "sus2";
  if (s === "add2") s = "add9";
  return KNOWN_QUALITIES.has(s) ? s : null;
}

export function qualityFamily(quality: string): QualityFamily {
  if (quality === "5") return "power";
  if (quality.startsWith("dim") || quality === "m7b5") return "dim";
  if (quality.startsWith("aug")) return "aug";
  if (quality.startsWith("sus") || quality === "7sus4") return "sus";
  if (quality.startsWith("m") && !quality.startsWith("maj")) return "minor";
  return "major";
}

export function isMinor(chord: Chord): boolean {
  return qualityFamily(chord.quality) === "minor";
}

/** Keys spelled with flats. Minor keys use their relative major. */
const FLAT_KEYS = new Set([5, 10, 3, 8, 1, 6]); // F Bb Eb Ab Db Gb

export interface Key {
  tonic: number;
  minor: boolean;
}

export function parseKey(name: string): Key | null {
  const m = /^([A-G][#b]?)(m)?$/.exec(name.trim());
  if (!m) return null;
  const tonic = NOTE_INDEX[m[1]];
  if (tonic === undefined) return null;
  return { tonic, minor: Boolean(m[2]) };
}

export function relativeMajor(key: Key): number {
  return key.minor ? mod12(key.tonic + 3) : key.tonic;
}

export function prefersFlats(key: Key): boolean {
  return FLAT_KEYS.has(relativeMajor(key));
}

export function noteName(pc: number, flats: boolean): string {
  return (flats ? FLAT_NAMES : SHARP_NAMES)[mod12(pc)];
}

export function keyName(key: Key): string {
  // Keys are named the way worship charts usually name them: Bb not A#, F# not Gb.
  const names = ["C", "Db", "D", "Eb", "E", "F", "F#", "G", "Ab", "A", "Bb", "B"];
  const minorNames = ["Cm", "C#m", "Dm", "Ebm", "Em", "Fm", "F#m", "Gm", "G#m", "Am", "Bbm", "Bm"];
  return key.minor ? minorNames[mod12(key.tonic)] : names[mod12(key.tonic)];
}

export function formatChord(chord: Chord, flats: boolean): string {
  let s = noteName(chord.root, flats) + chord.quality;
  if (chord.bass !== undefined) s += "/" + noteName(chord.bass, flats);
  return s;
}

export function transposeChord(chord: Chord, semitones: number): Chord {
  const out: Chord = { root: mod12(chord.root + semitones), quality: chord.quality };
  if (chord.bass !== undefined) out.bass = mod12(chord.bass + semitones);
  return out;
}

export function transposeKey(key: Key, semitones: number): Key {
  return { tonic: mod12(key.tonic + semitones), minor: key.minor };
}

/** Easy-mode chord: plain major or minor triad, no extensions, no slash bass. */
export function simplifyChord(chord: Chord): Chord {
  const fam = qualityFamily(chord.quality);
  const quality = fam === "minor" ? "m" : fam === "dim" ? "dim" : fam === "aug" ? "aug" : "";
  return { root: chord.root, quality };
}

const DEGREE_NAMES = ["1", "b2", "2", "b3", "3", "4", "b5", "5", "b6", "6", "b7", "7"];

/** Nashville number for a chord in a key, e.g. Em in G -> "6m", D/F# in G -> "5/7". */
export function nashville(chord: Chord, key: Key, keepExtensions: boolean): string {
  const tonic = relativeMajor(key);
  const deg = DEGREE_NAMES[mod12(chord.root - tonic)];
  const fam = qualityFamily(chord.quality);
  let suffix: string;
  if (keepExtensions) suffix = chord.quality;
  else suffix = fam === "minor" ? "m" : fam === "dim" ? "°" : fam === "aug" ? "+" : "";
  let s = deg + suffix;
  if (keepExtensions && chord.bass !== undefined) s += "/" + DEGREE_NAMES[mod12(chord.bass - tonic)];
  return s;
}

/** Pitch classes in a chord, used for detection templates and diagram checks. */
export function chordTones(chord: Chord): number[] {
  const intervals: Record<string, number[]> = {
    "": [0, 4, 7], m: [0, 3, 7], "7": [0, 4, 7, 10], maj7: [0, 4, 7, 11], m7: [0, 3, 7, 10],
    "6": [0, 4, 7, 9], m6: [0, 3, 7, 9], "9": [0, 4, 7, 10, 2], m9: [0, 3, 7, 10, 2],
    maj9: [0, 4, 7, 11, 2], add9: [0, 4, 7, 2], madd9: [0, 3, 7, 2], sus2: [0, 2, 7],
    sus4: [0, 5, 7], "7sus4": [0, 5, 7, 10], dim: [0, 3, 6], dim7: [0, 3, 6, 9],
    m7b5: [0, 3, 6, 10], aug: [0, 4, 8], "5": [0, 7], "11": [0, 4, 7, 10, 5], "13": [0, 4, 7, 10, 9],
    m11: [0, 3, 7, 10, 5],
  };
  const iv = intervals[chord.quality] ?? [0, 4, 7];
  const tones = iv.map((i) => mod12(chord.root + i));
  if (chord.bass !== undefined && !tones.includes(chord.bass)) tones.push(chord.bass);
  return tones;
}
