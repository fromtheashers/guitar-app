"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Song } from "@/lib/db";
import { parseKey } from "@/lib/music/chords";
import { buildView, eventAt, ALL_KEYS, ALL_MINOR_KEYS, type Mode } from "@/lib/songView";
import { sectionHue } from "@/lib/sections";
import { youtubeId } from "@/lib/youtube";
import { ChartView } from "./ChartView";
import { ChordDiagram } from "./ChordDiagram";
import { StrumGrid } from "./StrumGrid";
import { BUFFERING, PLAYING, useYouTube } from "./useYouTube";
import styles from "./PracticeView.module.css";

const RATES = [0.5, 0.75, 0.9, 1];

function usePref<T>(key: string, initial: T): [T, (v: T) => void] {
  const [value, setValue] = useState<T>(initial);
  useEffect(() => {
    try {
      const raw = localStorage.getItem(key);
      // Read after mount so the server render and first client render match.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      if (raw !== null) setValue(JSON.parse(raw) as T);
    } catch {
      /* storage unavailable: keep the default */
    }
  }, [key]);
  const set = useCallback(
    (v: T) => {
      setValue(v);
      try {
        localStorage.setItem(key, JSON.stringify(v));
      } catch {
        /* ignore */
      }
    },
    [key],
  );
  return [value, set];
}

