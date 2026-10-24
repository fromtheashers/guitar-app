import { describe, expect, it } from "vitest";
import { foldLines, glance, glanceChords } from "./glance";
import { buildView } from "./songView";

const song = (chart: string) => ({ originalKey: "G", beatsPerBar: 4, chart, timings: [], patterns: {} });
const view = (chart: string) => buildView(song(chart), { mode: "advanced", key: "G", capo: 0, numbers: false });

describe("glance", () => {
  it("folds a line played several times in a row", () => {
    expect(foldLines([["G"], ["G"], ["G"], ["C"]])).toEqual([
      { lines: [["G"]], times: 3 },
      { lines: [["C"]], times: 1 },
    ]);
  });

  it("folds a two-line phrase played twice", () => {
    const a = ["G", "–", "C", "–"];
    const b = ["Em", "D", "C", "–"];
    expect(foldLines([a, b, a, b])).toEqual([{ lines: [a, b], times: 2 }]);
  });

  it("shows held bars as a dash, four bars to a line", () => {
    const [verse] = glance(view("[Verse 1]\n| G | G | C | . |\n| Em | D | C G | C |"));
    expect(verse.groups.map((g) => g.lines)).toEqual([[["G", "–", "C", "–"]], [["Em", "D", "C G", "C"]]]);
  });

  it("lists each chord once in order", () => {
    expect(glanceChords(view("[Intro]\n| G | C | G | D |"))).toEqual(["G", "C", "D"]);
  });
});
