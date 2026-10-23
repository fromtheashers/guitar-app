"use client";

import { useEffect, useState } from "react";
import { mod12, noteName, parseKey, prefersFlats } from "@/lib/music/chords";
import styles from "./ChartKeys.module.css";

// Chords in the key, in the order a worship chart usually leans on them.
const MAJOR: [number, string][] = [[0, ""], [5, ""], [7, ""], [9, "m"], [2, "m"], [4, "m"]];
const MINOR: [number, string][] = [[0, "m"], [8, ""], [10, ""], [3, ""], [5, "m"], [7, "m"]];

export function keyChords(keyName: string): string[] {
  const key = parseKey(keyName);
  if (!key) return [];
  const flats = prefersFlats(key);
  return (key.minor ? MINOR : MAJOR).map(([step, q]) => noteName(mod12(key.tonic + step), flats) + q);
}

interface Props {
  textarea: React.RefObject<HTMLTextAreaElement | null>;
  value: string;
  onChange: (v: string) => void;
  songKey: string;
  /** Chords already in the chart, offered after the ones in the key. */
  used: string[];
}

/**
 * A row of chart symbols and chords that sits above a phone's keyboard while
 * the chart is being typed, since | [ ] and . are buried on phone keyboards.
 */
export function ChartKeys({ textarea, value, onChange, songKey, used }: Props) {
  const bottom = useKeyboardInset();
  const inKey = keyChords(songKey);
  const chords = [...inKey, ...used.filter((c) => !inKey.includes(c))].slice(0, 14);

  const insert = (text: string, kind: "word" | "line") => {
    const ta = textarea.current;
    if (!ta) return;
    const start = ta.selectionStart;
    const end = ta.selectionEnd;
    const before = value.slice(0, start);
    const after = value.slice(end);
    let add: string;
    if (kind === "line") {
      // Sections and cues start their own line.
      const lead = before === "" || before.endsWith("\n") ? "" : "\n";
      const gap = text.startsWith("[") && before.trim() && !before.endsWith("\n\n") ? "\n" : "";
      add = gap + lead + text + (text.startsWith("[") ? "\n" : "");
    } else {
      const lead = before === "" || /\s$/.test(before) ? "" : " ";
      add = lead + text + (after.startsWith(" ") ? "" : " ");
    }
    onChange(before + add + after);
    const caret = start + add.length;
    requestAnimationFrame(() => {
      ta.focus();
      ta.setSelectionRange(caret, caret);
    });
  };

  // Pressing a key mustn't take focus from the chart, or the phone keyboard closes.
  const keep = (e: React.SyntheticEvent) => e.preventDefault();
  const key = (label: string, text: string, kind: "word" | "line", cls = "") => (
    <button
      key={label}
      type="button"
      className={`${styles.key} ${cls}`}
      onPointerDown={keep}
      onMouseDown={keep}
      onClick={() => insert(text, kind)}
    >
      {label}
    </button>
  );

  return (
    <div className={styles.bar} style={{ bottom }} role="toolbar" aria-label="Chart symbols and chords">
      <div className={styles.scroll}>
        {key("|", "|", "word", styles.symbol)}
        {key(".", ".", "word", styles.symbol)}
        {chords.map((c) => key(c, c, "word", styles.chord))}
        {key("[Verse]", "[Verse]", "line")}
        {key("[Chorus]", "[Chorus]", "line")}
        {key("[Bridge]", "[Bridge]", "line")}
        {key("[Intro]", "[Intro]", "line")}
        {key("> cue", "> ", "line")}
        {key("N.C.", "N.C.", "word")}
      </div>
    </div>
  );
}

/** How far the on-screen keyboard pushes up from the bottom of the layout viewport. */
function useKeyboardInset() {
  const [inset, setInset] = useState(0);
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const update = () => setInset(Math.max(0, window.innerHeight - vv.height - vv.offsetTop));
    update();
    vv.addEventListener("resize", update);
    vv.addEventListener("scroll", update);
    return () => {
      vv.removeEventListener("resize", update);
      vv.removeEventListener("scroll", update);
    };
  }, []);
  return inset;
}
