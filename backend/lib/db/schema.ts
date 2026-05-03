import { pgTable, serial, integer, text, jsonb, vector, uniqueIndex, index } from "drizzle-orm/pg-core";

export const assets = pgTable("assets", {
  id: serial("id").primaryKey(),
  reporting_mark: text("reporting_mark").notNull(),
  road_number: text("road_number").notNull(),
  unit_model: text("unit_model").notNull(),
  in_service_date: text("in_service_date"),
  last_inspection_at: text("last_inspection_at"),
});

export const tickets = pgTable("tickets", {
  id: serial("id").primaryKey(),
  asset_id: integer("asset_id").references(() => assets.id),
  status: text("status").notNull(),
  opened_by_role: text("opened_by_role").notNull(),
  opened_at: text("opened_at").notNull(),
  initial_error_codes: text("initial_error_codes"),
  initial_symptoms: text("initial_symptoms"),
  fault_dump_raw: text("fault_dump_raw"),
  fault_dump_parsed: text("fault_dump_parsed"),
  pre_arrival_summary: text("pre_arrival_summary"),
  closed_at: text("closed_at"),
});

export const messages = pgTable(
  "messages",
  {
    id: serial("id").primaryKey(),
    ticket_id: integer("ticket_id").references(() => tickets.id),
    role: text("role").notNull(),
    content: text("content").notNull(),
    citations: jsonb("citations"),
    attachments: jsonb("attachments"),
    tool_calls: jsonb("tool_calls"),
    created_at: text("created_at").notNull(),
    prev_hash: text("prev_hash"),
    hash: text("hash").notNull(),
  },
  (t) => ({
    idx_ticket: index("idx_messages_ticket").on(t.ticket_id, t.id),
  })
);

export const parts = pgTable("parts", {
  id: serial("id").primaryKey(),
  part_number: text("part_number").notNull().unique(),
  name: text("name").notNull(),
  description: text("description"),
  compatible_units: jsonb("compatible_units").notNull(),
  bin_location: text("bin_location").notNull(),
  qty_on_hand: integer("qty_on_hand").notNull(),
  supplier: text("supplier"),
  lead_time_days: integer("lead_time_days"),
  alternate_part_numbers: jsonb("alternate_part_numbers"),
  last_used_at: text("last_used_at"),
});

export const ticket_parts = pgTable("ticket_parts", {
  id: serial("id").primaryKey(),
  ticket_id: integer("ticket_id").references(() => tickets.id),
  part_id: integer("part_id").references(() => parts.id),
  qty: integer("qty").notNull(),
  added_via: text("added_via").notNull(),
  added_at: text("added_at").notNull(),
});

export const forms = pgTable(
  "forms",
  {
    id: serial("id").primaryKey(),
    ticket_id: integer("ticket_id").references(() => tickets.id),
    form_type: text("form_type").notNull(),
    payload: jsonb("payload").notNull(),
    status: text("status").notNull(),
    pdf_path: text("pdf_path"),
    updated_at: text("updated_at").notNull(),
  },
  (t) => ({
    uniq_ticket_form: uniqueIndex("forms_ticket_form_unique").on(t.ticket_id, t.form_type),
  })
);

export const corpus_chunks = pgTable("corpus_chunks", {
  id: serial("id").primaryKey(),
  doc_class: text("doc_class").notNull(),
  doc_id: text("doc_id").notNull(),
  doc_title: text("doc_title").notNull(),
  source_label: text("source_label").notNull(),
  page: integer("page"),
  text: text("text").notNull(),
  embedding: vector("embedding", { dimensions: 1024 }),
});

export const tribal_capture = pgTable("tribal_capture", {
  id: serial("id").primaryKey(),
  ticket_id: integer("ticket_id").references(() => tickets.id),
  author: text("author"),
  text: text("text").notNull(),
  captured_at: text("captured_at").notNull(),
  promoted_chunk_id: integer("promoted_chunk_id"),
});
