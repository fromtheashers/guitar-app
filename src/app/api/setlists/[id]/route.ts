import { deleteSetlist, getSetlist, updateSetlist } from "@/lib/db";
import { setlistInput } from "@/lib/validate";
import { dbError, json, problem, readJson, requireEditor } from "@/lib/http";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: Request, { params }: Ctx) {
  try {
    const setlist = await getSetlist((await params).id);
    return setlist ? json(setlist) : problem("That setlist doesn't exist.", 404);
  } catch (e) {
    return dbError(e);
  }
}

export async function PUT(req: Request, { params }: Ctx) {
  const denied = await requireEditor();
  if (denied) return denied;
  const parsed = setlistInput(await readJson(req));
  if (!parsed.ok) return problem(parsed.error, 400);
  try {
    const setlist = await updateSetlist((await params).id, parsed.value);
    return setlist ? json(setlist) : problem("That setlist doesn't exist.", 404);
  } catch (e) {
    return dbError(e);
  }
}

export async function DELETE(_req: Request, { params }: Ctx) {
  const denied = await requireEditor();
  if (denied) return denied;
  try {
    return (await deleteSetlist((await params).id)) ? json({ ok: true }) : problem("That setlist doesn't exist.", 404);
  } catch (e) {
    return dbError(e);
  }
}
