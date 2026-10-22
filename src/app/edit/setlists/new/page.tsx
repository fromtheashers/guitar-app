import type { Metadata } from "next";
import { connection } from "next/server";
import { DbNotice } from "@/components/DbNotice";
import { SetlistEditor } from "@/components/SetlistEditor";
import { teacherGate } from "@/components/TeacherGate";
import { listSongs, type SongSummary } from "@/lib/db";

export const metadata: Metadata = { title: "New setlist" };

export default async function NewSetlistPage() {
  await connection();
  const gate = await teacherGate();
  if (gate) return gate;
  let songs: SongSummary[];
  try {
    songs = await listSongs();
  } catch (e) {
    return <DbNotice error={e} />;
  }
  return <SetlistEditor songs={songs} />;
}
