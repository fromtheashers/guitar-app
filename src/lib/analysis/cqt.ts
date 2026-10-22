// Constant-Q spectrogram matching the features the chord model was trained on
// (librosa.cqt: 144 bins from C1, 24 per octave, hop 2048 at 22050 Hz, frames laid
// out in 10-second chunks). Computed octave by octave on a signal halved in rate
// each time, so long low-note filters stay cheap.

import { SR } from "./features";

export const CQT_BINS = 144;
const BPO = 24;
const HOP = 2048;
const OCTAVES = CQT_BINS / BPO;
const FMIN = 32.70319566257483; // C1
const Q = 1 / (2 ** (1 / BPO) - 1);
const CHUNK = SR * 10;

export interface CqtFrames {
  /** log(|CQT| + 1e-6), frame-major: frames[t * 144 + bin]. */
  data: Float32Array;
  /** Centre time of each frame in seconds. */
  times: Float64Array;
}

/** Frame centres as BTC lays them out: restart the hop grid every 10 seconds. */
function frameCentres(length: number): number[] {
  const out: number[] = [];
  for (let s = 0; s < length; s += CHUNK) {
    const n = 1 + Math.floor(Math.min(CHUNK, length - s) / HOP);
    for (let j = 0; j < n; j++) out.push(s + j * HOP);
  }
  return out;
}

function besselI0(x: number): number {
  let sum = 1;
  let term = 1;
  for (let k = 1; k < 50; k++) {
    term *= (x / (2 * k)) ** 2;
    sum += term;
    if (term < 1e-12 * sum) break;
  }
  return sum;
}

// Half-band low-pass (windowed sinc, Kaiser beta 8) for halving the sample rate.
const TAPS = 127;
const HALF_BAND = (() => {
  const h = new Float64Array(TAPS);
  const mid = (TAPS - 1) / 2;
  let sum = 0;
  for (let i = 0; i < TAPS; i++) {
    const n = i - mid;
    const x = 0.45 * n;
    const sinc = n === 0 ? 1 : Math.sin(Math.PI * x) / (Math.PI * x);
    const r = n / mid;
    const kaiser = besselI0(8 * Math.sqrt(Math.max(0, 1 - r * r))) / besselI0(8);
    h[i] = sinc * 0.45 * kaiser;
    sum += h[i];
  }
  for (let i = 0; i < TAPS; i++) h[i] /= sum;
  return h;
})();

function halve(x: Float32Array): Float32Array {
  const out = new Float32Array(Math.ceil(x.length / 2));
  const mid = (TAPS - 1) / 2;
  for (let o = 0; o < out.length; o++) {
    const c = o * 2;
    let acc = 0;
    const lo = Math.max(0, mid - c);
    const hi = Math.min(TAPS, x.length + mid - c);
    for (let k = lo; k < hi; k++) acc += HALF_BAND[k] * x[c + k - mid];
    out[o] = acc;
  }
  return out;
}

export async function cqtFrames(samples: Float32Array, yieldEvery?: () => Promise<void>): Promise<CqtFrames> {
  const centres = frameCentres(samples.length);
  const nFrames = centres.length;
  const data = new Float32Array(nFrames * CQT_BINS);
  let x = samples;
  let rate = SR;
  for (let o = 0; o < OCTAVES; o++) {
    if (o > 0) {
      x = halve(x);
      rate /= 2;
      await yieldEvery?.();
    }
    const scale = 2 ** o;
    const hi = CQT_BINS - BPO * o;
    for (let k = hi - BPO; k < hi; k++) {
      const f = FMIN * 2 ** (k / BPO);
      const len = Math.floor((Q * rate) / f);
      const start = -Math.floor(len / 2);
      // Hann-windowed complex sinusoid, L1-normalised, scaled like librosa's output.
      const re = new Float32Array(len);
      const im = new Float32Array(len);
      let l1 = 0;
      for (let i = 0; i < len; i++) {
        const w = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / len);
        const ph = (2 * Math.PI * (start + i) * f) / rate;
        re[i] = w * Math.cos(ph);
        im[i] = w * Math.sin(ph);
        l1 += w;
      }
      const gain = Math.sqrt((Q * SR) / f) / l1;
      for (let t = 0; t < nFrames; t++) {
        const c = Math.floor(centres[t] / scale) + start;
        let sr = 0;
        let si = 0;
        const i0 = Math.max(0, -c);
        const i1 = Math.min(len, x.length - c);
        for (let i = i0; i < i1; i++) {
          const v = x[c + i];
          sr += v * re[i];
          si += v * im[i];
        }
        data[t * CQT_BINS + k] = Math.log(Math.hypot(sr, si) * gain + 1e-6);
      }
    }
  }
  return { data, times: Float64Array.from(centres, (c) => c / SR) };
}
