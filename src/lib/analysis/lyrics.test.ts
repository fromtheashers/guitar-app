import { describe, expect, it } from "vitest";
import { alignLyrics, lyricsPrompt, parseLyrics, sectionsFromLyrics, type TimedWord } from "./lyrics";

const SHEET = `[Verse 1]
You call me out upon the waters
The great unknown where feet may fail

[Chorus]
And I will call upon Your name
And keep my eyes above the waves

[Verse 2]
Your grace abounds in deepest waters
Your sovereign hand will be my guide

[Chorus]

[Interlude]

[Bridge]
Spirit lead me where my trust is without borders (x2)`;

// A deterministic "singer": sings the given sections in order, mishears some words,
// drops a few, throws in ad-libs, and pauses between sections.
function perform(order: string[][], opts: { gap?: number; slip?: number } = {}): { words: TimedWord[]; starts: number[] } {
  let seed = 7;
  const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const words: TimedWord[] = [];
  const starts: number[] = [];
  let t = 8;
  for (const lines of order) {
    starts.push(t);
    for (const line of lines) {
      for (const w of line.split(" ")) {
        const r = rand();
        if (r < (opts.slip ?? 0.12) / 3) continue; // swallowed
        const text = r < (opts.slip ?? 0.12) ? w.slice(0, -1) + "x" : w; // misheard
        words.push({ start: t, end: t + 0.35, text });
        t += 0.45;
        if (rand() < 0.04) {
          words.push({ start: t, end: t + 0.3, text: "oh" });
          t += 0.4;
        }
      }
      t += 0.8;
    }
    t += opts.gap ?? 4;
  }
  return { words, starts };
}

const lines = (sheet: string, label: string) => {
  const s = parseLyrics(sheet).find((x) => x.label === label)!;
  return s.lineStarts.map((from, i) => s.words.slice(from, s.lineStarts[i + 1] ?? s.words.length).join(" "));
};

describe("parseLyrics", () => {
  it("reads bracketed and bare section names, and repeats a named section with no lines", () => {
    const s = parseLyrics(SHEET);
    expect(s.map((x) => x.label)).toEqual(["Verse 1", "Chorus", "Verse 2", "Chorus", "Interlude", "Bridge"]);
    expect(s[3].words).toEqual(s[1].words);
    expect(s[4].words).toEqual([]);
    // "(x2)" is a direction, not a word.
    expect(s[5].words).not.toContain("x2");
    expect(parseLyrics("VERSE 1:\nAmazing grace\nchorus\nHow sweet").map((x) => x.label)).toEqual(["Verse 1", "Chorus"]);
    expect(parseLyrics("Amazing grace how sweet")[0].label).toBe("Verse");
  });

  it("builds a short prompt of distinct lines", () => {
    const p = lyricsPrompt(parseLyrics(SHEET));
    expect(p.split("and i will call upon your name").length).toBe(2);
    expect(p.length).toBeLessThanOrEqual(800);
  });
});

describe("alignLyrics", () => {
  const sheet = parseLyrics(SHEET);
  const v1 = lines(SHEET, "Verse 1");
  const ch = lines(SHEET, "Chorus");
  const v2 = lines(SHEET, "Verse 2");
  const br = lines(SHEET, "Bridge");

  it("names each pass, even where verses and choruses repeat", () => {
    const { words, starts } = perform([v1, ch, v2, ch, [...br, ...br, ...br], ch, ch]);
    const visits = alignLyrics(sheet, words);
    expect(visits.map((v) => v.label)).toEqual(["Verse 1", "Chorus", "Verse 2", "Chorus", "Bridge", "Chorus", "Chorus"]);
    visits.forEach((v, i) => expect(Math.abs(v.start - starts[i])).toBeLessThan(1.5));
  });

  it("tells the second verse from a pre-chorus by its words", () => {
    // The case that started this: chords alone called Verse 2 a pre-chorus.
    const { words } = perform([v1, v2, ch]);
    expect(alignLyrics(sheet, words).map((v) => v.label)).toEqual(["Verse 1", "Verse 2", "Chorus"]);
  });

  it("copes with a poor transcription", () => {
    const { words } = perform([v1, ch, v2, ch, ch], { slip: 0.35 });
    expect(alignLyrics(sheet, words).map((v) => v.label)).toEqual(["Verse 1", "Chorus", "Verse 2", "Chorus", "Chorus"]);
  });

  it("follows a singer who skips a line and repeats another", () => {
    const { words } = perform([[v1[1]], [ch[0], ch[1], ch[1]], v2]);
    expect(alignLyrics(sheet, words).map((v) => v.label)).toEqual(["Verse 1", "Chorus", "Verse 2"]);
  });

  it("ignores noise before the singing starts", () => {
    const { words } = perform([v1, ch]);
    const junk: TimedWord[] = ["thank", "you", "church", "lets", "sing"].map((text, i) => ({ start: i * 0.4, end: i * 0.4 + 0.3, text }));
    const visits = alignLyrics(sheet, [...junk, ...words]);
    expect(visits.map((v) => v.label)).toEqual(["Verse 1", "Chorus"]);
  });

  it("finds little when the words don't fit the sheet", () => {
    const words: TimedWord[] = "the quick brown fox jumps over the lazy dog again and again".split(" ").map((text, i) => ({ start: i, end: i + 0.5, text }));
    expect(alignLyrics(sheet, words).filter((v) => v.matched >= 3)).toEqual([]);
  });
});

