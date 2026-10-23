"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { analyzeAudio, type AnalysisResult } from "@/lib/analysis/analyze";
import { chordProbabilities, type ChordProbs } from "@/lib/analysis/chordModel";
import { cqtFrames } from "@/lib/analysis/cqt";
import { FetchAudioError, fetchYouTubeAudio, type FetchedAudio } from "@/lib/analysis/fetchAudio";
import { CaptureError, micCaptureSupported, startMicCapture, startTabCapture, tabCaptureSupported, type CaptureHandle } from "@/lib/analysis/capture";
import { ENDED, PLAYING, type YTPlayer } from "./useYouTube";
import styles from "./AnalysePanel.module.css";

interface Props {
  disabled: boolean;
  /** Tab listening drives the embedded player, so it waits for it. */
  playerReady: boolean;
  videoUrl: string;
  beatsPerBar: number;
  player: React.RefObject<YTPlayer | null>;
  onResult: (r: AnalysisResult) => void;
  onUndo?: () => void;
  hasChart: boolean;
}

type Phase =
  | { kind: "idle" }
  | { kind: "asking"; source: "tab" | "mic" }
  | { kind: "downloading"; bytes: number }
  | { kind: "listening" }
  | { kind: "working"; fraction: number; stage: string }
  | { kind: "done"; result: AnalysisResult }
  | { kind: "error"; message: string };

const noop = () => () => {};
const clock = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

