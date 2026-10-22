import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { DbNotice } from "@/components/DbNotice";
import { isEditor } from "@/lib/auth";
import { getSetlist, getSongs, type Setlist, type Song } from "@/lib/db";
import styles from "../setlists.module.css";

type Props = { params: Promise<{ id: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  try {
    return { title: (await getSetlist((await params).id))?.name ?? "Setlist" };
  } catch {
    return { title: "Setlist" };
  }
}

export default async function SetlistPage({ params }: Props) {
  const { id } = await params;
  let setlist: Setlist | null;
  let songs: Song[] = [];
  try {
    setlist = await getSetlist(id);
    if (setlist) songs = await getSongs(setlist.items.map((i) => i.songId));
  } catch (e) {
    return <DbNotice error={e} />;
  }
  if (!setlist) notFound();
  const byId = new Map(songs.map((s) => [s.id, s]));
  const editor = await isEditor();
  return (
    <div className={styles.page}>
      <div className={styles.head}>
        <div>
          <h1>{setlist.name}</h1>
          {setlist.description && <p className={styles.desc}>{setlist.description}</p>}
        </div>
        {editor && (
          <Link href={`/edit/setlists/${setlist.id}`} className="btn btn-small">
            Edit setlist
          </Link>
        )}
      </div>
      <ol className={styles.list}>
        {setlist.items.map((item, i) => {
          const song = byId.get(item.songId);
          if (!song) return null;
          const key = item.key || song.originalKey;
          return (
            <li key={`${item.songId}-${i}`}>
              <Link href={`/songs/${song.id}${item.key ? `?key=${encodeURIComponent(item.key)}` : ""}`} className={`${styles.row} ${styles.song}`}>
                <span className={styles.order}>{i + 1}</span>
                <span className={styles.songTitle}>
                  <span className={styles.name}>{song.title}</span>
                  <span>{song.artist}</span>
                </span>
                <span className={styles.key} title={`Played in ${key}`}>
                  {key}
                </span>
              </Link>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
