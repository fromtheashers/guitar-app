import type { NextRequest } from "next/server";
import type { AudioSource } from "@/lib/audioSource";
import { signTicket } from "@/lib/audioTicket";
import { getSong } from "@/lib/db";
import { helperSource } from "@/lib/helper";
import { dbError, json, problem } from "@/lib/http";
import { youtubeId } from "@/lib/youtube";

// Students: where to fetch a song's audio, for playing it back in another key. Only
// songs in the app, never any link. Returns sources in order (the Google Cloud audio
// service, then the helper on the teacher's computer), each with a signed pass for
// this one video. The site never handles the audio.
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const song = await getSong((await params).id);
    if (!song) return problem("That song doesn't exist.", 404);
    const v = youtubeId(song.youtubeUrl);
    if (!v) return problem("This song has no video.", 404);

    const sources: AudioSource[] = [];
    const service = process.env.AUDIO_SERVICE_URL?.replace(/\/+$/, "");
    const secret = process.env.AUDIO_SERVICE_TOKEN;
    if (service && secret) sources.push({ kind: "cloud", url: service, ticket: signTicket({ v, f: "listen" }, secret) });
    const helper = await helperSource({ v, f: "listen" });
    if (helper.source) sources.push(helper.source);

    if (!sources.length) return problem("Playing in another key isn't set up yet.", 503);
    return json({ sources });
  } catch (e) {
    return dbError(e);
  }
}