export function AnalysePanel({ disabled, playerReady, videoUrl, beatsPerBar, player, onResult, onUndo, hasChart }: Props) {
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });
  const supported = useSyncExternalStore(noop, tabCaptureSupported, () => true);
  const micSupported = useSyncExternalStore(noop, micCaptureSupported, () => true);
  const [elapsed, setElapsed] = useState(0);
  const [level, setLevel] = useState(0);
  const handle = useRef<CaptureHandle | null>(null);
  const download = useRef<AbortController | null>(null);
  const finishing = useRef(false);

  // Keep the screen on while drafting: a locked phone pauses the page and stalls the draft.
  const busy = phase.kind === "downloading" || phase.kind === "listening" || phase.kind === "working";
  useWakeLock(busy);

  // Throw the audio away if the editor closes mid-capture.
  useEffect(
    () => () => {
      handle.current?.cancel();
      download.current?.abort();
    },
    [],
  );

  const analyse = async ({ samples, stems }: FetchedAudio, toVideoTime?: (t: number) => number | null) => {
    // The trained chord model does the chords; if it can't load, the built-in engine still drafts.
    let chordProbs: ChordProbs | undefined;
    try {
      setPhase({ kind: "working", fraction: 0.02, stage: "Loading the chord model" });
      // Separated songs give the model the instruments without vocals or drums.
      const frames = await cqtFrames(stems?.instruments ?? samples, () => new Promise((r) => setTimeout(r, 0)));
      setPhase({ kind: "working", fraction: 0.15, stage: "Recognising chords" });
      chordProbs = await chordProbabilities(frames, (f) => setPhase({ kind: "working", fraction: 0.15 + 0.35 * f, stage: "Recognising chords" }));
    } catch (e) {
      console.warn("Chord model unavailable, using the built-in engine:", e);
    }
    const base = chordProbs ? 0.5 : 0;
    const result = await analyzeAudio(samples, {
      beatsPerBar,
      toVideoTime,
      chordProbs,
      stems,
      onProgress: (fraction, stage) => setPhase({ kind: "working", fraction: base + (1 - base) * fraction, stage }),
    });
    onResult(result);
    setPhase({ kind: "done", result });
  };

  // Main path: the server fetches the audio from YouTube and streams it here.
  const fromYouTube = async () => {
    const ctrl = new AbortController();
    download.current = ctrl;
    setPhase({ kind: "downloading", bytes: 0 });
    try {
      const audio = await fetchYouTubeAudio(videoUrl, (bytes) => setPhase({ kind: "downloading", bytes }), ctrl.signal);
      download.current = null;
      setPhase({ kind: "working", fraction: 0, stage: "Preparing the audio" });
      // The file starts where the video starts, so audio time is video time.
      await analyse(audio);
    } catch (e) {
      if (ctrl.signal.aborted) return;
      setPhase({
        kind: "error",
        message: e instanceof FetchAudioError ? e.message : "Something went wrong while analysing. Try again, or chart this one by hand.",
      });
    } finally {
      download.current = null;
    }
  };

  const finish = async () => {
    const h = handle.current;
    if (!h || finishing.current) return;
    finishing.current = true;
    handle.current = null;
    player.current?.pauseVideo();
    setPhase({ kind: "working", fraction: 0, stage: "Preparing the audio" });
    try {
      const capture = await h.finish();
      await analyse({ samples: capture.samples }, capture.toVideoTime);
    } catch (e) {
      setPhase({
        kind: "error",
        message: e instanceof CaptureError ? e.message : "Something went wrong while analysing. Try again, or chart this one by hand.",
      });
    } finally {
      finishing.current = false;
    }
  };

  // While listening: update the clock and meter, and stop when the video ends.
  useEffect(() => {
    if (phase.kind !== "listening") return;
    const id = window.setInterval(() => {
      const h = handle.current;
      if (!h) return;
      setElapsed(h.elapsed());
      setLevel(h.level());
      if (player.current?.getPlayerState() === ENDED) void finish();
    }, 200);
    return () => window.clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase.kind]);

  const videoTime = () => {
    const p = player.current;
    return { time: p?.getCurrentTime() ?? 0, playing: p?.getPlayerState() === PLAYING };
  };

  const start = async (source: "tab" | "mic") => {
    setPhase({ kind: "asking", source });
    try {
      handle.current =
        source === "mic"
          ? await startMicCapture(videoTime)
          : // The second argument fires when the person presses "Stop sharing" in the browser bar.
            await startTabCapture(videoTime, () => void finish());
    } catch (e) {
      setPhase({ kind: "error", message: e instanceof CaptureError ? e.message : "Couldn't start listening. Try again." });
      return;
    }
    setElapsed(0);
    setPhase({ kind: "listening" });
    const p = player.current;
    p?.seekTo(0, true);
    p?.playVideo();
  };

  const cancel = () => {
    handle.current?.cancel();
    handle.current = null;
    player.current?.pauseVideo();
    setPhase({ kind: "idle" });
  };

  return (
    <div className={styles.panel}>
      <h3>Draft a chart from the video</h3>

      {phase.kind === "idle" ? (
        <>
          <p className="muted">
            The app fetches the song&apos;s audio from YouTube and writes the chords, sections, timings and strum patterns.
            {hasChart && " It replaces the chart below, and you can undo."}
          </p>
          <button type="button" className="btn btn-primary" onClick={fromYouTube} disabled={disabled}>
            Draft from YouTube
          </button>
          <p className={styles.fine}>Takes about a minute; keep this screen open. The audio is analysed on this device and never saved.</p>
          {micSupported && (
            <details className={styles.backup}>
              <summary>Backup: listen through the microphone</summary>
              <ol className={styles.steps}>
                <li>Turn the volume up and keep the room quiet.</li>
                <li>Press the button below and allow the microphone.</li>
                <li>The video plays from the start. Stop early for a quick draft, or let it finish for the whole song.</li>
              </ol>
              <button type="button" className="btn" onClick={() => start("mic")} disabled={disabled || !playerReady}>
                Listen through the microphone
              </button>
            </details>
          )}
          {supported && (
            <details className={styles.backup}>
              <summary>Backup: listen to this tab (Chrome or Edge on a computer)</summary>
              <ol className={styles.steps}>
                <li>Press the button below.</li>
                <li>
                  In the window that opens, choose <strong>This tab</strong> (not the entire screen) and switch on <strong>Also share tab audio</strong>.
                </li>
                <li>Let the song play. Stop early for a quick draft, or let it finish for the whole song.</li>
              </ol>
              <button type="button" className="btn" onClick={() => start("tab")} disabled={disabled || !playerReady}>
                Listen to this tab
              </button>
            </details>
          )}
        </>
      ) : phase.kind === "asking" ? (
        <p className="muted" role="status">
          {phase.source === "mic" ? "Waiting for you to allow the microphone…" : "Waiting for you to share this tab…"}
        </p>
      ) : phase.kind === "downloading" ? (
        <>
          <p role="status">
            Fetching the audio from YouTube{phase.bytes > 0 ? ` (${(phase.bytes / 1048576).toFixed(1)} MB)` : ""}…
          </p>
          <div className={styles.row}>
            <button
              type="button"
              className="btn btn-quiet"
              onClick={() => {
                download.current?.abort();
                setPhase({ kind: "idle" });
              }}
            >
              Cancel
            </button>
          </div>
        </>
      ) : phase.kind === "listening" ? (
        <>
          <div className={styles.live} role="status">
            <span className={styles.time}>{clock(elapsed)}</span>
            <span className={styles.meter} aria-hidden="true">
              <span style={{ transform: `scaleX(${Math.max(0.02, level)})` }} />
            </span>
          </div>
          <p className="muted">{elapsed < 20 ? "Listening. Give it at least 20 seconds." : "Listening. Stop whenever you have enough."}</p>
          <div className={styles.row}>
            <button type="button" className="btn btn-primary" onClick={() => void finish()} disabled={elapsed < 20}>
              Stop and draft
            </button>
            <button type="button" className="btn btn-quiet" onClick={cancel}>
              Cancel
            </button>
          </div>
        </>
      ) : phase.kind === "working" ? (
        <div role="status">
          <p>{phase.stage}…</p>
          <span className={styles.progress} aria-hidden="true">
            <span style={{ transform: `scaleX(${Math.max(0.04, phase.fraction)})` }} />
          </span>
        </div>
      ) : phase.kind === "done" ? (
        <>
          <dl className={styles.summary}>
            <div>
              <dt>Key</dt>
              <dd>{phase.result.key}</dd>
            </div>
            <div>
              <dt>Tempo</dt>
              <dd>{phase.result.bpm} BPM</dd>
            </div>
            <div>
              <dt>Sections</dt>
              <dd>{phase.result.chart.split("\n").filter((l) => l.startsWith("[")).length}</dd>
            </div>
            <div>
              <dt>Chord fit</dt>
              <dd>{confidenceWord(phase.result.confidence.chords)}</dd>
            </div>
          </dl>
          <p className="muted">This is a draft. Check it against the video, fix any chords, then save.</p>
          <div className={styles.row}>
            {onUndo && (
              <button
                type="button"
                className="btn btn-quiet"
                onClick={() => {
                  onUndo();
                  setPhase({ kind: "idle" });
                }}
              >
                Undo draft
              </button>
            )}
            <button type="button" className="btn btn-quiet" onClick={() => setPhase({ kind: "idle" })}>
              Start again
            </button>
          </div>
        </>
      ) : (
        <>
          <p className="error-text" role="alert">
            {phase.message}
          </p>
          <button type="button" className="btn" onClick={() => setPhase({ kind: "idle" })}>
            Try again
          </button>
        </>
      )}
    </div>
  );
}

function confidenceWord(c: number) {
  if (c >= 0.7) return "Good";
  if (c >= 0.45) return "Fair";
  return "Rough";
}

/** Holds a screen wake lock while `on`, taking it again when the page comes back into view. */
function useWakeLock(on: boolean) {
  useEffect(() => {
    if (!on || !("wakeLock" in navigator)) return;
    let lock: WakeLockSentinel | null = null;
    let live = true;
    const take = async () => {
      if (document.visibilityState !== "visible") return;
      try {
        const l = await navigator.wakeLock.request("screen");
        if (live) lock = l;
        else void l.release();
      } catch {
        // Low battery mode or a browser that says no: drafting still works, the screen may just dim.
      }
    };
    void take();
    document.addEventListener("visibilitychange", take);
    return () => {
      live = false;
      document.removeEventListener("visibilitychange", take);
      void lock?.release();
    };
  }, [on]);
}
