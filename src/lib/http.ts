import { NextResponse } from "next/server";
import { isEditor } from "@/lib/auth";

export function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status });
}

export function problem(message: string, status: number) {
  return NextResponse.json({ error: message }, { status });
}

/** Returns a 401 response unless the request comes from the teacher. */
export async function requireEditor() {
  return (await isEditor()) ? null : problem("Enter the teacher passcode to make changes.", 401);
}

export async function readJson(req: Request): Promise<unknown> {
  try {
    return await req.json();
  } catch {
    return null;
  }
}

export function dbError(e: unknown) {
  console.error(e);
  const msg = e instanceof Error && e.message.includes("DATABASE_URL")
    ? "The database isn't connected yet. Add DATABASE_URL in Vercel's Environment Variables (Settings)."
    : "Something went wrong talking to the database. Try again in a moment.";
  return problem(msg, 500);
}
