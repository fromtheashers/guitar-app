"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { Setlist, SetlistInput, SongSummary } from "@/lib/db";
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
  const [adding, setAdding] = useState("");
  const dirty = JSON.stringify(draft) !== saved;
  const byId = new Map(songs.map((s) => [s.id, s]));

  const setItems = (items: SetlistInput["items"]) => setDraft((d) => ({ ...d, items }));
  const move = (i: number, by: number) => {
    const items = [...draft.items];
    const [it] = items.splice(i, 1);
    items.splice(i + by, 0, it);
    setItems(items);
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
            <Link href={`/setlists/${setlist.id}`} className="btn btn-quiet">
              Open as student
            </Link>
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
          <p className="muted">No songs yet. Add them below, in the order you&apos;ll play them.</p>
        ) : (
          <ol className={styles.list}>
            {draft.items.map((item, i) => {
              const song = byId.get(item.songId);
              const minor = song?.originalKey.endsWith("m");
              return (
                <li key={item.songId} className={styles.item}>
                  <span className={styles.num}>{i + 1}</span>
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
          <form
            className={styles.add}
            onSubmit={(e) => {
              e.preventDefault();
              if (!adding) return;
              setItems([...draft.items, { songId: adding }]);
              setAdding("");
            }}
          >
            <label className="field">
              <span>Add a song</span>
              <select className="select" value={adding} onChange={(e) => setAdding(e.target.value)} disabled={available.length === 0}>
                <option value="">{available.length ? "Choose a song" : "Every song is in this list"}</option>
                {available.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.title}
                    {s.artist ? ` · ${s.artist}` : ""}
                  </option>
                ))}
              </select>
            </label>
            <button type="submit" className="btn" disabled={!adding}>
              Add
            </button>
          </form>
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
