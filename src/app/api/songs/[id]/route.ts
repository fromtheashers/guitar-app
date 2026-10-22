import { deleteSong, getSong, updateSong } from "@/lib/db";
import { songInput } from "@/lib/validate";
import { dbError, json, problem, readJson, requireEditor } from "@/lib/http";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: Request, { params }: Ctx) {
  try {
    const song = await getSong((await params).id);
    return song ? json(song) : problem("That song doesn't exist.", 404);
  } catch (e) {
    return dbError(e);
  }
}

export async function PUT(req: Request, { params }: Ctx) {
  const denied = await requireEditor();
  if (denied) return denied;
  const parsed = songInput(await readJson(req));
  if (!parsed.ok) return problem(parsed.error, 400);
  try {
    const song = await updateSong((await params).id, parsed.value);
    return song ? json(song) : problem("That song doesn't exist.", 404);
  } catch (e) {
    return dbError(e);
  }
}

export async function DELETE(_req: Request, { params }: Ctx) {
  const denied = await requireEditor();
  if (denied) return denied;
  try {
    return (await deleteSong((await params).id)) ? json({ ok: true }) : problem("That song doesn't exist.", 404);
  } catch (e) {
    return dbError(e);
  }
}
