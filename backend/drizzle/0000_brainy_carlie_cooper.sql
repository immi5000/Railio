CREATE TABLE "assets" (
	"id" serial PRIMARY KEY NOT NULL,
	"reporting_mark" text NOT NULL,
	"road_number" text NOT NULL,
	"unit_model" text NOT NULL,
	"in_service_date" text,
	"last_inspection_at" text
);
--> statement-breakpoint
CREATE TABLE "corpus_chunks" (
	"id" serial PRIMARY KEY NOT NULL,
	"doc_class" text NOT NULL,
	"doc_id" text NOT NULL,
	"doc_title" text NOT NULL,
	"source_label" text NOT NULL,
	"page" integer,
	"text" text NOT NULL,
	"embedding" vector(1024)
);
--> statement-breakpoint
CREATE TABLE "forms" (
	"id" serial PRIMARY KEY NOT NULL,
	"ticket_id" integer,
	"form_type" text NOT NULL,
	"payload" jsonb NOT NULL,
	"status" text NOT NULL,
	"pdf_path" text,
	"updated_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "messages" (
	"id" serial PRIMARY KEY NOT NULL,
	"ticket_id" integer,
	"role" text NOT NULL,
	"content" text NOT NULL,
	"citations" jsonb,
	"attachments" jsonb,
	"tool_calls" jsonb,
	"created_at" text NOT NULL,
	"prev_hash" text,
	"hash" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "parts" (
	"id" serial PRIMARY KEY NOT NULL,
	"part_number" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"compatible_units" jsonb NOT NULL,
	"bin_location" text NOT NULL,
	"qty_on_hand" integer NOT NULL,
	"supplier" text,
	"lead_time_days" integer,
	"alternate_part_numbers" jsonb,
	"last_used_at" text,
	CONSTRAINT "parts_part_number_unique" UNIQUE("part_number")
);
--> statement-breakpoint
CREATE TABLE "ticket_parts" (
	"id" serial PRIMARY KEY NOT NULL,
	"ticket_id" integer,
	"part_id" integer,
	"qty" integer NOT NULL,
	"added_via" text NOT NULL,
	"added_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tickets" (
	"id" serial PRIMARY KEY NOT NULL,
	"asset_id" integer,
	"status" text NOT NULL,
	"opened_by_role" text NOT NULL,
	"opened_at" text NOT NULL,
	"initial_error_codes" text,
	"initial_symptoms" text,
	"fault_dump_raw" text,
	"fault_dump_parsed" text,
	"pre_arrival_summary" text,
	"closed_at" text
);
--> statement-breakpoint
CREATE TABLE "tribal_capture" (
	"id" serial PRIMARY KEY NOT NULL,
	"ticket_id" integer,
	"author" text,
	"text" text NOT NULL,
	"captured_at" text NOT NULL,
	"promoted_chunk_id" integer
);
--> statement-breakpoint
ALTER TABLE "forms" ADD CONSTRAINT "forms_ticket_id_tickets_id_fk" FOREIGN KEY ("ticket_id") REFERENCES "public"."tickets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_ticket_id_tickets_id_fk" FOREIGN KEY ("ticket_id") REFERENCES "public"."tickets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ticket_parts" ADD CONSTRAINT "ticket_parts_ticket_id_tickets_id_fk" FOREIGN KEY ("ticket_id") REFERENCES "public"."tickets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ticket_parts" ADD CONSTRAINT "ticket_parts_part_id_parts_id_fk" FOREIGN KEY ("part_id") REFERENCES "public"."parts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_asset_id_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."assets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tribal_capture" ADD CONSTRAINT "tribal_capture_ticket_id_tickets_id_fk" FOREIGN KEY ("ticket_id") REFERENCES "public"."tickets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "forms_ticket_form_unique" ON "forms" USING btree ("ticket_id","form_type");--> statement-breakpoint
CREATE INDEX "idx_messages_ticket" ON "messages" USING btree ("ticket_id","id");