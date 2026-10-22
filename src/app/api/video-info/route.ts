import type { NextRequest } from "next/server";
import { json, problem, requireEditor } from "@/lib/http";
import { fetchVideoFacts } from "@/lib/videoFetch";
import { guessSong } from "@/lib/videoInfo";
import { youtubeId } from "@/lib/youtube";

// Teacher-only, so the app can't be used as an open proxy to YouTube.
export async function GET(req: NextRequest) {
  const denied = await requireEditor();
  if (denied) return denied;
  const id = youtubeId(req.nextUrl.searchParams.get("url") ?? "");
  if (!id) return problem("That doesn't look like a YouTube link.", 400);
  const facts = await fetchVideoFacts(id);
  if (!facts) return problem("Couldn't read that video's details from YouTube.", 502);
  return json({ videoTitle: facts.title, channel: facts.channel, guess: guessSong(facts) });
}
