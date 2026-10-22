// Downloads a video's audio through the app's own server route and decodes it to
// mono samples at the analysis rate. Everything stays in memory.

import { SR } from "./features";

export class FetchAudioError extends Error {}

export interface FetchedAudio {
  /** The song, mono. Without vocals when it came separated. */
  samples: Float32Array;
  /** When the home helper separated the song: the instruments and drums on their own. */
  stems?: { instruments: Float32Array; drums: Float32Array };
}

export async function fetchYouTubeAudio(url: string, onBytes?: (bytes: number) => void, signal?: AbortSignal): Promise<FetchedAudio> {
  let res: Response;
  try {
    res = await fetch(`/api/youtube-audio?format=${preferredFormat()}&url=${encodeURIComponent(url)}`, { signal });
  } catch (e) {
    if (signal?.aborted) throw e;
    throw new FetchAudioError("Couldn't reach the app. Check your connection and try again.");
  }
  if (!res.ok || !res.body) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new FetchAudioError(body.error ?? "Couldn't fetch the audio from YouTube.");
  }

  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    total += value.length;
    onBytes?.(total);
  }
  const bytes = new Uint8Array(total);
  let o = 0;
  for (const c of chunks) {
    bytes.set(c, o);
    o += c.length;
  }
  chunks.length = 0;

  let decoded: AudioBuffer;
  try {
    // An offline context at the analysis rate decodes and resamples in one step.
    decoded = await new OfflineAudioContext(1, 1, SR).decodeAudioData(bytes.buffer);
  } catch {
    throw new FetchAudioError("This browser couldn't read the audio YouTube sent. Try Chrome, or the backup option.");
  }
  if (res.headers.get("x-stems") === "1" && decoded.numberOfChannels === 2) {
    // Instruments on the left, drums on the right; together they're the song minus vocals.
    const instruments = decoded.getChannelData(0);
    const drums = decoded.getChannelData(1);
    const samples = new Float32Array(decoded.length);
    for (let i = 0; i < samples.length; i++) samples[i] = instruments[i] + drums[i];
    return { samples, stems: { instruments, drums } };
  }
  const out = new Float32Array(decoded.length);
  for (let c = 0; c < decoded.numberOfChannels; c++) {
    const ch = decoded.getChannelData(c);
    for (let i = 0; i < ch.length; i++) out[i] += ch[i] / decoded.numberOfChannels;
  }
  return { samples: out };
}

/** AAC where the browser can decode it (Chrome, Edge, Safari, Firefox); Opus otherwise. */
function preferredFormat(): "m4a" | "webm" {
  const a = document.createElement("audio");
  return a.canPlayType('audio/mp4; codecs="mp4a.40.2"') ? "m4a" : "webm";
}
