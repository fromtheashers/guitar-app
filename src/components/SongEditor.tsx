"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useEffectEvent, useMemo, useRef, useState } from "react";
import type { Song, SongInput } from "@/lib/db";
import { parseLyrics } from "@/lib/analysis/lyrics";
import { distinctChords, parseChart, renameSection, sectionKind } from "@/lib/music/chart";
import { defaultPresetFor, GROOVE_PRESETS, presetPattern, type StrumPattern } from "@/lib/music/strum";
import { ALL_KEYS, ALL_MINOR_KEYS, buildView, eventAt } from "@/lib/songView";
import type { SongGuess as VideoGuess } from "@/lib/videoInfo";
import { shareLink } from "@/lib/share";
import { youtubeId } from "@/lib/youtube";
import { AnalysePanel } from "./AnalysePanel";
import { ChartKeys } from "./ChartKeys";
import { ChartView } from "./ChartView";
import { StrumGrid } from "./StrumGrid";
import { PLAYING, useYouTube } from "./useYouTube";
import styles from "./SongEditor.module.css";

const EMPTY: SongInput = {
  title: "",
  artist: "",
  youtubeUrl: "",
  spotifyUrl: "",
  originalKey: "G",
  bpm: 0,
  beatsPerBar: 4,
  chart: "",
  timings: [],
  patterns: {},
  notes: "",
  lyrics: "",
};

const LYRICS_HELP = `[Verse 1]
Amazing grace how sweet the sound
That saved a wretch like me

[Chorus]
My chains are gone…`;

const SECTION_NAMES = ["Intro", "Verse", "Pre-Chorus", "Chorus", "Bridge", "Tag", "Interlude", "Instrumental", "Outro"];

const CHART_HELP = `[Verse 1]
> Amazing grace
| G | C G | Em . . D | C |

[Chorus]
| C | D | Em | C |`;

