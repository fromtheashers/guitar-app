// Feature extraction: pitch-class (chroma) frames for chords, and onset strength in
// three drum bands for tempo, beats and strum patterns.

import { stft } from "./dsp";

export const SR = 22050;

// Drum/onset analysis: ~11.6 ms per frame.
export const ONSET_SIZE = 1024;
export const ONSET_HOP = 256;
export const ONSET_FPS = SR / ONSET_HOP;

// Harmony analysis: ~93 ms per frame, 2.7 Hz bins so low notes resolve.
export const CHROMA_SIZE = 8192;
export const CHROMA_HOP = 2048;
export const CHROMA_FPS = SR / CHROMA_HOP;

export interface OnsetFeatures {
  /** Overall onset strength per frame. */
  onset: Float64Array;
  kick: Float64Array;
  snare: Float64Array;
  hat: Float64Array;
  /** Loudness per frame. */
  rms: Float64Array;
}

export interface ChromaFeatures {
  /** 12 values per frame, L2-normalised. */
  chroma: Float64Array[];
  /** Pitch classes in the bass register only. */
  bass: Float64Array[];
  /** Total harmonic energy per frame, before normalisation. */
  energy: Float64Array;
  /** Estimated tuning offset in semitones (A4 != 440 Hz). */
  tuning: number;
}

const BANDS = {
  kick: [40, 130],
  snare: [1500, 4500],
  hat: [6000, 10500],
} as const;

/** Frame time (seconds into the audio) for an onset frame or chroma frame. */
export const onsetFrameTime = (f: number) => (f * ONSET_HOP + ONSET_SIZE / 2) / SR;
export const chromaFrameTime = (f: number) => (f * CHROMA_HOP + CHROMA_SIZE / 2) / SR;

/**
 * Spectral-flux onsets per drum band. With `isolated` (a separated drums track), each
 * frequency is floored at its average level first: the track sits on near-silence,
 * where the log scale would otherwise make faint spill (snare into the kick band) look big.
 */
export function onsetFeatures(samples: Float32Array, isolated = false): OnsetFeatures {
  const binHz = SR / ONSET_SIZE;
  const bandBins = (lo: number, hi: number) => [Math.max(1, Math.floor(lo / binHz)), Math.ceil(hi / binHz)];
  const [k0, k1] = bandBins(...BANDS.kick);
  const [s0, s1] = bandBins(...BANDS.snare);
  const [h0, h1] = bandBins(...BANDS.hat);
  const half = ONSET_SIZE / 2;

  const frames = Math.max(0, Math.floor((samples.length - ONSET_SIZE) / ONSET_HOP) + 1);
  const onset = new Float64Array(frames);
  const kick = new Float64Array(frames);
  const snare = new Float64Array(frames);
  const hat = new Float64Array(frames);
  const rms = new Float64Array(frames);
  let prev = new Float64Array(half + 1);
  let cur = new Float64Array(half + 1);
  const floor = new Float64Array(half + 1);
  if (isolated) {
    stft(samples, ONSET_SIZE, ONSET_HOP, (_, mag) => {
      for (let k = 0; k <= half; k++) floor[k] += mag[k] / Math.max(1, frames);
    });
  }

  stft(samples, ONSET_SIZE, ONSET_HOP, (f, mag) => {
    let e = 0;
    for (let k = 0; k <= half; k++) {
      cur[k] = Math.log1p(100 * Math.max(floor[k], mag[k]));
      e += mag[k] * mag[k];
    }
    rms[f] = Math.sqrt(e / (half + 1));
    if (f > 0) {
      let all = 0, kk = 0, ss = 0, hh = 0;
      for (let k = 1; k <= half; k++) {
        const d = cur[k] - prev[k];
        if (d <= 0) continue;
        all += d;
        if (k >= k0 && k <= k1) kk += d;
        else if (k >= s0 && k <= s1) ss += d;
        else if (k >= h0 && k <= h1) hh += d;
      }
      onset[f] = all;
      kick[f] = kk / (k1 - k0 + 1);
      snare[f] = ss / (s1 - s0 + 1);
      hat[f] = hh / (h1 - h0 + 1);
    }
    const t = prev; prev = cur; cur = t;
  });

  return { onset: adaptive(onset), kick: adaptive(kick), snare: adaptive(snare), hat: adaptive(hat), rms };
}

