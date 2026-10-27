import "server-only";
import { timingSafeEqual } from "node:crypto";
import type { AudioSource } from "./audioSource";
import { signTicket, type TicketPayload } from "./audioTicket";
import { getHelperStatus } from "./db";

// The helper on the teacher's home computer fetches YouTube audio over a home
// connection, which YouTube doesn't block. It runs a small server reached through a
// Cloudflare tunnel and tells the site its address every minute (api/helper/hello).
// The site only signs passes; browsers fetch from the helper directly, so no audio
// passes through the site.

// Helpers that say hello every minute; a little slack for a slow minute.
const ONLINE_MS = 150_000;
// Version 4 is the first that serves browsers directly.
const MIN_VERSION = 4;

export function helperConfigured(): boolean {
  return Boolean(process.env.HELPER_TOKEN);
}

export function checkHelperToken(header: string | null): boolean {
  const token = process.env.HELPER_TOKEN;
  if (!token || !header?.startsWith("Bearer ")) return false;
  const a = Buffer.from(header.slice(7));
  const b = Buffer.from(token);
  return a.length === b.length && timingSafeEqual(a, b);
}

export type HelperState = "unconfigured" | "offline" | "outdated" | "online";

/** The helper as an audio source for this request, or why it can't be one. */
export async function helperSource(payload: TicketPayload): Promise<{ state: HelperState; source?: AudioSource }> {
  if (!helperConfigured()) return { state: "unconfigured" };
  const status = await getHelperStatus();
  if (!status || Date.now() - status.seenAt.getTime() > ONLINE_MS) return { state: "offline" };
  if (status.version < MIN_VERSION) return { state: "outdated" };
  return { state: "online", source: { kind: "helper", url: status.url, ticket: signTicket(payload, process.env.HELPER_TOKEN!) } };
}
