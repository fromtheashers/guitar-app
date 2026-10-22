import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { DbNotice } from "@/components/DbNotice";
import { SetlistEditor } from "@/components/SetlistEditor";
import { teacherGate } from "@/components/TeacherGate";
import { getSetlist, listSongs, type Setlist, type SongSummary } from "@/lib/db";

export const metadata: Metadata = { title: "Edit setlist" };

export default async function EditSetlistPage({ params }: { params: Promise<{ id: string }> }) {
  const gate = await teacherGate();
  if (gate) return gate;
  let setlist: Setlist | null;
  let songs: SongSummary[];
  try {
    [setlist, songs] = await Promise.all([getSetlist((await params).id), listSongs()]);
  } catch (e) {
    return <DbNotice error={e} />;
  }
  if (!setlist) notFound();
  return <SetlistEditor key={setlist.id} setlist={setlist} songs={songs} />;
}
