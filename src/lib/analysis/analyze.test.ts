import { describe, expect, it } from "vitest";
import { analyzeAudio } from "./analyze";
import { SR } from "./features";
import { parseChart } from "../music/chart";
import { parseLyrics } from "./lyrics";

// A synthetic band: bass + triad pads for each chord, kick on 1 and 3,
// snare on 2 and 4, hi-hat eighths.
function synthSong(opts: {
  bpm: number;
  progression: string[][]; // sections of chords, one chord per bar
  drums?: boolean;
}): Float32Array {
  const notes: Record<string, number[]> = {
    G: [43, 55, 59, 62, 67],
    C: [48, 55, 60, 64, 67],
    Em: [40, 52, 55, 59, 64],
    D: [38, 50, 54, 57, 62],
    Am: [45, 57, 60, 64, 69],
  };
  const beat = 60 / opts.bpm;
  const bars = opts.progression.flat();
  const total = Math.ceil((bars.length * 4 * beat + 1) * SR);
  const out = new Float32Array(total);
  let seed = 1;
  const noise = () => {
    seed = (seed * 16807) % 2147483647;
    return seed / 1073741823.5 - 1;
  };
  const hz = (m: number) => 440 * Math.pow(2, (m - 69) / 12);
  bars.forEach((chord, b) => {
    const t0 = b * 4 * beat;
    const n0 = Math.floor(t0 * SR);
    const n1 = Math.floor((t0 + 4 * beat) * SR);
    for (const m of notes[chord]) {
      const f = hz(m);
      const amp = m < 50 ? 0.12 : 0.06;
      for (let n = n0; n < n1; n++) {
        const t = (n - n0) / SR;
        out[n] += amp * Math.sin(2 * Math.PI * f * t) * Math.exp(-t * 0.6) + amp * 0.3 * Math.sin(4 * Math.PI * f * t) * Math.exp(-t);
      }
    }
    if (opts.drums === false) return;
    for (let k = 0; k < 8; k++) {
      const start = Math.floor((t0 + (k * beat) / 2) * SR);
      const onBeat = k % 2 === 0;
      const beatNo = k / 2;
      for (let n = 0; n < 0.12 * SR && start + n < total; n++) {
        const t = n / SR;
        let v = 0.15 * noise() * Math.exp(-t * 60); // hat (broadband click; high band dominates)
        if (onBeat && (beatNo === 0 || beatNo === 2)) v += 0.8 * Math.sin(2 * Math.PI * (60 + 60 * Math.exp(-t * 30)) * t) * Math.exp(-t * 18);
        if (onBeat && (beatNo === 1 || beatNo === 3)) v += 0.5 * noise() * Math.exp(-t * 25);
        out[start + n] += v;
      }
    }
  });
  return out;
}

describe("analyzeAudio", () => {
  it("recovers tempo, key, chords and a drum-based pattern from a synthetic song", async () => {
    const verse = ["G", "C", "Em", "D", "G", "C", "Em", "D"];
    const chorus = ["C", "D", "Em", "C", "C", "D", "G", "G"];
    const audio = synthSong({ bpm: 100, progression: [verse, chorus, verse, chorus] });
    const result = await analyzeAudio(audio, { beatsPerBar: 4 });

    expect(Math.abs(result.bpm - 100)).toBeLessThanOrEqual(3);
    expect(result.key).toBe("G");

    const chart = parseChart(result.chart, 4);
    expect(chart.errors).toEqual([]);
    const barChords = chart.sections.flatMap((s) => s.bars.map((b) => b.events[0]?.chord?.replace(/\/.*/, "")));
    const expected = [...verse, ...chorus, ...verse, ...chorus];
    let right = 0;
    for (let i = 0; i < Math.min(barChords.length, expected.length); i++) if (barChords[i] === expected[i]) right++;
    expect(right / expected.length).toBeGreaterThan(0.8);

    // Timings line up with the chart and increase.
    expect(result.timings.length).toBe(chart.events.length);
    const t = result.timings.filter((x): x is number => x !== null);
    expect(t.every((v, i) => i === 0 || v > t[i - 1])).toBe(true);
    expect(Math.abs(t[0])).toBeLessThan(0.3);

    // The groove should show kick on beat 1 and snare on beat 2.
    const pattern = Object.values(result.patterns)[0];
    const per = pattern.groove.steps / 4;
    expect(pattern.groove.kick[0]).toBeGreaterThan(pattern.groove.kick[per]);
    expect(pattern.groove.snare[per]).toBeGreaterThan(pattern.groove.snare[0]);
    expect(pattern.strokes[0]).toBe("D");

    // Verse and chorus come back as two repeated sections.
    expect(chart.sections.map((s) => s.label)).toEqual(["Verse 1", "Chorus", "Verse 2", "Chorus"]);
  }, 60_000);

  it("names sections from the lyrics when the sung words are known", async () => {
    const verse = ["G", "C", "Em", "D", "G", "C", "Em", "D"];
    const chorus = ["C", "D", "Em", "C", "C", "D", "G", "G"];
    const audio = synthSong({ bpm: 100, progression: [verse, verse, chorus] });
    const sheet = parseLyrics(`[Verse 1]
Amazing grace how sweet the sound that saved a wretch like me
[Verse 2]
Twas grace that taught my heart to fear and grace my fears relieved
[Chorus]
My chains are gone I've been set free my God my Saviour has ransomed me`);
    // Each section's words sung from just after its first downbeat (a bar is 2.4 s).
    const words = sheet.flatMap((sec, k) => sec.words.map((text, i) => ({ start: k * 19.2 + 0.3 + i * 0.9, end: k * 19.2 + 0.7 + i * 0.9, text })));
    const result = await analyzeAudio(audio, { beatsPerBar: 4, lyrics: sheet, words });
    const chart = parseChart(result.chart, 4);
    expect(result.sections.from).toBe("lyrics");
    expect(chart.sections.map((s) => s.label)).toEqual(["Verse 1", "Verse 2", "Chorus"]);
    expect(chart.sections.map((s) => s.bars.length)).toEqual([8, 8, 8]);
  }, 60_000);

  it("marks a section with no drums as let-it-ring", async () => {
    const audio = synthSong({ bpm: 80, progression: [["G", "C", "G", "D", "G", "C", "D", "G"]], drums: false });
    const result = await analyzeAudio(audio, { beatsPerBar: 4 });
    const patterns = Object.values(result.patterns);
    expect(patterns.length).toBeGreaterThan(0);
    expect(result.key).toBe("G");
  }, 60_000);

  it("reads the groove from a separated drums track", async () => {
    const progression = [["G", "C", "Em", "D", "G", "C", "Em", "D"]];
    const full = synthSong({ bpm: 100, progression });
    const instruments = synthSong({ bpm: 100, progression, drums: false });
    const drums = full.map((v, i) => v - instruments[i]);
    const result = await analyzeAudio(full, { beatsPerBar: 4, stems: { instruments, drums } });
    expect(result.key).toBe("G");
    const pattern = Object.values(result.patterns)[0];
    const per = pattern.groove.steps / 4;
    expect(pattern.groove.kick[0]).toBeGreaterThan(pattern.groove.kick[per]);
    expect(pattern.groove.snare[per]).toBeGreaterThan(pattern.groove.snare[0]);
  }, 60_000);
});
