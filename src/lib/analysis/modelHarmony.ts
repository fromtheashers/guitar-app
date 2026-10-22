// Turns the chord model's per-frame probabilities into one chord per beat.

import { CLASSES, type ChordProbs, VOCAB } from "./chordModel";

// Simple triads are what most worship charts use; nudge close calls towards them.
const TRIAD_BONUS = Math.log(1.3);
// Cost of changing chord between beats, so single-beat flickers don't survive.
const CHANGE_PENALTY = 1.2;

/** Average probability of each chord class over each beat. */
export function beatProbabilities(model: ChordProbs, beatSec: number[], ibi: number): Float64Array[] {
  const out: Float64Array[] = [];
  let f = 0;
  for (let i = 0; i < beatSec.length; i++) {
    const a = beatSec[i];
    const b = beatSec[i + 1] ?? a + ibi;
    const p = new Float64Array(CLASSES);
    while (f < model.times.length && model.times[f] < a) f++;
    let n = 0;
    for (let t = f; t < model.times.length && model.times[t] < b; t++, n++) {
      for (let c = 0; c < CLASSES; c++) p[c] += model.probs[t * CLASSES + c];
    }
    // A beat shorter than a frame borrows the nearest frame.
    if (n === 0) {
      const t = Math.min(model.times.length - 1, f);
      for (let c = 0; c < CLASSES; c++) p[c] = model.probs[t * CLASSES + c];
      n = 1;
    }
    for (let c = 0; c < CLASSES; c++) p[c] /= n;
    out.push(p);
  }
  return out;
}

/** Viterbi over beats: the most likely chord sequence with few needless changes. */
export function labelBeatsWithModel(beatProbs: Float64Array[]): number[] {
  const n = beatProbs.length;
  if (!n) return [];
  const prior = VOCAB.map((v) => (v && (v.quality === "" || v.quality === "m") ? TRIAD_BONUS : 0));
  const emit = (i: number, c: number) => Math.log(beatProbs[i][c] + 1e-4) + prior[c];
  let score = Float64Array.from({ length: CLASSES }, (_, c) => emit(0, c));
  const back: Int16Array[] = [];
  for (let i = 1; i < n; i++) {
    let best = 0;
    for (let c = 1; c < CLASSES; c++) if (score[c] > score[best]) best = c;
    const next = new Float64Array(CLASSES);
    const from = new Int16Array(CLASSES);
    for (let c = 0; c < CLASSES; c++) {
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
  for (let k = 1; k < CLASSES; k++) if (score[k] > score[c]) c = k;
  const labels = new Array<number>(n);
  labels[n - 1] = c;
  for (let i = n - 1; i > 0; i--) {
    c = back[i - 1][c];
    labels[i - 1] = c;
  }
  return labels;
}