/** Subtract a local mean (~0.5 s) and clip, so steady noise doesn't read as onsets. */
function adaptive(x: Float64Array): Float64Array {
  const w = Math.round(ONSET_FPS * 0.25);
  const out = new Float64Array(x.length);
  let acc = 0;
  const prefix = new Float64Array(x.length + 1);
  for (let i = 0; i < x.length; i++) {
    acc += x[i];
    prefix[i + 1] = acc;
  }
  for (let i = 0; i < x.length; i++) {
    const a = Math.max(0, i - w);
    const b = Math.min(x.length, i + w + 1);
    const local = (prefix[b] - prefix[a]) / (b - a);
    out[i] = Math.max(0, x[i] - local);
  }
  return out;
}

export function chromaFeatures(samples: Float32Array): ChromaFeatures {
  const binHz = SR / CHROMA_SIZE;
  const lo = Math.ceil(60 / binHz);
  const hi = Math.floor(2100 / binHz);
  const bassHi = Math.floor(200 / binHz);
  const pitchOf = new Float64Array(hi + 1);
  for (let k = lo; k <= hi; k++) pitchOf[k] = 12 * Math.log2((k * binHz) / 440) + 69;

  // First pass: tuning from strong spectral peaks.
  let sx = 0, sy = 0;
  const peaks: { k: number; m: number }[] = [];
  const frames: Float64Array[] = [];
  stft(samples, CHROMA_SIZE, CHROMA_HOP, (_, mag) => {
    frames.push(mag.slice(0, hi + 2));
  });
  for (const mag of frames) {
    peaks.length = 0;
    for (let k = lo + 1; k < hi; k++) {
      if (mag[k] > mag[k - 1] && mag[k] >= mag[k + 1]) peaks.push({ k, m: mag[k] });
    }
    peaks.sort((a, b) => b.m - a.m);
    for (const { k, m } of peaks.slice(0, 6)) {
      // Parabolic interpolation for a sub-bin frequency estimate.
      const a = mag[k - 1], b = mag[k], c = mag[k + 1];
      const denom = a - 2 * b + c;
      const off = denom !== 0 ? (0.5 * (a - c)) / denom : 0;
      const pitch = 12 * Math.log2(((k + off) * binHz) / 440) + 69;
      const dev = pitch - Math.round(pitch);
      sx += m * Math.cos(2 * Math.PI * dev);
      sy += m * Math.sin(2 * Math.PI * dev);
    }
  }
  const tuning = sx === 0 && sy === 0 ? 0 : Math.atan2(sy, sx) / (2 * Math.PI);

  const chroma: Float64Array[] = [];
  const bass: Float64Array[] = [];
  const energy = new Float64Array(frames.length);
  for (let f = 0; f < frames.length; f++) {
    const mag = frames[f];
    const c = new Float64Array(12);
    const b = new Float64Array(12);
    let e = 0;
    for (let k = lo; k <= hi; k++) {
      const m = Math.sqrt(mag[k]);
      const pc = (((Math.round(pitchOf[k] - tuning) % 12) + 12) % 12);
      c[pc] += m;
      if (k <= bassHi) b[pc] += m;
      e += m;
    }
    energy[f] = e;
    chroma.push(normalize(c));
    bass.push(normalize(b));
  }
  return { chroma, bass, energy, tuning };
}

function normalize(v: Float64Array): Float64Array {
  let s = 0;
  for (const x of v) s += x * x;
  const n = Math.sqrt(s);
  if (n > 0) for (let i = 0; i < v.length; i++) v[i] /= n;
  return v;
}
