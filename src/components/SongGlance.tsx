"use client";

import { useMemo } from "react";
import { glance, glanceChords } from "@/lib/glance";
import { sectionHue } from "@/lib/sections";
import type { SongView } from "@/lib/songView";
import styles from "./SongGlance.module.css";

interface Props {
  view: SongView;
  beatsPerBar: number;
  bpm: number;
  open: boolean;
  onToggle: (open: boolean) => void;
}

/** The whole song on one card, static: the map to read before playing. */
export function SongGlance({ view, beatsPerBar, bpm, open, onToggle }: Props) {
  const sections = useMemo(() => glance(view), [view]);
  const chords = useMemo(() => glanceChords(view), [view]);
  if (!sections.length) return null;
  return (
    <section className={styles.card} aria-labelledby="glance-title">
      <div className={styles.head}>
        <h2 id="glance-title" className={styles.title}>Song at a glance</h2>
        <button type="button" className="btn btn-quiet btn-small" aria-expanded={open} aria-controls="glance-body" onClick={() => onToggle(!open)}>
          {open ? "Hide" : "Show"}
          <svg viewBox="0 0 12 12" width="12" height="12" aria-hidden="true" style={{ transform: open ? undefined : "rotate(180deg)" }}>
            <path d="M3 7.5 6 4.5 9 7.5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      </div>
      {open && (
        <div id="glance-body" className={styles.body}>
          <div className={styles.rows}>
            {sections.map((s, si) => (
              <div key={si} className={styles.row} data-hue={sectionHue(s.kind)}>
                <h3 className={styles.name}>{s.label}</h3>
                <div className={styles.lines}>
                  {s.groups.map((g, gi) =>
                    g.lines.map((line, li) => (
                      <div key={`${gi}-${li}`} className={styles.line}>
                        <ol className={styles.bars}>
                          {line.map((cell, ci) => (
                            <li key={ci} className={styles.bar} data-hold={cell === "–" || undefined}>
                              {cell}
                            </li>
                          ))}
                        </ol>
                        <span className={styles.times} aria-label={li === g.lines.length - 1 && g.times > 1 ? `play ${g.times} times` : undefined}>
                          {li === g.lines.length - 1 && g.times > 1 ? `×${g.times}` : ""}
                        </span>
                      </div>
                    )),
                  )}
                </div>
              </div>
            ))}
          </div>
          <p className={styles.foot}>
            <span>Chords:</span>
            {chords.map((c) => (
              <b key={c}>{c}</b>
            ))}
            <span>
              · {beatsPerBar} beats a bar{bpm > 0 && <> · {bpm} BPM</>}
            </span>
          </p>
        </div>
      )}
    </section>
  );
}
