import type { NextRequest } from "next/server";
import { json, jsonError, preflight } from "@/lib/cors";
import { getSql } from "@/lib/db";
import { renderFormPdf } from "@/lib/forms/pdf/render";
import type { FormType } from "@contract/contract";

const FORM_TYPES: FormType[] = ["F6180_49A", "DAILY_INSPECTION_229_21"];

export async function OPTIONS(req: NextRequest) {
  return preflight(req);
}

export async function POST(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string; form_type: string }> }
) {
  const { id, form_type } = await ctx.params;
  if (!FORM_TYPES.includes(form_type as FormType)) return jsonError("bad form_type", 400);

  const sql = getSql();
  const ticketId = Number(id);
  const rows = await sql<{ payload: any }[]>`
    SELECT payload FROM forms WHERE ticket_id = ${ticketId} AND form_type = ${form_type}
  `;
  if (!rows[0]) return jsonError("form not found", 404);

  const pdf_path = await renderFormPdf(ticketId, form_type as FormType, rows[0].payload);
  const now = new Date().toISOString();
  await sql`
    UPDATE forms SET pdf_path = ${pdf_path}, status = 'exported', updated_at = ${now}
    WHERE ticket_id = ${ticketId} AND form_type = ${form_type}
  `;
  return json({ pdf_path });
}