describe("sectionsFromLyrics", () => {
  const sheet = parseLyrics(SHEET);
  const v1 = lines(SHEET, "Verse 1");
  const ch = lines(SHEET, "Chorus");
  const v2 = lines(SHEET, "Verse 2");

  it("cuts bars at each sung section and names the gaps", () => {
    const { words } = perform([v1, ch, v2, ch], { gap: 10 });
    const visits = alignLyrics(sheet, words);
    const barLen = 2;
    const end = words[words.length - 1].end + 12;
    const barStarts = Array.from({ length: Math.ceil(end / barLen) + 1 }, (_, i) => i * barLen);
    const out = sectionsFromLyrics({
      barStarts,
      barSigs: barStarts.slice(1).map(() => "G"),
      beat: 0.5,
      sheet,
      visits,
      wordTimes: words.map((w) => w.start),
      chordSections: [{ from: 0, label: "Verse" }],
    })!;
    // Five-bar breaks between sections: the [Interlude] on the sheet names the one after the second chorus.
    expect(out.map((s) => s.label)).toEqual(["Intro", "Verse 1", "Instrumental", "Chorus", "Instrumental", "Verse 2", "Instrumental", "Chorus", "Outro"]);
    // Continuous and in order.
    out.forEach((s, i) => {
      expect(s.to).toBeGreaterThan(s.from);
      if (i) expect(s.from).toBe(out[i - 1].to);
    });
    expect(out[out.length - 1].to).toBe(barStarts.length - 1);
  });

  it("names an unclear verse from the sheet order", () => {
    const { words } = perform([v1, ch, v2, ch], { gap: 3 });
    const visits = alignLyrics(sheet, words).filter((v) => v.label !== "Verse 2");
    const barStarts = Array.from({ length: 60 }, (_, i) => i * 2);
    const out = sectionsFromLyrics({
      barStarts,
      barSigs: barStarts.slice(1).map(() => "G"),
      beat: 0.5,
      sheet,
      visits,
      wordTimes: words.map((w) => w.start),
      chordSections: [{ from: 0, label: "Verse" }],
    })!;
    expect(out.map((s) => s.label)).toContain("Verse 2");
  });

  it("numbers same-named sections with different words", () => {
    const s = parseLyrics("[Verse]\nOne two three four five\n[Chorus]\nSing sing sing sing\n[Verse]\nSix seven eight nine ten");
    const a = s[0].words.join(" ").split(" ");
    const b = s[2].words.join(" ").split(" ");
    const { words } = perform([[a.join(" ")], [s[1].words.join(" ")], [b.join(" ")]], { slip: 0 });
    const out = sectionsFromLyrics({
      barStarts: Array.from({ length: 30 }, (_, i) => i * 2),
      barSigs: Array.from({ length: 29 }, () => "G"),
      beat: 0.5,
      sheet: s,
      visits: alignLyrics(s, words),
      wordTimes: words.map((w) => w.start),
      chordSections: [{ from: 0, label: "Verse" }],
    })!;
    expect(out.map((x) => x.label).filter((l) => l.startsWith("Verse"))).toEqual(["Verse 1", "Verse 2"]);
  });

  it("gives up when the lyrics hardly matched", () => {
    expect(
      sectionsFromLyrics({ barStarts: [0, 2, 4], barSigs: ["G", "C"], beat: 0.5, sheet, visits: [], wordTimes: [], chordSections: [{ from: 0, label: "Verse" }] }),
    ).toBeNull();
  });
});
