"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { analyzeAudio, type AnalysisResult } from "@/lib/analysis/analyze";
import { CaptureError, startTabCapture, tabCaptureSupported, type CaptureHandle } from "@/lib/analysis/capture";
import { ENDED, PLAYING, type YTPlayer } from "./useYouTube";
import styles from "./AnalysePanel.module.css";

interface Props {
  disabled: boolean;
  beatsPerBar: number;
  player: React.RefObject<YTPlayer | null>;
  onResult: (r: AnalysisResult) => void;
  onUndo?: () => void;
  hasChart: boolean;
}

type Phase =
  | { kind: "idle" }
  | { kind: "asking" }
  | { kind: "listening" }
  | { kind: "working"; fraction: number; stage: string }
  | { kind: "done"; result: AnalysisResult }
  | { kind: "error"; message: string };

const noop = () => () => {};
const clock = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

export function AnalysePanel({ disabled, beatsPerBar, player, onResult, onUndo, hasChart }: Props) {
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });
  const supported = useSyncExternalStore(noop, tabCaptureSupported, () => true);
  const [elapsed, setElapsed] = useState(0);
  const [level, setLevel] = useState(0);
  const handle = useRef<CaptureHandle | null>(null);
  const finishing = useRef(false);

  // Throw the audio away if the editor closes mid-capture.
  useEffect(() => () => handle.current?.cancel(), []);

  const finish = async () => {
    const h = handle.current;
    if (!h || finishing.current) return;
    finishing.current = true;
    handle.current = null;
    player.current?.pauseVideo();
    setPhase({ kind: "working", fraction: 0, stage: "Preparing the audio" });
    try {
      const capture = await h.finish();
      const result = await analyzeAudio(capture.samples, {
        beatsPerBar,
        toVideoTime: capture.toVideoTime,
        onProgress: (fraction, stage) => setPhase({ kind: "working", fraction, stage }),
      });
      onResult(result);
      setPhase({ kind: "done", result });
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

  const start = async () => {
    setPhase({ kind: "asking" });
    try {
      handle.current = await startTabCapture(
        () => {
          const p = player.current;
          return { time: p?.getCurrentTime() ?? 0, playing: p?.getPlayerState() === PLAYING };
        },
        // The person pressed "Stop sharing" in the browser bar.
        () => void finish(),
      );
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

      {!supported ? (
        <p className="muted">
          This needs Chrome or Edge on a laptop or desktop. Phones can&apos;t share tab audio, but students can still practise here.
        </p>
      ) : phase.kind === "idle" || phase.kind === "asking" ? (
        <>
          <p className="muted">
            The app listens while the video plays from the start, then writes the chords, sections, timings and strum patterns.
            {hasChart && " It replaces the chart below, and you can undo."}
          </p>
          <ol className={styles.steps}>
            <li>Press the button below.</li>
            <li>In the window that opens, choose <strong>This tab</strong> and switch on <strong>Also share tab audio</strong>.</li>
            <li>Let the song play. Stop early for a quick draft, or let it finish for the whole song.</li>
          </ol>
          <button type="button" className="btn btn-primary" onClick={start} disabled={disabled || phase.kind === "asking"}>
            {phase.kind === "asking" ? "Waiting for you to share…" : "Listen and draft"}
          </button>
          <p className={styles.fine}>Audio is analysed on this device and never saved or uploaded.</p>
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
              Listen again
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
