import type { NextRequest } from "next/server";
import { json, jsonError, preflight } from "@/lib/cors";
import { parseFaultDump } from "@/lib/tools/parse-fault-dump";

export async function OPTIONS(req: NextRequest) {
  return preflight(req);
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const body = (await req.json()) as { raw: string };
  if (!body?.raw) return jsonError("raw required", 400);
  const noopEmit = () => {};
  try {
    const out = await parseFaultDump({ ticket_id: Number(id), raw_text: body.raw }, noopEmit);
    return json({ parsed: out.parsed });
  } catch (e) {
    return jsonError(String(e), 500);
  }
}
