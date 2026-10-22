import type { Metadata } from "next";
import { connection } from "next/server";
import { SongEditor } from "@/components/SongEditor";
import { teacherGate } from "@/components/TeacherGate";

export const metadata: Metadata = { title: "Add a song" };

export default async function NewSongPage() {
  await connection();
  return (await teacherGate()) ?? <SongEditor />;
}
