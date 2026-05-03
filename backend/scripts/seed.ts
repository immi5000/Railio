import "dotenv/config";
if (process.env.DATABASE_URL_DIRECT) process.env.DATABASE_URL = process.env.DATABASE_URL_DIRECT;
import fs from "node:fs";
import path from "node:path";
import { getSql } from "../lib/db";
import { createTicket } from "../lib/tickets-repo";

(async () => {
  const sql = getSql();
  const here = path.resolve(__dirname, "..");
  const parts = JSON.parse(fs.readFileSync(path.join(here, "seeds/parts.json"), "utf8"));
  const assets = JSON.parse(fs.readFileSync(path.join(here, "seeds/assets.json"), "utf8"));
  const demoTickets = JSON.parse(
    fs.readFileSync(path.join(here, "seeds/demo-tickets.json"), "utf8")
  );

  await sql.begin(async (tx) => {
    await tx`DELETE FROM ticket_parts`;
    await tx`DELETE FROM forms`;
    await tx`DELETE FROM messages`;
    await tx`DELETE FROM tickets`;
    await tx`DELETE FROM parts`;
    await tx`DELETE FROM assets`;
    // Reset sequences so re-seeds start at id=1.
    for (const t of ["assets", "parts", "tickets", "messages", "ticket_parts", "forms"]) {
      await tx`SELECT setval(pg_get_serial_sequence(${t}, 'id'), 1, false)`;
    }

    for (const a of assets) {
      await tx`
        INSERT INTO assets (reporting_mark, road_number, unit_model, in_service_date, last_inspection_at)
        VALUES (${a.reporting_mark}, ${a.road_number}, ${a.unit_model}, ${a.in_service_date}, ${a.last_inspection_at})
      `;
    }

    for (const p of parts) {
      await tx`
        INSERT INTO parts (part_number, name, description, compatible_units, bin_location, qty_on_hand, supplier, lead_time_days, alternate_part_numbers, last_used_at)
        VALUES (
          ${p.part_number}, ${p.name}, ${p.description},
          ${tx.json(p.compatible_units)},
          ${p.bin_location}, ${p.qty_on_hand}, ${p.supplier}, ${p.lead_time_days},
          ${tx.json(p.alternate_part_numbers ?? [])},
          ${p.last_used_at}
        )
      `;
    }
  });
  console.log(`seed: ${assets.length} assets, ${parts.length} parts.`);

  for (const t of demoTickets) {
    const found = await sql<{ id: number }[]>`
      SELECT id FROM assets WHERE reporting_mark = ${t.reporting_mark} AND road_number = ${t.road_number}
    `;
    const a = found[0];
    if (!a) {
      console.warn(`seed: skipping demo ticket "${t.label}" — asset ${t.reporting_mark} ${t.road_number} not found`);
      continue;
    }
    const created = await createTicket({
      asset_id: a.id,
      initial_symptoms: t.initial_symptoms,
      initial_error_codes: t.initial_error_codes,
      fault_dump_raw: t.fault_dump_raw,
    });
    console.log(`seed: demo ticket #${created.id} (${t.label})`);
  }

  console.log("seed: ok. Run `npm run db:seed-corpus` to embed and load the manual + tribal corpus.");
  await sql.end();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
