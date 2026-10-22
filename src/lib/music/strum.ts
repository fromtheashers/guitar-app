// Strum patterns derived from a drum groove. A pattern is one bar on a grid of
// `steps` slots (8 = eighth notes in 4/4, 16 = sixteenths). Each drum lane holds a
// strength from 0 to 1 per slot.

export type Stroke = "D" | "U" | "x" | "-";

export interface DrumGroove {
  steps: number;
  kick: number[];
  snare: number[];
  hat: number[];
}

export interface StrumPattern {
  name: string;
  groove: DrumGroove;
  /** One stroke per slot. "D" down, "U" up, "x" muted chuck, "-" no strum (hand keeps moving). */
  strokes: Stroke[];
  accents: boolean[];
  /** True for sections with little or no drums: strum once per chord and let it ring. */
  sparse?: boolean;
}

const HIT = 0.45;

function lane(steps: number, hits: number[], strength = 1): number[] {
  const out = Array(steps).fill(0);
  for (const h of hits) out[h] = strength;
  return out;
}

/** Slots per beat for a grid. */
export function slotsPerBeat(steps: number, beatsPerBar: number): number {
  return Math.max(1, Math.round(steps / beatsPerBar));
}

/**
 * Turn a drum groove into strokes. The hand moves down on the beat and up between,
 * at the hi-hat's speed; kick and snare hits become accented strums.
 */
export function strokesFromGroove(groove: DrumGroove, beatsPerBar: number, mode: "easy" | "advanced"): { strokes: Stroke[]; accents: boolean[] } {
  const n = groove.steps;
  const per = slotsPerBeat(n, beatsPerBar);
  const strokes: Stroke[] = [];
  const accents: boolean[] = [];
  const level = (i: number) => Math.max(groove.kick[i] ?? 0, groove.snare[i] ?? 0, groove.hat[i] ?? 0);
  for (let i = 0; i < n; i++) {
    const kick = groove.kick[i] ?? 0;
    const snare = groove.snare[i] ?? 0;
    const hat = groove.hat[i] ?? 0;
    // The hand alternates down/up on every grid slot; with one slot per beat it only goes down.
    const isDown = per === 1 || i % 2 === 0;
    const onBeat = i % per === 0;
    const accent = kick >= HIT || snare >= HIT;
    let stroke: Stroke = "-";
    if (mode === "easy") {
      // Down strums on the beats that have a kick or snare; always strum beat 1.
      if (onBeat && (accent || i === 0)) stroke = "D";
    } else {
      const direction: Stroke = isDown ? "D" : "U";
      if (snare >= 0.6 && kick < HIT && onBeat) stroke = "x";
      else if (accent || hat >= 0.35) stroke = direction;
    }
    strokes.push(stroke);
    accents.push(stroke !== "-" && accent && mode === "advanced");
  }
  if (!strokes.some((s) => s !== "-")) {
    strokes[0] = "D";
    if (level(0) > 0) accents[0] = true;
  }
  return { strokes, accents };
}

export function patternFromGroove(name: string, groove: DrumGroove, beatsPerBar: number, sparse = false): StrumPattern {
  const { strokes, accents } = sparse
    ? { strokes: ["D", ...Array(groove.steps - 1).fill("-")] as Stroke[], accents: Array(groove.steps).fill(false) }
    : strokesFromGroove(groove, beatsPerBar, "advanced");
  return { name, groove, strokes, accents, sparse };
}

/** Strokes to show for a pattern in the given mode. */
export function strokesForMode(pattern: StrumPattern, beatsPerBar: number, mode: "easy" | "advanced") {
  if (pattern.sparse) return { strokes: pattern.strokes, accents: pattern.accents };
  if (mode === "advanced") return { strokes: pattern.strokes, accents: pattern.accents };
  return strokesFromGroove(pattern.groove, beatsPerBar, "easy");
}

export interface GroovePreset {
  id: string;
  name: string;
  description: string;
  beatsPerBar: number;
  make: () => { groove: DrumGroove; sparse?: boolean };
}