export function SongEditor({ song, lyrics = "" }: { song?: Song; lyrics?: string }) {
  const router = useRouter();
  const [draft, setDraft] = useState<SongInput>(() => (song ? { ...EMPTY, ...song, lyrics } : EMPTY));
  const [saved, setSaved] = useState<string>(() => JSON.stringify(song ? { ...EMPTY, ...song, lyrics } : EMPTY));
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const [undo, setUndo] = useState<SongInput | null>(null);
  const dirty = JSON.stringify(draft) !== saved;

  const set = <K extends keyof SongInput>(k: K, v: SongInput[K]) => setDraft((d) => ({ ...d, [k]: v }));

  // Keep an unsaved copy on this device, so a phone call or a closed tab doesn't lose the work.
  const backupKey = `song-draft:${song?.id ?? "new"}`;
  const [backup, setBackup] = useState<{ draft: SongInput; at: number } | null | undefined>(undefined);
  useEffect(() => {
    // Storage is only readable in the browser, so this runs after the first render.
    const t = window.setTimeout(() => {
      const found = readBackup(backupKey);
      setBackup(found && JSON.stringify({ ...EMPTY, ...found.draft }) !== saved ? found : null);
    }, 0);
    return () => window.clearTimeout(t);
    // Only on opening the song.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [backupKey]);
  useEffect(() => {
    // Wait until the teacher has chosen whether to bring an old copy back.
    if (backup !== null) return;
    const t = window.setTimeout(() => writeBackup(backupKey, dirty ? draft : null), 600);
    return () => window.clearTimeout(t);
  }, [backup, backupKey, dirty, draft]);
  const restoreBackup = () => {
    // Copies from before the lyrics box keep the saved lyrics.
    if (backup) setDraft((d) => ({ ...EMPTY, lyrics: d.lyrics, ...backup.draft }));
    setBackup(null);
  };
  const discardBackup = () => {
    writeBackup(backupKey, null);
    setBackup(null);
  };

  // The details fill themselves in from the link, so they stay folded away until needed.
  const [detailsOpen, setDetailsOpen] = useState(() => Boolean(song) && !song?.title);
  const titleInput = useRef<HTMLInputElement>(null);

  const videoId = youtubeId(draft.youtubeUrl);
  const { host: ytHost, player, ready: ytReady, state: ytState, error: ytError } = useYouTube(videoId);

  // Pasting a new link reads the video's page and fills whatever is still empty.
  const [lookup, setLookup] = useState<{ busy: boolean; text: string | null }>({ busy: false, text: null });
  const lookedUp = useRef<string | null>(song ? youtubeId(song.youtubeUrl) : null);
  const fillFromVideo = useEffectEvent(async (id: string) => {
    setLookup({ busy: true, text: null });
    try {
      const res = await fetch(`/api/video-info?url=${encodeURIComponent(id)}`);
      const body = (await res.json().catch(() => ({}))) as { guess?: VideoGuess; error?: string };
      if (!res.ok || !body.guess) {
        setLookup({ busy: false, text: body.error ?? "Couldn't read the video's details. Fill them in by hand." });
        return;
      }
      const g = body.guess;
      // Only fields that are still empty; anything the teacher typed stays.
      const patch: Partial<SongInput> = {};
      const filled: string[] = [];
      const fill = <K extends keyof SongInput>(when: boolean, k: K, v: SongInput[K] | undefined, label: string) => {
        if (when && v !== undefined) {
          patch[k] = v;
          filled.push(label);
        }
      };
      const noChart = !draft.chart.trim();
      fill(!draft.title.trim(), "title", g.title, "title");
      fill(!draft.artist.trim(), "artist", g.artist, "artist");
      fill(!draft.spotifyUrl.trim(), "spotifyUrl", g.spotifyUrl, "Spotify link");
      fill(!draft.bpm, "bpm", g.bpm, "tempo");
      // Key and time signature have defaults, so only set them before there's a chart.
      fill(noChart, "originalKey", g.key, "key");
      fill(noChart, "beatsPerBar", g.beatsPerBar, "time signature");
      setDraft((d) => ({ ...d, ...patch }));
      const keyNote = g.key ? "" : " The description doesn't give a key; Listen and draft will work it out from the audio.";
      setLookup({
        busy: false,
        text: (filled.length ? `Filled in the ${list(filled)} from YouTube. Check they're right.` : "Nothing new to fill in from YouTube.") + keyNote,
      });
    } catch {
      setLookup({ busy: false, text: "Couldn't reach YouTube. Fill the details in by hand." });
    }
  });
  useEffect(() => {
    if (!videoId || lookedUp.current === videoId) return;
    const t = window.setTimeout(() => {
      lookedUp.current = videoId;
      void fillFromVideo(videoId);
    }, 400);
    return () => window.clearTimeout(t);
  }, [videoId]);

  const chart = useMemo(() => parseChart(draft.chart, draft.beatsPerBar), [draft.chart, draft.beatsPerBar]);
  const view = useMemo(
    () => buildView(draft, { mode: "advanced", key: draft.originalKey, capo: 0, numbers: false }),
    [draft],
  );
  const kinds = useMemo(() => [...new Set(chart.sections.map((s) => s.kind))], [chart]);
  const lyricSections = useMemo(() => parseLyrics(draft.lyrics ?? ""), [draft.lyrics]);
  const [lyricsOpen, setLyricsOpen] = useState(false);

  // Renaming a section from the chart preview, by default with all its repeats.
  const [renaming, setRenaming] = useState<{ index: number; name: string; all: boolean } | null>(null);
  const renameTarget = renaming ? chart.sections[renaming.index] : undefined;
  const repeats = renameTarget ? chart.sections.filter((s) => s.label.toLowerCase() === renameTarget.label.toLowerCase()).length : 0;
  const applyRename = () => {
    if (!renaming || !renameTarget || !renaming.name.trim()) return;
    const text = renameSection(draft.chart, renaming.index, renaming.name, renaming.all);
    const oldKind = renameTarget.kind;
    const newKind = sectionKind(renaming.name);
    setDraft((d) => {
      const left = parseChart(text, d.beatsPerBar).sections.some((s) => s.kind === oldKind);
      const patterns = { ...d.patterns };
      // The strum pattern goes with the section unless the new kind already has one.
      if (patterns[oldKind] && !patterns[newKind]) patterns[newKind] = patterns[oldKind];
      if (!left && oldKind !== newKind) delete patterns[oldKind];
      return { ...d, chart: text, patterns };
    });
    setRenaming(null);
  };
  const timed = draft.timings.slice(0, chart.events.length).filter((t) => typeof t === "number").length;

  // Warn before leaving with unsaved changes.
  useEffect(() => {
    if (!dirty) return;
    const h = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", h);
    return () => window.removeEventListener("beforeunload", h);
  }, [dirty]);

  const save = useCallback(async () => {
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch(song ? `/api/songs/${song.id}` : "/api/songs", {
        method: song ? "PUT" : "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(draft),
      });
      const body = (await res.json().catch(() => ({}))) as Song & { error?: string };
      if (!res.ok) {
        setMessage({ kind: "error", text: body.error ?? "Couldn't save. Try again." });
        if (!draft.title.trim()) {
          setDetailsOpen(true);
          requestAnimationFrame(() => titleInput.current?.focus());
        }
        return;
      }
      writeBackup(backupKey, null);
      setSaved(JSON.stringify(draft));
      setMessage({ kind: "ok", text: "Saved." });
      if (!song) router.replace(`/edit/songs/${body.id}`);
      else router.refresh();
    } catch {
      setMessage({ kind: "error", text: "Couldn't reach the app. Your changes are still here; try again." });
    } finally {
      setBusy(false);
    }
  }, [draft, song, router, backupKey]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "s") {
        e.preventDefault();
        if (!busy) void save();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [save, busy]);

  const remove = async () => {
    if (!song || !confirm(`Delete "${song.title}"? This can't be undone.`)) return;
    const res = await fetch(`/api/songs/${song.id}`, { method: "DELETE" });
    if (res.ok) {
      router.replace("/edit");
      router.refresh();
    } else setMessage({ kind: "error", text: "Couldn't delete the song." });
  };

  // Tap to sync: stamp the video time on each chord change in order, from the
  // start or from any chord picked in the preview.
  const [tapIndex, setTapIndex] = useState<number | null>(null);
  const [picked, setPicked] = useState<number | null>(null);
  const timingOf = (i: number) => (typeof draft.timings[i] === "number" ? (draft.timings[i] as number) : null);
  // Where to start the video so there's a run-up to chord i: a few seconds before
  // its old timing, or before the last synced chord ahead of it.
  const runUpTo = (i: number) => {
    for (let k = i; k >= 0; k--) {
      const t = timingOf(k);
      if (t !== null) return Math.max(0, t - (k === i ? 3 : 1));
    }
    return 0;
  };
  const setTiming = (i: number, t: number) =>
    setDraft((d) => {
      const timings = [...d.timings];
      while (timings.length < chart.events.length) timings.push(null);
      timings[i] = Math.max(0, Math.round(t * 1000) / 1000);
      return { ...d, timings };
    });

  const videoBox = useRef<HTMLDivElement>(null);
  const startTapping = (from = 0) => {
    const p = player.current;
    if (!p) return;
    // On a phone the tap pad covers the bottom of the screen, so bring the video up top.
    if (window.matchMedia("(max-width: 900px)").matches) requestAnimationFrame(() => videoBox.current?.scrollIntoView({ block: "start" }));
    setTapIndex(from);
    setPicked(from);
    p.seekTo(from === 0 ? 0 : runUpTo(from), true);
    p.playVideo();
  };
  const tap = () => {
    const p = player.current;
    if (tapIndex === null || !p) return;
    setTiming(tapIndex, p.getCurrentTime());
    if (tapIndex + 1 >= chart.events.length) {
      setTapIndex(null);
      p.pauseVideo();
    } else {
      setTapIndex(tapIndex + 1);
      setPicked(tapIndex + 1);
    }
  };
  // Made a mistake: go back one chord and replay a few seconds before it.
  const tapBack = () => {
    const p = player.current;
    if (tapIndex === null || !p || tapIndex === 0) return;
    const i = tapIndex - 1;
    setTapIndex(i);
    setPicked(i);
    p.seekTo(runUpTo(i), true);
    p.playVideo();
  };
  const stopTapping = () => {
    setTapIndex(null);
    player.current?.pauseVideo();
  };
  const tapFromKey = useEffectEvent(() => tap());
  const tapBackFromKey = useEffectEvent(() => tapBack());

  useEffect(() => {
    if (tapIndex === null) return;
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).closest("input, textarea, select")) return;
      if (e.code === "Space") {
        e.preventDefault();
        tapFromKey();
      } else if (e.code === "Backspace") {
        e.preventDefault();
        tapBackFromKey();
      } else if (e.code === "Escape") setTapIndex(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [tapIndex]);

  // Picking a chord in the preview: while tapping, carry on from it; otherwise
  // select it and move the video there.
  const pick = (i: number) => {
    setRenaming(null);
    if (tapIndex !== null) {
      startTapping(i);
      return;
    }
    setPicked(i);
    const t = timingOf(i);
    if (t !== null) player.current?.seekTo(t, true);
  };

  const nudge = (delta: number) =>
    set(
      "timings",
      draft.timings.map((t) => (typeof t === "number" ? Math.max(0, Math.round((t + delta) * 1000) / 1000) : t)),
    );
  // Move the picked chord and everything after it, e.g. by a beat that was missed.
  const shiftFrom = (from: number, delta: number) =>
    set(
      "timings",
      draft.timings.map((t, i) => (i >= from && typeof t === "number" ? Math.max(0, Math.round((t + delta) * 1000) / 1000) : t)),
    );
  const beat = draft.bpm > 0 ? 60 / draft.bpm : 0;

  const patternFor = (kind: string): StrumPattern =>
    draft.patterns[kind] ?? draft.patterns.default ?? presetPattern(defaultPresetFor(draft.beatsPerBar), draft.beatsPerBar);
  const setPattern = (kind: string, p: StrumPattern) => set("patterns", { ...draft.patterns, [kind]: p });

  const chartBox = useRef<HTMLTextAreaElement>(null);
  const [typingChart, setTypingChart] = useState(false);
  const usedChords = useMemo(() => distinctChords(chart), [chart]);

  const [shared, setShared] = useState<string | null>(null);
  const share = async () => {
    if (!song) return;
    const r = await shareLink(draft.title || "Song", `/songs/${song.id}`);
    setShared(r === "copied" ? "Link copied. Paste it to your students." : r === "failed" ? "Couldn't share the link." : null);
  };

  const time = useFollow(player, ytState === PLAYING);
  const nextChord = tapIndex !== null ? chart.events[tapIndex] : null;
  const afterChord = tapIndex !== null && tapIndex + 1 < chart.events.length ? chart.events[tapIndex + 1] : null;
  const pickedEvent = picked !== null && picked < view.events.length ? view.events[picked] : null;
  const pickedWhere = (() => {
    if (picked === null) return "";
    for (const sec of view.sections) {
      const bi = sec.bars.findIndex((b) => b.events.some((e) => e.index === picked));
      if (bi >= 0) return `${sec.label}, bar ${bi + 1}`;
    }
    return "";
  })();

  return (
    <div className={styles.page}>
      <div className={styles.head}>
        <div>
          <Link href="/edit" className={styles.back}>
            Teacher
          </Link>
          <h1>{song ? draft.title || "Untitled song" : "Add a song"}</h1>
        </div>
        <div className={styles.actions}>
          {song && (
            <>
              <Link href={`/songs/${song.id}`} className="btn btn-quiet">
                Open as student
              </Link>
              <button type="button" className="btn btn-quiet" onClick={share}>
                Share
              </button>
            </>
          )}
          <button type="button" className={`btn btn-primary ${styles.topSave}`} onClick={save} disabled={busy || (!dirty && Boolean(song))}>
            {busy ? "Saving…" : dirty || !song ? "Save" : "Saved"}
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
      {backup && (
        <div className={styles.restore} role="status">
          <p>
            You have unsaved changes to this song from {when(backup.at)}.
          </p>
          <div className={styles.row}>
            <button type="button" className="btn btn-primary btn-small" onClick={restoreBackup}>
              Bring them back
            </button>
            <button type="button" className="btn btn-quiet btn-small" onClick={discardBackup}>
              Discard
            </button>
          </div>
        </div>
      )}

      <section className={styles.block} aria-labelledby="details">
        <h2 id="details">Song</h2>
        <label className="field">
          <span>YouTube link</span>
          <input
            className="input"
            inputMode="url"
            placeholder="https://www.youtube.com/watch?v=…"
            value={draft.youtubeUrl}
            onChange={(e) => set("youtubeUrl", e.target.value)}
            aria-invalid={Boolean(draft.youtubeUrl) && !videoId}
          />
          {draft.youtubeUrl && !videoId && <small className="error-text">That doesn&apos;t look like a YouTube link.</small>}
          {videoId && (lookup.busy || lookup.text) && (
            <small className={styles.lookup} role="status">
              {lookup.busy ? "Reading the video's details…" : lookup.text}
            </small>
          )}
        </label>
        <details className={styles.details} open={detailsOpen} onToggle={(e) => setDetailsOpen(e.currentTarget.open)}>
          <summary>
            <span className={styles.detailsLabel}>Details</span>
            <span className={styles.detailsSummary}>
              {draft.title.trim()
                ? [draft.title, draft.artist, `Key ${draft.originalKey}`, timeName(draft.beatsPerBar), draft.bpm ? `${draft.bpm} BPM` : ""].filter(Boolean).join(" · ")
                : "Title, artist, key and tempo. They fill in from the link; open to check or change them."}
            </span>
          </summary>
          <div className={styles.fields}>
            <label className="field">
              <span>Title</span>
              <input ref={titleInput} className="input" value={draft.title} onChange={(e) => set("title", e.target.value)} required />
            </label>
            <label className="field">
              <span>Artist</span>
              <input className="input" value={draft.artist} onChange={(e) => set("artist", e.target.value)} />
            </label>
            <label className={`field ${styles.wide}`}>
              <span>Spotify link (optional, for a Listen button)</span>
              <input className="input" inputMode="url" value={draft.spotifyUrl} onChange={(e) => set("spotifyUrl", e.target.value)} />
            </label>
            <label className="field">
              <span>Original key</span>
              <select className="select" value={draft.originalKey} onChange={(e) => set("originalKey", e.target.value)}>
                <optgroup label="Major">
                  {ALL_KEYS.map((k) => (
                    <option key={k}>{k}</option>
                  ))}
                </optgroup>
                <optgroup label="Minor">
                  {ALL_MINOR_KEYS.map((k) => (
                    <option key={k}>{k}</option>
                  ))}
                </optgroup>
              </select>
            </label>
            <label className="field">
              <span>Time signature</span>
              <select className="select" value={draft.beatsPerBar} onChange={(e) => set("beatsPerBar", Number(e.target.value))}>
                <option value={4}>4/4</option>
                <option value={3}>3/4</option>
                <option value={6}>6/8</option>
              </select>
            </label>
            <label className="field">
              <span>Tempo (BPM)</span>
              <input
                className="input"
                type="number"
                min={0}
                max={300}
                value={draft.bpm || ""}
                onChange={(e) => set("bpm", Number(e.target.value) || 0)}
              />
            </label>
          </div>
        </details>
        <details className={styles.details} open={lyricsOpen} onToggle={(e) => setLyricsOpen(e.currentTarget.open)}>
          <summary>
            <span className={styles.detailsLabel}>Lyrics</span>
            <span className={styles.detailsSummary}>
              {lyricSections.length
                ? `${lyricSections.length} sections: ${lyricSections.map((l) => l.label).join(", ")}. For naming sections; students never see them.`
                : "Optional. Paste them so Draft from YouTube can name verses and choruses from the singing. Students never see them."}
            </span>
          </summary>
          <div className={styles.lyrics}>
            <p className={styles.hint}>
              Put each section name on its own line, like <strong>[Verse 2]</strong> or <strong>Chorus</strong>. A chorus sung again can be just its name. Then press Draft from YouTube. The lyrics are only for matching: they stay in the teacher view and aren&apos;t shown on the song page.
            </p>
            <label className="field">
              <span className="visually-hidden">Lyrics</span>
              <textarea
                className={`textarea ${styles.lyricsText}`}
                value={draft.lyrics ?? ""}
                placeholder={LYRICS_HELP}
                onChange={(e) => set("lyrics", e.target.value)}
                autoCapitalize="sentences"
              />
            </label>
          </div>
        </details>
      </section>

      <section className={styles.block} aria-labelledby="video">
        <h2 id="video">Video</h2>
        <div className={styles.videoRow}>
          <div className={styles.video} ref={videoBox}>
            {videoId ? <div ref={ytHost} className={styles.frame} /> : <div className={styles.noVideo}>Paste a YouTube link above to load the video.</div>}
            {ytError && <p className={styles.videoError}>{ytError}</p>}
          </div>
          <div className={styles.side}>
            <AnalysePanel
              disabled={!videoId || tapIndex !== null}
              playerReady={ytReady}
              videoUrl={draft.youtubeUrl}
              beatsPerBar={draft.beatsPerBar}
              lyrics={lyricSections}
              player={player}
              onResult={(r) => {
                setUndo(draft);
                setDraft((d) => ({
                  ...d,
                  chart: r.chart,
                  timings: r.timings,
                  patterns: r.patterns,
                  bpm: r.bpm,
                  originalKey: r.key,
                }));
              }}
              onUndo={
                undo
                  ? () => {
                      setDraft(undo);
                      setUndo(null);
                    }
                  : undefined
              }
              hasChart={Boolean(draft.chart.trim())}
            />

            <div className={styles.sync}>
              <h3>Timing</h3>
              <p className="muted">
                {chart.events.length === 0
                  ? "Write or analyse a chart first."
                  : `${timed} of ${chart.events.length} chord changes are synced to the video.`}
              </p>
              <div className={styles.row}>
                <button type="button" className="btn" onClick={() => startTapping(0)} disabled={!ytReady || chart.events.length === 0 || tapIndex !== null}>
                  Tap along from the start
                </button>
                <button type="button" className="btn btn-quiet btn-small" onClick={() => nudge(-0.1)} disabled={!timed}>
                  All earlier 0.1s
                </button>
                <button type="button" className="btn btn-quiet btn-small" onClick={() => nudge(0.1)} disabled={!timed}>
                  All later 0.1s
                </button>
              </div>
              <p className="muted">To fix part of the song, click a chord in the chart preview below and tap from there.</p>
              {ytState === PLAYING && tapIndex === null && timed > 0 && (
                <p className="muted">Playing: the preview below follows the video.</p>
              )}
            </div>
          </div>
        </div>
      </section>

      <section className={styles.block} aria-labelledby="chart">
        <div className={styles.chartHead}>
          <h2 id="chart">Chart</h2>
          <p className="muted">Sections in [brackets], bars between |, lyric cues after &gt;. Dots hold a chord for a beat.</p>
        </div>
        <div className={styles.chartGrid}>
          <label className="field">
            <span className="visually-hidden">Chart text</span>
            <textarea
              className={`textarea ${styles.chartText}`}
              spellCheck={false}
              ref={chartBox}
              value={draft.chart}
              placeholder={CHART_HELP}
              onChange={(e) => set("chart", e.target.value)}
              onFocus={() => setTypingChart(true)}
              onBlur={() => setTypingChart(false)}
            />
          </label>
          {typingChart && (
            <ChartKeys textarea={chartBox} value={draft.chart} onChange={(v) => set("chart", v)} songKey={draft.originalKey} used={usedChords} />
          )}
          <div className={styles.preview}>
            {chart.events.length > 0 && (
              <div className={styles.syncBar} data-tapping={tapIndex !== null || undefined} role="group" aria-label="Sync">
                {tapIndex === null && renaming && renameTarget ? (
                  <form
                    className={styles.renameForm}
                    onSubmit={(e) => {
                      e.preventDefault();
                      applyRename();
                    }}
                  >
                    <label className="field">
                      <span>Rename “{renameTarget.label}”</span>
                      <input
                        className="input"
                        value={renaming.name}
                        enterKeyHint="done"
                        onChange={(e) => setRenaming({ ...renaming, name: e.target.value })}
                      />
                    </label>
                    <div className={styles.row} role="group" aria-label="Common names">
                      {SECTION_NAMES.map((n) => (
                        <button type="button" key={n} className="btn btn-quiet btn-small" aria-pressed={renaming.name === n} onClick={() => setRenaming({ ...renaming, name: n })}>
                          {n}
                        </button>
                      ))}
                    </div>
                    {repeats > 1 && (
                      <label className={styles.check}>
                        <input type="checkbox" checked={renaming.all} onChange={(e) => setRenaming({ ...renaming, all: e.target.checked })} />
                        Rename all {repeats} sections called “{renameTarget.label}”
                      </label>
                    )}
                    <div className={styles.row}>
                      <button type="submit" className="btn btn-primary" disabled={!renaming.name.trim()}>
                        Rename
                      </button>
                      <button type="button" className="btn btn-quiet" onClick={() => setRenaming(null)}>
                        Cancel
                      </button>
                    </div>
                  </form>
                ) : tapIndex !== null ? (
                  <>
                    <p>
                      Tap on <strong>{nextChord?.chord ?? "N.C."}</strong> <span className="muted">({tapIndex + 1} of {chart.events.length})</span>
                    </p>
                    <div className={styles.row}>
                      <button type="button" className={`btn btn-primary ${styles.tap}`} onClick={tap}>
                        Tap (space)
                      </button>
                      <button type="button" className="btn" onClick={tapBack} disabled={tapIndex === 0}>
                        Back one (⌫)
                      </button>
                      <button type="button" className="btn btn-quiet" onClick={stopTapping}>
                        Done
                      </button>
                    </div>
                    <p className={styles.hint}>Missed one? Press Back to replay it, or click any chord below to carry on from there. Done keeps everything after this chord as it was.</p>
                  </>
                ) : pickedEvent ? (
                  <>
                    <p>
                      <strong>{pickedEvent.label}</strong> <span className="muted">· {pickedWhere} · {pickedEvent.time === null ? "not synced" : `${pickedEvent.time.toFixed(2)} s`}</span>
                    </p>
                    <div className={styles.row}>
                      <button type="button" className="btn btn-primary" onClick={() => startTapping(picked!)} disabled={!ytReady}>
                        Tap from here
                      </button>
                      <button type="button" className="btn" onClick={() => player.current && setTiming(picked!, player.current.getCurrentTime())} disabled={!ytReady}>
                        Set to video time
                      </button>
                      <button type="button" className="btn btn-quiet btn-small" onClick={() => setTiming(picked!, pickedEvent.time! - 0.1)} disabled={pickedEvent.time === null}>
                        −0.1s
                      </button>
                      <button type="button" className="btn btn-quiet btn-small" onClick={() => setTiming(picked!, pickedEvent.time! + 0.1)} disabled={pickedEvent.time === null}>
                        +0.1s
                      </button>
                      <button type="button" className="btn btn-quiet btn-small" onClick={() => shiftFrom(picked!, -beat)} disabled={!beat || pickedEvent.time === null}>
                        −1 beat
                      </button>
                      <button type="button" className="btn btn-quiet btn-small" onClick={() => shiftFrom(picked!, beat)} disabled={!beat || pickedEvent.time === null}>
                        +1 beat
                      </button>
                      <button type="button" className="btn btn-quiet btn-small" onClick={() => setPicked(null)}>
                        Close
                      </button>
                    </div>
                    <p className={styles.hint}>±0.1s moves just this chord. ±1 beat moves this chord and everything after it, for a beat that was added or missed.</p>
                  </>
                ) : (
                  <p className={styles.hint}>Click a chord to fix its timing, or to re-sync from it without starting the song again. Tap a section name to rename it.</p>
                )}
              </div>
            )}
            {chart.errors.length > 0 && (
              <ul className={styles.errors} role="alert">
                {chart.errors.slice(0, 6).map((er, i) => (
                  <li key={i}>
                    Line {er.line}: {er.message}
                  </li>
                ))}
              </ul>
            )}
            <ChartView
              view={view}
              beatsPerBar={draft.beatsPerBar}
              activeEvent={tapIndex !== null ? -1 : ytState === PLAYING ? eventAt(view.events, time) : -1}
              onPick={pick}
              picked={picked}
              onRenameSection={
                tapIndex === null
                  ? (i) => {
                      setRenaming({ index: i, name: chart.sections[i]?.label ?? "", all: true });
                      setPicked(null);
                    }
                  : undefined
              }
            />
          </div>
        </div>
      </section>

      {kinds.length > 0 && (
        <section className={styles.block} aria-labelledby="strums">
          <h2 id="strums">Strum patterns</h2>
          <p className="muted">One pattern per kind of section. Tap a drum pane to change it, and a strum to cycle down, up, chuck and rest. Press and hold a strum (or right-click it) to accent it.</p>
          <div className={styles.patterns}>
            {kinds.map((kind) => {
              const p = patternFor(kind);
              const label = chart.sections.find((s) => s.kind === kind)?.label.replace(/\s*\d+$/, "") ?? kind;
              return (
                <div key={kind} className={styles.pattern}>
                  <div className={styles.patternHead}>
                    <h3>{label}</h3>
                    <select
                      className="select"
                      aria-label={`Groove for ${label}`}
                      value=""
                      onChange={(e) => e.target.value && setPattern(kind, presetPattern(e.target.value, draft.beatsPerBar))}
                    >
                      <option value="">{p.name}</option>
                      {GROOVE_PRESETS.filter((g) => g.beatsPerBar === draft.beatsPerBar || (draft.beatsPerBar === 4 && g.beatsPerBar === 4)).map((g) => (
                        <option key={g.id} value={g.id}>
                          Use: {g.name}
                        </option>
                      ))}
                    </select>
                  </div>
                  <StrumGrid pattern={p} beatsPerBar={draft.beatsPerBar} mode="advanced" onChange={(np) => setPattern(kind, np)} />
                </div>
              );
            })}
          </div>
        </section>
      )}

      <section className={styles.block} aria-labelledby="notes">
        <h2 id="notes">Notes for students</h2>
        <textarea
          className={`textarea ${styles.notes}`}
          value={draft.notes}
          onChange={(e) => set("notes", e.target.value)}
          placeholder="e.g. Let the chorus ring, build on the second time through."
        />
      </section>

      {song && (
        <section className={styles.danger}>
          <button type="button" className="btn btn-quiet btn-danger" onClick={remove}>
            Delete this song
          </button>
        </section>
      )}

      {/* Phones: a big pad to tap on while syncing, otherwise Save stays in reach. */}
      {tapIndex !== null ? (
        <div className={styles.tapPad} role="group" aria-label="Tap to sync">
          <p className={styles.tapNext}>
            <span className="muted">Next</span> <strong>{nextChord?.chord ?? "N.C."}</strong>
            {afterChord && <span className="muted"> then {afterChord.chord ?? "N.C."}</span>}
            <span className={`muted tnum ${styles.tapCount}`}>
              {tapIndex + 1} of {chart.events.length}
            </span>
          </p>
          <button
            type="button"
            className={styles.tapButton}
            onPointerDown={(e) => {
              // On the finger going down, not lifting, so the timing is as tight as it can be.
              e.preventDefault();
              tap();
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") tap();
            }}
          >
            Tap on the change
          </button>
          <div className={styles.tapActions}>
            <button type="button" className="btn" onClick={tapBack} disabled={tapIndex === 0}>
              Back one
            </button>
            <button type="button" className="btn btn-quiet" onClick={stopTapping}>
              Done
            </button>
          </div>
        </div>
      ) : (
        !typingChart && (
          <div className={styles.saveBar}>
            <span className={styles.saveState} role="status">
              {busy ? "Saving…" : dirty ? "Unsaved changes" : song ? "All changes saved" : "Not saved yet"}
            </span>
            <button type="button" className="btn btn-primary" onClick={save} disabled={busy || (!dirty && Boolean(song))}>
              {busy ? "Saving…" : dirty || !song ? "Save" : "Saved"}
            </button>
          </div>
        )
      )}
    </div>
  );
}

function useFollow(player: React.RefObject<{ getCurrentTime(): number } | null>, playing: boolean) {
  const [t, setT] = useState(0);
  const raf = useRef(0);
  useEffect(() => {
    if (!playing) return;
    const tick = () => {
      if (player.current) setT(player.current.getCurrentTime());
      raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf.current);
  }, [player, playing]);
  return t;
}

function list(items: string[]) {
  return items.length < 2 ? items.join("") : `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

function timeName(beatsPerBar: number) {
  return beatsPerBar === 6 ? "6/8" : `${beatsPerBar}/4`;
}

function when(at: number) {
  const d = new Date(at);
  const today = new Date().toDateString() === d.toDateString();
  const time = d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  return today ? `today at ${time}` : `${d.toLocaleDateString([], { day: "numeric", month: "short" })} at ${time}`;
}

// Storage can be missing or full (private windows); the backup is a nicety, so failures are ignored.
function readBackup(key: string): { draft: SongInput; at: number } | null {
  try {
    const raw = localStorage.getItem(key);
    const v = raw ? (JSON.parse(raw) as { draft?: SongInput; at?: number }) : null;
    return v?.draft && typeof v.at === "number" ? { draft: v.draft, at: v.at } : null;
  } catch {
    return null;
  }
}

function writeBackup(key: string, draft: SongInput | null) {
  try {
    if (draft) localStorage.setItem(key, JSON.stringify({ draft, at: Date.now() }));
    else localStorage.removeItem(key);
  } catch {
    // Nothing to do.
  }
}
