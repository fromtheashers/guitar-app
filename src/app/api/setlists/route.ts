import { createSetlist, listSetlists } from "@/lib/db";
import { setlistInput } from "@/lib/validate";
import { dbError, json, problem, readJson, requireEditor } from "@/lib/http";

export async function GET() {
  try {
    return json(await listSetlists());
  } catch (e) {
    return dbError(e);
  }
}

export async function POST(req: Request) {
  const denied = await requireEditor();
  if (denied) return denied;
  const parsed = setlistInput(await readJson(req));
  if (!parsed.ok) return problem(parsed.error, 400);
  try {
    return json(await createSetlist(parsed.value), 201);
  } catch (e) {
    return dbError(e);
  }
}