export function PracticeView({ song, initialKey }: { song: Song; initialKey?: string }) {
  const [mode, setMode] = usePref<Mode>("pref:mode", "easy");
  const [numbers, setNumbers] = usePref<boolean>("pref:numbers", false);
  const [follow, setFollow] = usePref<boolean>("pref:follow", true);
  const [key, setKey] = useState(initialKey && parseKey(initialKey) ? initialKey : song.originalKey);
  const [capo, setCapo] = useState<number | "auto">("auto");
  const [rate, setRate] = useState(1);
  const [loop, setLoop] = useState<{ section: number; a: number; b: number } | null>(null);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const chartRef = useRef<HTMLDivElement>(null);

  const videoId = youtubeId(song.youtubeUrl);
  const { host: ytHost, player, ready: ytReady, state: ytState, error: ytError } = useYouTube(videoId);
  const playing = ytState === PLAYING;
  // Buffering counts as playing for the button, so it doesn't flicker to "Play".
  const rolling = playing || ytState === BUFFERING;

  const view = useMemo(() => buildView(song, { mode, key, capo, numbers }), [song, mode, key, capo, numbers]);
  const autoCapo = useMemo(() => buildView(song, { mode, key, capo: "auto", numbers: false }).capo, [song, mode, key]);
  const synced = view.events.some((e) => e.time !== null);

  // Follow the video.
  useEffect(() => {
    if (!playing) return;
    let raf = 0;
    const tick = () => {
      const p = player.current;
      if (p) {
        const t = p.getCurrentTime();
        setTime(t);
        setDuration(p.getDuration());
        if (loop && t >= loop.b) p.seekTo(loop.a, true);
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, loop, player]);

  useEffect(() => {
    player.current?.setPlaybackRate(rate);
  }, [rate, ytReady, player]);

  const current = eventAt(view.events, time);
  const nowEvent = current >= 0 ? view.events[current] : null;
  // Before the first change (or with no timings) the song "starts on" its first chord.
  const shownIndex = Math.max(0, current);
  const shownShape = view.events[shownIndex]?.shape;
  const nextEvent = view.events.slice(shownIndex + 1).find((e) => e.shape && e.shape !== shownShape) ?? null;

  // Where we are: section, bar and the strum step inside the bar.
  // Recomputed every frame while playing, so there's nothing to memoise.
  const position = (() => {
    for (let si = 0; si < view.sections.length; si++) {
      const s = view.sections[si];
      for (const b of s.bars) {
        if (b.events.some((e) => e.index === nowEvent?.index)) {
          let step = -1;
          if (b.start !== null) {
            const barLen = b.end !== null ? b.end - b.start : song.bpm ? (60 / song.bpm) * song.beatsPerBar : 0;
            if (barLen > 0) step = Math.floor(((time - b.start) / barLen) * s.pattern.groove.steps);
            if (step >= s.pattern.groove.steps) step = -1;
          }
          return { section: si, step };
        }
      }
    }
    return { section: -1, step: -1 };
  })();

  const section = view.sections[position.section] ?? view.sections[0];

  const seek = (t: number) => {
    const p = player.current;
    if (!p) return;
    p.seekTo(Math.max(0, t - 0.15), true);
    p.playVideo();
    setTime(t);
  };

  const playPause = () => {
    const p = player.current;
    if (!p) return;
    if (rolling) p.pauseVideo();
    else p.playVideo();
  };

  // Stop: pause and go back to the start, ready to play from the top.
  const stop = () => {
    const p = player.current;
    if (!p) return;
    p.pauseVideo();
    p.seekTo(0, true);
    setLoop(null);
    setTime(0);
    if (follow) chartRef.current?.scrollIntoView({ block: "start", behavior: "smooth" });
  };

  const skip = (by: number) => {
    const p = player.current;
    if (!p) return;
    const t = Math.max(0, p.getCurrentTime() + by);
    p.seekTo(t, true);
    setTime(t);
  };

  const toggleLoop = (si: number) => {
    const s = view.sections[si];
    if (loop?.section === si || s.start === null) {
      setLoop(null);
      return;
    }
    const end = s.end ?? (player.current?.getDuration() || s.start + 30);
    setLoop({ section: si, a: Math.max(0, s.start - 0.2), b: end });
    seek(s.start);
  };

  // Keyboard: space plays and pauses, arrows skip five seconds.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target.closest("input, textarea, select, button, [contenteditable]")) return;
      const p = player.current;
      if (!p) return;
      if (e.code === "Space") {
        e.preventDefault();
        if (p.getPlayerState() === PLAYING) p.pauseVideo();
        else p.playVideo();
      } else if (e.code === "ArrowLeft" || e.code === "ArrowRight") {
        e.preventDefault();
        p.seekTo(Math.max(0, p.getCurrentTime() + (e.code === "ArrowLeft" ? -5 : 5)), true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [player]);

  // Keep the bar playing now on screen.
  useEffect(() => {
    if (!follow || !playing) return;
    const el = chartRef.current?.querySelector("[data-active]");
    if (!el) return;
    const r = el.getBoundingClientRect();
    if (r.top < 120 || r.bottom > window.innerHeight - 40) el.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [current, follow, playing]);

  const minor = parseKey(song.originalKey)?.minor ?? false;
  const keys = minor ? ALL_MINOR_KEYS : ALL_KEYS;
  const easy = mode === "easy";

  return (
    <div className={styles.page}>
      <div className={styles.top}>
        <div className={styles.videoCol}>
          <div className={styles.video}>
            {videoId ? <div ref={ytHost} className={styles.frame} /> : <div className={styles.noVideo}>No video for this song yet.</div>}
            {ytError && <p className={styles.videoError}>{ytError}</p>}
          </div>
          {videoId && (
            <div className={styles.transport} role="group" aria-label="Playback">
              <button type="button" className={`btn btn-primary ${styles.play}`} onClick={playPause} disabled={!ytReady}>
                {rolling ? <PauseIcon /> : <PlayIcon />}
                {rolling ? "Pause" : "Play"}
              </button>
              <button type="button" className="btn" onClick={stop} disabled={!ytReady}>
                <StopIcon />
                Stop
              </button>
              <button type="button" className={`btn btn-quiet ${styles.skip}`} onClick={() => skip(-5)} disabled={!ytReady} aria-label="Back 5 seconds">
                −5s
              </button>
              <button type="button" className={`btn btn-quiet ${styles.skip}`} onClick={() => skip(5)} disabled={!ytReady} aria-label="Forward 5 seconds">
                +5s
              </button>
              <span className={styles.clock} aria-hidden="true">
                {clock(time)}
                {duration > 0 && ` / ${clock(duration)}`}
              </span>
            </div>
          )}
          <div className={styles.controls}>
            <div className="segmented" role="group" aria-label="Difficulty">
              <button type="button" aria-pressed={easy} onClick={() => setMode("easy")}>Easy</button>
              <button type="button" aria-pressed={!easy} onClick={() => setMode("advanced")}>Advanced</button>
            </div>
            <label className={styles.inline}>
              <span>Key</span>
              <select className="select" value={key} onChange={(e) => setKey(e.target.value)}>
                {keys.map((k) => (
                  <option key={k} value={k}>
                    {k}
                    {k === song.originalKey ? " (original)" : ""}
                  </option>
                ))}
              </select>
            </label>
            <label className={styles.inline}>
              <span>Capo</span>
              <select className="select" value={String(capo)} onChange={(e) => setCapo(e.target.value === "auto" ? "auto" : Number(e.target.value))}>
                <option value="auto">Best ({autoCapo === 0 ? "none" : autoCapo})</option>
                {Array.from({ length: 8 }, (_, i) => (
                  <option key={i} value={i}>
                    {i === 0 ? "No capo" : `Fret ${i}`}
                  </option>
                ))}
              </select>
            </label>
            <div className="segmented" role="group" aria-label="Show chords as">
              <button type="button" aria-pressed={!numbers} onClick={() => setNumbers(false)}>Chords</button>
              <button type="button" aria-pressed={numbers} onClick={() => setNumbers(true)}>Numbers</button>
            </div>
            <label className={styles.inline}>
              <span>Speed</span>
              <select className="select" value={rate} onChange={(e) => setRate(Number(e.target.value))} disabled={!videoId}>
                {RATES.map((r) => (
                  <option key={r} value={r}>
                    {r === 1 ? "Normal" : `${Math.round(r * 100)}%`}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <p className={styles.capoLine}>
            {view.capo > 0 ? (
              <>
                <strong>Capo on fret {view.capo}.</strong> Play {view.shapeKey} shapes; it sounds in {view.soundingKey}.
              </>
            ) : (
              <>No capo. Playing in {view.soundingKey}.</>
            )}
            {song.bpm > 0 && <> · {song.bpm} BPM</>}
            {song.spotifyUrl && (
              <>
                {" · "}
                <a href={song.spotifyUrl} target="_blank" rel="noreferrer">
                  Listen on Spotify
                </a>
              </>
            )}
          </p>
        </div>

        <aside className={styles.now} data-hue={section ? sectionHue(section.kind) : "plain"} aria-label="Now playing">
          <div className={styles.nowHead}>
            <span className={styles.sectionName}>{section?.label ?? "Song"}</span>
            {loop && (
              <button type="button" className="btn btn-quiet btn-small" onClick={() => setLoop(null)}>
                Stop looping
              </button>
            )}
          </div>
          {!synced && (
            <p className={styles.unsynced}>
              {videoId ? "Not synced to the video yet. Start on this chord and follow the chart below." : "Start on this chord and follow the chart below."}
            </p>
          )}
          {view.events.length > 0 && (
            <div className={styles.chords} aria-live="off">
              <div className={styles.nowChord}>
                <span className={styles.big}>{nowEvent?.label ?? view.events[0]?.label ?? "–"}</span>
                {(nowEvent?.shape ?? view.events[0]?.shape) && (
                  <ChordDiagram chord={(nowEvent?.shape ?? view.events[0]?.shape)!} easy={easy} size="l" active={playing} />
                )}
              </div>
              <div className={styles.nextChord}>
                <span className={styles.nextLabel}>Next</span>
                <span className={styles.mid}>{nextEvent?.label ?? "–"}</span>
                {nextEvent?.shape && <ChordDiagram chord={nextEvent.shape} easy={easy} size="s" />}
              </div>
            </div>
          )}
          {section && (
            <div className={styles.strum}>
              <div className={styles.strumHead}>
                <span>Strum</span>
                <span className="muted">{section.pattern.sparse ? "One strum, let it ring" : section.pattern.name}</span>
              </div>
              <StrumGrid pattern={section.pattern} beatsPerBar={song.beatsPerBar} mode={mode} active={playing ? position.step : -1} />
            </div>
          )}
        </aside>
      </div>

      {view.errors.length > 0 && (
        <p className="error-text">Part of this chart couldn&apos;t be read. Your teacher can fix it in the editor.</p>
      )}

      <div className={styles.chartHead}>
        <h2>Chart</h2>
        <label className={styles.follow}>
          <input type="checkbox" checked={follow} onChange={(e) => setFollow(e.target.checked)} /> Follow the video
        </label>
      </div>
      <div ref={chartRef}>
        <ChartView
          view={view}
          beatsPerBar={song.beatsPerBar}
          activeEvent={current}
          onSeek={videoId ? seek : undefined}
          onLoopSection={videoId && synced ? toggleLoop : undefined}
          loopedSection={loop?.section ?? null}
        />
      </div>

      {view.shapes.length > 0 && (
        <section className={styles.shapes} aria-labelledby="shapes-title">
          <h2 id="shapes-title">Chords in this song</h2>
          <div className={styles.shapeRow}>
            {view.shapes.map((s) => (
              <ChordDiagram key={s} chord={s} easy={easy} size="m" active={nowEvent?.shape === s} />
            ))}
          </div>
        </section>
      )}
      {song.notes && (
        <section className={styles.notes} aria-labelledby="notes-title">
          <h2 id="notes-title">Teacher&apos;s notes</h2>
          <p>{song.notes}</p>
        </section>
      )}
    </div>
  );
}

const clock = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

const PlayIcon = () => (
  <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
    <path d="M4 2.5v11l9-5.5z" fill="currentColor" />
  </svg>
);

const PauseIcon = () => (
  <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
    <rect x="3" y="2.5" width="3.5" height="11" rx="1" fill="currentColor" />
    <rect x="9.5" y="2.5" width="3.5" height="11" rx="1" fill="currentColor" />
  </svg>
);

const StopIcon = () => (
  <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
    <rect x="3" y="3" width="10" height="10" rx="1.5" fill="currentColor" />
  </svg>
);
