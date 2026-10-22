import { checkPasscode, passcodeConfigured, signIn, signOut } from "@/lib/auth";
import { json, problem, readJson } from "@/lib/http";

export async function POST(req: Request) {
  if (!passcodeConfigured()) return problem("No teacher passcode is set. Add EDITOR_PASSCODE in Render's environment settings.", 503);
  const body = (await readJson(req)) as { passcode?: unknown } | null;
  const attempt = typeof body?.passcode === "string" ? body.passcode : "";
  if (!checkPasscode(attempt)) return problem("That passcode isn't right.", 401);
  await signIn();
  return json({ ok: true });
}

export async function DELETE() {
  await signOut();
  return json({ ok: true });
}
