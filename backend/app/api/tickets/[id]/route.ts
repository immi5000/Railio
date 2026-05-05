import type { NextRequest } from "next/server";
import { json, jsonError, preflight } from "@/lib/cors";
import { deleteTicket, getTicketDetail } from "@/lib/tickets-repo";
import { getSql } from "@/lib/db";
import type { Severity, TicketStatus } from "@contract/contract";

const SEVERITIES: Severity[] = ["minor", "major", "critical"];

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
  const body = (await req.json()) as {
    status?: TicketStatus;
    pre_arrival_summary?: string;
    severity?: Severity;
  };
  const sql = getSql();
  const ticketId = Number(id);

  if (body.severity !== undefined && !SEVERITIES.includes(body.severity)) {
    return jsonError("invalid severity", 400);
  }

  const sets: string[] = [];
  if (body.status !== undefined) sets.push("status");
  if (body.pre_arrival_summary !== undefined) sets.push("pre_arrival_summary");
  if (body.severity !== undefined) sets.push("severity");
  if (sets.length === 0) return jsonError("no fields to update", 400);

  // postgres-js doesn't support fragment composition cleanly across optional
  // SETs, so update each provided field with its own statement.
  if (body.status !== undefined) {
    await sql`UPDATE tickets SET status = ${body.status} WHERE id = ${ticketId}`;
  }
  if (body.pre_arrival_summary !== undefined) {
    await sql`UPDATE tickets SET pre_arrival_summary = ${body.pre_arrival_summary} WHERE id = ${ticketId}`;
  }
  if (body.severity !== undefined) {
    await sql`UPDATE tickets SET severity = ${body.severity} WHERE id = ${ticketId}`;
  }

  const t = await getTicketDetail(ticketId);
  return t ? json(t) : jsonError("not found", 404);
}

export async function DELETE(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const ok = await deleteTicket(Number(id));
  if (!ok) return jsonError("not found", 404);
  return json({ deleted: true });
}
