import type { NextRequest } from "next/server";
import { fetchViaHelper, helperConfigured, helperOnline, HelperError } from "@/lib/helperQueue";
import { problem, readJson, requireEditor } from "@/lib/http";
import { youtubeId } from "@/lib/youtube";
import { AudioFetchError, explain, streamAudio } from "@/lib/ytAudio";

const HEADERS = { "content-type": "application/octet-stream", "cache-control": "no-store" };

// Teacher-only: gets a video's audio for the browser to analyse. Never stored.
// With a home helper set up (HELPER_TOKEN), the helper downloads it; otherwise
// this server tries yt-dlp itself.
export async function GET(req: NextRequest) {
  const denied = await requireEditor();
  if (denied) return denied;
  return audio(req, req.nextUrl.searchParams.get("url") ?? "", req.nextUrl.searchParams.get("format"));
}

// The same, with lyric lines (the "prompt") so the helper also sends the words sung,
// for naming sections. The lyrics are passed on in memory and not kept.
export async function POST(req: NextRequest) {
  const denied = await requireEditor();
  if (denied) return denied;
  const body = ((await readJson(req)) ?? {}) as Record<string, unknown>;
  const prompt = typeof body.prompt === "string" ? body.prompt.slice(0, 1000) : "";
  return audio(req, String(body.url ?? ""), String(body.format ?? ""), prompt);
}

async function audio(req: NextRequest, url: string, formatParam: string | null, prompt?: string) {
  const id = youtubeId(url);
  if (!id) return problem("That doesn't look like a YouTube link.", 400);
  const format = formatParam === "webm" ? "webm" : "m4a";

  if (helperConfigured()) {
    if (!helperOnline()) {
      return problem("The YouTube helper on your home computer isn't running. Switch the computer on, or use the microphone option below.", 503);
    }
    try {
      const { audio, stems } = await fetchViaHelper(id, format, req.signal, prompt ? { prompt } : undefined);
      return new Response(audio as BodyInit, {
        headers: { ...HEADERS, "content-length": String(audio.length), ...(stems ? { "x-stems": "1" } : {}) },
      });
    } catch (e) {
      const stderr = e instanceof HelperError ? e.stderr : "";
      if (stderr.includes("helper timed out")) return problem("The home computer took too long. Check it's awake and online, then try again.", 504);
      return problem(explain(stderr, "helper"), 502);
    }
  }

  try {
    const body = await streamAudio(id, format, req.signal);
    return new Response(body, { headers: HEADERS });
  } catch (e) {
    return problem(e instanceof AudioFetchError ? e.message : "Couldn't fetch the audio from YouTube.", 502);
  }
}
