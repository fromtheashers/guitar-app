// Low-level signal processing: resampling, FFT and short-time spectra.

/** In-place iterative radix-2 FFT. `re` and `im` must have a power-of-two length. */
export function fft(re: Float64Array, im: Float64Array): void {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      let t = re[i]; re[i] = re[j]; re[j] = t;
      t = im[i]; im[i] = im[j]; im[j] = t;
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    const wr = Math.cos(ang);
    const wi = Math.sin(ang);
    const half = len >> 1;
    for (let i = 0; i < n; i += len) {
      let cr = 1;
      let ci = 0;
      for (let k = 0; k < half; k++) {
        const a = i + k;
        const b = a + half;
        const xr = re[b] * cr - im[b] * ci;
        const xi = re[b] * ci + im[b] * cr;
        re[b] = re[a] - xr;
        im[b] = im[a] - xi;
        re[a] += xr;
        im[a] += xi;
        const ncr = cr * wr - ci * wi;
        ci = cr * wi + ci * wr;
        cr = ncr;
      }
    }
  }
}

export function hann(n: number): Float64Array {
  const w = new Float64Array(n);
  for (let i = 0; i < n; i++) w[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / n);
  return w;
}

/**
 * Resample to `target` Hz. A box low-pass sized to the ratio removes most aliasing,
 * which is plenty for chroma and drum-band analysis.
 */
export function resample(input: Float32Array, from: number, target: number): Float32Array {
  if (from === target) return input;
  const ratio = from / target;
  const width = Math.max(1, Math.round(ratio));
  let src = input;
  if (width > 1) {
    src = new Float32Array(input.length);
    let acc = 0;
    for (let i = 0; i < input.length; i++) {
      acc += input[i];
      if (i >= width) acc -= input[i - width];
      src[i] = acc / Math.min(i + 1, width);
    }
  }
  const outLen = Math.floor(input.length / ratio);
  const out = new Float32Array(outLen);
  for (let i = 0; i < outLen; i++) {
    const x = i * ratio;
    const i0 = Math.floor(x);
    const f = x - i0;
    const a = src[i0] ?? 0;
    const b = src[i0 + 1] ?? a;
    out[i] = a + (b - a) * f;
  }
  return out;
}

/**
 * Magnitude spectra for frames of `size` samples every `hop` samples.
 * Calls `onFrame(frameIndex, magnitudes)`; the magnitude array is reused between calls.
 */
export function stft(
  samples: Float32Array,
  size: number,
  hop: number,
  onFrame: (index: number, mag: Float64Array) => void,
): number {
  const win = hann(size);
  const re = new Float64Array(size);
  const im = new Float64Array(size);
  const mag = new Float64Array(size / 2 + 1);
  const frames = Math.max(0, Math.floor((samples.length - size) / hop) + 1);
  for (let f = 0; f < frames; f++) {
    const start = f * hop;
    for (let i = 0; i < size; i++) {
      re[i] = samples[start + i] * win[i];
      im[i] = 0;
    }
    fft(re, im);
    for (let k = 0; k <= size / 2; k++) mag[k] = Math.hypot(re[k], im[k]);
    onFrame(f, mag);
  }
  return frames;
}

export function percentile(values: ArrayLike<number>, p: number): number {
  const arr = Array.from(values).sort((a, b) => a - b);
  if (!arr.length) return 0;
  const idx = Math.min(arr.length - 1, Math.max(0, Math.round((p / 100) * (arr.length - 1))));
  return arr[idx];
}

export function mean(values: ArrayLike<number>): number {
  let s = 0;
  for (let i = 0; i < values.length; i++) s += values[i];
  return values.length ? s / values.length : 0;
}
