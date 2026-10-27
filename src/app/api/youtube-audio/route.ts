import type { NextRequest } from "next/server";
import { helperSource } from "@/lib/helper";
import { dbError, json, problem, readJson, requireEditor } from "@/lib/http";
import { youtubeId } from "@/lib/youtube";

// Teacher-only: where the browser can fetch a video's audio to analyse it. The site
// never handles the audio: this returns the helper on the teacher's computer as a
// source, with a signed pass that lets it fetch this one video.
export async function GET(req: NextRequest) {
  const denied = await requireEditor();
  if (denied) return denied;
  return source(req.nextUrl.searchParams.get("url") ?? "", req.nextUrl.searchParams.get("format"));
}

// The same, with lyric lines (the "prompt") so the helper also sends the words sung,
// for naming sections. The lyrics travel inside the signed pass and are not kept.
export async function POST(req: NextRequest) {
  const denied = await requireEditor();
  if (denied) return denied;
  const body = ((await readJson(req)) ?? {}) as Record<string, unknown>;
  const prompt = typeof body.prompt === "string" ? body.prompt.slice(0, 1000) : "";
  return source(String(body.url ?? ""), String(body.format ?? ""), prompt);
}

async function source(url: string, formatParam: string | null, prompt?: string) {
  const id = youtubeId(url);
  if (!id) return problem("That doesn't look like a YouTube link.", 400);
  const format = formatParam === "webm" ? "webm" : "m4a";
  try {
    const helper = await helperSource({ v: id, f: format, ...(prompt ? { w: prompt } : {}) });
    if (helper.source) return json({ source: helper.source });
    const message = {
      unconfigured: "YouTube blocks cloud servers, so drafting from a link needs the helper on your home computer. See the helper setup guide, or use the microphone option below.",
      offline: "The YouTube helper on your home computer isn't running. Switch the computer on, or use the microphone option below.",
      outdated: "The YouTube helper on your home computer needs updating for the new site. Run its update script, or use the microphone option below.",
    }[helper.state as "unconfigured" | "offline" | "outdated"];
    return problem(message, 503);
  } catch (e) {
    return dbError(e);
  }
}
