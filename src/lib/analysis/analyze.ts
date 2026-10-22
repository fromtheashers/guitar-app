// Turns audio into a draft chart: tempo, key, chords per bar, sections and a
// drum-based strum pattern per section. Runs entirely in memory.

import { formatChord, keyName, mod12, prefersFlats } from "../music/chords";
import { ChartBar, ChartSection, sectionKind, serializeChart } from "../music/chart";
import { DrumGroove, patternFromGroove, StrumPattern } from "../music/strum";
import { estimateTempo, trackBeats } from "./beats";
import { mean, percentile } from "./dsp";
import {
  CHROMA_FPS,
  chromaFeatures,
  chromaFrameTime,
  ONSET_FPS,
  onsetFeatures,
  onsetFrameTime,
} from "./features";
import type { ChordProbs } from "./chordModel";
import { BeatHarmony, detectKey, labelBeats, slashBass, STATES } from "./harmony";
import { beatProbabilities, chordPrior, FAMILY_STATES, labelBeatsWithModel } from "./modelHarmony";

export interface AnalysisOptions {
  /** Beats per bar as written in the chart: 4, 3 or 6 (6/8). */
  beatsPerBar: number;
  /** Maps seconds into the captured audio to seconds in the video; null if unknown. */
  toVideoTime?: (audioSeconds: number) => number | null;
  onProgress?: (fraction: number, stage: string) => void;
  /** Output of the trained chord model (chordModel.ts). Without it, chords come from chroma templates. */
  chordProbs?: ChordProbs;
}

export interface AnalysisResult {
  bpm: number;
  key: string;
  beatsPerBar: number;
  chart: string;
  /** Video time in seconds for each chord change, in chart order. */
  timings: (number | null)[];
  /** Strum pattern per section kind ("verse", "chorus", ...). */
  patterns: Record<string, StrumPattern>;
  confidence: { tempo: number; chords: number };
}

interface Bar {
  /** Beat positions in onset frames, one per analysis beat plus the next bar's downbeat. */
  beatFrames: number[];
  /** Chord per half (or whole) bar: state index and optional slash bass. */
  halves: { state: number; bass?: number; beat: number }[];
  energy: number;
}

const tick = () => new Promise<void>((r) => setTimeout(r, 0));

