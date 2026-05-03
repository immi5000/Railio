import { getSql } from "./db";
import { chainHash } from "./hash";
import type { Message, Role, Citation, Attachment, ToolCall } from "@contract/contract";

export type InsertMessage = {
  ticket_id: number;
  role: Role;
  content: string;
  citations?: Citation[] | null;
  attachments?: Attachment[] | null;
  tool_calls?: ToolCall[] | null;
};

export async function insertMessage(m: InsertMessage): Promise<Message> {
  const sql = getSql();
  const created_at = new Date().toISOString();
  const prevRows = await sql<{ hash: string }[]>`
    SELECT hash FROM messages WHERE ticket_id = ${m.ticket_id} ORDER BY id DESC LIMIT 1
  `;
  const prev_hash = prevRows[0]?.hash ?? null;
  const payload = {
    ticket_id: m.ticket_id,
    role: m.role,
    content: m.content,
    citations: m.citations ?? null,
    attachments: m.attachments ?? null,
    tool_calls: m.tool_calls ?? null,
    created_at,
  };
  const hash = chainHash(prev_hash, payload);
  const inserted = await sql<{ id: number }[]>`
    INSERT INTO messages (ticket_id, role, content, citations, attachments, tool_calls, created_at, prev_hash, hash)
    VALUES (
      ${m.ticket_id},
      ${m.role},
      ${m.content},
      ${m.citations ? sql.json(m.citations as any) : null},
      ${m.attachments ? sql.json(m.attachments as any) : null},
      ${m.tool_calls ? sql.json(m.tool_calls as any) : null},
      ${created_at},
      ${prev_hash},
      ${hash}
    )
    RETURNING id
  `;
  return {
    id: inserted[0].id,
    ticket_id: m.ticket_id,
    role: m.role,
    content: m.content,
    citations: m.citations ?? null,
    attachments: m.attachments ?? null,
    tool_calls: m.tool_calls ?? null,
    created_at,
    prev_hash,
    hash,
  };
}

export async function listMessages(ticket_id: number): Promise<Message[]> {
  const sql = getSql();
  const rows = await sql<any[]>`
    SELECT id, ticket_id, role, content, citations, attachments, tool_calls, created_at, prev_hash, hash
    FROM messages WHERE ticket_id = ${ticket_id} ORDER BY id ASC
  `;
  return rows.map((r) => ({
    id: r.id,
    ticket_id: r.ticket_id,
    role: r.role,
    content: r.content,
    citations: r.citations ?? null,
    attachments: r.attachments ?? null,
    tool_calls: r.tool_calls ?? null,
    created_at: r.created_at,
    prev_hash: r.prev_hash,
    hash: r.hash,
  }));
}
