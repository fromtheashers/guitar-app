// YouTube helper for Chord Window. Runs on a home computer, asks the site for work,
// downloads a video's audio with yt-dlp over the home connection, and sends it back.
// Audio is held in memory only and never written to disk.
//
// Needs Node 20+ and yt-dlp (yt-dlp.exe next to this file on Windows, or on PATH).
// Settings come from config.json next to this file: { "site": "https://…", "token": "…" }

import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const config = JSON.parse(readFileSync(path.join(here, "config.json"), "utf8"));
const site = String(config.site).replace(/\/+$/, "");
const auth = { authorization: `Bearer ${config.token}` };
const MAX_BYTES = 60 * 1024 * 1024;

const exe = ["yt-dlp.exe", "yt-dlp"].map((f) => path.join(here, f)).find(existsSync) ?? "yt-dlp";
const log = (...a) => console.log(new Date().toLocaleTimeString(), ...a);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

function download(job) {
  return new Promise((resolve) => {
    const args = [
      "--format", job.format === "m4a" ? "bestaudio[ext=m4a]/bestaudio" : "bestaudio[ext=webm]/bestaudio",
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

async function send(job, result) {
  const body = "audio" in result ? result.audio : result.stderr;
  const type = "audio" in result ? "application/octet-stream" : "text/plain";
  const res = await fetch(`${site}/api/helper/result/${job.id}`, { method: "POST", headers: { ...auth, "content-type": type }, body });
  if (!res.ok) log("The site didn't take the result:", res.status);
}

log(`Helper started. Waiting for work from ${site}`);
let backoff = 2000;
for (;;) {
  try {
    const res = await fetch(`${site}/api/helper/next`, { headers: auth, signal: AbortSignal.timeout(40_000) });
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
    const result = await download(job);
    log("audio" in result ? `Sent ${(result.audio.length / 1048576).toFixed(1)} MB.` : `Failed: ${result.stderr.split("\n").filter(Boolean).pop()}`);
    await send(job, result);
  } catch (e) {
    // The site may be asleep or restarting, or the internet may be down. Try again shortly.
    log("Can't reach the site, retrying…", e?.cause?.code ?? e?.name ?? "");
    await wait(backoff);
    backoff = Math.min(backoff * 2, 60_000);
  }
}
