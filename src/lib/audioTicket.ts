import "server-only";
import { createHmac } from "node:crypto";

// Short-lived signed passes for fetching a song's audio. The site never handles the
// audio itself: it signs what may be fetched, and the browser takes the pass to the
// Google Cloud audio service or the helper on the teacher's computer, which check
// the signature with the password they share with the site. Format: payload.signature,
// both base64url; the payload is JSON.

export interface TicketPayload {
  /** YouTube video id. */
  v: string;
  /** "m4a" | "webm" for drafting, "listen" for a student playing it in another key. */
  f: "m4a" | "webm" | "listen";
  /** Lyric lines: also transcribe the vocals (helper only). */
  w?: string;
}

const TTL_SECONDS = 120;

export function signTicket(payload: TicketPayload, secret: string): string {
  const body = Buffer.from(JSON.stringify({ ...payload, exp: Math.floor(Date.now() / 1000) + TTL_SECONDS })).toString("base64url");
  return `${body}.${createHmac("sha256", secret).update(body).digest("base64url")}`;
}
