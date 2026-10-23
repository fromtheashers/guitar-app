"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import type { Setlist, SetlistInput, SongSummary } from "@/lib/db";
import { shareLink } from "@/lib/share";
import { ALL_KEYS, ALL_MINOR_KEYS } from "@/lib/songView";
import styles from "./SetlistEditor.module.css";

export function SetlistEditor({ setlist, songs }: { setlist?: Setlist; songs: SongSummary[] }) {
  const router = useRouter();
  const initial: SetlistInput = setlist
    ? { name: setlist.name, description: setlist.description, items: setlist.items }
    : { name: "", description: "", items: [] };
  const [draft, setDraft] = useState(initial);
  const [saved, setSaved] = useState(JSON.stringify(initial));
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const [search, setSearch] = useState("");
  const [shared, setShared] = useState<string | null>(null);
  const dirty = JSON.stringify(draft) !== saved;
  const byId = new Map(songs.map((s) => [s.id, s]));

  const setItems = (items: SetlistInput["items"]) => setDraft((d) => ({ ...d, items }));
  const move = (i: number, by: number) =>
    setDraft((d) => {
      const items = [...d.items];
      const [it] = items.splice(i, 1);
      items.splice(i + by, 0, it);
      return { ...d, items };
    });

  // Drag a song by its handle to reorder. Row positions are measured once when the
  // drag starts, and the song moves whenever the finger passes a row's middle.
  const listRef = useRef<HTMLOListElement>(null);
  const drag = useRef<{ index: number; mids: number[] } | null>(null);
  const [dragging, setDragging] = useState<number | null>(null);
  const startDrag = (i: number, e: React.PointerEvent) => {
    const rows = listRef.current ? [...listRef.current.children] : [];
    drag.current = { index: i, mids: rows.map((r) => r.getBoundingClientRect()).map((r) => r.top + r.height / 2) };
    setDragging(i);
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const moveDrag = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    // The rows have moved since they were measured, but they're all the same height,
    // so slot k is still where row k was.
    let to = d.mids.findIndex((m) => e.clientY < m);
    if (to === -1) to = d.mids.length - 1;
    if (to !== d.index) {
      move(d.index, to - d.index);
      d.index = to;
      setDragging(to);
    }
  };
  const endDrag = () => {
    drag.current = null;
    setDragging(null);
  };

  const share = async () => {
    if (!setlist) return;
    const r = await shareLink(draft.name || "Setlist", `/setlists/${setlist.id}`);
    setShared(r === "copied" ? "Link copied. Paste it to your students." : r === "failed" ? "Couldn't share the link." : null);
  };

  const save = async () => {
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch(setlist ? `/api/setlists/${setlist.id}` : "/api/setlists", {
        method: setlist ? "PUT" : "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(draft),
      });
      const body = (await res.json().catch(() => ({}))) as Setlist & { error?: string };
      if (!res.ok) {
        setMessage({ kind: "error", text: body.error ?? "Couldn't save. Try again." });
        return;
      }
      setSaved(JSON.stringify(draft));
      setMessage({ kind: "ok", text: "Saved." });
      if (!setlist) router.replace(`/edit/setlists/${body.id}`);
      else router.refresh();
    } catch {
      setMessage({ kind: "error", text: "Couldn't reach the app. Your changes are still here; try again." });
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!setlist || !confirm(`Delete "${setlist.name}"? The songs stay; only the list goes.`)) return;
    const res = await fetch(`/api/setlists/${setlist.id}`, { method: "DELETE" });
    if (res.ok) {
      router.replace("/edit");
      router.refresh();
    } else setMessage({ kind: "error", text: "Couldn't delete the setlist." });
  };

  const available = songs.filter((s) => !draft.items.some((i) => i.songId === s.id));
  const q = search.trim().toLowerCase();
  const matches = q ? available.filter((s) => `${s.title} ${s.artist}`.toLowerCase().includes(q)) : available;

  return (
    <div className={styles.page}>
      <div className={styles.head}>
        <div>
          <Link href="/edit" className={styles.back}>
            Teacher
          </Link>
          <h1>{setlist ? draft.name || "Untitled setlist" : "New setlist"}</h1>
        </div>
        <div className={styles.actions}>
          {setlist && (
            <>
              <Link href={`/setlists/${setlist.id}`} className="btn btn-quiet">
                Open as student
              </Link>
              <button type="button" className="btn btn-quiet" onClick={share}>
                Share
              </button>
            </>
          )}
          <button type="button" className="btn btn-primary" onClick={save} disabled={busy || !draft.name.trim() || (!dirty && Boolean(setlist))}>
            {busy ? "Saving…" : dirty || !setlist ? "Save" : "Saved"}
          </button>
        </div>
      </div>
      {message && (
        <p className={message.kind === "error" ? "error-text" : styles.ok} role={message.kind === "error" ? "alert" : "status"}>
          {message.text}
        </p>
      )}
      {shared && (
        <p className={styles.ok} role="status">
          {shared}
        </p>
      )}

      <div className={styles.fields}>
        <label className="field">
          <span>Name</span>
          <input
            className="input"
            value={draft.name}
            placeholder="Sunday 2 November"
            onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
          />
        </label>
        <label className="field">
          <span>Description (optional)</span>
          <input
            className="input"
            value={draft.description}
            placeholder="This week's homework"
            onChange={(e) => setDraft((d) => ({ ...d, description: e.target.value }))}
          />
        </label>
      </div>

      <section className={styles.block} aria-labelledby="songs">
        <h2 id="songs">Songs</h2>
        {draft.items.length === 0 ? (
          <p className="muted">No songs yet. Tap them below, in the order you&apos;ll play them.</p>
        ) : (
          <ol className={styles.list} ref={listRef}>
            {draft.items.map((item, i) => {
              const song = byId.get(item.songId);
              const minor = song?.originalKey.endsWith("m");
              return (
                <li key={item.songId} className={styles.item} data-dragging={dragging === i || undefined}>
                  <span
                    className={styles.handle}
                    onPointerDown={(e) => startDrag(i, e)}
                    onPointerMove={moveDrag}
                    onPointerUp={endDrag}
                    onPointerCancel={endDrag}
                    aria-hidden="true"
                    title="Drag to reorder"
                  >
                    <span className={styles.num}>{i + 1}</span>
                    <svg viewBox="0 0 10 16" width="10" height="16">
                      {[3, 8, 13].map((y) => (
                        <g key={y}>
                          <circle cx="2.5" cy={y} r="1.4" />
                          <circle cx="7.5" cy={y} r="1.4" />
                        </g>
                      ))}
                    </svg>
                  </span>
                  <span className={styles.title}>
                    {song ? song.title : "Deleted song"}
                    {song?.artist && <span className="muted"> · {song.artist}</span>}
                  </span>
                  {song && (
                    <label className={styles.key}>
                      <span className="visually-hidden">Key for {song.title}</span>
                      <select
                        className="select"
                        value={item.key ?? ""}
                        onChange={(e) =>
                          setItems(draft.items.map((it, j) => (j === i ? (e.target.value ? { ...it, key: e.target.value } : { songId: it.songId }) : it)))
                        }
                      >
                        <option value="">Key: {song.originalKey} (original)</option>
                        {(minor ? ALL_MINOR_KEYS : ALL_KEYS).map((k) => (
                          <option key={k} value={k}>
                            Key: {k}
                          </option>
                        ))}
                      </select>
                    </label>
                  )}
                  <span className={styles.itemActions}>
                    <button type="button" className="btn btn-quiet btn-small" onClick={() => move(i, -1)} disabled={i === 0} aria-label="Move up">
                      Up
                    </button>
                    <button
                      type="button"
                      className="btn btn-quiet btn-small"
                      onClick={() => move(i, 1)}
                      disabled={i === draft.items.length - 1}
                      aria-label="Move down"
                    >
                      Down
                    </button>
                    <button
                      type="button"
                      className="btn btn-quiet btn-small"
                      onClick={() => setItems(draft.items.filter((_, j) => j !== i))}
                      aria-label={`Remove ${song?.title ?? "song"}`}
                    >
                      Remove
                    </button>
                  </span>
                </li>
              );
            })}
          </ol>
        )}

        {songs.length === 0 ? (
          <p className="muted">
            There are no songs to add yet. <Link href="/edit/songs/new">Add a song</Link> first.
          </p>
        ) : (
          <div className={styles.add}>
            <label className="field">
              <span>Add songs</span>
              <input
                className="input"
                type="search"
                placeholder={available.length ? "Search your songs" : "Every song is in this list"}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                disabled={available.length === 0}
              />
            </label>
            {available.length > 0 && (
              <ul className={styles.results}>
                {matches.slice(0, 30).map((s) => (
                  <li key={s.id}>
                    <button type="button" className={styles.result} onClick={() => setItems([...draft.items, { songId: s.id }])}>
                      <span className={styles.title}>
                        {s.title}
                        {s.artist && <span className="muted"> · {s.artist}</span>}
                      </span>
                      <span className={styles.plus} aria-hidden="true">
                        Add
                      </span>
                    </button>
                  </li>
                ))}
                {matches.length === 0 && <li className="muted">No songs match &ldquo;{search}&rdquo;.</li>}
              </ul>
            )}
          </div>
        )}
      </section>

      {setlist && (
        <section className={styles.danger}>
          <button type="button" className="btn btn-quiet btn-danger" onClick={remove}>
            Delete this setlist
          </button>
        </section>
      )}
    </div>
  );
}
