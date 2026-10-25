// Moves a recording into another key (and optionally slows it down) without
// changing its length: WSOLA time stretching, then resampling. Plain functions on
// mono samples, so it runs in a worker and in tests.

const SEQUENCE_MS = 40;
const OVERLAP_MS = 8;
const SEEK_MS = 15;

/**
 * Shift `input` by `semitones` and play it at `tempo` (1 = normal, 0.5 = half
 * speed). The result lasts input.length / tempo samples.
 */
export function shiftPitch(
  input: Float32Array,
  sampleRate: number,
  semitones: number,
  tempo = 1,
  onProgress?: (done: number) => void,
): Float32Array {
  const ratio = 2 ** (semitones / 12);
  const stretched = stretch(input, sampleRate, ratio / tempo, onProgress);
  return ratio === 1 ? stretched : resample(stretched, ratio);
}

/** Make `input` last `factor` times longer at the same pitch. */
export function stretch(input: Float32Array, sampleRate: number, factor: number, onProgress?: (done: number) => void): Float32Array {
  if (Math.abs(factor - 1) < 1e-6) return input.slice();
  const seq = Math.round((sampleRate * SEQUENCE_MS) / 1000);
  const overlap = Math.round((sampleRate * OVERLAP_MS) / 1000);
  const seek = Math.round((sampleRate * SEEK_MS) / 1000);
  const hop = seq - overlap;
  const out = new Float32Array(Math.ceil(input.length * factor) + seq);

  let prev = 0;
  out.set(input.subarray(0, Math.min(seq, input.length)));
  let outPos = hop;
  for (let k = 1; ; k++) {
    const nominal = Math.round((k * hop) / factor);
    if (nominal + seek + seq > input.length || outPos + seq > out.length) break;
    // Where the last segment would have carried on: match the next one to it.
    const ref = prev + hop;
    const start = bestMatch(input, ref, Math.max(0, nominal - (seek >> 1)), seek, overlap);
    for (let i = 0; i < overlap; i++) {
      const w = i / overlap;
      out[outPos + i] = out[outPos + i] * (1 - w) + input[start + i] * w;
    }
    out.set(input.subarray(start + overlap, start + seq), outPos + overlap);
    prev = start;
    outPos += hop;
    if (onProgress && k % 200 === 0) onProgress(nominal / input.length);
  }
  return out.subarray(0, outPos + overlap);
}

// The offset in [from, from + range) whose first `len` samples line up best with
// input[ref...]: a coarse pass on every 4th offset, then a fine pass around it.
function bestMatch(input: Float32Array, ref: number, from: number, range: number, len: number): number {
  let best = from;
  let bestScore = -Infinity;
  for (let o = 0; o < range; o += 4) {
    const s = score(input, ref, from + o, len, 2);
    if (s > bestScore) [bestScore, best] = [s, from + o];
  }
  const centre = best;
  for (let o = Math.max(from, centre - 3); o <= Math.min(from + range - 1, centre + 3); o++) {
    const s = score(input, ref, o, len, 1);
    if (s > bestScore) [bestScore, best] = [s, o];
  }
  return best;
}

function score(x: Float32Array, a: number, b: number, len: number, step: number): number {
  let dot = 0;
  let energy = 1e-9;
  for (let i = 0; i < len; i += step) {
    const v = x[b + i];
    dot += x[a + i] * v;
    energy += v * v;
  }
  return dot / Math.sqrt(energy);
}

/** Read `input` `ratio` times faster (higher pitch, shorter), cubic interpolation. */
export function resample(input: Float32Array, ratio: number): Float32Array {
  const n = Math.floor((input.length - 3) / ratio);
  const out = new Float32Array(Math.max(0, n));
  for (let i = 0; i < n; i++) {
    const t = i * ratio + 1;
    const j = Math.floor(t);
    const f = t - j;
    const y0 = input[j - 1], y1 = input[j], y2 = input[j + 1], y3 = input[j + 2];
    // Catmull-Rom.
    out[i] = y1 + 0.5 * f * (y2 - y0 + f * (2 * y0 - 5 * y1 + 4 * y2 - y3 + f * (3 * (y1 - y2) + y3 - y0)));
  }
  return out;
}
