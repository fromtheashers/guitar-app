import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { DbNotice } from "@/components/DbNotice";
import { PracticeView } from "@/components/PracticeView";
import { isEditor } from "@/lib/auth";
import { getSong, type Song } from "@/lib/db";
import styles from "./page.module.css";

type Props = { params: Promise<{ id: string }>; searchParams: Promise<{ key?: string; instrument?: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  try {
    const song = await getSong((await params).id);
    return { title: song?.title ?? "Song" };
  } catch {
    return { title: "Song" };
  }
}

export default async function SongPage({ params, searchParams }: Props) {
  const { id } = await params;
  const { key, instrument } = await searchParams;
  let song: Song | null;
  try {
    song = await getSong(id);
  } catch (e) {
    return <DbNotice error={e} />;
  }
  if (!song) notFound();
  const editor = await isEditor();
  return (
    <div className={styles.page}>
      <div className={styles.head}>
        <div>
          <h1>{song.title}</h1>
          {song.artist && <p className={styles.artist}>{song.artist}</p>}
        </div>
        {editor && (
          <Link href={`/edit/songs/${song.id}`} className="btn btn-small">
            Edit song
          </Link>
        )}
      </div>
      <PracticeView song={song} initialKey={key} initialInstrument={instrument} />
    </div>
  );
}
