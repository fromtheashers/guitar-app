// Trained chord recogniser: BTC (Park et al., ISMIR 2019, MIT licence), large
// vocabulary, run with onnxruntime-web in the browser. Takes the CQT frames from
// cqt.ts and returns per-frame probabilities over 170 chord classes.

import type { CqtFrames } from "./cqt";
import { CQT_BINS } from "./cqt";

const MODEL_URL = "/models/btc-chords.onnx";
const WINDOW = 108;
// Feature normalisation from the model's training data.
const MEAN = -2.2279878897355596;
const STD = 1.7191329394436938;

export const CLASSES = 170;

export interface ModelChord {
  root: number;
  /** Quality in this app's spelling: "", "m", "7", "maj7", "sus4"... */
  quality: string;
  minor: boolean;
}

// BTC's class order: 12 roots x 14 qualities, then X (unknown) and N (no chord).
const BTC_QUALITIES = ["m", "", "dim", "aug", "m6", "6", "m7", "m", "maj7", "7", "dim7", "m7b5", "sus2", "sus4"];
// (minmaj7 is spelled "m": it's rare in worship music and hard for beginners.)

export const VOCAB: (ModelChord | null)[] = Array.from({ length: CLASSES }, (_, i) => {
  if (i >= 168) return null;
  const quality = BTC_QUALITIES[i % 14];
  return { root: Math.floor(i / 14), quality, minor: quality.startsWith("m") && !quality.startsWith("maj") };
});

export interface ChordProbs {
  /** probs[t * 170 + c] */
  probs: Float32Array;
  times: Float64Array;
}

type Ort = typeof import("onnxruntime-web");
let loading: Promise<{ ort: Ort; session: import("onnxruntime-web").InferenceSession }> | null = null;

function load() {
  loading ??= (async () => {
    const ort = await import("onnxruntime-web");
    ort.env.wasm.wasmPaths = "/ort/";
    // One thread: multi-threading needs cross-origin isolation headers.
    ort.env.wasm.numThreads = 1;
    const session = await ort.InferenceSession.create(MODEL_URL, { executionProviders: ["wasm"] });
    return { ort, session };
  })().catch((e) => {
    loading = null;
    throw e;
  });
  return loading;
}

export async function chordProbabilities(frames: CqtFrames, onWindow?: (fraction: number) => void): Promise<ChordProbs> {
  const { ort, session } = await load();
  const n = frames.times.length;
  const windows = Math.ceil(n / WINDOW);
  const probs = new Float32Array(n * CLASSES);
  for (let w = 0; w < windows; w++) {
    const input = new Float32Array(WINDOW * CQT_BINS);
    const from = w * WINDOW;
    const count = Math.min(WINDOW, n - from);
    for (let i = 0; i < count * CQT_BINS; i++) input[i] = (frames.data[from * CQT_BINS + i] - MEAN) / STD;
    const out = await session.run({ x: new ort.Tensor("float32", input, [1, WINDOW, CQT_BINS]) });
    const logits = out.logits.data as Float32Array;
    for (let t = 0; t < count; t++) {
      let max = -Infinity;
      for (let c = 0; c < CLASSES; c++) max = Math.max(max, logits[t * CLASSES + c]);
      let sum = 0;
      for (let c = 0; c < CLASSES; c++) sum += Math.exp(logits[t * CLASSES + c] - max);
      for (let c = 0; c < CLASSES; c++) probs[(from + t) * CLASSES + c] = Math.exp(logits[t * CLASSES + c] - max) / sum;
    }
    onWindow?.((w + 1) / windows);
  }
  return { probs, times: frames.times };
}
