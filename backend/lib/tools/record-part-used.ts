import { getSql } from "../db";
import type { ToolEmit } from "./index";
import type { F6180_49A, FormType } from "@contract/contract";

type Input = { ticket_id: number; part_id: number; qty: number };

export async function recordPartUsed(inp: Input, emit: ToolEmit) {
  const sql = getSql();
  const partRows = await sql<any[]>`SELECT * FROM parts WHERE id = ${inp.part_id}`;
  const part = partRows[0];
  if (!part) return { error: `part ${inp.part_id} not found` };

  const now = new Date().toISOString();
  await sql`
    INSERT INTO ticket_parts (ticket_id, part_id, qty, added_via, added_at)
    VALUES (${inp.ticket_id}, ${inp.part_id}, ${inp.qty}, 'ai_suggestion', ${now})
  `;

  const formRows = await sql<{ payload: any }[]>`
    SELECT payload FROM forms WHERE ticket_id = ${inp.ticket_id} AND form_type = 'F6180_49A'
  `;
  if (formRows[0]) {
    const payload = formRows[0].payload as F6180_49A;
    const lastRepair = payload.repairs[payload.repairs.length - 1];
    if (lastRepair) {
      lastRepair.parts_replaced = [
        ...(lastRepair.parts_replaced ?? []),
        ...Array(inp.qty).fill(part.part_number),
      ];
      await sql`
        UPDATE forms SET payload = ${sql.json(payload as any)}, updated_at = ${now}
        WHERE ticket_id = ${inp.ticket_id} AND form_type = 'F6180_49A'
      `;
      emit({
        type: "form_updated",
        form_type: "F6180_49A" as FormType,
        payload: payload as unknown as Record<string, unknown>,
      });
    }
  }

  return {
    ok: true,
    part_number: part.part_number,
    name: part.name,
    bin_location: part.bin_location,
    qty: inp.qty,
  };
}
