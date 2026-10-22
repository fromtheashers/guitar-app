import { createSong, listSongs } from "@/lib/db";
import { songInput } from "@/lib/validate";
import { dbError, json, problem, readJson, requireEditor } from "@/lib/http";

export async function GET() {
  try {
    return json(await listSongs());
  } catch (e) {
    return dbError(e);
  }
}

export async function POST(req: Request) {
  const denied = await requireEditor();
  if (denied) return denied;
  const parsed = songInput(await readJson(req));
  if (!parsed.ok) return problem(parsed.error, 400);
  try {
    return json(await createSong(parsed.value), 201);
  } catch (e) {
    return dbError(e);
  }
}
