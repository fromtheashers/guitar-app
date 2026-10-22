// Downloads a video's audio through the app's own server route and decodes it to
// mono samples at the analysis rate. Everything stays in memory.

import { SR } from "./features";

export class FetchAudioError extends Error {}

export async function fetchYouTubeAudio(url: string, onBytes?: (bytes: number) => void, signal?: AbortSignal): Promise<Float32Array> {
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
  const out = new Float32Array(decoded.length);
  for (let c = 0; c < decoded.numberOfChannels; c++) {
    const ch = decoded.getChannelData(c);
    for (let i = 0; i < ch.length; i++) out[i] += ch[i] / decoded.numberOfChannels;
  }
  return out;
}

/** AAC where the browser can decode it (Chrome, Edge, Safari, Firefox); Opus otherwise. */
function preferredFormat(): "m4a" | "webm" {
  const a = document.createElement("audio");
  return a.canPlayType('audio/mp4; codecs="mp4a.40.2"') ? "m4a" : "webm";
}
