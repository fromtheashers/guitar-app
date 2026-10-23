import { shapesFor, type Shape } from "@/lib/music/guitar";
import styles from "./ChordDiagram.module.css";

interface Props {
  chord: string;
  /** Prefer a shape without a barre (easy mode). */
  easy?: boolean;
  size?: "s" | "m" | "l";
  /** Highlight as the chord playing now. */
  active?: boolean;
  /** Show the chord name above the box (off when the name is shown beside it). */
  caption?: boolean;
}

export function pickShape(chord: string, easy: boolean): Shape | undefined {
  const shapes = shapesFor(chord);
  if (!easy) return shapes[0];
  return [...shapes].sort((a, b) => Number(Boolean(a.barre)) - Number(Boolean(b.barre)))[0];
}

const W = { s: 56, m: 84, l: 120 };

/** Fingering box for one chord: strings left to right from low E, frets top to bottom. */
export function ChordDiagram({ chord, easy = false, size = "m", active = false, caption = true }: Props) {
  const shape = pickShape(chord, easy);
  const width = W[size];
  if (!shape) {
    return (
      <figure className={styles.wrap} style={{ width }}>
        <figcaption className={styles.name}>{chord}</figcaption>
        <div className={styles.none}>No diagram</div>
      </figure>
    );
  }
  const frets = shape.frets;
  const fretted = frets.filter((f) => f > 0);
  const max = Math.max(0, ...fretted);
  const min = fretted.length ? Math.min(...fretted) : 1;
  const span = 4;
  const base = max > span ? min : 1;

  const padX = 10;
  const top = 18;
  const gridW = 100 - padX * 2;
  const stringGap = gridW / 5;
  const fretGap = 18;
  const gridH = fretGap * span;
  const x = (s: number) => padX + s * stringGap;
  const y = (fret: number) => top + (fret - base + 0.5) * fretGap;
  const label = `${chord}: ${frets.map((f) => (f < 0 ? "x" : f)).join(" ")}`;

  return (
    <figure className={styles.wrap} style={{ width }} data-active={active || undefined}>
      <figcaption className={caption ? styles.name : "visually-hidden"}>{chord}</figcaption>
      <svg viewBox={`0 0 100 ${top + gridH + 6}`} role="img" aria-label={label} className={styles.svg}>
        {base === 1 ? (
          <rect x={padX} y={top - 3} width={gridW} height={3} rx={1} className={styles.nut} />
        ) : (
          <text x={padX + gridW + 3} y={top + fretGap * 0.68} className={styles.fretNo}>
            {base}
          </text>
        )}
        {Array.from({ length: span + 1 }, (_, i) => (
          <line key={`f${i}`} x1={padX} x2={padX + gridW} y1={top + i * fretGap} y2={top + i * fretGap} className={styles.fret} />
        ))}
        {Array.from({ length: 6 }, (_, s) => (
          <line key={`s${s}`} x1={x(s)} x2={x(s)} y1={top} y2={top + gridH} className={styles.string} />
        ))}
        {shape.barre !== undefined && shape.barre >= base && (
          <rect
            x={x(frets.findIndex((f) => f === shape.barre)) - 4}
            y={y(shape.barre) - 4}
            width={x(5 - [...frets].reverse().findIndex((f) => f === shape.barre)) - x(frets.findIndex((f) => f === shape.barre)) + 8}
            height={8}
            rx={4}
            className={styles.dot}
          />
        )}
        {frets.map((f, s) =>
          f < 0 ? (
            <text key={s} x={x(s)} y={top - 7} className={styles.mark}>
              ×
            </text>
          ) : f === 0 ? (
            <circle key={s} cx={x(s)} cy={top - 9} r={3} className={styles.open} />
          ) : (
            <circle key={s} cx={x(s)} cy={y(f)} r={5.2} className={styles.dot} />
          ),
        )}
      </svg>
      {shape.note && <span className={styles.note}>{shape.note}</span>}
    </figure>
  );
}
