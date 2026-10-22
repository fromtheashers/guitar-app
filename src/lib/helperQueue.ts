import "server-only";
import { timingSafeEqual } from "node:crypto";

// Hands YouTube downloads to the helper on the teacher's home computer. The helper
// polls this server (so no tunnel or port-forwarding is needed), fetches the audio
// over a home connection that YouTube doesn't block, and posts it back. Audio lives
// only in memory, only until it's passed on to the browser that asked for it.

export interface HelperJob {
  id: string;
  videoId: string;
  format: "m4a" | "webm";
}

export interface HelperAudio {
  audio: Uint8Array;
  /** A WAV of instruments, drums and vocals (the helper separated it). */
  stems: boolean;
}

interface Pending extends HelperJob {
  resolve: (result: HelperAudio) => void;
  reject: (stderr: string) => void;
}

const ONLINE_MS = 45_000;
const POLL_MS = 25_000;
const JOB_MS = 3 * 60_000;

const state = ((globalThis as unknown as { helperQueue?: State }).helperQueue ??= {
  lastSeen: 0,
  queue: [],
  running: new Map(),
  pollers: [],
} as State);

interface State {
  lastSeen: number;
  queue: Pending[];
  running: Map<string, Pending>;
  pollers: ((job: HelperJob | null) => void)[];
}

export function helperConfigured(): boolean {
  return Boolean(process.env.HELPER_TOKEN);
}

export function helperOnline(): boolean {
  return Date.now() - state.lastSeen < ONLINE_MS;
}

export function checkHelperToken(header: string | null): boolean {
  const token = process.env.HELPER_TOKEN;
  if (!token || !header?.startsWith("Bearer ")) return false;
  const a = Buffer.from(header.slice(7));
  const b = Buffer.from(token);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Ask the helper for a video's audio. Rejects with yt-dlp's error output on failure. */
export function fetchViaHelper(videoId: string, format: "m4a" | "webm", signal: AbortSignal): Promise<HelperAudio> {
  return new Promise((resolve, reject) => {
    const job: Pending = {
      id: crypto.randomUUID(),
      videoId,
      format,
      resolve: (a) => done(() => resolve(a)),
      reject: (e) => done(() => reject(new HelperError(e))),
    };
    const timer = setTimeout(() => job.reject("ERROR: helper timed out"), JOB_MS);
    const abort = () => job.reject("ERROR: cancelled");
    signal.addEventListener("abort", abort, { once: true });
    function done(fn: () => void) {
      clearTimeout(timer);
      signal.removeEventListener("abort", abort);
      state.running.delete(job.id);
      state.queue = state.queue.filter((j) => j !== job);
      fn();
    }
    const poller = state.pollers.shift();
    if (poller) {
      state.running.set(job.id, job);
      poller(publicJob(job));
    } else state.queue.push(job);
  });
}

export class HelperError extends Error {
  constructor(readonly stderr: string) {
    super("helper failed");
  }
}

/** Long poll from the helper: the next job, or null after a quiet spell. */
export function nextJob(signal: AbortSignal): Promise<HelperJob | null> {
  state.lastSeen = Date.now();
  const job = state.queue.shift();
  if (job) {
    state.running.set(job.id, job);
    return Promise.resolve(publicJob(job));
  }
  return new Promise((resolve) => {
    const give = (j: HelperJob | null) => {
      clearTimeout(timer);
      signal.removeEventListener("abort", leave);
      state.lastSeen = Date.now();
      resolve(j);
    };
    const leave = () => {
      state.pollers = state.pollers.filter((p) => p !== give);
      give(null);
    };
    const timer = setTimeout(leave, POLL_MS);
    signal.addEventListener("abort", leave, { once: true });
    state.pollers.push(give);
  });
}

export function finishJob(id: string, result: HelperAudio | { stderr: string }): boolean {
  const job = state.running.get(id);
  if (!job) return false;
  if ("audio" in result) job.resolve(result);
  else job.reject(result.stderr);
  return true;
}

const publicJob = ({ id, videoId, format }: Pending): HelperJob => ({ id, videoId, format });
