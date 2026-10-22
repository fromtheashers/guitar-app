// Key detection and chord labelling from chroma vectors.

import { Key, mod12 } from "../music/chords";

// Krumhansl-Kessler key profiles.
const MAJOR_PROFILE = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
const MINOR_PROFILE = [6.33, 2.68, 3.52, 5.38, 2.6, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];

function correlate(a: ArrayLike<number>, b: ArrayLike<number>): number {
  const n = a.length;
  let ma = 0, mb = 0;
  for (let i = 0; i < n; i++) {
    ma += a[i];
    mb += b[i];
  }
  ma /= n;
  mb /= n;
  let num = 0, da = 0, db = 0;
  for (let i = 0; i < n; i++) {
    const x = a[i] - ma;
    const y = b[i] - mb;
    num += x * y;
    da += x * x;
    db += y * y;
  }
  return da && db ? num / Math.sqrt(da * db) : 0;
}

export function detectKey(chromaSum: ArrayLike<number>): Key {
  let best = { tonic: 0, minor: false };
  let bestScore = -Infinity;
  for (let t = 0; t < 12; t++) {
    const rotated = Array.from({ length: 12 }, (_, i) => chromaSum[mod12(i + t)]);
    // Worship songs are overwhelmingly in major keys; give major a small head start.
    const maj = correlate(rotated, MAJOR_PROFILE) + 0.04;
    const min = correlate(rotated, MINOR_PROFILE);
    if (maj > bestScore) {
      bestScore = maj;
      best = { tonic: t, minor: false };
    }
    if (min > bestScore) {
      bestScore = min;
      best = { tonic: t, minor: true };
    }
  }
  return best;
}

export interface ChordState {
  root: number;
  minor: boolean;
}

/** 24 triads plus "no chord" (index 24). */
export const STATES: (ChordState | null)[] = [
  ...Array.from({ length: 12 }, (_, r) => ({ root: r, minor: false })),
  ...Array.from({ length: 12 }, (_, r) => ({ root: r, minor: true })),
  null,
];
export const NO_CHORD = 24;

function template(s: ChordState): Float64Array {
  const t = new Float64Array(12);
  t[s.root] = 1;
  t[mod12(s.root + (s.minor ? 3 : 4))] = 0.9;
  t[mod12(s.root + 7)] = 0.8;
  return t;
}

const TEMPLATES = STATES.map((s) => (s ? template(s) : null));

/** How likely a chord is in a key, from typical worship progressions (I IV V vi ii iii bVII). */
function keyBonus(s: ChordState, key: Key): number {
  const tonic = key.minor ? mod12(key.tonic + 3) : key.tonic;
  const deg = mod12(s.root - tonic);
  if (!s.minor && (deg === 0 || deg === 5 || deg === 7)) return 0.1;
  if (s.minor && (deg === 9 || deg === 2 || deg === 4)) return 0.08;
  if (!s.minor && deg === 10) return 0.03;
  return -0.06;
}

export interface BeatHarmony {
  chroma: Float64Array;
  bass: Float64Array;
  energy: number;
}

/**
 * Label each beat with a chord using template matching plus a Viterbi pass that
 * discourages flickering between chords.
 */
export function labelBeats(beats: BeatHarmony[], key: Key, silence: number): number[] {
  const n = beats.length;
  const S = STATES.length;
  const emit: Float64Array[] = beats.map((b) => {
    const e = new Float64Array(S);
    const quiet = b.energy < silence;
    for (let s = 0; s < S; s++) {
      const st = STATES[s];
      if (!st) {
        e[s] = quiet ? 1 : -0.4;
        continue;
      }
      let score = correlate(b.chroma, TEMPLATES[s]!);
      // A bass note on the root is strong evidence for the chord.
      const bassRoot = b.bass[st.root];
      const bassMax = Math.max(...b.bass);
      if (bassMax > 0 && bassRoot >= 0.8 * bassMax) score += 0.12;
      score += keyBonus(st, key);
      e[s] = quiet ? score - 0.8 : score;
    }
    return e;
  });

  const change = 0.35;
  const dp = new Float64Array(S);
  const back: Int16Array[] = [];
  for (let s = 0; s < S; s++) dp[s] = emit[0]?.[s] ?? 0;
  for (let t = 1; t < n; t++) {
    let bestPrev = 0;
    for (let s = 1; s < S; s++) if (dp[s] > dp[bestPrev]) bestPrev = s;
    const bk = new Int16Array(S);
    const next = new Float64Array(S);
    for (let s = 0; s < S; s++) {
      const stay = dp[s];
      const move = dp[bestPrev] - change;
      if (stay >= move) {
        next[s] = stay + emit[t][s];
        bk[s] = s;
      } else {
        next[s] = move + emit[t][s];
        bk[s] = bestPrev;
      }
    }
    back.push(bk);
    dp.set(next);
  }
  const path = new Array<number>(n);
  let s = 0;
  for (let k = 1; k < S; k++) if (dp[k] > dp[s]) s = k;
  for (let t = n - 1; t >= 0; t--) {
    path[t] = s;
    if (t > 0) s = back[t - 1][s];
  }
  return path;
}

/** Bass note under a chord when it is clearly a chord tone other than the root (G/B, C/E, D/F#). */
export function slashBass(bass: Float64Array, state: ChordState): number | undefined {
  let arg = 0;
  for (let i = 1; i < 12; i++) if (bass[i] > bass[arg]) arg = i;
  if (arg === state.root) return undefined;
  const third = mod12(state.root + (state.minor ? 3 : 4));
  const fifth = mod12(state.root + 7);
  if (arg !== third && arg !== fifth) return undefined;
  return bass[arg] > 1.6 * bass[state.root] ? arg : undefined;
}
