// Tempo estimation and beat tracking on an onset-strength envelope
// (dynamic programming beat tracker after Ellis, 2007).

export interface TempoEstimate {
  bpm: number;
  /** 0..1, how clearly one tempo stands out. */
  confidence: number;
}

/** Prefer tempos around 100 BPM; worship songs mostly sit between 65 and 150. */
function tempoPrior(bpm: number): number {
  const x = Math.log2(bpm / 100) / 0.8;
  return Math.exp(-0.5 * x * x);
}

export function estimateTempo(onset: Float64Array, fps: number, minBpm = 55, maxBpm = 190): TempoEstimate {
  const n = onset.length;
  let m = 0;
  for (let i = 0; i < n; i++) m += onset[i];
  m /= Math.max(1, n);
  const x = new Float64Array(n);
  for (let i = 0; i < n; i++) x[i] = onset[i] - m;

  const minLag = Math.floor((60 * fps) / maxBpm);
  const maxLag = Math.ceil((60 * fps) / minBpm);
  const ac = new Float64Array(maxLag + 2);
  for (let lag = minLag - 1; lag <= maxLag + 1; lag++) {
    let s = 0;
    for (let i = lag; i < n; i++) s += x[i] * x[i - lag];
    ac[lag] = s / (n - lag);
  }
  let zero = 0;
  for (let i = 0; i < n; i++) zero += x[i] * x[i];
  zero /= Math.max(1, n);

  let best = -Infinity;
  let bestLag = minLag;
  for (let lag = minLag; lag <= maxLag; lag++) {
    // Reward lags whose double also correlates: true beat periods repeat.
    const dbl = 2 * lag <= maxLag + 1 ? ac[2 * lag] ?? 0 : 0;
    const score = (ac[lag] + 0.5 * Math.max(0, dbl)) * tempoPrior((60 * fps) / lag);
    if (score > best) {
      best = score;
      bestLag = lag;
    }
  }
  // Parabolic refinement.
  const a = ac[bestLag - 1], b = ac[bestLag], c = ac[bestLag + 1];
  const denom = a - 2 * b + c;
  const off = denom !== 0 ? Math.max(-0.5, Math.min(0.5, (0.5 * (a - c)) / denom)) : 0;
  const lag = bestLag + off;
  const confidence = zero > 0 ? Math.max(0, Math.min(1, b / zero)) : 0;
  return { bpm: (60 * fps) / lag, confidence };
}

/** Beat positions in frames (fractional), evenly spread around the detected tempo. */
export function trackBeats(onset: Float64Array, fps: number, bpm: number, tightness = 120): number[] {
  const n = onset.length;
  if (n === 0) return [];
  const period = (60 * fps) / bpm;
  let sd = 0, mu = 0;
  for (let i = 0; i < n; i++) mu += onset[i];
  mu /= n;
  for (let i = 0; i < n; i++) sd += (onset[i] - mu) ** 2;
  sd = Math.sqrt(sd / n) || 1;
  const local = new Float64Array(n);
  for (let i = 0; i < n; i++) local[i] = onset[i] / sd;

  const score = new Float64Array(n);
  const back = new Int32Array(n).fill(-1);
  const lo = Math.round(period / 2);
  const hi = Math.round(period * 2);
  for (let t = 0; t < n; t++) {
    let best = -Infinity;
    let arg = -1;
    for (let p = t - hi; p <= t - lo; p++) {
      if (p < 0) continue;
      const r = Math.log((t - p) / period);
      const s = score[p] - tightness * r * r;
      if (s > best) {
        best = s;
        arg = p;
      }
    }
    score[t] = local[t] + (arg >= 0 ? Math.max(0, best) : 0);
    back[t] = arg >= 0 && best > 0 ? arg : -1;
  }
  // Start from the best-scoring frame in the last beat period.
  let end = n - 1;
  let bestEnd = -Infinity;
  for (let t = Math.max(0, n - Math.round(period)); t < n; t++) {
    if (score[t] > bestEnd) {
      bestEnd = score[t];
      end = t;
    }
  }
  const beats: number[] = [];
  for (let t = end; t >= 0; t = back[t]) {
    beats.push(t);
    if (back[t] < 0) break;
  }
  beats.reverse();
  return fillGaps(beats, period, n);
}

/** Where the tracker skipped through silence, insert beats at the local period. */
function fillGaps(beats: number[], period: number, n: number): number[] {
  if (beats.length === 0) return beats;
  const out: number[] = [];
  // Extend backwards to the start of the audio.
  // A beat just before the first analysed frame still counts (the song starts on it).
  for (let t = beats[0] - period; t >= -0.3 * period; t -= period) out.unshift(Math.max(0, t));
  for (let i = 0; i < beats.length; i++) {
    out.push(beats[i]);
    const next = beats[i + 1];
    if (next === undefined) break;
    const gap = next - beats[i];
    const k = Math.round(gap / period);
    for (let j = 1; j < k; j++) out.push(beats[i] + (gap * j) / k);
  }
  for (let t = out[out.length - 1] + period; t < n; t += period) out.push(t);
  return out;
}
