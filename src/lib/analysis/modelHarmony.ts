// Turns the chord model's per-frame probabilities into one chord per beat.
//
// The model's 170 classes are folded into the chords a worship chart would write
// (B, Bmaj7, B6 and Bsus2 all become B; G#m7 becomes G#m), then a Viterbi pass picks
// the chord sequence, favouring chords that belong to the song's key.

import type { Key } from "../music/chords";
import { mod12 } from "../music/chords";
import { CLASSES, type ChordProbs, VOCAB } from "./chordModel";

// Families per root, in state order. "7" and "sus4" stay distinct: they change what a guitarist plays.
const FAMILIES = ["", "m", "7", "sus4", "dim", "aug"] as const;
const FAMILY_OF: Record<string, (typeof FAMILIES)[number]> = {
  "": "", "6": "", maj7: "", sus2: "",
  m: "m", m6: "m", m7: "m",
  "7": "7", sus4: "sus4",
  dim: "dim", dim7: "dim", m7b5: "dim",
  aug: "aug",
};

export interface FamilyChord {
  root: number;
  quality: string;
  minor: boolean;
}

/** States for labelling: 12 roots x 6 families, then no chord. */
export const FAMILY_STATES: (FamilyChord | null)[] = [
  ...Array.from({ length: 12 * FAMILIES.length }, (_, i) => {
    const quality = FAMILIES[i % FAMILIES.length];
    return { root: Math.floor(i / FAMILIES.length), quality, minor: quality === "m" };
  }),
  null,
];
const N_STATE = FAMILY_STATES.length - 1;

// Model class -> family state ("unknown" counts as no chord).
const CLASS_TO_STATE = VOCAB.map((v) => (v ? v.root * FAMILIES.length + FAMILIES.indexOf(FAMILY_OF[v.quality]) : N_STATE));

// Cost of changing chord between beats, so single-beat flickers don't survive.
const CHANGE_PENALTY = 2;
// Plain major and minor chords are what most worship charts use.
const PLAIN_BONUS = Math.log(1.5);
// How strongly chords outside the key are discouraged.
const OUT_OF_KEY = Math.log(0.15);
const BORROWED = Math.log(0.45);

/** Average probability of each chord family over each beat. */
export function beatProbabilities(model: ChordProbs, beatSec: number[], ibi: number): Float64Array[] {
  const out: Float64Array[] = [];
  let f = 0;
  for (let i = 0; i < beatSec.length; i++) {
    const a = beatSec[i];
    const b = beatSec[i + 1] ?? a + ibi;
    const p = new Float64Array(FAMILY_STATES.length);
    while (f < model.times.length && model.times[f] < a) f++;
    let n = 0;
    const add = (t: number) => {
      for (let c = 0; c < CLASSES; c++) p[CLASS_TO_STATE[c]] += model.probs[t * CLASSES + c];
    };
    for (let t = f; t < model.times.length && model.times[t] < b; t++, n++) add(t);
    // A beat shorter than a frame borrows the nearest frame.
    if (n === 0) {
      add(Math.min(model.times.length - 1, f));
      n = 1;
    }
    for (let s = 0; s < p.length; s++) p[s] /= n;
    out.push(p);
  }
  return out;
}

/**
 * Log prior per state. Without a key, plain triads get a small bonus. With a key,
 * diatonic chords are favoured, common borrowed chords (bVII, IV minor, II major,
 * III major) are allowed with a smaller cost, and everything else is discouraged.
 */
export function chordPrior(key: Key | null): number[] {
  return FAMILY_STATES.map((st) => {
    if (!st) return 0;
    const plain = st.quality === "" || st.quality === "m" ? PLAIN_BONUS : 0;
    if (!key) return plain;
    // Minor keys use their relative major's chords, plus a major V.
    const tonic = key.minor ? mod12(key.tonic + 3) : key.tonic;
    const deg = mod12(st.root - tonic);
    const fam = st.quality === "m" ? "m" : st.quality === "dim" ? "dim" : st.quality === "aug" ? "aug" : "M";
    const diatonic: Record<number, string> = { 0: "M", 2: "m", 4: "m", 5: "M", 7: "M", 9: "m", 11: "dim" };
    const borrowed: Record<number, string> = { 10: "M", 5: "m", 2: "M", 4: "M", 8: "M" };
    if (key.minor && deg === 4 && fam === "M") return plain; // V in the minor key
    if (diatonic[deg] === fam) return plain;
    if (borrowed[deg] === fam) return plain + BORROWED;
    return plain + OUT_OF_KEY;
  });
}

/** Viterbi over beats: the most likely chord sequence with few needless changes. */
export function labelBeatsWithModel(beatProbs: Float64Array[], prior: number[]): number[] {
  const n = beatProbs.length;
  if (!n) return [];
  const k = prior.length;
  const emit = (i: number, c: number) => Math.log(beatProbs[i][c] + 1e-4) + prior[c];
  let score = Float64Array.from({ length: k }, (_, c) => emit(0, c));
  const back: Int16Array[] = [];
  for (let i = 1; i < n; i++) {
    let best = 0;
    for (let c = 1; c < k; c++) if (score[c] > score[best]) best = c;
    const next = new Float64Array(k);
    const from = new Int16Array(k);
    for (let c = 0; c < k; c++) {
      const stay = score[c];
      const move = score[best] - CHANGE_PENALTY;
      if (stay >= move) {
        next[c] = stay + emit(i, c);
        from[c] = c;
      } else {
        next[c] = move + emit(i, c);
        from[c] = best;
      }
    }
    back.push(from);
    score = next;
  }
  let c = 0;
  for (let s = 1; s < k; s++) if (score[s] > score[c]) c = s;
  const labels = new Array<number>(n);
  labels[n - 1] = c;
  for (let i = n - 1; i > 0; i--) {
    c = back[i - 1][c];
    labels[i - 1] = c;
  }
  return labels;
}
