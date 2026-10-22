import "server-only";
import { Pool } from "pg";
import type { StrumPattern } from "./music/strum";

// One pool per server process. Neon needs SSL; its connection strings include
// ?sslmode=require, which pg reads from the URL.
const globalForDb = globalThis as unknown as { pool?: Pool; schemaReady?: Promise<void> };

function pool(): Pool {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is not set. Add your Neon connection string to the environment.");
  }
  globalForDb.pool ??= new Pool({ connectionString: process.env.DATABASE_URL, max: 5 });
  return globalForDb.pool;
}

const SCHEMA = `
create table if not exists songs (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  artist text not null default '',
  youtube_url text not null default '',
  spotify_url text not null default '',
  original_key text not null default 'G',
  bpm integer not null default 0,
  beats_per_bar integer not null default 4,
  chart text not null default '',
  timings jsonb not null default '[]'::jsonb,
  patterns jsonb not null default '{}'::jsonb,
  notes text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table if not exists setlists (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text not null default '',
  items jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
`;

async function ready(): Promise<Pool> {
  const p = pool();
  globalForDb.schemaReady ??= p.query(SCHEMA).then(() => undefined);
  try {
    await globalForDb.schemaReady;
  } catch (e) {
    globalForDb.schemaReady = undefined;
    throw e;
  }
  return p;
}

export interface Song {
  id: string;
  title: string;
  artist: string;
  youtubeUrl: string;
  spotifyUrl: string;
  originalKey: string;
  bpm: number;
  beatsPerBar: number;
  chart: string;
  timings: (number | null)[];
  /** Strum pattern per section kind ("verse", "chorus"); "default" applies to the rest. */
  patterns: Record<string, StrumPattern>;
  notes: string;
  updatedAt: string;
}

export type SongInput = Omit<Song, "id" | "updatedAt">;

export interface SetlistItem {
  songId: string;
  /** Key the band plays it in, if different from the song's original key. */
  key?: string;
}

export interface Setlist {
  id: string;
  name: string;
  description: string;
  items: SetlistItem[];
  updatedAt: string;
}

export type SetlistInput = Omit<Setlist, "id" | "updatedAt">;

type Row = Record<string, unknown>;

function toSong(r: Row): Song {
  return {
    id: r.id as string,
    title: r.title as string,
    artist: r.artist as string,
    youtubeUrl: r.youtube_url as string,
    spotifyUrl: r.spotify_url as string,
    originalKey: r.original_key as string,
    bpm: r.bpm as number,
    beatsPerBar: r.beats_per_bar as number,
    chart: r.chart as string,
    timings: (r.timings as (number | null)[]) ?? [],
    patterns: (r.patterns as Record<string, StrumPattern>) ?? {},
    notes: r.notes as string,
    updatedAt: new Date(r.updated_at as string).toISOString(),
  };
}

function toSetlist(r: Row): Setlist {
  return {
    id: r.id as string,
    name: r.name as string,
    description: r.description as string,
    items: (r.items as SetlistItem[]) ?? [],
    updatedAt: new Date(r.updated_at as string).toISOString(),
  };
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isId = (s: string) => UUID_RE.test(s);

export interface SongSummary {
  id: string;
  title: string;
  artist: string;
  originalKey: string;
  bpm: number;
  youtubeUrl: string;
  hasChart: boolean;
  updatedAt: string;
}

export async function listSongs(): Promise<SongSummary[]> {
  const db = await ready();
  const { rows } = await db.query(
    "select id, title, artist, original_key, bpm, youtube_url, length(chart) > 0 as has_chart, updated_at from songs order by lower(title)",
  );
  return rows.map((r) => ({
    id: r.id,
    title: r.title,
    artist: r.artist,
    originalKey: r.original_key,
    bpm: r.bpm,
    youtubeUrl: r.youtube_url,
    hasChart: r.has_chart,
    updatedAt: new Date(r.updated_at).toISOString(),
  }));
}

export async function getSong(id: string): Promise<Song | null> {
  if (!isId(id)) return null;
  const db = await ready();
  const { rows } = await db.query("select * from songs where id = $1", [id]);
  return rows[0] ? toSong(rows[0]) : null;
}

export async function getSongs(ids: string[]): Promise<Song[]> {
  const valid = ids.filter(isId);
  if (!valid.length) return [];
  const db = await ready();
  const { rows } = await db.query("select * from songs where id = any($1::uuid[])", [valid]);
  return rows.map(toSong);
}

export async function createSong(s: SongInput): Promise<Song> {
  const db = await ready();
  const { rows } = await db.query(
    `insert into songs (title, artist, youtube_url, spotify_url, original_key, bpm, beats_per_bar, chart, timings, patterns, notes)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) returning *`,
    [s.title, s.artist, s.youtubeUrl, s.spotifyUrl, s.originalKey, s.bpm, s.beatsPerBar, s.chart, JSON.stringify(s.timings), JSON.stringify(s.patterns), s.notes],
  );
  return toSong(rows[0]);
}

export async function updateSong(id: string, s: SongInput): Promise<Song | null> {
  if (!isId(id)) return null;
  const db = await ready();
  const { rows } = await db.query(
    `update songs set title=$2, artist=$3, youtube_url=$4, spotify_url=$5, original_key=$6, bpm=$7, beats_per_bar=$8,
       chart=$9, timings=$10, patterns=$11, notes=$12, updated_at=now() where id=$1 returning *`,
    [id, s.title, s.artist, s.youtubeUrl, s.spotifyUrl, s.originalKey, s.bpm, s.beatsPerBar, s.chart, JSON.stringify(s.timings), JSON.stringify(s.patterns), s.notes],
  );
  return rows[0] ? toSong(rows[0]) : null;
}

export async function deleteSong(id: string): Promise<boolean> {
  if (!isId(id)) return false;
  const db = await ready();
  const { rowCount } = await db.query("delete from songs where id = $1", [id]);
  return (rowCount ?? 0) > 0;
}

export async function listSetlists(): Promise<Setlist[]> {
  const db = await ready();
  const { rows } = await db.query("select * from setlists order by updated_at desc");
  return rows.map(toSetlist);
}

export async function getSetlist(id: string): Promise<Setlist | null> {
  if (!isId(id)) return null;
  const db = await ready();
  const { rows } = await db.query("select * from setlists where id = $1", [id]);
  return rows[0] ? toSetlist(rows[0]) : null;
}

export async function createSetlist(s: SetlistInput): Promise<Setlist> {
  const db = await ready();
  const { rows } = await db.query(
    "insert into setlists (name, description, items) values ($1,$2,$3) returning *",
    [s.name, s.description, JSON.stringify(s.items)],
  );
  return toSetlist(rows[0]);
}

export async function updateSetlist(id: string, s: SetlistInput): Promise<Setlist | null> {
  if (!isId(id)) return null;
  const db = await ready();
  const { rows } = await db.query(
    "update setlists set name=$2, description=$3, items=$4, updated_at=now() where id=$1 returning *",
    [id, s.name, s.description, JSON.stringify(s.items)],
  );
  return rows[0] ? toSetlist(rows[0]) : null;
}

export async function deleteSetlist(id: string): Promise<boolean> {
  if (!isId(id)) return false;
  const db = await ready();
  const { rowCount } = await db.query("delete from setlists where id = $1", [id]);
  return (rowCount ?? 0) > 0;
}
