import { getSql } from "../db";
import { getOpenAI, OPENAI_CHAT_MODEL } from "../openai";
import type { ParsedFault } from "@contract/contract";
import type { ToolEmit } from "./index";

type Input = { ticket_id: number; raw_text: string };

const PARSER_SYSTEM = `Extract structured fault entries from a raw locomotive diagnostic dump (GE ToolBoxLOCO export, fault history screen, etc.).

Return ONLY a JSON object of shape { "faults": ParsedFault[] } where each fault is:
{ "code": string, "ts": string|null (ISO 8601 if present), "severity": "minor"|"major"|"critical", "description": string }

Rules:
- One object per distinct fault entry.
- code: the alphanumeric fault identifier as it appears (e.g. "EOA-3", "FUEL-PRESS-LOW").
- severity: infer from any flags ("CRITICAL", "WARN", "INFO") or fault category. Default "minor" if unknown.
- description: brief plain-text description; keep the original phrasing where possible.
- ts: parse any timestamp into ISO 8601, else null.`;

export async function parseFaultDump(inp: Input, _emit: ToolEmit) {
  const client = getOpenAI();
  const r = await client.chat.completions.create({
    model: OPENAI_CHAT_MODEL,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: PARSER_SYSTEM },
      { role: "user", content: inp.raw_text },
    ],
  });

  const text = r.choices[0]?.message?.content ?? "{}";
  let parsed: ParsedFault[] = [];
  try {
    const obj = JSON.parse(text);
    if (Array.isArray(obj)) parsed = obj;
    else if (Array.isArray(obj.faults)) parsed = obj.faults;
  } catch {
    parsed = [];
  }

  const sql = getSql();
  await sql`
    UPDATE tickets SET fault_dump_parsed = ${JSON.stringify(parsed)} WHERE id = ${inp.ticket_id}
  `;

  return { parsed };
}