export async function analyzeAudio(samples: Float32Array, opts: AnalysisOptions): Promise<AnalysisResult> {
  const progress = opts.onProgress ?? (() => {});
  const toVideo = opts.toVideoTime ?? ((t: number) => t);

  // 6/8 is felt in two: track the dotted-quarter pulse and split each beat in three.
  const sixEight = opts.beatsPerBar === 6;
  const pulsesPerBar = sixEight ? 2 : opts.beatsPerBar;
  const chartBeatsPerPulse = sixEight ? 3 : 1;
  const stepsPerPulse = sixEight ? 3 : 4;

  progress(0.05, "Finding the drums");
  await tick();
  const onset = onsetFeatures(samples);
  progress(0.3, "Listening for chords");
  await tick();
  const harm = chromaFeatures(samples);
  progress(0.55, "Finding the beat");
  await tick();

  let tempo = estimateTempo(onset.onset, ONSET_FPS);
  if (sixEight) {
    // The pulse of a 6/8 ballad is slow; fold fast estimates (eighth notes) down.
    while (tempo.bpm > 90) tempo = { ...tempo, bpm: tempo.bpm / (tempo.bpm > 135 ? 3 : 2) };
  }
  const beatFrames = trackBeats(onset.onset, ONSET_FPS, tempo.bpm);
  const beatSec = beatFrames.map((f) => onsetFrameTime(f));
  const ibi = median(diffs(beatSec));
  const bpm = ibi > 0 ? 60 / ibi : tempo.bpm;

  progress(0.65, "Working out the chords");
  await tick();

  // Harmony per beat.
  const silence = percentile(harm.energy, 50) * 0.2;
  const beatHarmony: BeatHarmony[] = [];
  for (let i = 0; i < beatSec.length; i++) {
    const a = beatSec[i];
    const b = beatSec[i + 1] ?? a + ibi;
    beatHarmony.push(averageHarmony(harm, a, b));
  }
  const total = new Float64Array(12);
  beatHarmony.forEach((b) => b.chroma.forEach((v, i) => (total[i] += v * Math.min(1, b.energy / (silence * 5 || 1)))));
  let key = detectKey(total);
  // Chord vocabulary: the trained model's classes folded into chart chords, or 24 triads from templates.
  let states: (ChordName | null)[];
  let labels: number[];
  let beatProbs: Float64Array[] | null = null;
  if (opts.chordProbs) {
    states = FAMILY_STATES;
    beatProbs = beatProbabilities(opts.chordProbs, beatSec, ibi);
    // First pass without a key, to find it from the chords; then again favouring chords in that key.
    const firstPass = labelBeatsWithModel(beatProbs, chordPrior(null));
    const tones = new Float64Array(12);
    firstPass.forEach((l) => {
      const st = FAMILY_STATES[l];
      if (!st) return;
      tones[st.root] += 1;
      tones[mod12(st.root + (st.minor ? 3 : 4))] += 0.8;
      tones[mod12(st.root + 7)] += 0.8;
    });
    if (tones.some((v) => v > 0)) key = detectKey(tones);
    labels = labelBeatsWithModel(beatProbs, chordPrior(key));
  } else {
    states = STATES.map((st) => st && { ...st, quality: st.minor ? "m" : "" });
    labels = labelBeats(beatHarmony, key, silence);
  }

  // Downbeat: the phase where the kick is strongest and chords tend to change.
  const kickAt = beatFrames.map((f) => peakNear(onset.kick, f, 3));
  let phase = 0;
  let phaseScore = -Infinity;
  for (let p = 0; p < pulsesPerBar; p++) {
    let s = 0;
    for (let i = p; i < labels.length; i += pulsesPerBar) {
      s += kickAt[i] ?? 0;
      if (i > 0 && labels[i] !== labels[i - 1]) s += 1.5 * mean(kickAt);
    }
    if (s > phaseScore) {
      phaseScore = s;
      phase = p;
    }
  }

  // Bars and their chords (changes allowed on beat 1 and halfway through).
  const bars: Bar[] = [];
  const splits = pulsesPerBar === 4 ? [0, 2] : [0];
  for (let start = phase; start + pulsesPerBar <= labels.length; start += pulsesPerBar) {
    const frames = beatFrames.slice(start, start + pulsesPerBar + 1);
    if (frames.length < pulsesPerBar + 1) frames.push(frames[frames.length - 1] + ibi * ONSET_FPS);
    const halves: Bar["halves"] = [];
    splits.forEach((sp, k) => {
      const end = splits[k + 1] ?? pulsesPerBar;
      const counts = new Map<number, number>();
      for (let i = start + sp; i < start + end; i++) counts.set(labels[i], (counts.get(labels[i]) ?? 0) + (i === start + sp ? 1.1 : 1));
      const state = [...counts.entries()].sort((x, y) => y[1] - x[1])[0][0];
      let bass: number | undefined;
      const st = states[state];
      if (st) {
        const h = averageHarmony(harm, beatSec[start + sp], beatSec[start + end] ?? beatSec[start + sp] + ibi * (end - sp));
        // The model never hears inversions, so only a clearly dominant bass note makes a slash chord.
        bass = slashBass(h.bass, st, beatProbs ? 3 : 1.6);
      }
      const prev = halves[halves.length - 1];
      if (!prev || prev.state !== state || prev.bass !== bass) halves.push({ state, bass, beat: sp });
    });
    const energy = mean(Array.from(onset.rms.subarray(Math.floor(frames[0]), Math.ceil(frames[frames.length - 1]))));
    bars.push({ beatFrames: frames, halves, energy });
  }

  // Trim silent bars at the start and end.
  const isEmpty = (b: Bar) => b.halves.every((h) => !states[h.state]);
  while (bars.length && isEmpty(bars[0])) bars.shift();
  while (bars.length && isEmpty(bars[bars.length - 1])) bars.pop();

  progress(0.8, "Finding verses and choruses");
  await tick();
  // Sections compare chords coarsely (root and major/minor), so "B" and "Bmaj7" count as the same.
  const coarse = (state: number) => {
    const st = states[state];
    return st ? `${st.root}${st.minor ? "m" : ""}` : "N";
  };
  const sections = findSections(bars, coarse);

  progress(0.9, "Turning the drums into strum patterns");
  await tick();
  const patterns: Record<string, StrumPattern> = {};
  const byKind = new Map<string, Bar[]>();
  for (const s of sections) {
    const kind = sectionKind(s.label);
    byKind.set(kind, [...(byKind.get(kind) ?? []), ...s.bars]);
  }
  const norms = {
    kick: percentile(onset.kick, 98) || 1,
    snare: percentile(onset.snare, 98) || 1,
    hat: percentile(onset.hat, 98) || 1,
  };
  for (const [kind, kbars] of byKind) {
    const groove = grooveFor(kbars, onset, norms, pulsesPerBar, stepsPerPulse);
    const level = mean([...groove.kick, ...groove.snare, ...groove.hat]);
    const sparse = level < 0.1;
    const name = sparse ? "Let it ring" : "From the recording";
    patterns[kind] = patternFromGroove(name, groove, opts.beatsPerBar, sparse);
  }

  // Chart text and timings.
  const flats = prefersFlats(key);
  const chartSections: ChartSection[] = sections.map((s) => ({
    label: s.label,
    kind: sectionKind(s.label),
    bars: s.bars.map((b): ChartBar => ({
      events: b.halves.map((h) => ({ chord: symbolFor(states[h.state], h.bass, flats), beat: h.beat * chartBeatsPerPulse, index: -1 })),
    })),
  }));
  const timings: (number | null)[] = [];
  for (const s of sections) {
    for (const b of s.bars) {
      for (const h of b.halves) timings.push(roundTime(toVideo(onsetFrameTime(b.beatFrames[h.beat]))));
    }
  }

  const fit: number[] = [];
  beatHarmony.forEach((b, i) => {
    const st = states[labels[i]];
    if (!st || b.energy < silence) return;
    // With the model, confidence is how sure it was; otherwise how well the chroma fits.
    fit.push(beatProbs ? beatProbs[i][labels[i]] : b.chroma[st.root] / (Math.max(...b.chroma) || 1));
  });
  const chordConfidence = mean(fit);

  progress(1, "Done");
  return {
    bpm: Math.round(bpm),
    key: keyName(key),
    beatsPerBar: opts.beatsPerBar,
    chart: serializeChart(chartSections, opts.beatsPerBar),
    timings,
    patterns,
    confidence: { tempo: round2(tempo.confidence), chords: round2(chordConfidence) },
  };
}

