import type { SetlistInput, SongInput } from "./db";
import type { Stroke, StrumPattern } from "./music/strum";
import { parseKey } from "./music/chords";
import { youtubeId } from "./youtube";

const str = (v: unknown, max: number) => (typeof v === "string" ? v.slice(0, max) : "");
const int = (v: unknown, lo: number, hi: number, fallback: number) => {
  const n = typeof v === "number" ? Math.round(v) : Number.parseInt(String(v ?? ""), 10);
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : fallback;
};

const STROKES = new Set(["D", "U", "x", "-"]);

function lane(v: unknown, steps: number): number[] {
  const arr = Array.isArray(v) ? v : [];
  return Array.from({ length: steps }, (_, i) => {
    const n = Number(arr[i]);
    return Number.isFinite(n) ? Math.min(1, Math.max(0, Math.round(n * 100) / 100)) : 0;
  });
}

function pattern(v: unknown): StrumPattern | null {
  if (!v || typeof v !== "object") return null;
  const p = v as Record<string, unknown>;
  const g = (p.groove ?? {}) as Record<string, unknown>;
  const steps = int(g.steps, 2, 24, 8);
  const strokes = Array.isArray(p.strokes) ? p.strokes : [];
  const accents = Array.isArray(p.accents) ? p.accents : [];
  return {
    name: str(p.name, 60) || "Pattern",
    groove: { steps, kick: lane(g.kick, steps), snare: lane(g.snare, steps), hat: lane(g.hat, steps) },
    strokes: Array.from({ length: steps }, (_, i) => (STROKES.has(strokes[i] as string) ? (strokes[i] as Stroke) : "-")),
    accents: Array.from({ length: steps }, (_, i) => accents[i] === true),
    sparse: p.sparse === true || undefined,
  };
}

export function songInput(body: unknown): { ok: true; value: SongInput } | { ok: false; error: string } {
  const b = (body ?? {}) as Record<string, unknown>;
  const title = str(b.title, 200).trim();
  if (!title) return { ok: false, error: "Give the song a title." };
  const youtubeUrl = str(b.youtubeUrl, 500).trim();
  if (youtubeUrl && !youtubeId(youtubeUrl)) return { ok: false, error: "That doesn't look like a YouTube link." };
  const originalKey = str(b.originalKey, 4).trim() || "G";
  if (!parseKey(originalKey)) return { ok: false, error: `"${originalKey}" isn't a key I know. Try something like G, Bb or F#m.` };
  const beatsPerBar = int(b.beatsPerBar, 2, 12, 4);
  const timings = (Array.isArray(b.timings) ? b.timings : []).slice(0, 5000).map((t) => {
    const n = Number(t);
    return t === null || !Number.isFinite(n) ? null : Math.round(n * 1000) / 1000;
  });
  const patterns: Record<string, StrumPattern> = {};
  if (b.patterns && typeof b.patterns === "object") {
    for (const [k, v] of Object.entries(b.patterns as Record<string, unknown>).slice(0, 30)) {
      const p = pattern(v);
      if (p) patterns[k.slice(0, 40)] = p;
    }
  }
  return {
    ok: true,
    value: {
      title,
      artist: str(b.artist, 200).trim(),
      youtubeUrl,
      spotifyUrl: str(b.spotifyUrl, 500).trim(),
      originalKey,
      bpm: int(b.bpm, 0, 300, 0),
      beatsPerBar,
      chart: str(b.chart, 50_000),
      timings,
      patterns,
      notes: str(b.notes, 5000),
    },
  };
}

export function setlistInput(body: unknown): { ok: true; value: SetlistInput } | { ok: false; error: string } {
  const b = (body ?? {}) as Record<string, unknown>;
  const name = str(b.name, 200).trim();
  if (!name) return { ok: false, error: "Give the setlist a name." };
  const items = (Array.isArray(b.items) ? b.items : []).slice(0, 100).flatMap((it) => {
    const o = (it ?? {}) as Record<string, unknown>;
    const songId = str(o.songId, 40);
    if (!songId) return [];
    const key = str(o.key, 4).trim();
    return [key && parseKey(key) ? { songId, key } : { songId }];
  });
  return { ok: true, value: { name, description: str(b.description, 2000).trim(), items } };
}
