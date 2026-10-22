import { connection } from "next/server";
import { DbNotice } from "@/components/DbNotice";
import { SongList } from "@/components/SongList";
import { listSongs, type SongSummary } from "@/lib/db";

export default async function SongsPage() {
  await connection();
  let songs: SongSummary[];
  try {
    songs = await listSongs();
  } catch (e) {
    return <DbNotice error={e} />;
  }
  return <SongList songs={songs} />;
}
