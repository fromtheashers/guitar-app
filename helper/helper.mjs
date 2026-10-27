// YouTube helper for Chord Window. Runs on a home computer and downloads a video's
// audio with yt-dlp over the home connection, which YouTube doesn't block. Audio is
// held in memory only and never written to disk.
//
// The site runs on Vercel and never handles audio. This helper runs a small server,
// reachable from the internet through a free Cloudflare quick tunnel (cloudflared,
// no account needed), and tells the site its address every minute. A browser that
// wants audio brings a short pass signed by the site with the shared password:
// POST /jobs {"ticket"} starts the work, GET /jobs/<id> answers 202 until the audio
// is ready, then sends it once.
//
// Needs Node 20+, yt-dlp and cloudflared (yt-dlp.exe and cloudflared.exe next to this
// file on Windows, or on PATH). Settings come from config.json next to this file:
// { "site": "https://…", "token": "…" }, optionally "port" (default 47321) and
// "publicUrl" (an address that already reaches the port, instead of a quick tunnel).
//
// Optional: with "separator" set to a Python that has Demucs (see separate.py), in
// config.json or in separator.json next to this file (which holds no password), the
// helper splits each song into instruments and drums before sending it, so the site
// can read chords without vocals and strum patterns from the drums alone. Needs
// ffmpeg (ffmpeg.exe next to this file, "ffmpeg" in config.json, or on PATH). If
// separation fails, the plain audio is sent instead.
//
// When a draft comes with lyrics, separate.py also transcribes the vocals with
// Whisper (openai-whisper in the same Python) so the site can name sections from the
// lyrics. "lyricsModel" / "lyricsModelCpu" in separator.json pick the models
// (default turbo on a free graphics card, small on the processor).

import { spawn } from "node:child_process";
import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { createServer } from "node:http";
import { existsSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
// Windows PowerShell 5 writes a byte-order mark, which JSON.parse rejects.
const config = JSON.parse(readFileSync(path.join(here, "config.json"), "utf8").replace(/^\uFEFF/, ""));
const site = String(config.site).replace(/\/+$/, "");
const token = String(config.token);
const port = Number(config.port ?? 47321);
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
// Tells the site what this helper can do (3: sends sung words; 4: serves browsers directly).
const VERSION = 4;
const log = (...a) => console.log(new Date().toLocaleTimeString(), ...a);

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
async function separate(audio, job) {
  if (!separator) return null;
  const started = Date.now();
  const decoded = await run(ffmpeg, ["-v", "error", "-i", "pipe:0", "-f", "f32le", "-ac", "2", "-ar", "44100", "pipe:1"], audio);
  if (decoded.code !== 0 || !decoded.out.length) {
    log("Couldn't decode the audio for separation:", decoded.stderr.trim().split("\n").pop());
    return null;
  }
  const env = {
    ...(models ? { TORCH_HOME: models, HF_HOME: path.join(models, "hf") } : {}),
    ...(job.words ? { CW_WORDS: "1", CW_PROMPT: String(job.words.prompt ?? "").slice(0, 1000) } : {}),
    ...(sep.lyricsModel ? { CW_WHISPER_MODEL: sep.lyricsModel } : {}),
    ...(sep.lyricsModelCpu ? { CW_WHISPER_CPU_MODEL: sep.lyricsModelCpu } : {}),
  };
  const split = await run(separator, [separatorScript], decoded.out, env);
  if (split.code !== 0 || split.out.length < 44) {
    log("Separation failed, sending the plain audio:", split.stderr.trim().split("\n").pop());
    return null;
  }
  log(`Separated in ${((Date.now() - started) / 1000).toFixed(1)} s.`);
  for (const line of split.stderr.split("\n")) if (line.startsWith("NOTE: ")) log(line.slice(6));
  return split.out;
}

// ---- Passes from the site ----

const same = (a, b) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

/** The job a valid, unexpired pass allows, or an error message. */
function readTicket(ticket) {
  const [body, sig] = String(ticket ?? "").split(".");
  if (!body || !sig || !same(sig, createHmac("sha256", token).update(body).digest("base64url"))) return { error: "Bad pass." };
  let p;
  try {
    p = JSON.parse(Buffer.from(body, "base64url").toString());
  } catch {
    return { error: "Bad pass." };
  }
  if (!(p.exp * 1000 > Date.now())) return { error: "Pass expired." };
  if (!/^[\w-]{11}$/.test(p.v ?? "") || !(p.f in FORMATS)) return { error: "Bad pass." };
  return { job: { videoId: p.v, format: p.f, ...(p.w ? { words: { prompt: String(p.w) } } : {}) } };
}

// ---- Jobs, one at a time so the computer stays usable ----

const jobs = new Map();
const KEEP_MS = 3 * 60_000;
const MAX_WAITING = 5;
let chain = Promise.resolve();

function addJob(job) {
  const id = randomUUID();
  const entry = { state: "waiting", result: null, timer: null };
  jobs.set(id, entry);
  chain = chain.then(async () => {
    entry.state = "working";
    log(`Fetching ${job.videoId}${job.format === "listen" ? " for a student" : ""}…`);
    let result = await download(job);
    if ("audio" in result && job.format !== "listen") {
      const stems = await separate(result.audio, job);
      if (stems) result = { audio: stems, stems: true };
    }
    log("audio" in result ? `Ready: ${(result.audio.length / 1048576).toFixed(1)} MB.` : `Failed: ${result.stderr.split("\n").filter(Boolean).pop()}`);
    entry.state = "done";
    entry.result = result;
    // Nobody came for it: let it go.
    entry.timer = setTimeout(() => jobs.delete(id), KEEP_MS);
  });
  return id;
}

// ---- The server the tunnel points at ----

const CORS = { "access-control-allow-origin": "*", "access-control-allow-methods": "GET, POST, OPTIONS", "access-control-allow-headers": "content-type", "access-control-expose-headers": "x-stems" };

function readBody(req) {
  return new Promise((resolve) => {
    let data = "";
    req.on("data", (d) => {
      data += d;
      if (data.length > 20_000) req.destroy();
    });
    req.on("end", () => resolve(data));
    req.on("error", () => resolve(""));
  });
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", "http://x");
  if (req.method === "OPTIONS") return void res.writeHead(204, CORS).end();
  if (url.pathname === "/" && req.method === "GET") return void res.writeHead(200, CORS).end("ok");

  if (url.pathname === "/jobs" && req.method === "POST") {
    let ticket;
    try {
      ticket = JSON.parse(await readBody(req)).ticket;
    } catch {}
    const read = readTicket(ticket);
    if (read.error) return void res.writeHead(403, CORS).end(read.error);
    const waiting = [...jobs.values()].filter((j) => j.state !== "done").length;
    if (waiting >= MAX_WAITING) return void res.writeHead(503, CORS).end("The home computer is busy. Try again in a minute.");
    return void res.writeHead(200, { ...CORS, "content-type": "application/json" }).end(JSON.stringify({ id: addJob(read.job) }));
  }

  const m = /^\/jobs\/([\w-]+)$/.exec(url.pathname);
  if (m && req.method === "GET") {
    const entry = jobs.get(m[1]);
    if (!entry) return void res.writeHead(404, CORS).end("No such job (it may have expired).");
    if (entry.state !== "done") return void res.writeHead(202, { ...CORS, "cache-control": "no-store" }).end();
    // Sent once, then forgotten.
    jobs.delete(m[1]);
    clearTimeout(entry.timer);
    const r = entry.result;
    if ("audio" in r) {
      return void res
        .writeHead(200, { ...CORS, "content-type": "application/octet-stream", "content-length": r.audio.length, "cache-control": "no-store", ...(r.stems ? { "x-stems": "1" } : {}) })
        .end(r.audio);
    }
    return void res.writeHead(502, { ...CORS, "content-type": "text/plain" }).end(r.stderr);
  }
  res.writeHead(404, CORS).end();
});

