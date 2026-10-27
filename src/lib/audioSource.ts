// Where the browser gets a song's audio from, and how. The site's routes hand out
// sources (an address plus a signed pass); this fetches from one. Audio stays in
// memory.

import { explain } from "./ytErrors";

export interface AudioSource {
  /** "cloud": the Google Cloud audio service streams it. "helper": the teacher's computer prepares it as a job. */
  kind: "cloud" | "helper";
  url: string;
  ticket: string;
}

export interface SourceAudio {
  bytes: Uint8Array<ArrayBuffer>;
  /** The helper separated the song (see fetchAudio.ts for the layout). */
  stems: boolean;
}

export class SourceError extends Error {}

const POLL_MS = 2000;
// Separating and transcribing a long song on a processor can take a while.
const HELPER_LIMIT_MS = 15 * 60_000;

export async function fetchFromSource(source: AudioSource, opts: { signal?: AbortSignal; onBytes?: (n: number) => void } = {}): Promise<SourceAudio> {
  const { signal, onBytes } = opts;
  // text/plain keeps these simple cross-site requests, with no preflight.
  const post = (path: string) => fetch(`${source.url}${path}`, { method: "POST", body: JSON.stringify({ ticket: source.ticket }), headers: { "content-type": "text/plain" }, signal, cache: "no-store" });
  const via = source.kind === "helper" ? "helper" : "server";
  let res: Response;
  try {
    if (source.kind === "cloud") res = await post("/audio");
    else {
      const started = await post("/jobs");
      if (!started.ok) throw new SourceError(explain(await started.text(), via));
      const { id } = (await started.json()) as { id: string };
      const until = Date.now() + HELPER_LIMIT_MS;
      for (;;) {
        res = await fetch(`${source.url}/jobs/${id}`, { signal, cache: "no-store" });
        if (res.status !== 202) break;
        if (Date.now() > until) throw new SourceError("The home computer took too long. Check it's awake and online, then try again.");
        await new Promise((r) => setTimeout(r, POLL_MS));
      }
    }
  } catch (e) {
    if (signal?.aborted || e instanceof SourceError) throw e;
    throw new SourceError(source.kind === "helper" ? "Couldn't reach the home computer. Check it's on and online." : "Couldn't reach the audio service.");
  }
  if (!res.ok || !res.body) throw new SourceError(explain(await res.text().catch(() => ""), via));

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
  return { bytes, stems: res.headers.get("x-stems") === "1" };
}
