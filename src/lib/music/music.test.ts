import { describe, expect, it } from "vitest";
import { formatChord, nashville, parseChord, parseKey, simplifyChord, transposeChord } from "./chords";
import { parseChart, serializeChart } from "./chart";
import { bestCapo, shapeMatchesChord, shapesFor } from "./guitar";
import { presetPattern, strokesForMode } from "./strum";

const chord = (s: string) => parseChord(s)!;

describe("chords", () => {
  it("parses common worship chord symbols", () => {
    expect(parseChord("Cadd9")).toEqual({ root: 0, quality: "add9" });
    expect(parseChord("D/F#")).toEqual({ root: 2, quality: "", bass: 6 });
    expect(parseChord("Bbmaj7")).toEqual({ root: 10, quality: "maj7" });
    expect(parseChord("Esus")).toEqual({ root: 4, quality: "sus4" });
    expect(parseChord("Hello")).toBeNull();
  });

  it("transposes with the key's spelling", () => {
    expect(formatChord(transposeChord(chord("G/B"), 3), true)).toBe("Bb/D");
    expect(formatChord(transposeChord(chord("Em7"), 2), false)).toBe("F#m7");
  });

  it("simplifies for easy mode", () => {
    expect(formatChord(simplifyChord(chord("Cadd9")), false)).toBe("C");
    expect(formatChord(simplifyChord(chord("Em7")), false)).toBe("Em");
    expect(formatChord(simplifyChord(chord("D/F#")), false)).toBe("D");
  });

  it("writes Nashville numbers", () => {
    const key = parseKey("G")!;
    expect(nashville(chord("Em"), key, false)).toBe("6m");
    expect(nashville(chord("D/F#"), key, true)).toBe("5/7");
    expect(nashville(chord("F"), key, false)).toBe("b7");
  });
});

describe("chart", () => {
  it("reads bars, beats, cues and inline chords", () => {
    const text = "[Verse 1]\n> Amazing grace\n| G . . . | C . G . | Em D | % |\n[Chorus]\n[G]How sweet the [D]sound\n";
    const chart = parseChart(text, 4);
    expect(chart.errors).toEqual([]);
    expect(chart.sections.map((s) => s.label)).toEqual(["Verse 1", "Chorus"]);
    const v = chart.sections[0].bars;
    expect(v[0].cue).toBe("Amazing grace");
    expect(v[1].events.map((e) => [e.chord, e.beat])).toEqual([["C", 0], ["G", 2]]);
    expect(v[2].events.map((e) => [e.chord, e.beat])).toEqual([["Em", 0], ["D", 2]]);
    expect(v[3].events.map((e) => e.chord)).toEqual(["Em", "D"]);
    expect(chart.sections[1].bars[0].cue).toBe("How sweet the sound");
    expect(chart.events.map((e) => e.index)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8]);
  });

  it("reports lines it can't read", () => {
    const chart = parseChart("| G | Xyz |", 4);
    expect(chart.errors[0].line).toBe(1);
  });

  it("round-trips through text, writing even splits the short way", () => {
    const chart = parseChart("[Verse]\n| G | C . G . | Em . . D | C |\n", 4);
    const text = serializeChart(chart.sections, 4);
    expect(text).toBe("[Verse]\n| G | C G | Em . . D | C |\n");
    expect(parseChart(text, 4).events).toEqual(chart.events);
  });
});

describe("guitar", () => {
  it("has a shape for every chord in the open table and barre fallbacks", () => {
    for (const s of ["G", "Cadd9", "Em7", "Dsus4", "D/F#", "G/B", "Bm", "F", "Am7"]) {
      const shape = shapesFor(s)[0];
      expect(shapeMatchesChord(shape, chord(s))).toBe(true);
    }
    expect(shapesFor("Bb")[0].barre).toBe(1);
    expect(shapesFor("C#m")[0].barre).toBe(4);
  });

  it("suggests capo 3 for a song in Bb", () => {
    const chords = ["Bb", "Eb", "Gm", "F"].map(chord);
    expect(bestCapo(chords, true).capo).toBe(3);
  });

  it("needs no capo for a song in G", () => {
    expect(bestCapo(["G", "C", "Em", "D"].map(chord), true).capo).toBe(0);
  });
});

describe("strum patterns", () => {
  it("turns a driving groove into down-up strums with accents", () => {
    const p = presetPattern("driving-8ths", 4);
    expect(p.strokes.join("")).toBe("DUxUDUxU");
    expect(p.accents[0]).toBe(true);
    const easy = strokesForMode(p, 4, "easy");
    expect(easy.strokes.join("")).toBe("D-D-D-D-");
  });
});
