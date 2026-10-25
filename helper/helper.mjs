// YouTube helper for Chord Window. Runs on a home computer, asks the site for work,
// downloads a video's audio with yt-dlp over the home connection, and sends it back.
// Audio is held in memory only and never written to disk.
//
// Needs Node 20+ and yt-dlp (yt-dlp.exe next to this file on Windows, or on PATH).
// Settings come from config.json next to this file: { "site": "https://…", "token": "…" }
//
// Optional: with "separator" set to a Python that has Demucs (see separate.py), in
// config.json or in separator.json next to this file (which holds no password), the
// helper splits each song into instruments and drums before sending it, so the site
// can read chords without vocals and strum patterns from the drums alone. Needs
// ffmpeg (ffmpeg.exe next to this file, "ffmpeg" in config.json, or on PATH). If
// separation fails, the plain audio is sent instead.

import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
// Windows PowerShell 5 writes a byte-order mark, which JSON.parse rejects.
const config = JSON.parse(readFileSync(path.join(here, "config.json"), "utf8").replace(/^\uFEFF/, ""));
const site = String(config.site).replace(/\/+$/, "");
const auth = { authorization: `Bearer ${config.token}` };
const MAX_BYTES = 60 * 1024 * 1024;

const exe = ["yt-dlp.exe", "yt-dlp"].map((f) => path.join(here, f)).find(existsSync) ?? "yt-dlp";
const sepFile = path.join(here, "separator.json");
const sep = { ...(existsSync(sepFile) ? JSON.parse(readFileSync(sepFile, "utf8").replace(/^\uFEFF/, "")) : {}), ...config };
const ffmpeg = sep.ffmpeg ?? ["ffmpeg.exe", "ffmpeg"].map((f) => path.join(here, f)).find(existsSync) ?? "ffmpeg";
const separator = sep.separator;
const separatorScript = sep.separatorScript ?? path.join(here, "separate.py");
// Demucs weights live beside the Python environment unless config says otherwise.
const models = sep.models ?? (separator ? path.resolve(path.dirname(separator), "..", "..", "models") : undefined);
// "listen" is for a student playing the song in another key: small AAC, never separated.
const FORMATS = { m4a: "bestaudio[ext=m4a]/bestaudio", webm: "bestaudio[ext=webm]/bestaudio", listen: "139/140/bestaudio[ext=m4a]/bestaudio" };
// Tells the site which jobs this helper understands.
const VERSION = 2;
const log = (...a) => console.log(new Date().toLocaleTimeString(), ...a);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

function download(job) {
  return new Promise((resolve) => {
    const args = [
      "--format", FORMATS[job.format] ?? FORMATS.webm,
      "--output", "-",
      "--no-playlist", "--no-part", "--no-cache-dir", "--no-progress", "--quiet",
      "--match-filter", "duration < 900",
      "--js-runtimes", `node:${process.execPath}`,
      `https://www.youtube.com/watch?v=${job.videoId}`,
    ];
    const child = spawn(exe, args, { stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
    const chunks = [];
    let size = 0;
    let stderr = "";
    child.stdout.on("data", (c) => {
      size += c.length;
      if (size > MAX_BYTES) child.kill();
      else chunks.push(c);
    });
    child.stderr.on("data", (d) => (stderr += d));
    child.on("error", () => resolve({ stderr: "ERROR: The YouTube downloader isn't installed on the helper." }));
    child.on("close", (code) => resolve(code === 0 && size > 0 && size <= MAX_BYTES ? { audio: Buffer.concat(chunks) } : { stderr: stderr || `ERROR: yt-dlp exited ${code}` }));
  });
}

/** Runs a program with `input` on stdin; collects stdout in memory. */
function run(cmd, args, input, env) {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { stdio: ["pipe", "pipe", "pipe"], windowsHide: true, env: { ...process.env, ...env } });
    // Low priority, so whatever the computer is being used for comes first.
    try {
      os.setPriority(child.pid, os.constants.priority.PRIORITY_LOW);
    } catch {}
    const chunks = [];
    let stderr = "";
    child.stdout.on("data", (c) => chunks.push(c));
    child.stderr.on("data", (d) => (stderr += d));
    child.stdin.on("error", () => {}); // the program quit early; its exit code says why
    child.on("error", (e) => resolve({ code: -1, out: Buffer.alloc(0), stderr: String(e) }));
    child.on("close", (code) => resolve({ code, out: Buffer.concat(chunks), stderr }));
    child.stdin.end(input);
  });
}

/** Instruments, drums and vocals as a three-channel WAV, or null to send the plain audio. */
async function separate(audio) {
  if (!separator) return null;
  const started = Date.now();
  const decoded = await run(ffmpeg, ["-v", "error", "-i", "pipe:0", "-f", "f32le", "-ac", "2", "-ar", "44100", "pipe:1"], audio);
  if (decoded.code !== 0 || !decoded.out.length) {
    log("Couldn't decode the audio for separation:", decoded.stderr.trim().split("\n").pop());
    return null;
  }
  const split = await run(separator, [separatorScript], decoded.out, models ? { TORCH_HOME: models, HF_HOME: path.join(models, "hf") } : {});
  if (split.code !== 0 || split.out.length < 44) {
    log("Separation failed, sending the plain audio:", split.stderr.trim().split("\n").pop());
    return null;
  }
  log(`Separated in ${((Date.now() - started) / 1000).toFixed(1)} s.`);
  return split.out;
}

async function send(job, result) {
  const body = "audio" in result ? result.audio : result.stderr;
  const type = "audio" in result ? "application/octet-stream" : "text/plain";
  const headers = { ...auth, "content-type": type, ...(result.stems ? { "x-stems": "1" } : {}) };
  const res = await fetch(`${site}/api/helper/result/${job.id}`, { method: "POST", headers, body });
  if (!res.ok) log("The site didn't take the result:", res.status);
}

log(`Helper started. Waiting for work from ${site}`);
let backoff = 2000;
for (;;) {
  try {
    const res = await fetch(`${site}/api/helper/next?v=${VERSION}`, { headers: auth, signal: AbortSignal.timeout(40_000) });
    if (res.status === 401) {
      log("The site rejected the helper password. Check config.json matches HELPER_TOKEN in Render.");
      await wait(60_000);
      continue;
    }
    if (res.status === 204) {
      backoff = 2000;
      continue;
    }
    if (res.status !== 200) {
      // The site is restarting or erroring (e.g. 502 during a Render deploy): back off.
      await wait(backoff);
      backoff = Math.min(backoff * 2, 60_000);
      continue;
    }
    backoff = 2000;
    const job = await res.json();
    log(`Fetching ${job.videoId}…`);
    let result = await download(job);
    if ("audio" in result && job.format !== "listen") {
      const stems = await separate(result.audio);
      if (stems) result = { audio: stems, stems: true };
    }
    log("audio" in result ? `Sent ${(result.audio.length / 1048576).toFixed(1)} MB.` : `Failed: ${result.stderr.split("\n").filter(Boolean).pop()}`);
    await send(job, result);
  } catch (e) {
    // The site may be asleep or restarting, or the internet may be down. Try again shortly.
    log("Can't reach the site, retrying…", e?.cause?.code ?? e?.name ?? "");
    await wait(backoff);
    backoff = Math.min(backoff * 2, 60_000);
  }
}
