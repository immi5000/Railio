import type { NextRequest } from "next/server";
import { json, jsonError, preflight } from "@/lib/cors";
import { resetTicket } from "@/lib/tickets-repo";

export async function OPTIONS(req: NextRequest) {
  return preflight(req);
}

// Demo-only: rewind a ticket back to AWAITING_TECH so the same scenario can be
// re-run. Wipes messages, ticket_parts, and AI form edits.
export async function POST(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const t = await resetTicket(Number(id));
  if (!t) return jsonError("not found", 404);
  return json(t);
}
