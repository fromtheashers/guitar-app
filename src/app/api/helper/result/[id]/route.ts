import type { NextRequest } from "next/server";
import { json, problem } from "@/lib/http";
import { checkHelperToken, finishJob } from "@/lib/helperQueue";

// Separated songs arrive as WAV, which is larger than YouTube's compressed audio.
const MAX_BYTES = 100 * 1024 * 1024;

// The helper posts the audio (or yt-dlp's error text) for a job here.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!checkHelperToken(req.headers.get("authorization"))) return problem("Wrong helper password.", 401);
  const { id } = await params;
  if (Number(req.headers.get("content-length") ?? 0) > MAX_BYTES) return problem("Too large.", 413);
  const ok = req.headers.get("content-type")?.startsWith("text/plain")
    ? finishJob(id, { stderr: await req.text() })
    : finishJob(id, { audio: new Uint8Array(await req.arrayBuffer()), stems: req.headers.get("x-stems") === "1" });
  return ok ? json({ ok: true }) : problem("No such job (it may have been cancelled).", 404);
}
