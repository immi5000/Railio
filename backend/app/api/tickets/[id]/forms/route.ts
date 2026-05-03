import type { NextRequest } from "next/server";
import { json, preflight } from "@/lib/cors";
import { listForms } from "@/lib/tickets-repo";

export async function OPTIONS(req: NextRequest) {
  return preflight(req);
}

export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  return json(await listForms(Number(id)));
}
