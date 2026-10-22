import "server-only";
import { embeddedJson, musicSection, type VideoFacts } from "./videoInfo";

// Reads what YouTube publicly shows about a video: oEmbed for the title and channel
// (an official, stable endpoint), then the watch page for the description and the
// "Music" section. Each step is best effort; whatever is found is returned.

const TIMEOUT = 5000;
const HEADERS = {
  "accept-language": "en-GB,en;q=0.9",
  "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36",
  // Skip the EU cookie-consent interstitial.
  cookie: "SOCS=CAI; CONSENT=YES+",
};

async function get(url: string): Promise<Response | null> {
  try {
    const res = await fetch(url, { headers: HEADERS, signal: AbortSignal.timeout(TIMEOUT), cache: "no-store" });
    return res.ok ? res : null;
  } catch {
    return null;
  }
}

export async function fetchVideoFacts(id: string): Promise<VideoFacts | null> {
  const watch = `https://www.youtube.com/watch?v=${id}`;
  const [oembed, page] = await Promise.all([
    get(`https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(watch)}`).then((r) => r?.json().catch(() => null)),
    get(watch).then((r) => r?.text().catch(() => null)),
  ]);

  const facts: VideoFacts = { title: oembed?.title ?? "", channel: oembed?.author_name ?? "" };
  if (page) {
    const player = embeddedJson(page, "ytInitialPlayerResponse") as PlayerResponse | null;
    const d = player?.videoDetails;
    if (d) {
      facts.title ||= d.title ?? "";
      facts.channel ||= d.author ?? "";
      facts.description = d.shortDescription;
      facts.lengthSeconds = Number(d.lengthSeconds) || undefined;
    }
    const music = musicSection(embeddedJson(page, "ytInitialData"));
    if (music) facts.music = music;
  }
  return facts.title ? facts : null;
}

interface PlayerResponse {
  videoDetails?: { title?: string; author?: string; shortDescription?: string; lengthSeconds?: string };
}
