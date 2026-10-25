import type { NextRequest } from "next/server";
import { getSong } from "@/lib/db";
import { fetchViaHelper, helperCanListen, HelperError } from "@/lib/helperQueue";
import { dbError, problem } from "@/lib/http";
import { youtubeId } from "@/lib/youtube";

const HEADERS = { "content-type": "application/octet-stream", "cache-control": "no-store" };

// Students: a song's audio, for playing it back in another key. Only songs in the
// app, never any link. Passed straight through and never stored. Tries the Google
// Cloud audio service (AUDIO_SERVICE_URL + AUDIO_SERVICE_TOKEN), then the helper
// on the teacher's home computer.
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (tooMany(req)) return problem("Too many tries. Wait a few minutes, then change key again.", 429);
  let videoId: string | null;
  try {
    const song = await getSong((await params).id);
    if (!song) return problem("That song doesn't exist.", 404);
    videoId = youtubeId(song.youtubeUrl);
  } catch (e) {
    return dbError(e);
  }
  if (!videoId) return problem("This song has no video.", 404);

  const reasons: string[] = [];
  const service = process.env.AUDIO_SERVICE_URL?.replace(/\/+$/, "");
  if (service && process.env.AUDIO_SERVICE_TOKEN) {
    try {
      const res = await fetch(`${service}/audio?v=${videoId}`, {
        headers: { authorization: `Bearer ${process.env.AUDIO_SERVICE_TOKEN}` },
        signal: AbortSignal.any([req.signal, AbortSignal.timeout(60_000)]),
        cache: "no-store",
      });
      if (res.ok && res.body) return new Response(res.body, { headers: HEADERS });
      const why = await res.text().catch(() => "");
      console.error("Audio service failed:", res.status, why.split("\n").filter(Boolean).pop());
      reasons.push(res.status === 401 ? "The audio service's password doesn't match." : forStudents(why));
    } catch (e) {
      if (req.signal.aborted) return new Response(null, { status: 499 });
      console.error("Audio service unreachable:", e);
      reasons.push("The audio service couldn't be reached.");
    }
  }

  if (helperCanListen()) {
    try {
      const { audio } = await fetchViaHelper(videoId, "listen", req.signal);
      return new Response(audio as BodyInit, { headers: { ...HEADERS, "content-length": String(audio.length) } });
    } catch (e) {
      reasons.push(forStudents(e instanceof HelperError ? e.stderr : ""));
    }
  }

  return problem(reasons[0] ?? "Playing in another key isn't set up yet.", 503);
}

// yt-dlp's errors, in words for a student (the full text goes to the server log).
function forStudents(stderr: string): string {
  const s = stderr.toLowerCase();
  if (s.includes("not a bot") || s.includes("sign in to confirm") || s.includes("429")) return "YouTube held the audio back this time. Try again later.";
  if (s.includes("does not pass filter")) return "The video is too long to change key.";
  if (s.includes("private video") || s.includes("unavailable")) return "The video isn't available.";
  return "Couldn't get the song's audio this time.";
}

// A few fetches per student per hour is plenty; this stops a runaway page or a
// stranger from burning through the free audio allowance.
const LIMIT = 20;
const WINDOW_MS = 60 * 60_000;
const hits: Map<string, number[]> = ((globalThis as unknown as { songAudioHits?: Map<string, number[]> }).songAudioHits ??= new Map());

function tooMany(req: NextRequest): boolean {
  const who = req.headers.get("x-forwarded-for")?.split(",")[0].trim() || "local";
  const now = Date.now();
  const recent = (hits.get(who) ?? []).filter((t) => now - t < WINDOW_MS);
  if (recent.length >= LIMIT) return true;
  recent.push(now);
  hits.set(who, recent);
  if (hits.size > 5000) hits.clear();
  return false;
}