interface ChordName {
  root: number;
  minor: boolean;
  quality: string;
}

function symbolFor(st: ChordName | null, bass: number | undefined, flats: boolean): string | null {
  if (!st) return null;
  return formatChord({ root: st.root, quality: st.quality, bass }, flats);
}

function averageHarmony(h: ReturnType<typeof chromaFeatures>, a: number, b: number): BeatHarmony {
  const f0 = Math.max(0, Math.floor(a * CHROMA_FPS - 0.5));
  const f1 = Math.max(f0 + 1, Math.min(h.chroma.length, Math.ceil(b * CHROMA_FPS - 0.5)));
  const chroma = new Float64Array(12);
  const bass = new Float64Array(12);
  let energy = 0;
  let count = 0;
  for (let f = f0; f < f1 && f < h.chroma.length; f++) {
    // Skip frames centred outside the span.
    const t = chromaFrameTime(f);
    if (t < a - 0.05 || t > b + 0.05) continue;
    for (let i = 0; i < 12; i++) {
      chroma[i] += h.chroma[f][i] * h.energy[f];
      bass[i] += h.bass[f][i];
    }
    energy += h.energy[f];
    count++;
  }
  return { chroma, bass, energy: count ? energy / count : 0 };
}

function peakNear(x: Float64Array, frame: number, radius: number): number {
  let m = 0;
  const c = Math.round(frame);
  for (let i = Math.max(0, c - radius); i <= Math.min(x.length - 1, c + radius); i++) m = Math.max(m, x[i]);
  return m;
}

