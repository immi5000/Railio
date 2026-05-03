import "dotenv/config";
if (process.env.DATABASE_URL_DIRECT) process.env.DATABASE_URL = process.env.DATABASE_URL_DIRECT;
import { getSql } from "../lib/db";
import { chainHash } from "../lib/hash";

(async () => {
  const sql = getSql();
  const tickets = await sql<{ id: number }[]>`SELECT id FROM tickets ORDER BY id`;

  let ok = true;
  for (const t of tickets) {
    const rows = await sql<any[]>`
      SELECT id, ticket_id, role, content, citations, attachments, tool_calls, created_at, prev_hash, hash
      FROM messages WHERE ticket_id = ${t.id} ORDER BY id ASC
    `;
    let prev: string | null = null;
    for (const r of rows) {
      if (r.prev_hash !== prev) {
        console.error(`ticket ${t.id} msg ${r.id}: prev_hash mismatch`);
        ok = false;
      }
      const expected = chainHash(prev, {
        ticket_id: r.ticket_id,
        role: r.role,
        content: r.content,
        citations: r.citations ?? null,
        attachments: r.attachments ?? null,
        tool_calls: r.tool_calls ?? null,
        created_at: r.created_at,
      });
      if (expected !== r.hash) {
        console.error(`ticket ${t.id} msg ${r.id}: hash mismatch`);
        ok = false;
      }
      prev = r.hash;
    }
  }
  if (ok) console.log("verify-chain: ok");
  await sql.end();
  if (!ok) process.exit(2);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