// ---- Telling the site where we are ----

let publicUrl = config.publicUrl ? String(config.publicUrl).replace(/\/+$/, "") : null;

async function hello() {
  if (!publicUrl) return;
  try {
    const res = await fetch(`${site}/api/helper/hello`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ url: publicUrl, version: VERSION }),
      signal: AbortSignal.timeout(20_000),
    });
    if (res.status === 401) log("The site rejected the helper password. Check config.json matches HELPER_TOKEN in Vercel.");
    else if (!res.ok) log("The site didn't take the helper's address:", res.status);
  } catch (e) {
    log("Can't reach the site, will try again…", e?.cause?.code ?? e?.name ?? "");
  }
}

// A quick tunnel gets a new random address each time it starts; restart it if it stops.
function tunnel() {
  const exe = config.cloudflared ?? ["cloudflared.exe", "cloudflared"].map((f) => path.join(here, f)).find(existsSync) ?? "cloudflared";
  const child = spawn(exe, ["tunnel", "--no-autoupdate", "--url", `http://127.0.0.1:${port}`], { stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
  const watch = (d) => {
    const found = /https:\/\/[a-z0-9-]+\.trycloudflare\.com/.exec(String(d));
    if (found && found[0] !== publicUrl) {
      publicUrl = found[0];
      log(`Reachable at ${publicUrl}`);
      void hello();
    }
  };
  child.stdout.on("data", watch);
  child.stderr.on("data", watch);
  child.on("error", () => log("cloudflared isn't installed next to the helper. Re-run the helper setup."));
  child.on("close", (code) => {
    log(`The tunnel stopped (${code}); restarting it…`);
    publicUrl = null;
    setTimeout(tunnel, 5000);
  });
}

server.listen(port, "127.0.0.1", () => {
  log(`Helper started (version ${VERSION}) for ${site}`);
  if (publicUrl) void hello();
  else tunnel();
  setInterval(hello, 60_000);
});