function grooveFor(
  bars: Bar[],
  onset: ReturnType<typeof onsetFeatures>,
  norms: { kick: number; snare: number; hat: number },
  pulses: number,
  perPulse: number,
): DrumGroove {
  const steps = pulses * perPulse;
  const acc = { kick: new Float64Array(steps), snare: new Float64Array(steps), hat: new Float64Array(steps) };
  for (const bar of bars) {
    for (let p = 0; p < pulses; p++) {
      const a = bar.beatFrames[p];
      const b = bar.beatFrames[p + 1] ?? a + (a - (bar.beatFrames[p - 1] ?? a - 40));
      const len = (b - a) / perPulse;
      for (let k = 0; k < perPulse; k++) {
        const center = a + k * len;
        const r = Math.max(1, Math.round(len * 0.35));
        const i = p * perPulse + k;
        acc.kick[i] += Math.min(1, peakNear(onset.kick, center, r) / norms.kick);
        acc.snare[i] += Math.min(1, peakNear(onset.snare, center, r) / norms.snare);
        acc.hat[i] += Math.min(1, peakNear(onset.hat, center, r) / norms.hat);
      }
    }
  }
  const n = Math.max(1, bars.length);
  const avg = (x: Float64Array) => Array.from(x, (v) => round2(v / n));
  let groove: DrumGroove = { steps, kick: avg(acc.kick), snare: avg(acc.snare), hat: avg(acc.hat) };

  // Use an eighth-note grid unless the hi-hat really plays sixteenths.
  if (perPulse === 4) {
    const even: number[] = [], odd: number[] = [];
    groove.hat.forEach((v, i) => (i % 2 === 0 ? even : odd).push(v));
    if (mean(odd) < 0.6 * mean(even) || mean(odd) < 0.15) {
      const pick = (x: number[]) => Array.from({ length: steps / 2 }, (_, i) => Math.max(x[2 * i], 0.6 * x[2 * i + 1]));
      groove = { steps: steps / 2, kick: pick(groove.kick), snare: pick(groove.snare), hat: pick(groove.hat) };
    }
  }
  return groove;
}

interface FoundSection {
  label: string;
  bars: Bar[];
}

/**
 * Split bars into sections by grouping repeated 4-bar phrases, then name the groups:
 * the loudest repeated group is the chorus, the group before it the verse, and so on.
 */
