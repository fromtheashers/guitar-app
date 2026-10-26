// Names a song's sections from lyrics the teacher pasted. The home helper transcribes
// the separated vocals into timed words; those are lined up with the lyric sheet, so
// each sung pass through a section gives its start time and its name. Pure functions,
// no audio: analyze.ts maps the result onto bars. Lyrics and words are never stored
// with the chart or shown to students.

export interface LyricSection {
  /** As written on the sheet, e.g. "Verse 2". */
  label: string;
  /** Normalised words; empty for an instrumental placeholder like [Interlude]. */
  words: string[];
  /** Index into `words` where each line starts. */
  lineStarts: number[];
}

export interface TimedWord {
  start: number;
  end: number;
  text: string;
}

export interface LyricVisit {
  /** Index into the sheet. */
  section: number;
  label: string;
  /** First and last matched sung word, in seconds. */
  start: number;
  end: number;
  /** Distinct sheet words heard in this pass. */
  matched: number;
  confidence: number;
}

const KNOWN = "verse|chorus|pre[- ]?chorus|prechorus|bridge|intro|outro|tag|interlude|instrumental|refrain|ending|turnaround|vamp|hook|coda|break|post[- ]?chorus|channel|solo";
// "Verse 1", "CHORUS:", "Pre-Chorus 2 (x2)" on a line of their own.
const BARE_LABEL = new RegExp(`^(?:${KNOWN})(?:\\s*\\d+)?\\s*(?:\\(?\\s*x\\s*\\d+\\s*\\)?)?\\s*:?$`, "i");
const BRACKET = /^\s*[[{(]\s*([^\]})]+?)\s*[\]})]\s*:?\s*$/;
const REPEAT_MARK = /\(?\s*(?:x\s*\d+|\d+\s*x|repeat)\s*\)?/gi;

