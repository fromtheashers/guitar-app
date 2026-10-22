import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";

// There are no accounts. Anyone with the link can practise; adding and editing
// songs needs the teacher's passcode (EDITOR_PASSCODE). A signed cookie remembers it.

export const EDITOR_COOKIE = "editor";
const MAX_AGE = 60 * 60 * 24 * 90;

function token(): string | null {
  const pass = process.env.EDITOR_PASSCODE;
  if (!pass) return null;
  const secret = process.env.SESSION_SECRET || pass;
  return createHmac("sha256", secret).update("editor:" + pass).digest("hex");
}

function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

export function passcodeConfigured(): boolean {
  return Boolean(process.env.EDITOR_PASSCODE);
}

export function checkPasscode(attempt: string): boolean {
  const pass = process.env.EDITOR_PASSCODE;
  return Boolean(pass) && safeEqual(attempt.trim(), pass!);
}

export async function isEditor(): Promise<boolean> {
  const expected = token();
  if (!expected) return false;
  const value = (await cookies()).get(EDITOR_COOKIE)?.value;
  return Boolean(value) && safeEqual(value!, expected);
}

export async function signIn(): Promise<void> {
  const t = token();
  if (!t) return;
  (await cookies()).set(EDITOR_COOKIE, t, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: MAX_AGE,
    path: "/",
  });
}

export async function signOut(): Promise<void> {
  (await cookies()).delete(EDITOR_COOKIE);
}
