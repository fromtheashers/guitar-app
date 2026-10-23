"use client";

import { useRef } from "react";
import { countLabels, slotsPerBeat, strokesForMode, type Stroke, type StrumPattern } from "@/lib/music/strum";
import styles from "./StrumGrid.module.css";

type Lane = "kick" | "snare" | "hat";

interface Props {
  pattern: StrumPattern;
  beatsPerBar: number;
  mode: "easy" | "advanced";
  /** Slot playing now, or -1. */
  active?: number;
  /** Teacher editing: lets drum panes and strokes be toggled. */
  onChange?: (pattern: StrumPattern) => void;
  showDrums?: boolean;
}

const LANES: { id: Lane; label: string }[] = [
  { id: "kick", label: "Kick" },
  { id: "snare", label: "Snare" },
  { id: "hat", label: "Hi-hat" },
];

const STROKE_NAME: Record<Stroke, string> = { D: "down", U: "up", x: "muted chuck", "-": "no strum" };

function Arrow({ stroke, accent }: { stroke: Stroke; accent: boolean }) {
  const w = accent ? 2.6 : 1.7;
  if (stroke === "D")
    return (
      <svg viewBox="0 0 16 20" aria-hidden="true">
        <path d="M8 2v15M3 12l5 5 5-5" fill="none" stroke="currentColor" strokeWidth={w} strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
  if (stroke === "U")
    return (
      <svg viewBox="0 0 16 20" aria-hidden="true">
        <path d="M8 18V3M3 8l5-5 5 5" fill="none" stroke="currentColor" strokeWidth={w} strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
  if (stroke === "x")
    return (
      <svg viewBox="0 0 16 20" aria-hidden="true">
        <path d="M4 6l8 8M12 6l-8 8" fill="none" stroke="currentColor" strokeWidth={w} strokeLinecap="round" />
      </svg>
    );
  return (
    <svg viewBox="0 0 16 20" aria-hidden="true">
      <circle cx="8" cy="10" r="1.4" fill="currentColor" />
    </svg>
  );
}

const NEXT_STROKE: Record<Stroke, Stroke> = { D: "U", U: "x", x: "-", "-": "D" };
const nextLevel = (v: number) => (v >= 0.75 ? 0.4 : v > 0 ? 0 : 1);

/** One bar of strumming on a grid of leaded panes, with the drum groove it came from above it. */
export function StrumGrid({ pattern, beatsPerBar, mode, active = -1, onChange, showDrums = true }: Props) {
  const steps = pattern.groove.steps;
  const { strokes, accents } = strokesForMode(pattern, beatsPerBar, mode);
  const labels = countLabels(steps, beatsPerBar);
  const per = slotsPerBeat(steps, beatsPerBar);
  const editable = Boolean(onChange);

  const setLane = (lane: Lane, i: number) => {
    if (!onChange) return;
    const values = [...pattern.groove[lane]];
    values[i] = nextLevel(values[i] ?? 0);
    onChange({ ...pattern, name: "Custom", groove: { ...pattern.groove, [lane]: values } });
  };
  const setStroke = (i: number) => {
    if (!onChange) return;
    const next = [...pattern.strokes];
    next[i] = NEXT_STROKE[next[i] ?? "-"];
    onChange({ ...pattern, name: "Custom", strokes: next, sparse: false });
  };
  const toggleAccent = (i: number) => {
    if (!onChange) return;
    const next = [...pattern.accents];
    next[i] = !next[i];
    onChange({ ...pattern, name: "Custom", accents: next });
  };

  // Phones have no right-click, so press and hold accents too. The click that
  // follows a hold is swallowed so the stroke doesn't also change.
  const hold = useRef<{ timer: number; fired: boolean }>({ timer: 0, fired: false });
  const holdToAccent = (i: number) => ({
    onPointerDown: (e: React.PointerEvent) => {
      if (e.button !== 0) return;
      hold.current.fired = false;
      window.clearTimeout(hold.current.timer);
      hold.current.timer = window.setTimeout(() => {
        hold.current.fired = true;
        toggleAccent(i);
        navigator.vibrate?.(15);
      }, 450);
    },
    onPointerUp: () => window.clearTimeout(hold.current.timer),
    onPointerLeave: () => window.clearTimeout(hold.current.timer),
    onPointerCancel: () => window.clearTimeout(hold.current.timer),
    onClick: () => {
      if (hold.current.fired) hold.current.fired = false;
      else setStroke(i);
    },
    onContextMenu: (e: React.MouseEvent) => {
      e.preventDefault();
      // A long touch also raises contextmenu on Android; the timer has it covered.
      if (hold.current.fired || (e.nativeEvent as PointerEvent).pointerType === "touch") return;
      toggleAccent(i);
    },
  });

  const words = strokes.map((s, i) => (s === "-" ? null : `${labels[i]} ${STROKE_NAME[s]}${accents[i] ? " accented" : ""}`)).filter(Boolean);

  return (
    <div className={styles.grid} style={{ ["--steps" as string]: steps }} data-editable={editable || undefined}>
      <p className="visually-hidden">Strum pattern: {words.join(", ") || "one strum, let it ring"}.</p>
      <div className={styles.row} aria-hidden="true">
        <span className={styles.lane} />
        {labels.map((l, i) => (
          <span key={i} className={styles.count} data-beat={i % per === 0 || undefined} data-active={i === active || undefined}>
            {l}
          </span>
        ))}
      </div>
      {showDrums &&
        LANES.map((lane) => (
          <div key={lane.id} className={styles.row}>
            <span className={styles.lane}>{lane.label}</span>
            {pattern.groove[lane.id].map((v, i) => {
              const cls = `${styles.pane} ${styles[lane.id]}`;
              const style = { ["--level" as string]: Math.round(Math.min(1, v) * 100) + "%" };
              return editable ? (
                <button
                  key={i}
                  type="button"
                  className={cls}
                  style={style}
                  data-active={i === active || undefined}
                  aria-label={`${lane.label} on ${labels[i] || "step " + (i + 1)}: ${v >= 0.75 ? "loud" : v > 0 ? "soft" : "off"}`}
                  onClick={() => setLane(lane.id, i)}
                />
              ) : (
                <span key={i} className={cls} style={style} data-active={i === active || undefined} aria-hidden="true" />
              );
            })}
          </div>
        ))}
      <div className={`${styles.row} ${styles.strokes}`}>
        <span className={styles.lane}>Strum</span>
        {strokes.map((s, i) =>
          editable ? (
            <button
              key={i}
              type="button"
              className={styles.stroke}
              data-stroke={s}
              data-accent={accents[i] || undefined}
              data-active={i === active || undefined}
              aria-label={`${labels[i] || "step " + (i + 1)}: ${STROKE_NAME[s]}${accents[i] ? ", accented" : ""}. Click to change; press and hold, or right-click, to accent.`}
              {...holdToAccent(i)}
            >
              <Arrow stroke={s} accent={accents[i]} />
            </button>
          ) : (
            <span key={i} className={styles.stroke} data-stroke={s} data-accent={accents[i] || undefined} data-active={i === active || undefined} aria-hidden="true">
              <Arrow stroke={s} accent={accents[i]} />
            </span>
          ),
        )}
      </div>
    </div>
  );
}