function findSections(bars: Bar[], coarse: (state: number) => string): FoundSection[] {
  if (!bars.length) return [];
  const PHRASE = 4;
  type Phrase = { bars: Bar[]; sig: string[]; energy: number; group: number };
  const phrasesFrom = (offset: number) => {
    const out: Phrase[] = [];
    const cuts = offset ? [0] : [];
    for (let i = offset; i < bars.length; i += PHRASE) cuts.push(i);
    cuts.forEach((from, k) => {
      const pb = bars.slice(from, cuts[k + 1] ?? bars.length);
      const sig = pb.flatMap((b) => [coarse(b.halves[0].state), coarse(b.halves[b.halves.length - 1].state)]);
      out.push({ bars: pb, sig, energy: mean(pb.map((b) => b.energy)), group: -1 });
    });
    return out;
  };
  // Same chords at a similar loudness: a quiet verse and a loud chorus often share a progression.
  const alike = (a: Phrase, b: Phrase, threshold: number) =>
    similarity(a.sig, b.sig) >= threshold && Math.max(a.energy, b.energy) <= 1.6 * Math.min(a.energy, b.energy);

  // Intros and pickups shift the phrases: start them where the most phrases repeat.
  let phrases = phrasesFrom(0);
  let bestRepeats = -1;
  for (let offset = 0; offset < PHRASE && offset < bars.length; offset++) {
    const ps = phrasesFrom(offset);
    const repeats = ps.filter((p, i) => ps.some((q, j) => j !== i && alike(p, q, 0.75))).length;
    if (repeats > bestRepeats) {
      bestRepeats = repeats;
      phrases = ps;
    }
  }

  // Each phrase joins the group it matches best, so one misheard bar doesn't start a new section.
  const reps: Phrase[] = [];
  for (const p of phrases) {
    let g = -1;
    let best = 0.75;
    reps.forEach((r, i) => {
      const sim = similarity(r.sig, p.sig);
      if (sim >= best && alike(r, p, best)) {
        best = sim;
        g = i;
      }
    });
    if (g < 0) {
      g = reps.length;
      reps.push(p);
    }
    p.group = g;
  }
  // A phrase heard only once that is close to a repeated group belongs to it.
  const sizes = new Map<number, number>();
  phrases.forEach((p) => sizes.set(p.group, (sizes.get(p.group) ?? 0) + 1));
  for (const p of phrases) {
    if (sizes.get(p.group) !== 1) continue;
    const g = reps.findIndex((r, i) => (sizes.get(i) ?? 0) >= 2 && alike(r, p, 0.5));
    if (g >= 0) {
      sizes.set(p.group, 0);
      p.group = g;
      sizes.set(g, (sizes.get(g) ?? 0) + 1);
    }
  }

  // Runs of the same group form one section.
  const runs: { group: number; bars: Bar[]; energy: number }[] = [];
  for (const p of phrases) {
    const last = runs[runs.length - 1];
    if (last && last.group === p.group) {
      last.bars.push(...p.bars);
      last.energy = (last.energy + p.energy) / 2;
    } else runs.push({ group: p.group, bars: [...p.bars], energy: p.energy });
  }

  // Two single-phrase groups that always appear back to back are one section
  // (a chorus whose second half differs from its first).
  for (let i = 0; i + 1 < runs.length; i++) {
    const a = runs[i].group;
    const b = runs[i + 1].group;
    if (a === b) continue;
    const pairs = runs.every((r, k) =>
      r.group === a ? runs[k + 1]?.group === b && r.bars.length <= PHRASE && runs[k + 1].bars.length <= PHRASE
      : r.group === b ? runs[k - 1]?.group === a : true,
    );
    if (!pairs) continue;
    for (let k = 0; k + 1 < runs.length; k++) {
      if (runs[k].group === a && runs[k + 1].group === b) {
        runs[k].bars.push(...runs[k + 1].bars);
        runs[k].energy = (runs[k].energy + runs[k + 1].energy) / 2;
        runs.splice(k + 1, 1);
      }
    }
  }

  const groupCount = new Map<number, number>();
  const groupEnergy = new Map<number, number[]>();
  runs.forEach((r) => {
    groupCount.set(r.group, (groupCount.get(r.group) ?? 0) + 1);
    groupEnergy.set(r.group, [...(groupEnergy.get(r.group) ?? []), r.energy]);
  });
  const energyOf = (g: number) => mean(groupEnergy.get(g) ?? [0]);
  const repeated = [...groupCount.keys()].filter((g) => (groupCount.get(g) ?? 0) >= 2);
  const pool = repeated.length ? repeated : [...groupCount.keys()];
  const chorus = pool.reduce((a, b) => (energyOf(b) > energyOf(a) ? b : a));

  const names = new Map<number, string>();
  names.set(chorus, "Chorus");
  const firstChorusRun = runs.findIndex((r) => r.group === chorus);
  const once = (g: number) => groupCount.get(g) === 1;

  if (runs.length > 2 && once(runs[0].group) && runs[0].energy < 0.8 * energyOf(chorus) && runs[0].group !== chorus) {
    names.set(runs[0].group, "Intro");
  }
  const last = runs[runs.length - 1];
  if (runs.length > 3 && once(last.group) && !names.has(last.group)) names.set(last.group, "Outro");

  const unnamedBefore = runs.slice(0, Math.max(0, firstChorusRun)).map((r) => r.group).filter((g) => !names.has(g));
  if (unnamedBefore.length) {
    names.set(unnamedBefore[0], "Verse");
    const pre = unnamedBefore.find((g) => g !== unnamedBefore[0]);
    if (pre !== undefined) names.set(pre, "Pre-Chorus");
  }
  const extra = ["Bridge", "Interlude", "Tag"];
  for (const r of runs) {
    if (names.has(r.group)) continue;
    if (![...names.values()].includes("Verse") && (groupCount.get(r.group) ?? 0) >= 2) names.set(r.group, "Verse");
    else names.set(r.group, extra.shift() ?? `Section ${String.fromCharCode(65 + r.group)}`);
  }

  const seen = new Map<string, number>();
  const verseCount = runs.filter((r) => names.get(r.group) === "Verse").length;
  return runs.map((r) => {
    const base = names.get(r.group)!;
    const n = (seen.get(base) ?? 0) + 1;
    seen.set(base, n);
    const label = base === "Verse" && verseCount > 1 ? `Verse ${n}` : base;
    return { label, bars: r.bars };
  });
}

function similarity(a: string[], b: string[]): number {
  const n = Math.max(a.length, b.length);
  if (!n) return 1;
  let same = 0;
  for (let i = 0; i < n; i++) if (a[i] === b[i]) same++;
  return same / n;
}

function diffs(x: number[]): number[] {
  return x.slice(1).map((v, i) => v - x[i]);
}

function median(x: number[]): number {
  if (!x.length) return 0;
  const s = [...x].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
}

const round2 = (x: number) => Math.round(x * 100) / 100;
const roundTime = (t: number | null) => (t === null ? null : Math.round(t * 1000) / 1000);
