// Audio service for Chord Window, run on Google Cloud Run. The site asks it for a
// YouTube video's audio when a student changes key; it streams yt-dlp's output
// straight back. Nothing is written to disk.
//
// GET /audio?v=<video id>  with  Authorization: Bearer <AUDIO_TOKEN>
// GET /check?v=<video id>  same, but only reports whether YouTube lets us in.

import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { timingSafeEqual } from "node:crypto";

const TOKEN = process.env.AUDIO_TOKEN ?? "";
const PORT = Number(process.env.PORT ?? 8080);
const MAX_BYTES = 40 * 1024 * 1024;
// Small AAC first (half the data, still fine for practice), then the usual one.
const FORMAT = "139/140/bestaudio[ext=m4a]/bestaudio";

function authorised(header) {
  if (!TOKEN || !header?.startsWith("Bearer ")) return false;
  const a = Buffer.from(header.slice(7));
  const b = Buffer.from(TOKEN);
  return a.length === b.length && timingSafeEqual(a, b);
}

function ytdlp(videoId, extra) {
  return spawn("yt-dlp", [
    "--format", FORMAT,
    "--no-playlist", "--no-part", "--no-cache-dir", "--no-progress", "--quiet",
    "--match-filter", "duration < 900",
    "--js-runtimes", `node:${process.execPath}`,
    ...extra,
    `https://www.youtube.com/watch?v=${videoId}`,
  ], { stdio: ["ignore", "pipe", "pipe"] });
}

function lastError(stderr) {
  return stderr.split("\n").filter((l) => l.startsWith("ERROR")).pop() ?? stderr.trim().split("\n").pop() ?? "";
}

createServer((req, res) => {
  const url = new URL(req.url ?? "/", "http://x");
  if (url.pathname === "/") return void res.end("ok");
  if (url.pathname !== "/audio" && url.pathname !== "/check") return void res.writeHead(404).end();
  if (!authorised(req.headers.authorization)) return void res.writeHead(401).end("Wrong token.");
  const id = url.searchParams.get("v") ?? "";
  if (!/^[\w-]{11}$/.test(id)) return void res.writeHead(400).end("Bad video id.");

  const check = url.pathname === "/check";
  const child = ytdlp(id, check ? ["--simulate", "--print", "%(title)s"] : ["--output", "-"]);
  let stderr = "";
  let sent = 0;
  child.stderr.on("data", (d) => {
    if (stderr.length < 4000) stderr += d;
  });
  const kill = () => child.kill("SIGKILL");
  res.on("close", kill);

  if (check) {
    let out = "";
    child.stdout.on("data", (d) => (out += d));
    child.on("close", (code) => res.writeHead(code === 0 ? 200 : 502).end(code === 0 ? `OK: ${out.trim()}\n` : `${lastError(stderr)}\n`));
    return;
  }

  child.stdout.on("data", (chunk) => {
    if (!sent) res.writeHead(200, { "content-type": "application/octet-stream", "cache-control": "no-store" });
    sent += chunk.length;
    if (sent > MAX_BYTES) return void (kill(), res.destroy());
    res.write(chunk);
  });
  child.on("error", () => res.writeHead(500).end("ERROR: yt-dlp isn't installed."));
  child.on("close", (code) => {
    if (sent) return void (code === 0 ? res.end() : res.destroy());
    console.error("yt-dlp failed:", lastError(stderr));
    res.writeHead(502, { "content-type": "text/plain" }).end(stderr || `ERROR: yt-dlp exited ${code}`);
  });
}).listen(PORT, () => console.log(`Listening on ${PORT}`));
