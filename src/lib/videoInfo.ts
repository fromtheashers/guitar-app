// Works out song details from what a YouTube page says about a video. Pure, so it
// can be tested without the network; videoFetch.ts gathers the raw inputs.

import { keyName, parseKey } from "./music/chords";

export interface VideoFacts {
  /** The video's title as shown on YouTube. */
  title: string;
  /** Channel name. */
  channel: string;
  description?: string;
  /** From YouTube's "Music" section, when the page has one. */
  music?: { song?: string; artist?: string };
  lengthSeconds?: number;
}

export interface SongGuess {
  title?: string;
  artist?: string;
  spotifyUrl?: string;
  key?: string;
  bpm?: number;
  beatsPerBar?: number;
}

// Bracketed or trailing extras that aren't part of a song's name.
const NOISE =
  /\b(official|music|lyric|lyrics|video|audio|visuali[sz]er|live|acoustic|session|performance|hd|4k|mv|chords?|tutorial|cover|feat\.?|ft\.?|featuring|with|version|edit|remastered|worship|moment|sing-?along)\b/i;

export function cleanTitle(t: string): string {
  let s = t;
  // Drop (...) and [...] groups that only hold extras like "(Official Video)" or "[Live]".
  s = s.replace(/\s*[([]([^)\]]*)[)\]]/g, (whole, inner: string) => (NOISE.test(inner) ? "" : whole));
  // Drop trailing "ft. Someone" or "feat. Someone".
  s = s.replace(/\s+(ft\.?|feat\.?|featuring)\s+.*$/i, "");
  return s.replace(/\s{2,}/g, " ").replace(/[\s\-–—|:,]+$/, "").trim();
}

function cleanChannel(c: string): string {
  return c
    .replace(/\s*-\s*Topic$/i, "")
    .replace(/VEVO$/i, "")
    .replace(/\s+(official|official channel|tv|channel)$/i, "")
    .trim();
}

