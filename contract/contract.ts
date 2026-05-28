// Shared types between frontend and backend.
// Backend writes here first; frontend imports from here.
// See ../backend/MVP_v0_BACKEND.md and ../frontend/MVP_v0_FRONTEND.md §4.

// === Core enums ===
export type UnitModel = "ES44DC";
export type TicketStatus =
  | "AWAITING_TECH"
  | "IN_PROGRESS"
  | "AWAITING_REVIEW"
  | "CLOSED";
export type Role = "dispatcher" | "tech" | "assistant" | "system" | "tool";
export type DocClass = "manual" | "tribal_knowledge";
export type Severity = "minor" | "major" | "critical";

// === API request bodies ===
export type CreateTicketBody = {
  asset_id: number;
  initial_symptoms?: string;
  initial_error_codes?: string;
  fault_dump_raw?: string;
  severity?: Severity;
  opened_by_role: "dispatcher";
};

export type SendMessageBody = {
  role: "dispatcher" | "tech";
  content: string;
  attachment_paths?: string[];
};

/**
 * DELETE /api/tickets/:id — permanently delete a ticket and all dependents
 * (messages, ticket_parts, forms). Dispatcher-side action.
 */
export type DeleteTicketResponse = { deleted: true };

/**
 * GET /api/corpus/chunks — browsable knowledge library.
 * Lists every chunk the AI can cite (manual + tribal_knowledge), optionally
 * filtered by `doc_class` and free-text `q`. Used by the /knowledge page so
 * users can see what the LLM is grounding its answers in.
 *
 * Frontend-only contract for now; backend implementation is a TODO.
 */
export type ListCorpusChunksQuery = {
  doc_class?: DocClass;
  q?: string;
  limit?: number;
};
export type ListCorpusChunksResponse = { chunks: CorpusChunk[] };

// === Domain ===
export type Asset = {
  id: number;
  reporting_mark: string;
  road_number: string;
  unit_model: UnitModel;
  in_service_date: string | null;
  last_inspection_at: string | null;
};

export type Citation = {
  doc_class: DocClass;
  doc_id: string;
  page: number | null;
  source_label: string;
  chunk_id: number;
};

export type Attachment = {
  kind: "image" | "pdf";
  path: string;
  mime: string;
};

export type ToolCall = {
  name: string;
  input: Record<string, unknown>;
  output: Record<string, unknown>;
  call_id?: string;
};

export type ParsedFault = {
  code: string;
  ts: string | null;
  severity: Severity;
  description: string;
};

export type Message = {
  id: number;
  ticket_id: number;
  role: Role;
  content: string;
  citations: Citation[] | null;
  attachments: Attachment[] | null;
  tool_calls: ToolCall[] | null;
  created_at: string;
  prev_hash: string | null;
  hash: string;
};

export type Ticket = {
  id: number;
  asset: Asset;
  status: TicketStatus;
  severity: Severity;
  opened_at: string;
  initial_error_codes: string | null;
  initial_symptoms: string | null;
  fault_dump_raw: string | null;
  fault_dump_parsed: ParsedFault[] | null;
  pre_arrival_summary: string | null;
  closed_at: string | null;
};

export type TicketDetail = Ticket & {
  messages: Message[];
  ticket_parts: TicketPart[];
};

export type Part = {
  id: number;
  part_number: string;
  name: string;
  description: string | null;
  compatible_units: UnitModel[];
  bin_location: string;
  qty_on_hand: number;
  supplier: string | null;
  lead_time_days: number | null;
  alternate_part_numbers: string[];
  last_used_at: string | null;
};

export type TicketPart = {
  id: number;
  part_id: number;
  qty: number;
  added_via: "ai_suggestion" | "tech_manual";
  added_at: string;
};

export type CorpusChunk = {
  id: number;
  doc_class: DocClass;
  doc_id: string;
  doc_title: string;
  source_label: string;
  page: number | null;
  text: string;
};

// === Streaming events on POST /api/tickets/:id/messages ===
export type StreamEvent =
  | { type: "user_message_persisted"; message: Message }
  | { type: "assistant_token"; delta: string }
  | {
      type: "tool_call_started";
      name: string;
      input: Record<string, unknown>;
      call_id: string;
    }
  | {
      type: "tool_call_completed";
      call_id: string;
      output: Record<string, unknown>;
    }
  | { type: "request_photo"; prompt: string; reason: string }
  | { type: "assistant_message_persisted"; message: Message }
  | { type: "done" }
  | { type: "error"; error: string };
