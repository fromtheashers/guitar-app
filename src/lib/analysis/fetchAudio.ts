// Downloads a video's audio through the app's own server route and decodes it to
// mono samples at the analysis rate. Everything stays in memory.

import { SR } from "./features";
import type { TimedWord } from "./lyrics";

export class FetchAudioError extends Error {}

export interface FetchedAudio {
  /** The whole song, mono. */
  samples: Float32Array;
  /** When the home helper separated the song: the instruments and drums on their own. */
  stems?: { instruments: Float32Array; drums: Float32Array };
  /** Words the helper heard in the vocals, when asked for them; null if it sent none. */
  words?: TimedWord[] | null;
}

/**
 * `prompt` (distinct lyric lines) asks the helper to also transcribe the vocals, so
 * sections can be named from the lyrics; it helps the speech model with the words.
 */
export async function fetchYouTubeAudio(url: string, onBytes?: (bytes: number) => void, signal?: AbortSignal, prompt?: string): Promise<FetchedAudio> {
  let res: Response;
  try {
    res = prompt
      ? await fetch("/api/youtube-audio", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ url, format: preferredFormat(), prompt }),
          signal,
        })
      : await fetch(`/api/youtube-audio?format=${preferredFormat()}&url=${encodeURIComponent(url)}`, { signal });
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

  const stemmed = res.headers.get("x-stems") === "1";
  // Separated songs arrive as two WAVs back to back: harmony + drums (stereo), then the
  // rest (mono), and then, if asked for, the sung words as JSON.
  const riff = (at: number) => (at + 8 <= bytes.length && String.fromCharCode(...bytes.subarray(at, at + 4)) === "RIFF" ? new DataView(bytes.buffer).getUint32(at + 4, true) + 8 : 0);
  const firstLength = stemmed ? riff(0) || bytes.length : bytes.length;
  const secondLength = firstLength < bytes.length ? riff(firstLength) || bytes.length - firstLength : 0;
  const parts = secondLength ? [bytes.slice(0, firstLength), bytes.slice(firstLength, firstLength + secondLength)] : [bytes];
  const words = prompt ? readWords(bytes.subarray(firstLength + secondLength)) : undefined;

  let decoded: AudioBuffer[];
  try {
    // An offline context at the analysis rate decodes and resamples in one step.
    decoded = await Promise.all(parts.map((p) => new OfflineAudioContext(1, 1, SR).decodeAudioData(p.buffer)));
  } catch {
    throw new FetchAudioError("This browser couldn't read the audio YouTube sent. Try Chrome, or the backup option.");
  }
  const main = decoded[0];
  if (stemmed && main.numberOfChannels >= 2) {
    const instruments = main.getChannelData(0);
    const drums = main.getChannelData(1);
    const samples = new Float32Array(main.length);
    // All channels of both parts together are the whole song.
    for (const buf of decoded) {
      for (let c = 0; c < buf.numberOfChannels; c++) {
        const ch = buf.getChannelData(c);
        for (let i = 0; i < Math.min(samples.length, ch.length); i++) samples[i] += ch[i];
      }
    }
    return { samples, stems: { instruments, drums }, words };
  }
  const out = new Float32Array(main.length);
  for (let c = 0; c < main.numberOfChannels; c++) {
    const ch = main.getChannelData(c);
    for (let i = 0; i < ch.length; i++) out[i] += ch[i] / main.numberOfChannels;
  }
  return { samples: out, words };
}

function readWords(tail: Uint8Array): TimedWord[] | null {
  if (!tail.length) return null;
  try {
    const body = JSON.parse(new TextDecoder().decode(tail)) as { words?: unknown };
    if (!Array.isArray(body.words)) return null;
    return body.words.flatMap((w): TimedWord[] =>
      Array.isArray(w) && typeof w[0] === "number" && typeof w[1] === "number" && typeof w[2] === "string" ? [{ start: w[0], end: w[1], text: w[2] }] : [],
    );
  } catch {
    return null;
  }
}

/** AAC where the browser can decode it (Chrome, Edge, Safari, Firefox); Opus otherwise. */
function preferredFormat(): "m4a" | "webm" {
  const a = document.createElement("audio");
  return a.canPlayType('audio/mp4; codecs="mp4a.40.2"') ? "m4a" : "webm";
}
