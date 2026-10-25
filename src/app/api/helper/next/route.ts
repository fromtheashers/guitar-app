import type { NextRequest } from "next/server";
import { json, problem } from "@/lib/http";
import { checkHelperToken, nextJob } from "@/lib/helperQueue";

// The home helper long-polls here for work.
export async function GET(req: NextRequest) {
  if (!checkHelperToken(req.headers.get("authorization"))) return problem("Wrong helper password.", 401);
  const job = await nextJob(req.signal, Number(req.nextUrl.searchParams.get("v")) || 1);
  return job ? json(job) : new Response(null, { status: 204 });
}
