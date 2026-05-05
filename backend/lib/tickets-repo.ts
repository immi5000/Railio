import { getSql } from "./db";
import { buildInitialForms } from "./forms/pre-fill";
import type { Asset, Form, FormType, Severity, Ticket, TicketDetail, TicketPart, TicketStatus } from "@contract/contract";
import { listMessages } from "./messages-repo";
import { generatePreArrivalSummary } from "./pre-arrival";

export async function getAsset(id: number): Promise<Asset | null> {
  const sql = getSql();
  const rows = await sql<Asset[]>`
    SELECT id, reporting_mark, road_number, unit_model, in_service_date, last_inspection_at
    FROM assets WHERE id = ${id}
  `;
  return rows[0] ?? null;
}

export async function listTickets(status?: TicketStatus): Promise<Ticket[]> {
  const sql = getSql();
  const rows = status
    ? await sql<any[]>`SELECT * FROM tickets WHERE status = ${status} ORDER BY id DESC`
    : await sql<any[]>`SELECT * FROM tickets ORDER BY id DESC`;
  return Promise.all(rows.map(rowToTicket));
}

export async function getTicket(id: number): Promise<Ticket | null> {
  const sql = getSql();
  const rows = await sql<any[]>`SELECT * FROM tickets WHERE id = ${id}`;
  return rows[0] ? rowToTicket(rows[0]) : null;
}

export async function getTicketDetail(id: number): Promise<TicketDetail | null> {
  const t = await getTicket(id);
  if (!t) return null;
  const [messages, forms, ticket_parts] = await Promise.all([
    listMessages(id),
    listForms(id),
    listTicketParts(id),
  ]);
  return { ...t, messages, forms, ticket_parts };
}

async function rowToTicket(r: any): Promise<Ticket> {
  const asset = await getAsset(r.asset_id);
  return {
    id: r.id,
    asset: asset!,
    status: r.status,
    severity: (r.severity ?? "major") as Severity,
    opened_at: r.opened_at,
    initial_error_codes: r.initial_error_codes,
    initial_symptoms: r.initial_symptoms,
    fault_dump_raw: r.fault_dump_raw,
    fault_dump_parsed: r.fault_dump_parsed ? JSON.parse(r.fault_dump_parsed) : null,
    pre_arrival_summary: r.pre_arrival_summary,
    closed_at: r.closed_at,
  };
}

export async function listForms(ticket_id: number): Promise<Form[]> {
  const sql = getSql();
  const rows = await sql<any[]>`
    SELECT * FROM forms WHERE ticket_id = ${ticket_id} ORDER BY form_type ASC
  `;
  return rows.map((r) => ({
    ticket_id: r.ticket_id,
    form_type: r.form_type as FormType,
    payload: r.payload, // jsonb returns parsed
    status: r.status,
    pdf_path: r.pdf_path,
    updated_at: r.updated_at,
  })) as Form[];
}

export async function listTicketParts(ticket_id: number): Promise<TicketPart[]> {
  const sql = getSql();
  const rows = await sql<any[]>`
    SELECT * FROM ticket_parts WHERE ticket_id = ${ticket_id} ORDER BY id ASC
  `;
  return rows.map((r) => ({
    id: r.id,
    part_id: r.part_id,
    qty: r.qty,
    added_via: r.added_via,
    added_at: r.added_at,
  }));
}

export type CreateTicketInput = {
  asset_id: number;
  initial_symptoms?: string;
  initial_error_codes?: string;
  fault_dump_raw?: string;
  severity?: Severity;
};

// Permanently delete a ticket and all of its dependents (messages, parts,
// forms). Returns true if a row was removed.
export async function deleteTicket(id: number): Promise<boolean> {
  const sql = getSql();
  const existing = await sql<{ id: number }[]>`SELECT id FROM tickets WHERE id = ${id}`;
  if (existing.length === 0) return false;
  await sql.begin(async (tx) => {
    await tx`DELETE FROM messages WHERE ticket_id = ${id}`;
    await tx`DELETE FROM ticket_parts WHERE ticket_id = ${id}`;
    await tx`DELETE FROM forms WHERE ticket_id = ${id}`;
    await tx`DELETE FROM tickets WHERE id = ${id}`;
  });
  return true;
}

export async function createTicket(inp: CreateTicketInput): Promise<Ticket> {
  const sql = getSql();
  const asset = await getAsset(inp.asset_id);
  if (!asset) throw new Error(`asset ${inp.asset_id} not found`);
  const opened_at = new Date().toISOString();

  const inserted = await sql<{ id: number }[]>`
    INSERT INTO tickets (asset_id, status, severity, opened_by_role, opened_at, initial_error_codes, initial_symptoms, fault_dump_raw)
    VALUES (
      ${inp.asset_id},
      'AWAITING_TECH',
      ${inp.severity ?? "major"},
      'dispatcher',
      ${opened_at},
      ${inp.initial_error_codes ?? null},
      ${inp.initial_symptoms ?? null},
      ${inp.fault_dump_raw ?? null}
    )
    RETURNING id
  `;
  const ticket_id = inserted[0].id;

  const initial = buildInitialForms({
    ticket_id,
    asset,
    opened_at,
    initial_error_codes: inp.initial_error_codes ?? null,
    initial_symptoms: inp.initial_symptoms ?? null,
    opened_by: "dispatcher",
  });
  await sql`
    INSERT INTO forms (ticket_id, form_type, payload, status, updated_at)
    VALUES (${ticket_id}, 'F6180_49A', ${sql.json(initial.F6180_49A as any)}, 'draft', ${opened_at})
  `;
  await sql`
    INSERT INTO forms (ticket_id, form_type, payload, status, updated_at)
    VALUES (${ticket_id}, 'DAILY_INSPECTION_229_21', ${sql.json(initial.DAILY_INSPECTION_229_21 as any)}, 'draft', ${opened_at})
  `;

  // Auto-generate the pre-arrival brief from intake. Best-effort: a generation
  // failure must not break ticket creation, so we swallow errors and continue.
  try {
    const summary = await generatePreArrivalSummary({
      asset,
      severity: inp.severity ?? "major",
      initial_symptoms: inp.initial_symptoms ?? null,
      initial_error_codes: inp.initial_error_codes ?? null,
      fault_dump_raw: inp.fault_dump_raw ?? null,
    });
    if (summary) {
      await sql`
        UPDATE tickets SET pre_arrival_summary = ${summary} WHERE id = ${ticket_id}
      `;
    }
  } catch (e) {
    console.error("[createTicket] pre-arrival generation failed:", e);
  }

  return (await getTicket(ticket_id))!;
}
