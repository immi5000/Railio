import { getSql } from "../db";
import type { TicketStatus } from "@contract/contract";

type Input = { ticket_id: number; status: TicketStatus };

const LEGAL: Record<TicketStatus, TicketStatus[]> = {
  AWAITING_TECH: ["IN_PROGRESS"],
  IN_PROGRESS: ["AWAITING_REVIEW"],
  AWAITING_REVIEW: ["CLOSED", "IN_PROGRESS"],
  CLOSED: [],
};

export async function setTicketStatus(inp: Input) {
  const sql = getSql();
  const rows = await sql<{ status: TicketStatus }[]>`SELECT status FROM tickets WHERE id = ${inp.ticket_id}`;
  const t = rows[0];
  if (!t) return { error: `ticket ${inp.ticket_id} not found` };
  if (!LEGAL[t.status]?.includes(inp.status)) {
    return { error: `illegal transition ${t.status} → ${inp.status}` };
  }
  const closed_at = inp.status === "CLOSED" ? new Date().toISOString() : null;
  await sql`
    UPDATE tickets
    SET status = ${inp.status}, closed_at = COALESCE(${closed_at}, closed_at)
    WHERE id = ${inp.ticket_id}
  `;
  return { ok: true, status: inp.status };
}
