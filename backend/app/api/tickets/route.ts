import type { NextRequest } from "next/server";
import { json, jsonError, preflight } from "@/lib/cors";
import { createTicket, listTickets } from "@/lib/tickets-repo";
import type { CreateTicketBody, Severity, TicketStatus } from "@contract/contract";

const SEVERITIES: Severity[] = ["minor", "major", "critical"];

export async function OPTIONS(req: NextRequest) {
  return preflight(req);
}

export async function GET(req: NextRequest) {
  const status = req.nextUrl.searchParams.get("status") as TicketStatus | null;
  return json(await listTickets(status ?? undefined));
}

export async function POST(req: NextRequest) {
  let body: CreateTicketBody;
  try {
    body = (await req.json()) as CreateTicketBody;
  } catch {
    return jsonError("invalid json", 400);
  }
  if (!body.asset_id) return jsonError("asset_id required", 400);
  if (body.opened_by_role !== "dispatcher")
    return jsonError("opened_by_role must be 'dispatcher'", 400);
  if (body.severity !== undefined && !SEVERITIES.includes(body.severity))
    return jsonError("invalid severity", 400);
  try {
    const t = await createTicket(body);
    return json(t, { status: 201 });
  } catch (e) {
    return jsonError(String(e), 400);
  }
}