/** "Live", "Official Music Video": a part made only of extras. */
function onlyNoise(s: string): boolean {
  return s.split(/\s+/).every((w) => NOISE.test(w));
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

/** True when two names plausibly refer to the same artist ("Bethel Music" vs "BethelMusicTV"). */
function sameArtist(a: string, b: string): boolean {
  const x = norm(a);
  const y = norm(b);
  if (!x || !y) return false;
  return x === y || (x.length >= 4 && y.includes(x)) || (y.length >= 4 && x.includes(y));
}

export function guessSong(f: VideoFacts): SongGuess {
  const out: SongGuess = {};
  const channel = cleanChannel(f.channel);

  if (f.music?.song) out.title = cleanTitle(f.music.song);
  if (f.music?.artist) out.artist = f.music.artist.trim();

  if (!out.title || !out.artist) {
    const fromTitle = splitTitle(f.title, channel, /-\s*Topic$/i.test(f.channel));
    out.title ??= fromTitle.title;
    out.artist ??= fromTitle.artist;
  }

  if (f.description) Object.assign(out, fromDescription(f.description));
  for (const k of Object.keys(out) as (keyof SongGuess)[]) if (out[k] === "" || out[k] === undefined) delete out[k];
  return out;
}

function splitTitle(raw: string, channel: string, topic: boolean): { title?: string; artist?: string } {
  // "Artist - Topic" channels carry the plain song name as the title.
  if (topic) return { title: cleanTitle(raw), artist: channel || undefined };

  // "Graves Into Gardens | Live | Elevation Worship": the song comes first; a part that
  // names the channel, or the last meaningful part, is the artist.
  if (raw.includes("|")) {
    const parts = raw.split("|").map(cleanTitle).filter((p) => p && !onlyNoise(p));
    const title = parts[0];
    const artist = parts.slice(1).find((p) => sameArtist(p, channel)) ?? (parts.length > 1 ? parts[parts.length - 1] : undefined);
    return { title, artist: artist && artist !== title ? artist : channel || undefined };
  }

  // "Artist - Song" is the usual order; trust the channel name when it says otherwise.
  const dash = raw.split(/\s+[-–—]\s+/);
  if (dash.length >= 2) {
    const left = cleanTitle(dash[0]);
    const right = cleanTitle(dash.slice(1).join(" - "));
    if (sameArtist(right, channel) && !sameArtist(left, channel)) return { title: left, artist: right };
    return { title: right, artist: left };
  }

  // 'Hillsong UNITED "Oceans"' style.
  const quoted = /^(.+?)\s*["“](.+?)["”]/.exec(raw);
  if (quoted) return { title: cleanTitle(quoted[2]), artist: quoted[1].trim() };

  return { title: cleanTitle(raw), artist: channel || undefined };
}

function fromDescription(d: string): SongGuess {
  const out: SongGuess = {};
  const spotify = /https?:\/\/open\.spotify\.com\/(?:intl-[a-z]+\/)?track\/[A-Za-z0-9]+/.exec(d);
  if (spotify) out.spotifyUrl = spotify[0];

  // "Key: G", "Key of Bb", "Original key - E", "Key: F#m"
  const key = /\bkey(?:\s+of)?\s*[:\-–]?\s*([A-G](?:#|b|♯|♭)?)\s*(m(?:in(?:or)?)?\b)?/i.exec(d);
  if (key) {
    const name = key[1].replace("♯", "#").replace("♭", "b") + (key[2] ? "m" : "");
    const parsed = parseKey(name);
    if (parsed) out.key = keyName(parsed);
  }

  // "BPM: 72", "72 BPM", "Tempo - 136"
  const bpm = /\b(?:bpm|tempo)\s*[:\-–]?\s*(\d{2,3})\b|\b(\d{2,3})\s*bpm\b/i.exec(d);
  if (bpm) {
    const n = Number(bpm[1] ?? bpm[2]);
    if (n >= 40 && n <= 220) out.bpm = n;
  }

  // "Time signature: 6/8", "Time: 3/4"
  const ts = /\btime(?:\s+signature)?\s*[:\-–]?\s*([346])\/([48])\b/i.exec(d);
  if (ts) out.beatsPerBar = Number(ts[1]);
  return out;
}

/** Pulls `var NAME = {...};` out of the page and parses it. */
export function embeddedJson(html: string, name: string): unknown {
  const at = html.search(new RegExp(`(?:var |window\\["|window\\.)${name}"?\\]?\\s*=\\s*\\{`));
  if (at < 0) return null;
  const start = html.indexOf("{", at);
  // Scan to the matching brace, skipping strings.
  let depth = 0;
  let inString = false;
  for (let i = start; i < html.length; i++) {
    const c = html[i];
    if (inString) {
      if (c === "\\") i++;
      else if (c === '"') inString = false;
    } else if (c === '"') inString = true;
    else if (c === "{") depth++;
    else if (c === "}" && --depth === 0) {
      try {
        return JSON.parse(html.slice(start, i + 1));
      } catch {
        return null;
      }
    }
  }
  return null;
}

type Node = Record<string, unknown>;

const text = (v: unknown): string | undefined => {
  if (typeof v === "string") return v;
  const n = v as Node | undefined;
  if (!n) return undefined;
  if (typeof n.content === "string") return n.content;
  if (typeof n.simpleText === "string") return n.simpleText;
  if (Array.isArray(n.runs)) return n.runs.map((r: Node) => r.text).join("");
  return undefined;
};

/** Song and artist from the description's "Music" card, in either of YouTube's layouts. */
export function musicSection(data: unknown): { song?: string; artist?: string } | null {
  let found: { song?: string; artist?: string } | null = null;
  const rows: Record<string, string> = {};
  const walk = (v: unknown, depth: number) => {
    if (found || depth > 40 || !v || typeof v !== "object") return;
    if (Array.isArray(v)) {
      for (const x of v) walk(x, depth + 1);
      return;
    }
    const n = v as Node;
    // Current layout: a card with the song as title and the artist as subtitle.
    const card = n.videoAttributeViewModel as Node | undefined;
    if (card) {
      const song = text(card.title);
      if (song) {
        found = { song, artist: text(card.subtitle) };
        return;
      }
    }
    // Older layout: rows labelled SONG and ARTIST.
    const row = n.infoRowRenderer as Node | undefined;
    if (row) {
      const label = text(row.title)?.trim().toLowerCase();
      const value = text(row.defaultMetadata) ?? text(row.expandedMetadata);
      if (label && value && !(label in rows)) rows[label] = value;
    }
    for (const k in n) walk(n[k], depth + 1);
  };
  walk(data, 0);
  if (found) return found;
  if (rows.song || rows.artist) return { song: rows.song, artist: rows.artist };
  return null;
}
