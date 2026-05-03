import type { NextRequest } from "next/server";
import { json, jsonError, preflight } from "@/lib/cors";
import { getSql } from "@/lib/db";
import type { FormType } from "@contract/contract";

const FORM_TYPES: FormType[] = ["F6180_49A", "DAILY_INSPECTION_229_21"];

export async function OPTIONS(req: NextRequest) {
  return preflight(req);
}

export async function PATCH(
  req: NextRequest,
  ctx: { params: Promise<{ id: string; form_type: string }> }
) {
  const { id, form_type } = await ctx.params;
  if (!FORM_TYPES.includes(form_type as FormType)) return jsonError("bad form_type", 400);
  const body = (await req.json()) as { payload: Record<string, unknown> };
  if (!body?.payload || typeof body.payload !== "object")
    return jsonError("payload required", 400);

  const sql = getSql();
  const ticketId = Number(id);
  const rows = await sql<{ payload: any }[]>`
    SELECT payload FROM forms WHERE ticket_id = ${ticketId} AND form_type = ${form_type}
  `;
  if (!rows[0]) return jsonError("form not found", 404);
  const merged = { ...rows[0].payload, ...body.payload };
  const now = new Date().toISOString();
  await sql`
    UPDATE forms SET payload = ${sql.json(merged as any)}, updated_at = ${now}
    WHERE ticket_id = ${ticketId} AND form_type = ${form_type}
  `;

  const updatedRows = await sql<any[]>`
    SELECT * FROM forms WHERE ticket_id = ${ticketId} AND form_type = ${form_type}
  `;
  const updated = updatedRows[0];
  return json({
    ticket_id: updated.ticket_id,
    form_type: updated.form_type,
    payload: updated.payload,
    status: updated.status,
    pdf_path: updated.pdf_path,
    updated_at: updated.updated_at,
  });
}
