import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { DbNotice } from "@/components/DbNotice";
import { SongEditor } from "@/components/SongEditor";
import { teacherGate } from "@/components/TeacherGate";
import { getSong, type Song } from "@/lib/db";

export const metadata: Metadata = { title: "Edit song" };

export default async function EditSongPage({ params }: { params: Promise<{ id: string }> }) {
  const gate = await teacherGate();
  if (gate) return gate;
  let song: Song | null;
  try {
    song = await getSong((await params).id);
  } catch (e) {
    return <DbNotice error={e} />;
  }
  if (!song) notFound();
  return <SongEditor key={song.id} song={song} />;
}
