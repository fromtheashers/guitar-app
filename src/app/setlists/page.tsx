import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { DbNotice } from "@/components/DbNotice";
import { listSetlists, type Setlist } from "@/lib/db";
import styles from "./setlists.module.css";

export const metadata: Metadata = { title: "Setlists" };

export default async function SetlistsPage() {
  await connection();
  let setlists: Setlist[];
  try {
    setlists = await listSetlists();
  } catch (e) {
    return <DbNotice error={e} />;
  }
  return (
    <div className={styles.page}>
      <h1>Setlists</h1>
      {setlists.length === 0 ? (
        <div className={styles.empty}>
          <p>No setlists yet.</p>
          <p className="muted">When your teacher makes one for Sunday or for homework, it shows up here.</p>
        </div>
      ) : (
        <ul className={styles.list}>
          {setlists.map((s) => (
            <li key={s.id}>
              <Link href={`/setlists/${s.id}`} className={styles.row}>
                <span className={styles.name}>{s.name}</span>
                <span className="muted">
                  {s.items.length} {s.items.length === 1 ? "song" : "songs"}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
