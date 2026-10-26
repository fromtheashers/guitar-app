import { describe, expect, it } from "vitest";
import { formatChord, nashville, parseChord, parseKey, simplifyChord, transposeChord } from "./chords";
import { parseChart, renameSection, serializeChart } from "./chart";
import { bestCapo, getInstrument, INSTRUMENTS, shapeMatchesChord, shapesFor } from "./instruments";
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
  it("renames a section, and every section with the same name", () => {
    const text = "[Verse 1]\n| G |\n[Pre-Chorus]\n| C |\n[Chorus]\n| D |\n[Pre-Chorus]\n| C |";
    const one = parseChart(renameSection(text, 1, "Verse 2", false), 4).sections.map((s) => s.label);
    expect(one).toEqual(["Verse 1", "Verse 2", "Chorus", "Pre-Chorus"]);
    const all = parseChart(renameSection(text, 3, "Verse", true), 4).sections.map((s) => s.label);
    expect(all).toEqual(["Verse 1", "Verse", "Chorus", "Verse"]);
    expect(parseChart(renameSection("| G | C |", 0, "Intro", true), 4).sections.map((s) => s.label)).toEqual(["Intro"]);
  });

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

describe("other instruments", () => {
  const roots = ["C", "C#", "D", "Eb", "E", "F", "F#", "G", "Ab", "A", "Bb", "B"];
  const qualities = ["", "m", "7", "m7", "maj7", "sus4", "sus2", "add9", "dim", "6", "9"];

  it("has a playable shape made of chord tones for every chord on each non-guitar instrument", () => {
    for (const inst of INSTRUMENTS.filter((i) => i.id !== "guitar")) {
      for (const r of roots) {
        for (const q of qualities) {
          const shapes = shapesFor(r + q, inst);
          expect(shapes.length, `${inst.id} ${r}${q}`).toBeGreaterThan(0);
          for (const s of shapes) {
            expect(s.frets.length).toBe(inst.tuning.length);
            expect(shapeMatchesChord(s, chord(r + q), inst), `${inst.id} ${r}${q} ${s.frets}`).toBe(true);
          }
        }
      }
    }
  });

  it("uses the standard ukulele shapes", () => {
    const uke = getInstrument("ukulele");
    expect(shapesFor("C", uke)[0].frets).toEqual([0, 0, 0, 3]);
    expect(shapesFor("G", uke)[0].frets).toEqual([0, 2, 3, 2]);
    expect(shapesFor("Bb", uke)[0]).toEqual({ frets: [3, 2, 1, 1], barre: 1 });
    expect(shapesFor("D/F#", uke)[0].frets).toEqual([2, 2, 2, 0]);
  });

  it("finds the usual baritone shapes, which match the guitar's top four strings", () => {
    const bari = getInstrument("baritone");
    expect(shapesFor("G", bari)[0].frets).toEqual([0, 0, 0, 3]);
    expect(shapesFor("D", bari)[0].frets).toEqual([0, 2, 3, 2]);
    expect(shapesFor("Am", bari)[0].frets).toEqual([2, 2, 1, 0]);
  });

  it("puts a song in G on ukulele without a capo, and suggests one in Bb", () => {
    const uke = getInstrument("ukulele");
    expect(bestCapo(["G", "C", "Em", "D"].map(chord), true, uke).capo).toBe(0);
    expect(bestCapo(["Bb", "Eb", "Gm", "F"].map(chord), true, uke).capo).toBeGreaterThan(0);
  });

  it("plays the bass note on bass, and never suggests a capo", () => {
    const bass = getInstrument("bass");
    expect(shapesFor("G", bass)[0].frets).toEqual([3, -1, -1, -1]);
    expect(shapesFor("D", bass)[0].frets).toEqual([-1, -1, 0, -1]);
    expect(shapesFor("D/F#", bass)[0].frets).toEqual([2, -1, -1, -1]);
    expect(bestCapo(["Bb", "Eb"].map(chord), true, bass).capo).toBe(0);
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
