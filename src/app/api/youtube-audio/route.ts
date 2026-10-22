import type { NextRequest } from "next/server";
import { problem, requireEditor } from "@/lib/http";
import { youtubeId } from "@/lib/youtube";
import { AudioFetchError, streamAudio } from "@/lib/ytAudio";

// Teacher-only: streams a video's audio to the browser for analysis. Never stored.
export async function GET(req: NextRequest) {
  const denied = await requireEditor();
  if (denied) return denied;
  const id = youtubeId(req.nextUrl.searchParams.get("url") ?? "");
  if (!id) return problem("That doesn't look like a YouTube link.", 400);
  try {
    const format = req.nextUrl.searchParams.get("format") === "webm" ? "webm" : "m4a";
    const body = await streamAudio(id, format, req.signal);
    return new Response(body, {
      headers: { "content-type": "application/octet-stream", "cache-control": "no-store" },
    });
  } catch (e) {
    return problem(e instanceof AudioFetchError ? e.message : "Couldn't fetch the audio from YouTube.", 502);
  }
}
