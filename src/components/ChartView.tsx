"use client";

import type { SongView } from "@/lib/songView";
import { sectionHue } from "@/lib/sections";
import styles from "./ChartView.module.css";

interface Props {
  view: SongView;
  beatsPerBar: number;
  /** Chord-change index playing now, or -1. */
  activeEvent?: number;
  /** Beat playing now inside the active bar (0-based), or -1. */
  activeBeat?: number;
  onSeek?: (time: number) => void;
  onLoopSection?: (sectionIndex: number) => void;
  loopedSection?: number | null;
  /** Editor: each chord becomes its own button, for picking one to re-sync. */
  onPick?: (eventIndex: number) => void;
  picked?: number | null;
}

/** The whole song as rows of bar panes, tinted by section. */
export function ChartView({ view, beatsPerBar, activeEvent = -1, activeBeat = -1, onSeek, onLoopSection, loopedSection = null, onPick, picked = null }: Props) {
  if (!view.sections.length) {
    return <p className="muted">No chart yet.</p>;
  }
  return (
    <div className={styles.chart}>
      {view.sections.map((s, si) => {
        const hue = sectionHue(s.kind);
        return (
          <section key={si} className={styles.section} data-hue={hue} aria-label={s.label}>
            <header className={styles.head}>
              <h3 className={styles.label}>{s.label}</h3>
              {onLoopSection && s.start !== null && (
                <button
                  type="button"
                  className={`btn btn-quiet btn-small ${styles.loop}`}
                  aria-pressed={loopedSection === si}
                  onClick={() => onLoopSection(si)}
                >
                  {loopedSection === si ? "Looping" : "Loop"}
                </button>
              )}
            </header>
            <ol className={styles.bars}>
              {s.bars.map((b, bi) => {
                const isActive = b.events.some((e) => e.index === activeEvent);
                const seekable = !onPick && onSeek && b.start !== null;
                const content = (
                  <>
                    {b.cue && <span className={styles.cue}>{b.cue}</span>}
                    <span className={styles.chords}>
                      {b.events.length === 0 && <span className={styles.chord}>–</span>}
                      {b.events.map((e) =>
                        onPick ? (
                          <button
                            type="button"
                            key={e.index}
                            className={`${styles.chord} ${styles.pick}`}
                            data-now={e.index === activeEvent || undefined}
                            data-picked={e.index === picked || undefined}
                            data-untimed={e.time === null || undefined}
                            style={{ gridColumn: `${e.beat + 1} / span 1` }}
                            onClick={() => onPick(e.index)}
                            aria-pressed={e.index === picked}
                            title={e.time === null ? "Not synced yet" : `At ${e.time.toFixed(1)} s`}
                          >
                            {e.label}
                          </button>
                        ) : (
                          <span
                            key={e.index}
                            className={styles.chord}
                            data-now={e.index === activeEvent || undefined}
                            style={{ gridColumn: `${e.beat + 1} / span 1` }}
                          >
                            {e.label}
                          </span>
                        ),
                      )}
                    </span>
                    {isActive && activeBeat >= 0 && (
                      <span className={styles.beats} aria-hidden="true">
                        {Array.from({ length: beatsPerBar }, (_, i) => (
                          <i key={i} data-now={i === activeBeat || undefined} data-past={i < activeBeat || undefined} />
                        ))}
                      </span>
                    )}
                  </>
                );
                return (
                  <li key={bi} className={styles.bar} data-active={isActive || undefined} style={{ ["--beats" as string]: beatsPerBar }}>
                    {seekable ? (
                      <button type="button" className={styles.barButton} onClick={() => onSeek(b.start!)} aria-label={`Play from bar ${bi + 1} of ${s.label}`}>
                        {content}
                      </button>
                    ) : (
                      <div className={styles.barButton}>{content}</div>
                    )}
                  </li>
                );
              })}
            </ol>
          </section>
        );
      })}
    </div>
  );
}