export const GROOVE_PRESETS: GroovePreset[] = [
  {
    id: "driving-8ths",
    name: "Driving 8ths",
    description: "Kick on 1 and 3, snare on 2 and 4, hi-hat eighths. Most upbeat worship songs.",
    beatsPerBar: 4,
    make: () => ({ groove: { steps: 8, kick: lane(8, [0, 4, 5]), snare: lane(8, [2, 6]), hat: lane(8, [0, 1, 2, 3, 4, 5, 6, 7], 0.6) } }),
  },
  {
    id: "four-on-floor",
    name: "Four on the floor",
    description: "Kick on every beat, snare on 2 and 4. Big anthem choruses.",
    beatsPerBar: 4,
    make: () => ({ groove: { steps: 8, kick: lane(8, [0, 2, 4, 6]), snare: lane(8, [2, 6]), hat: lane(8, [1, 3, 5, 7], 0.6) } }),
  },
  {
    id: "half-time",
    name: "Half-time",
    description: "Kick on 1, snare on 3. Slower-feeling verses and bridges.",
    beatsPerBar: 4,
    make: () => ({ groove: { steps: 8, kick: lane(8, [0, 3]), snare: lane(8, [4]), hat: lane(8, [0, 2, 4, 6], 0.5) } }),
  },
  {
    id: "sixteenths",
    name: "16th-note groove",
    description: "Busy hi-hat sixteenths. Builds and fast songs.",
    beatsPerBar: 4,
    make: () => ({
      groove: {
        steps: 16,
        kick: lane(16, [0, 6, 8, 10]),
        snare: lane(16, [4, 12]),
        hat: lane(16, Array.from({ length: 16 }, (_, i) => i), 0.5),
      },
    }),
  },
  {
    id: "ballad-ring",
    name: "Let it ring",
    description: "No drums. One strum per chord, let it ring. Intros and quiet verses.",
    beatsPerBar: 4,
    make: () => ({ groove: { steps: 8, kick: lane(8, []), snare: lane(8, []), hat: lane(8, []) }, sparse: true }),
  },
  {
    id: "six-eight",
    name: "6/8 ballad",
    description: "Two big beats per bar, counted 1-2-3-4-5-6.",
    beatsPerBar: 6,
    make: () => ({ groove: { steps: 6, kick: lane(6, [0]), snare: lane(6, [3]), hat: lane(6, [0, 1, 2, 3, 4, 5], 0.5) } }),
  },
  {
    id: "three-four",
    name: "3/4 waltz",
    description: "Kick on 1, snare on 2 and 3. Hymns like Amazing Grace.",
    beatsPerBar: 3,
    make: () => ({ groove: { steps: 6, kick: lane(6, [0]), snare: lane(6, [2, 4]), hat: lane(6, [0, 1, 2, 3, 4, 5], 0.4) } }),
  },
];

export function presetPattern(id: string, beatsPerBar: number): StrumPattern {
  const preset = GROOVE_PRESETS.find((p) => p.id === id) ?? GROOVE_PRESETS[0];
  const { groove, sparse } = preset.make();
  return patternFromGroove(preset.name, groove, beatsPerBar, sparse);
}

export function defaultPresetFor(beatsPerBar: number): string {
  if (beatsPerBar === 3) return "three-four";
  if (beatsPerBar === 6) return "six-eight";
  return "driving-8ths";
}

/** Count labels for a grid: "1 & 2 &" or "1 e & a". */
export function countLabels(steps: number, beatsPerBar: number): string[] {
  const per = slotsPerBeat(steps, beatsPerBar);
  const sub = per === 4 ? ["", "e", "&", "a"] : per === 3 ? ["", "&", "a"] : per === 2 ? ["", "&"] : [""];
  return Array.from({ length: steps }, (_, i) => (i % per === 0 ? String(i / per + 1) : sub[i % per] ?? ""));
}
