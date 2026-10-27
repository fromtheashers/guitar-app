// Audio service for Chord Window, run on Google Cloud Run. When a student changes
// key, their browser brings a short-lived pass signed by the site and this streams
// that video's audio from yt-dlp straight back. Nothing is written to disk.
//
// POST /audio  body {"ticket": "<payload>.<signature>"} (signed with AUDIO_TOKEN)
// GET /check?v=<video id>  with  Authorization: Bearer <AUDIO_TOKEN>: only reports
//   whether YouTube lets the service in.

import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { createHmac, timingSafeEqual } from "node:crypto";

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

const same = (a, b) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

/** The video id a valid, unexpired pass allows, or an error message. */
function readTicket(ticket) {
  const [body, sig] = String(ticket ?? "").split(".");
  if (!TOKEN || !body || !sig || !same(sig, createHmac("sha256", TOKEN).update(body).digest("base64url"))) return { error: "Bad pass." };
  let p;
  try {
    p = JSON.parse(Buffer.from(body, "base64url").toString());
  } catch {
    return { error: "Bad pass." };
  }
  if (!(p.exp * 1000 > Date.now())) return { error: "Pass expired." };
  if (!/^[\w-]{11}$/.test(p.v ?? "")) return { error: "Bad pass." };
  return { id: p.v };
}

function readBody(req) {
  return new Promise((resolve) => {
    let data = "";
    req.on("data", (d) => {
      data += d;
      if (data.length > 10_000) req.destroy();
    });
    req.on("end", () => resolve(data));
    req.on("error", () => resolve(""));
  });
}

// Browsers on the site call this directly; the pass is what protects it.
const CORS = { "access-control-allow-origin": "*", "access-control-allow-methods": "POST, GET, OPTIONS", "access-control-allow-headers": "content-type" };

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

createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", "http://x");
  if (req.method === "OPTIONS") return void res.writeHead(204, CORS).end();
  if (url.pathname === "/") return void res.end("ok");
  let id;
  if (url.pathname === "/check" && req.method === "GET") {
    if (!authorised(req.headers.authorization)) return void res.writeHead(401).end("Wrong token.");
    id = url.searchParams.get("v") ?? "";
    if (!/^[\w-]{11}$/.test(id)) return void res.writeHead(400).end("Bad video id.");
  } else if (url.pathname === "/audio" && req.method === "POST") {
    let ticket;
    try {
      ticket = JSON.parse(await readBody(req)).ticket;
    } catch {}
    const read = readTicket(ticket);
    if (read.error) return void res.writeHead(403, CORS).end(read.error);
    id = read.id;
  } else return void res.writeHead(404).end();

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
    if (!sent) res.writeHead(200, { ...CORS, "content-type": "application/octet-stream", "cache-control": "no-store" });
    sent += chunk.length;
    if (sent > MAX_BYTES) return void (kill(), res.destroy());
    res.write(chunk);
  });
  child.on("error", () => res.writeHead(500, CORS).end("ERROR: yt-dlp isn't installed."));
  child.on("close", (code) => {
    if (sent) return void (code === 0 ? res.end() : res.destroy());
    console.error("yt-dlp failed:", lastError(stderr));
    res.writeHead(502, { ...CORS, "content-type": "text/plain" }).end(stderr || `ERROR: yt-dlp exited ${code}`);
  });
}).listen(PORT, () => console.log(`Listening on ${PORT}`));
