"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import type { SongSummary } from "@/lib/db";
import styles from "./SongList.module.css";

export function SongList({ songs, hrefBase = "/songs/", title = "Songs" }: { songs: SongSummary[]; hrefBase?: string; title?: string }) {
  const [q, setQ] = useState("");
  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return songs;
    return songs.filter((s) => `${s.title} ${s.artist}`.toLowerCase().includes(needle));
  }, [songs, q]);

  return (
    <div className={styles.wrap}>
      <div className={styles.head}>
        {hrefBase === "/songs/" ? <h1>{title}</h1> : <h2>{title}</h2>}
        {songs.length > 6 && (
          <label className={styles.search}>
            <span className="visually-hidden">Search songs</span>
            <input className="input" type="search" placeholder="Search by title or artist" value={q} onChange={(e) => setQ(e.target.value)} />
          </label>
        )}
      </div>
      {songs.length === 0 ? (
        <div className={styles.empty}>
          <p>No songs yet.</p>
          {hrefBase === "/songs/" ? (
            <p className="muted">Your teacher adds songs from the Teacher page. They&apos;ll show up here.</p>
          ) : (
            <p className="muted">
              Press <strong>Add a song</strong>, paste a YouTube link, and let the app draft the chart while it plays.
            </p>
          )}
        </div>
      ) : shown.length === 0 ? (
        <p className="muted">No songs match &ldquo;{q}&rdquo;.</p>
      ) : (
        <ul className={styles.list}>
          {shown.map((s) => (
            <li key={s.id}>
              <Link href={hrefBase + s.id} className={styles.row}>
                <span className={styles.title}>{s.title}</span>
                <span className={styles.artist}>{s.artist}</span>
                <span className={styles.meta}>
                  <span className={styles.key}>{s.originalKey}</span>
                  {s.bpm > 0 && <span>{s.bpm} BPM</span>}
                  {!s.hasChart && <span className={styles.draft}>No chart yet</span>}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
