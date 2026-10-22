import "server-only";
import { spawn } from "node:child_process";
import { copyFileSync, existsSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

// Streams a YouTube video's audio track through yt-dlp. The bytes go straight from
// yt-dlp's stdout to the HTTP response; nothing is written to disk.

const MAX_SECONDS = 15 * 60;
const MAX_BYTES = 60 * 1024 * 1024;

export class AudioFetchError extends Error {}

function binary(): string {
  if (process.env.YTDLP_PATH) return process.env.YTDLP_PATH;
  const local = path.join(process.cwd(), "bin", "yt-dlp");
  return existsSync(local) ? local : "yt-dlp";
}

// YouTube blocks cloud servers unless they're signed in. The teacher can give the
// server a spare account's cookies, as a Render Secret File (preferred) or as the
// YTDLP_COOKIES variable. yt-dlp rewrites its cookie file, so it gets a private copy.
const SECRET_FILE = "/etc/secrets/youtube-cookies.txt";
let cookieCopy: string | null | undefined;

function cookiesFile(): string | null {
  if (cookieCopy !== undefined) return cookieCopy;
  const copy = path.join(os.tmpdir(), "yt-cookies.txt");
  const src = process.env.YTDLP_COOKIES_FILE || SECRET_FILE;
  try {
    if (existsSync(src)) copyFileSync(src, copy);
    else if (process.env.YTDLP_COOKIES) writeFileSync(copy, process.env.YTDLP_COOKIES.replace(/\\n/g, "\n").replace(/\\t/g, "\t"), { mode: 0o600 });
    else return (cookieCopy = null);
    return (cookieCopy = copy);
  } catch (e) {
    console.error("Couldn't prepare YouTube cookies:", e);
    return (cookieCopy = null);
  }
}

export function hasCookies(): boolean {
  return cookiesFile() !== null;
}

/** Resolves once audio starts flowing (or rejects with a readable reason). */
export function streamAudio(videoId: string, format: "m4a" | "webm", signal: AbortSignal): Promise<ReadableStream<Uint8Array>> {
  const args = [
    // Ask for a codec the browser can decode: AAC (m4a) everywhere except open-source Chromium builds, Opus (webm) otherwise.
    "--format", format === "m4a" ? "bestaudio[ext=m4a]/bestaudio" : "bestaudio[ext=webm]/bestaudio",
    "--output", "-",
    "--no-playlist",
    "--no-part",
    "--no-cache-dir",
    "--no-progress",
    "--quiet",
    "--match-filter", `duration < ${MAX_SECONDS}`,
    // YouTube's player needs a JavaScript runtime; Node is already on the server.
    "--js-runtimes", `node:${process.execPath}`,
    `https://www.youtube.com/watch?v=${videoId}`,
  ];
  const cookies = cookiesFile();
  if (cookies) args.unshift("--cookies", cookies);
  const child = spawn(binary(), args, { stdio: ["ignore", "pipe", "pipe"] });
  let stderr = "";
  child.stderr.on("data", (d: Buffer) => {
    if (stderr.length < 4000) stderr += d.toString();
  });
  const kill = () => {
    child.kill("SIGKILL");
  };
  signal.addEventListener("abort", kill, { once: true });

  return new Promise((resolve, reject) => {
    let sent = 0;
    let started = false;
    let controller: ReadableStreamDefaultController<Uint8Array>;
    const stream = new ReadableStream<Uint8Array>({
      start: (c) => {
        controller = c;
      },
      cancel: kill,
    });

    child.on("error", (e: NodeJS.ErrnoException) => {
      reject(new AudioFetchError(e.code === "ENOENT" ? "The YouTube downloader isn't installed on the server." : "Couldn't start the YouTube downloader."));
    });
    child.stdout.on("data", (chunk: Buffer) => {
      sent += chunk.length;
      if (sent > MAX_BYTES) {
        kill();
        controller.error(new Error("too large"));
        return;
      }
      controller.enqueue(new Uint8Array(chunk));
      if (!started) {
        started = true;
        resolve(stream);
      }
    });
    child.on("close", (code) => {
      signal.removeEventListener("abort", kill);
      if (started) {
        if (code === 0) controller.close();
        else controller.error(new Error(`yt-dlp exited ${code}`));
        return;
      }
      if (sent === 0) console.error("yt-dlp failed:", stderr.trim());
      reject(new AudioFetchError(explain(stderr)));
    });
  });
}

export function explain(stderr: string): string {
  // Judge by yt-dlp's final ERROR line; earlier WARNING lines are retries.
  const lines = stderr.split("\n").filter((l) => l.startsWith("ERROR"));
  const s = (lines.length ? lines.join(" ") : stderr).toLowerCase();
  if (s.includes("confirm your age") || s.includes("age-restricted") || s.includes("age restricted"))
    return "That video is age-restricted, so it can't be fetched.";
  if (s.includes("not a bot") || s.includes("sign in to confirm") || s.includes("http error 429") || s.includes("too many requests"))
    return hasCookies()
      ? "YouTube blocked the server even with the signed-in account. The account's cookies may have expired; export them again. Meanwhile, use the microphone option below."
      : "YouTube blocked the server from fetching this video. Use the microphone option below, or give the server a YouTube sign-in (see the setup guide).";
  if (s.includes("private video")) return "That video is private.";
  if (s.includes("video unavailable") || s.includes("is not available")) return "That video is unavailable.";
  if (s.includes("does not pass filter")) return "That video is longer than 15 minutes. Pick a single-song video.";
  if (s.includes("unable to download webpage") || s.includes("unable to connect") || s.includes("timed out"))
    return "The server couldn't reach YouTube. Try again in a minute.";
  return "Couldn't fetch the audio from YouTube. Try again, or use the backup option below.";
}
