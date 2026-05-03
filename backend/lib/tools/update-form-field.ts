import { getSql } from "../db";
import { applyFieldPath, validateFieldPath } from "../forms/field-path";
import type { FormType } from "@contract/contract";
import type { ToolEmit } from "./index";

type Input = {
  ticket_id: number;
  form_type: FormType;
  field_path: string;
  value: unknown;
  source_message_id: number;
};

export async function updateFormField(inp: Input, emit: ToolEmit) {
  if (!validateFieldPath(inp.form_type, inp.field_path)) {
    return { error: `invalid field_path '${inp.field_path}' for form ${inp.form_type}` };
  }
  const sql = getSql();
  const rows = await sql<{ payload: any }[]>`
    SELECT payload FROM forms WHERE ticket_id = ${inp.ticket_id} AND form_type = ${inp.form_type}
  `;
  if (!rows[0]) return { error: `form ${inp.form_type} not found for ticket ${inp.ticket_id}` };

  const payload = rows[0].payload; // jsonb returns parsed object
  const updated = applyFieldPath(payload, inp.field_path, inp.value);
  const now = new Date().toISOString();
  await sql`
    UPDATE forms
    SET payload = ${sql.json(updated as any)}, updated_at = ${now}
    WHERE ticket_id = ${inp.ticket_id} AND form_type = ${inp.form_type}
  `;

  emit({
    type: "form_updated",
    form_type: inp.form_type,
    payload: updated as Record<string, unknown>,
  });

  return { ok: true, form_type: inp.form_type, field_path: inp.field_path };
}