/** Lowercase letters and digits only, accents stripped: "Lord's" → "lords". */
export function normWord(w: string): string {
  return w
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

const splitWords = (line: string) =>
  line
    .replace(REPEAT_MARK, " ")
    .split(/[\s\-–—/]+/)
    .map(normWord)
    .filter(Boolean);

function cleanLabel(raw: string): string {
  const s = raw.replace(REPEAT_MARK, "").replace(/[:\s]+$/, "").replace(/\s+/g, " ").trim();
  // "VERSE 1" → "Verse 1", but keep "Pre-Chorus" style casing when it's mixed already.
  return s === s.toUpperCase() || s === s.toLowerCase() ? s.toLowerCase().replace(/(^|[\s-])([a-z])/g, (_, a, b) => a + b.toUpperCase()) : s;
}

const baseLabel = (label: string) => label.toLowerCase().replace(/[\d.:()]+/g, "").replace(/\s+/g, " ").trim();

/**
 * Reads a lyric sheet: section names in brackets ([Verse 1]) or alone on a line
 * (Chorus, VERSE 2:). A name with no lines under it that was used earlier, like a
 * second [Chorus], repeats that section's words. Text before any name is "Verse".
 */
export function parseLyrics(text: string): LyricSection[] {
  const sections: LyricSection[] = [];
  let current: LyricSection | null = null;
  for (const raw of text.replace(/\r\n?/g, "\n").split("\n")) {
    const line = raw.trim();
    if (!line) continue;
    const bracket = BRACKET.exec(line);
    const isLabel = bracket ? !/\s{2,}/.test(bracket[1]) && bracket[1].length <= 40 && /[a-z]/i.test(bracket[1]) && (BARE_LABEL.test(bracket[1].trim()) || line.startsWith("[")) : BARE_LABEL.test(line);
    if (isLabel) {
      current = { label: cleanLabel(bracket ? bracket[1] : line), words: [], lineStarts: [] };
      sections.push(current);
      continue;
    }
    const words = splitWords(line);
    if (!words.length) continue;
    if (!current) {
      current = { label: "Verse", words: [], lineStarts: [] };
      sections.push(current);
    }
    current.lineStarts.push(current.words.length);
    current.words.push(...words);
  }
  // A repeated name with no words of its own sings the earlier section again.
  for (const s of sections) {
    if (s.words.length) continue;
    const same = sections.find((o) => o !== s && o.words.length && o.label.toLowerCase() === s.label.toLowerCase());
    if (same) {
      s.words = same.words;
      s.lineStarts = same.lineStarts;
    }
  }
  return sections;
}

/** Distinct lines, for priming the speech model with the song's vocabulary. */
export function lyricsPrompt(sections: LyricSection[], max = 800): string {
  const seen = new Set<string>();
  const lines: string[] = [];
  for (const s of sections) {
    s.lineStarts.forEach((from, i) => {
      const line = s.words.slice(from, s.lineStarts[i + 1] ?? s.words.length).join(" ");
      if (!seen.has(line)) {
        seen.add(line);
        lines.push(line);
      }
    });
  }
  let out = "";
  for (const l of lines) {
    if (out.length + l.length + 2 > max) break;
    out += (out ? ". " : "") + l;
  }
  return out;
}

function similarity(a: string, b: string): number {
  if (a === b) return 1;
  if (!a || !b) return 0;
  const n = a.length;
  const m = b.length;
  let prev = Array.from({ length: m + 1 }, (_, j) => j);
  for (let i = 1; i <= n; i++) {
    const cur = [i];
    for (let j = 1; j <= m; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return 1 - prev[m] / Math.max(n, m);
}

// Scores for the alignment. A heard word that matches its sheet word earns up to
// +2; a wrong word costs more than calling it noise (an ad-lib or a mishearing).
const NOISE = 0.6;
const ENTER_NOISE = 0.4;
const RESUME = 0.3;
const SKIP = 0.8;
const STAY = 1.2;
const LINE_JUMP = 2.5;
const ORDER = 1.5;
const CUT_SHORT = 2;
const MATCH = 0.75;

const matchScore = (sim: number) => (sim >= MATCH ? 2 * sim : sim >= 0.5 ? -0.3 : -1.2);

/**
 * Lines the heard words up with the sheet. Singers follow the sheet's order but may
 * repeat any section (a chorus three times), repeat or skip a line, and add words
 * the sheet doesn't have. Returns each pass through a section, in time order.
 */
export function alignLyrics(sheet: LyricSection[], heard: TimedWord[]): LyricVisit[] {
  const sections = sheet.map((s, i) => ({ ...s, index: i })).filter((s) => s.words.length);
  const words = heard.map((w) => ({ ...w, norm: normWord(w.text) })).filter((w) => w.norm);
  if (!sections.length || !words.length) return [];

  // Flatten the sheet into positions.
  const pos: { sec: number; at: number; lineStart: boolean; word: string }[] = [];
  const first: number[] = [];
  for (let k = 0; k < sections.length; k++) {
    const s = sections[k];
    first.push(pos.length);
    s.words.forEach((w, at) => pos.push({ sec: k, at, lineStart: s.lineStarts.includes(at), word: w }));
  }
  const N = pos.length;
  const S = sections.length;
  const lenOf = (k: number) => sections[k].words.length;
  const F0 = 2 * N; // noise before the first sung word
  const STATES = 2 * N + 1; // A[p] = p (sung at p), F[p] = N + p (noise after p)

  const sims = new Map<string, number>();
  const sim = (a: string, b: string) => {
    const key = a < b ? `${a}|${b}` : `${b}|${a}`;
    let v = sims.get(key);
    if (v === undefined) sims.set(key, (v = similarity(a, b)));
    return v;
  };

  let score = new Float64Array(STATES).fill(-Infinity);
  const back: Int32Array[] = [];
  const startCost = (k: number) => (k === 0 ? 0 : ORDER);
  {
    const b = new Int32Array(STATES).fill(-1);
    for (let k = 0; k < S; k++) {
      for (let d = 0; d < 3 && d < lenOf(k); d++) {
        const p = first[k] + d;
        score[p] = -startCost(k) - d * SKIP + matchScore(sim(pos[p].word, words[0].norm));
      }
    }
    score[F0] = -NOISE;
    back.push(b);
  }

  for (let j = 1; j < words.length; j++) {
    const w = words[j].norm;
    const gap = words[j].start - words[j - 1].end;
    const next = new Float64Array(STATES).fill(-Infinity);
    const from = new Int32Array(STATES).fill(-1);
    const offer = (to: number, prev: number, v: number) => {
      if (v > next[to]) {
        next[to] = v;
        from[to] = prev;
      }
    };

    // Best way to have just finished (or abandoned) a pass through each section.
    const leave = new Float64Array(S).fill(-Infinity);
    const leaveFrom = new Int32Array(S).fill(-1);
    let leaveAll = score[F0] - (gap > 2.5 ? 0 : 0.5);
    let leaveAllFrom = F0;
    for (let p = 0; p < N; p++) {
      const left = lenOf(pos[p].sec) - 1 - pos[p].at;
      const cost = left <= 2 ? 0 : CUT_SHORT + 0.05 * left;
      for (const st of [p, N + p]) {
        const v = score[st] - cost;
        if (v > leave[pos[p].sec]) {
          leave[pos[p].sec] = v;
          leaveFrom[pos[p].sec] = st;
        }
        if (v > leaveAll) {
          leaveAll = v;
          leaveAllFrom = st;
        }
      }
    }
    // A long silence is where sections usually change.
    const pause = gap > 2.5 ? 0.7 : 0;

    for (let p = 0; p < N; p++) {
      const { sec, at, lineStart } = pos[p];
      const m = matchScore(sim(pos[p].word, w));
      if (at > 0) {
        offer(p, p - 1, score[p - 1] + m);
        offer(p, N + p - 1, score[N + p - 1] - RESUME + m);
      }
      for (let d = 2; d <= 3 && at - d >= 0; d++) offer(p, p - d, score[p - d] - (d - 1) * SKIP + m);
      offer(p, p, score[p] - STAY + m);
      // Back to the start of a line in the same pass (a repeated line), or on past a skipped one.
      if (lineStart && at > 0) {
        for (let q = first[sec]; q < first[sec] + lenOf(sec); q++) {
          if (q === p - 1) continue;
          offer(p, q, score[q] - LINE_JUMP + m);
          offer(p, N + q, score[N + q] - LINE_JUMP + m);
        }
      }
      // A new pass: the start of any section, preferably the next one on the sheet.
      if (at < 3) {
        const skip = at * SKIP;
        if (sec > 0 && leaveFrom[sec - 1] >= 0) offer(p, leaveFrom[sec - 1], leave[sec - 1] + pause - skip + m);
        if (leaveAllFrom >= 0) offer(p, leaveAllFrom, leaveAll - ORDER + pause - skip + m);
      }
      offer(N + p, p, score[p] - ENTER_NOISE);
      offer(N + p, N + p, score[N + p] - NOISE);
    }
    offer(F0, F0, score[F0] - NOISE);
    back.push(from);
    score = next;
  }

  // Trace the best path back.
  let state = 0;
  for (let s = 1; s < STATES; s++) if (score[s] > score[state]) state = s;
  const path = new Int32Array(words.length);
  for (let j = words.length - 1; j >= 0; j--) {
    path[j] = state;
    state = back[j][state];
  }

  // Cut the path into passes: a new one starts on entering a section at its top.
  const visits: LyricVisit[] = [];
  let open: { sec: number; start: number; end: number; seen: Set<number>; lastAt: number } | null = null;
  const close = () => {
    if (!open || !open.seen.size) return;
    const s = sections[open.sec];
    visits.push({
      section: s.index,
      label: s.label,
      start: open.start,
      end: open.end,
      matched: open.seen.size,
      confidence: Math.min(1, open.seen.size / s.words.length),
    });
  };
  for (let j = 0; j < words.length; j++) {
    const st = path[j];
    if (st === F0) continue;
    const p = st < N ? st : st - N;
    const { sec, at } = pos[p];
    const sung = st < N;
    // Back to the top after a pause is the section again; straight on (a one-line tag
    // sung three times) is the same pass.
    const again = sung && at < 3 && open !== null && open.lastAt >= at + 3 && j > 0 && words[j].start - words[j - 1].end > 2.5;
    const fresh = !open || open.sec !== sec || again;
    if (fresh && sung) {
      close();
      open = { sec, start: Infinity, end: 0, seen: new Set(), lastAt: at };
    }
    if (!open || !sung) continue;
    open.lastAt = at;
    if (sim(pos[p].word, words[j].norm) >= MATCH) {
      open.seen.add(at);
      open.start = Math.min(open.start, words[j].start);
      open.end = Math.max(open.end, words[j].end);
    }
  }
  close();
  return visits;
}

/** A pass heard clearly enough to name a section by. */
export const confidentVisit = (v: LyricVisit) => v.matched >= 3 && v.confidence >= 0.35;

export interface LyricSectionInput {
  /** Start time of each bar, plus the end of the last one (bars + 1 entries). */
  barStarts: number[];
  /** Coarse chords of each bar, for matching unclear parts to clear ones. */
  barSigs: string[];
  /** Seconds per beat. */
  beat: number;
  sheet: LyricSection[];
  visits: LyricVisit[];
  /** Start times of every heard word, to tell sung parts from instrumental ones. */
  wordTimes: number[];
  /** Sections found from chord patterns alone: first bar of each and its name. */
  chordSections: { from: number; label: string }[];
}

export interface BarSection {
  label: string;
  /** The sheet section it was named after, if any. */
  sheet?: number;
  /** First bar, and one past the last. */
  from: number;
  to: number;
}

/**
 * Turns the clear passes into bar ranges with names. Gaps between them are named from
 * the sheet (an unheard verse between two heard sections, or an [Interlude]), from
 * matching chords, or else from the chord-pattern sections. Null if the lyrics hardly
 * matched, so the caller keeps the chord-pattern sections.
 */
export function sectionsFromLyrics(input: LyricSectionInput): BarSection[] | null {
  const { barStarts, barSigs, beat, sheet, wordTimes, chordSections } = input;
  const bars = barStarts.length - 1;
  if (bars < 1) return null;
  const visits = input.visits.filter(confidentVisit).sort((a, b) => a.start - b.start);
  const sheetWords = new Set(sheet.filter((s) => s.words.length).map((s) => s.label.toLowerCase())).size;
  const heardSections = new Set(visits.map((v) => v.label.toLowerCase())).size;
  if (!visits.length || heardSections < Math.max(1, Math.ceil(sheetWords * 0.4))) return null;

  const barAt = (t: number) => {
    let b = 0;
    while (b + 1 < bars && barStarts[b + 1] <= t) b++;
    return b;
  };
  const chordStarts = chordSections.map((c) => c.from);

  // Where each pass starts: the bar its first word falls in, or the next one when the
  // word is a pickup in the last beat and a half before it. Then onto a chord-pattern
  // boundary if one is a bar away, since those sit on the downbeat of a progression.
  type Placed = { visit: LyricVisit; from: number; sungTo: number };
  const placed: Placed[] = [];
  for (const v of visits) {
    let from = barAt(v.start + 1.5 * beat);
    const near = chordStarts.find((c) => Math.abs(c - from) === 1);
    if (near !== undefined && !chordStarts.includes(from)) from = near;
    const prev = placed[placed.length - 1];
    if (prev && from <= prev.from) {
      // Two passes in the same bar: keep the one heard more clearly.
      if (v.matched > prev.visit.matched) placed.pop();
      else continue;
      if (placed.length && from <= placed[placed.length - 1].from) continue;
    }
    placed.push({ visit: v, from, sungTo: Math.min(bars, barAt(v.end) + 1) });
  }
  if (!placed.length) return null;

  const out: BarSection[] = [];
  const sigOf = (from: number, to: number) => barSigs.slice(from, to);
  const sungIn = (from: number, to: number) => wordTimes.filter((t) => t >= barStarts[from] && t < barStarts[to]).length;
  const chordLabelAt = (bar: number) => {
    let label = chordSections[0]?.label ?? "Section";
    for (const c of chordSections) if (c.from <= bar) label = c.label;
    return label;
  };
  const sameChords = (from: number, to: number) => {
    let best: { label: string; sim: number } | null = null;
    for (let k = 0; k < placed.length; k++) {
      const p = placed[k];
      const end = placed[k + 1]?.from ?? bars;
      const a = sigOf(from, to);
      const b = sigOf(p.from, end);
      const n = Math.min(a.length, b.length);
      if (n < 2) continue;
      let same = 0;
      for (let i = 0; i < n; i++) if (a[i] === b[i]) same++;
      const s = same / Math.max(a.length, b.length);
      if (s >= 0.7 && (!best || s > best.sim)) best = { label: p.visit.label, sim: s };
    }
    return best?.label;
  };
  // Sheet sections between two heard ones, in sheet order.
  const between = (after: number, before: number, sung: boolean) =>
    sheet.findIndex((s, i) => i > after && i < before && (sung ? s.words.length > 0 : s.words.length === 0));

  const gapSection = (from: number, to: number, after: number, before: number, where: "start" | "middle" | "end"): BarSection => {
    const sung = sungIn(from, to) >= 4;
    // Only placeholders outside all the sung sheet sections name the ends of the song.
    const sungSheet = sheet.map((s, i) => (s.words.length ? i : -1)).filter((i) => i >= 0);
    const k = sung
      ? between(after, before, true)
      : where === "start"
        ? between(-1, sungSheet[0], false)
        : where === "end"
          ? between(sungSheet[sungSheet.length - 1], sheet.length, false)
          : between(after, before, false);
    if (k >= 0) return { label: sheet[k].label, sheet: k, from, to };
    const label = sung
      ? sameChords(from, to) ?? chordLabelAt(from)
      : where === "start" ? "Intro" : where === "end" ? "Outro" : sameChords(from, to) ?? "Instrumental";
    return { label, from, to };
  };

  // Before the first sung section.
  if (placed[0].from > 0) out.push(gapSection(0, placed[0].from, -1, placed[0].visit.section, "start"));
  placed.forEach((p, k) => {
    const next = placed[k + 1];
    const end = next?.from ?? bars;
    // A held last chord or a short fill stays with the section; four bars or more of
    // something else (two at the end of the song) is a section of its own.
    const tail = Math.min(end, Math.max(p.sungTo + 1, p.from + 1));
    const gap = end - tail;
    const split = next ? gap >= 4 : gap >= 2;
    out.push({ label: p.visit.label, sheet: p.visit.section, from: p.from, to: split ? tail : end });
    if (split) out.push(gapSection(tail, end, p.visit.section, next ? next.visit.section : sheet.length, next ? "middle" : "end"));
  });
  return numberRepeats(out, sheet);
}

/**
 * Sheets that call two different sections plain "Verse" get "Verse 1" and "Verse 2",
 * numbered in sheet order; the same section sung again keeps its number.
 */
function numberRepeats(out: BarSection[], sheet: LyricSection[]): BarSection[] {
  const groups = new Map<string, string[]>();
  for (const s of sheet) {
    if (!s.words.length || /\d/.test(s.label)) continue;
    const key = baseLabel(s.label);
    const list = groups.get(key) ?? [];
    const words = s.words.join(" ");
    if (!list.includes(words)) list.push(words);
    groups.set(key, list);
  }
  return out.map((o) => {
    if (o.sheet === undefined || /\d/.test(o.label)) return o;
    const list = groups.get(baseLabel(o.label));
    if (!list || list.length < 2) return o;
    return { ...o, label: `${o.label} ${list.indexOf(sheet[o.sheet].words.join(" ")) + 1}` };
  });
}
