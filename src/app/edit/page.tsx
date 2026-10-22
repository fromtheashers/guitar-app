import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { DbNotice } from "@/components/DbNotice";
import { LoginForm, SignOutButton } from "@/components/LoginForm";
import { SongList } from "@/components/SongList";
import { isEditor, passcodeConfigured } from "@/lib/auth";
import { listSetlists, listSongs, type Setlist, type SongSummary } from "@/lib/db";
import styles from "./edit.module.css";

export const metadata: Metadata = { title: "Teacher" };

export default async function TeacherPage() {
  await connection();
  if (!passcodeConfigured()) {
    return (
      <div className={styles.notice}>
        <h1>Set a teacher passcode first</h1>
        <p className="muted">Add EDITOR_PASSCODE in Render&apos;s environment settings, then redeploy. Anyone with the passcode can add and edit songs.</p>
      </div>
    );
  }
  if (!(await isEditor())) {
    return <LoginForm />;
  }
  let songs: SongSummary[];
  let setlists: Setlist[];
  try {
    [songs, setlists] = await Promise.all([listSongs(), listSetlists()]);
  } catch (e) {
    return <DbNotice error={e} />;
  }
  return (
    <div className={styles.page}>
      <div className={styles.head}>
        <h1>Teacher</h1>
        <div className={styles.actions}>
          <Link href="/edit/songs/new" className="btn btn-primary">
            Add a song
          </Link>
          <Link href="/edit/setlists/new" className="btn">
            New setlist
          </Link>
          <SignOutButton />
        </div>
      </div>

      <section className={styles.block} aria-labelledby="t-setlists">
        <h2 id="t-setlists">Setlists</h2>
        {setlists.length === 0 ? (
          <p className="muted">No setlists yet. Make one for Sunday or for this week&apos;s homework.</p>
        ) : (
          <ul className={styles.list}>
            {setlists.map((s) => (
              <li key={s.id}>
                <Link href={`/edit/setlists/${s.id}`} className={styles.row}>
                  <span className={styles.name}>{s.name}</span>
                  <span className="muted">
                    {s.items.length} {s.items.length === 1 ? "song" : "songs"}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className={styles.block}>
        <SongList songs={songs} hrefBase="/edit/songs/" />
      </section>
    </div>
  );
}
