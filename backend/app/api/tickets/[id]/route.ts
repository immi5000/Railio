import type { NextRequest } from "next/server";
import { json, jsonError, preflight } from "@/lib/cors";
import { getTicketDetail } from "@/lib/tickets-repo";
import { getSql } from "@/lib/db";
import type { TicketStatus } from "@contract/contract";

export async function OPTIONS(req: NextRequest) {
  return preflight(req);
}

export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const t = await getTicketDetail(Number(id));
  if (!t) return jsonError("not found", 404);
  return json(t);
}

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const body = (await req.json()) as { status?: TicketStatus; pre_arrival_summary?: string };
  const sql = getSql();
  const ticketId = Number(id);

  if (body.status !== undefined && body.pre_arrival_summary !== undefined) {
    await sql`
      UPDATE tickets SET status = ${body.status}, pre_arrival_summary = ${body.pre_arrival_summary}
      WHERE id = ${ticketId}
    `;
  } else if (body.status !== undefined) {
    await sql`UPDATE tickets SET status = ${body.status} WHERE id = ${ticketId}`;
  } else if (body.pre_arrival_summary !== undefined) {
    await sql`UPDATE tickets SET pre_arrival_summary = ${body.pre_arrival_summary} WHERE id = ${ticketId}`;
  } else {
    return jsonError("no fields to update", 400);
  }

  const t = await getTicketDetail(ticketId);
  return t ? json(t) : jsonError("not found", 404);
}
