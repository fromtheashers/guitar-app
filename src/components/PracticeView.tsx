"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import type { Song } from "@/lib/db";
import { parseKey } from "@/lib/music/chords";
import { buildView, eventAt, ALL_KEYS, ALL_MINOR_KEYS, type Mode } from "@/lib/songView";
import { sectionHue } from "@/lib/sections";
import { youtubeId } from "@/lib/youtube";
import { ChartView } from "./ChartView";
import { ChordDiagram } from "./ChordDiagram";
import { SongGlance } from "./SongGlance";
import { StrumGrid } from "./StrumGrid";
import { BUFFERING, PLAYING, useYouTube } from "./useYouTube";
import { useWakeLock } from "./useWakeLock";
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

// Phones and small tablets: the player docks to the bottom of the screen.
const DOCKED = "(max-width: 960px)";

function useDocked() {
  return useSyncExternalStore(
    (onChange) => {
      const m = window.matchMedia(DOCKED);
      m.addEventListener("change", onChange);
      return () => m.removeEventListener("change", onChange);
    },
    () => window.matchMedia(DOCKED).matches,
    () => false,
  );
}

/** True once nobody has touched the page or played the song for ten minutes. */
function useIdle(rolling: boolean) {
  const [idle, setIdle] = useState(false);
  useEffect(() => {
    if (rolling) return;
    let last = Date.now();
    const touch = () => {
      last = Date.now();
      setIdle(false);
    };
    const check = window.setInterval(() => setIdle(Date.now() - last > 10 * 60_000), 30_000);
    const events = ["pointerdown", "keydown", "scroll"] as const;
    events.forEach((e) => window.addEventListener(e, touch, { passive: true }));
    return () => {
      window.clearInterval(check);
      events.forEach((e) => window.removeEventListener(e, touch));
    };
  }, [rolling]);
  return idle && !rolling;
}

