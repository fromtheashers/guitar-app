import type { NextRequest } from "next/server";
import { setHelperStatus } from "@/lib/db";
import { dbError, json, problem, readJson } from "@/lib/http";
import { checkHelperToken } from "@/lib/helper";

// The helper on the teacher's computer says where it can be reached, every minute.
export async function POST(req: NextRequest) {
  if (!checkHelperToken(req.headers.get("authorization"))) return problem("Wrong helper password.", 401);
  const body = ((await readJson(req)) ?? {}) as { url?: unknown; version?: unknown };
  const url = typeof body.url === "string" ? body.url.replace(/\/+$/, "") : "";
  if (!/^https:\/\/[\w.-]+(:\d+)?$/.test(url)) return problem("Send the helper's https address.", 400);
  try {
    await setHelperStatus(url, Number(body.version) || 0);
    return json({ ok: true });
  } catch (e) {
    return dbError(e);
  }
}