export function PracticeView({ song, initialKey }: { song: Song; initialKey?: string }) {
  const [mode, setMode] = usePref<Mode>("pref:mode", "easy");
  const [numbers, setNumbers] = usePref<boolean>("pref:numbers", false);
  const [follow, setFollow] = usePref<boolean>("pref:follow", true);
  const [glanceOpen, setGlanceOpen] = usePref<boolean>("pref:glance", true);
  const [key, setKey] = useState(initialKey && parseKey(initialKey) ? initialKey : song.originalKey);
  const [capo, setCapo] = useState<number | "auto">("auto");
  const [rate, setRate] = useState(1);
  const [more, setMore] = useState(false);
  const [loop, setLoop] = useState<{ section: number; a: number; b: number } | null>(null);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const pageRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<HTMLDivElement>(null);
  const playerRef = useRef<HTMLElement>(null);
  const docked = useDocked();

  const videoId = youtubeId(song.youtubeUrl);
  const { host: ytHost, player, ready: ytReady, state: ytState, error: ytError } = useYouTube(videoId);
  const playing = ytState === PLAYING;
  // Buffering counts as playing for the button, so it doesn't flicker to "Play".
  const rolling = playing || ytState === BUFFERING;

  // Keep the screen on while practising; let it sleep after ten quiet minutes.
  const idle = useIdle(rolling);
  useWakeLock(!idle);

  const view = useMemo(() => buildView(song, { mode, key, capo, numbers }), [song, mode, key, capo, numbers]);
  const autoCapo = useMemo(() => buildView(song, { mode, key, capo: "auto", numbers: false }).capo, [song, mode, key]);
  const synced = view.events.some((e) => e.time !== null);
  const barLength = song.bpm > 0 ? (60 / song.bpm) * song.beatsPerBar : 2;

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

  // The length is known once the player is ready, before anyone presses Play.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (ytReady) setDuration(player.current?.getDuration() ?? 0);
  }, [ytReady, player]);

  useEffect(() => {
    player.current?.setPlaybackRate(rate);
  }, [rate, ytReady, player]);

  // Room under the chart for the docked player, whatever height it ends up.
  useEffect(() => {
    const el = playerRef.current;
    const page = pageRef.current;
    if (!el || !page) return;
    const ro = new ResizeObserver(() => page.style.setProperty("--dock", `${el.offsetHeight}px`));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const current = eventAt(view.events, time);
  const nowEvent = current >= 0 ? view.events[current] : null;
  // Before the first change (or with no timings) the song "starts on" its first chord.
  const shownIndex = Math.max(0, current);
  const shown = view.events[shownIndex] ?? null;
  const nextEvent = view.events.slice(shownIndex + 1).find((e) => e.shape && e.shape !== shown?.shape) ?? null;

  // Where we are: section, beat in the bar and the strum step inside the bar.
  // Recomputed every frame while playing, so there's nothing to memoise.
  const position = (() => {
    for (let si = 0; si < view.sections.length; si++) {
      const s = view.sections[si];
      for (const b of s.bars) {
        if (b.events.some((e) => e.index === nowEvent?.index)) {
          let step = -1;
          let beat = -1;
          if (b.start !== null) {
            const len = b.end !== null ? b.end - b.start : song.bpm ? barLength : 0;
            const at = len > 0 ? (time - b.start) / len : -1;
            if (at >= 0 && at < 1) {
              step = Math.floor(at * s.pattern.groove.steps);
              beat = Math.floor(at * song.beatsPerBar);
            }
          }
          return { section: si, step, beat };
        }
      }
    }
    return { section: -1, step: -1, beat: -1 };
  })();

  const section = view.sections[position.section] ?? view.sections[0];
  const lastTime = view.events.reduce((m, e) => (e.time !== null && e.time > m ? e.time : m), 0);
  const length = duration || (lastTime ? lastTime + barLength : 0);

  const seek = (t: number) => {
    const p = player.current;
    if (!p) return;
    p.seekTo(Math.max(0, t - 0.15), true);
    p.playVideo();
    setTime(t);
  };

  // Tapping a bar starts one bar early, so there's time to get the hand in place.
  const playFrom = (t: number) => seek(Math.max(0, t - barLength));

  const scrub = (t: number) => {
    const p = player.current;
    if (!p) return;
    p.seekTo(t, true);
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
    const chart = chartRef.current;
    if (follow && chart) window.scrollTo({ top: window.scrollY + chart.getBoundingClientRect().top - 120, behavior: "smooth" });
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
    playFrom(s.start);
  };

  // Keyboard: space plays and pauses, arrows skip five seconds (paused too).
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
        const t = Math.max(0, p.getCurrentTime() + (e.code === "ArrowLeft" ? -5 : 5));
        p.seekTo(t, true);
        setTime(t);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [player]);

  // Auto-scroll: keep the bar playing now in the part of the screen the player doesn't cover.
  useEffect(() => {
    if (!follow || current < 0) return;
    const el = chartRef.current?.querySelector("[data-active]");
    if (!el) return;
    const r = el.getBoundingClientRect();
    const top = 64;
    const bottom = (docked ? (playerRef.current?.getBoundingClientRect().top ?? window.innerHeight) : window.innerHeight) - 16;
    if (r.top >= top && r.bottom <= bottom) return;
    window.scrollTo({ top: window.scrollY + r.top - (top + (bottom - top) * 0.3), behavior: "smooth" });
  }, [current, follow, docked]);

  const minor = parseKey(song.originalKey)?.minor ?? false;
  const keys = minor ? ALL_MINOR_KEYS : ALL_KEYS;
  const easy = mode === "easy";
  const pct = (t: number) => `${Math.min(100, Math.max(0, (t / length) * 100))}%`;
  const settingsSummary = [
    `Key ${key}`,
    view.capo > 0 ? `Capo ${view.capo}` : "No capo",
    numbers ? "Numbers" : null,
    rate !== 1 ? `${Math.round(rate * 100)}% speed` : null,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <div ref={pageRef} className={styles.page}>
      <div className={styles.main}>
        <div className={styles.video}>
          {videoId ? <div ref={ytHost} className={styles.frame} /> : <div className={styles.noVideo}>No video for this song yet.</div>}
          {ytError && <p className={styles.videoError}>{ytError}</p>}
        </div>

        <div className={styles.controls}>
          <div className="segmented" role="group" aria-label="Difficulty">
            <button type="button" aria-pressed={easy} onClick={() => setMode("easy")}>Easy</button>
            <button type="button" aria-pressed={!easy} onClick={() => setMode("advanced")}>Advanced</button>
          </div>
          <button
            type="button"
            className={`btn btn-small ${styles.moreToggle}`}
            aria-expanded={more}
            aria-controls="song-settings"
            onClick={() => setMore(!more)}
          >
            <span className={styles.moreText}>{settingsSummary}</span>
            <ChevronIcon open={more} />
          </button>
          <div id="song-settings" className={styles.more} data-open={more || undefined}>
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

        {view.errors.length > 0 && (
          <p className="error-text">Part of this chart couldn&apos;t be read. Your teacher can fix it in the editor.</p>
        )}

        <SongGlance view={view} beatsPerBar={song.beatsPerBar} bpm={song.bpm} open={glanceOpen} onToggle={setGlanceOpen} />

        <h2 className={styles.chartTitle}>Chart</h2>
        {!synced && view.events.length > 0 && (
          <p className={styles.unsynced}>
            {videoId ? "Not synced to the video yet. Start on the first chord and follow the chart." : "Start on the first chord and follow the chart."}
          </p>
        )}
        <div ref={chartRef}>
          <ChartView
            view={view}
            beatsPerBar={song.beatsPerBar}
            activeEvent={current}
            activeBeat={position.beat}
            onSeek={videoId ? playFrom : undefined}
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

      {/* What the chart can't show: the shape to hold and the strum, kept in view. */}
      <aside ref={playerRef} className={styles.player} data-hue={section ? sectionHue(section.kind) : "plain"} aria-label="Now playing">
        {shown && (
          <div className={styles.nowRow}>
            <div className={styles.nowText}>
              <span className={styles.sectionName}>
                {section?.label ?? "Song"}
                {loop && (
                  <button type="button" className={styles.unloop} onClick={() => setLoop(null)}>
                    Stop loop
                  </button>
                )}
              </span>
              <span className={styles.nowName}>{shown.label}</span>
            </div>
            {shown.shape && <ChordDiagram chord={shown.shape} easy={easy} size={docked ? "s" : "m"} active={playing} caption={false} />}
            <div className={styles.next}>
              <div className={styles.nextText}>
                <span className={styles.nextLabel}>Next</span>
                <span className={styles.nextName}>{nextEvent?.label ?? "–"}</span>
              </div>
              {nextEvent?.shape && <ChordDiagram chord={nextEvent.shape} easy={easy} size="s" caption={false} />}
            </div>
          </div>
        )}
        {section && (
          <div className={styles.strum}>
            <div className={styles.strumHead}>
              <span>Strum</span>
              <span className="muted">{section.pattern.sparse ? "One strum, let it ring" : section.pattern.name}</span>
            </div>
            <StrumGrid pattern={section.pattern} beatsPerBar={song.beatsPerBar} mode={mode} active={playing ? position.step : -1} showDrums={!docked} />
          </div>
        )}
        {videoId && (
          <>
            <div className={styles.progress}>
              <span className={styles.clock}>{clock(time)}</span>
              <div className={styles.track}>
                {length > 0 &&
                  view.sections.map((s, si) =>
                    s.start === null ? null : (
                      <span
                        key={si}
                        className={styles.mark}
                        data-hue={sectionHue(s.kind)}
                        style={{ left: pct(s.start), width: `calc(${pct((s.end ?? length) - s.start)} - 2px)` }}
                        title={s.label}
                      />
                    ),
                  )}
                <input
                  type="range"
                  className={styles.scrub}
                  min={0}
                  max={Math.max(1, Math.round(length))}
                  step={1}
                  value={Math.min(time, length)}
                  onChange={(e) => scrub(Number(e.target.value))}
                  disabled={!ytReady}
                  aria-label="Song position"
                  aria-valuetext={`${clock(time)} of ${clock(length)}${section ? `, ${section.label}` : ""}`}
                />
              </div>
              <span className={styles.clock}>{clock(length)}</span>
            </div>
            <div className={styles.transport} role="group" aria-label="Playback">
              <button type="button" className={`btn btn-primary ${styles.play}`} onClick={playPause} disabled={!ytReady}>
                {rolling ? <PauseIcon /> : <PlayIcon />}
                {rolling ? "Pause" : "Play"}
              </button>
              <button type="button" className="btn" onClick={stop} disabled={!ytReady} aria-label="Stop">
                <StopIcon />
                <span className={styles.stopText}>Stop</span>
              </button>
              <button type="button" className={`btn btn-quiet ${styles.skip}`} onClick={() => skip(-5)} disabled={!ytReady} aria-label="Back 5 seconds">
                −5s
              </button>
              <button type="button" className={`btn btn-quiet ${styles.skip}`} onClick={() => skip(5)} disabled={!ytReady} aria-label="Forward 5 seconds">
                +5s
              </button>
              <label className={styles.follow}>
                <input type="checkbox" checked={follow} onChange={(e) => setFollow(e.target.checked)} />
                Auto-scroll
              </label>
            </div>
          </>
        )}
      </aside>
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

const ChevronIcon = ({ open }: { open: boolean }) => (
  <svg viewBox="0 0 12 12" width="12" height="12" aria-hidden="true" style={{ transform: open ? "rotate(180deg)" : undefined }}>
    <path d="M3 4.5 6 7.5 9 4.5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);
