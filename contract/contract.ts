// Shared types between frontend and backend.
// Backend writes here first; frontend imports from here.
// See ../backend/MVP_v0_BACKEND.md and ../frontend/MVP_v0_FRONTEND.md §4.

// === Core enums ===
export type UnitModel = "ES44AC" | "ET44AC";
export type TicketStatus =
  | "AWAITING_TECH"
  | "IN_PROGRESS"
  | "AWAITING_REVIEW"
  | "CLOSED";
export type Role = "dispatcher" | "tech" | "assistant" | "system" | "tool";
export type FormType = "F6180_49A" | "DAILY_INSPECTION_229_21";
export type DocClass = "manual" | "tribal_knowledge";
export type Severity = "minor" | "major" | "critical";
export type FormStatus = "draft" | "tech_signed" | "exported";

// === API request bodies ===
export type CreateTicketBody = {
  asset_id: number;
  initial_symptoms?: string;
  initial_error_codes?: string;
  fault_dump_raw?: string;
  opened_by_role: "dispatcher";
};

export type SendMessageBody = {
  role: "dispatcher" | "tech";
  content: string;
  attachment_paths?: string[];
};

/**
 * POST /api/tickets/:id/reset — dispatcher-only demo helper.
 * Wipes all messages, resets the four forms back to their initial pre-fill,
 * clears ticket_parts, pre_arrival_summary, fault_dump_parsed, and closed_at,
 * and sets status back to AWAITING_TECH. Returns the freshened ticket.
 *
 * Frontend-only contract for now; backend implementation is a TODO.
 */
export type ResetTicketResponse = { ticket: Ticket };

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
  forms: Form[];
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

// === Form payloads ===

// FRA Form F 6180.49A — Locomotive Inspection and Repair Record.
// Federally mandated periodic inspection (92-day, annual, biennial).
// Field set mirrors the actual federal form sections: identification,
// inspection details, items checklist, defects, repairs, brake test,
// out-of-service, certification.
export type InspectionType = "92_day" | "annual" | "biennial" | "after_repair";
export type ItemResult = "pass" | "fail" | "na";

export type F6180_49A = {
  // Section A — Locomotive identification
  reporting_mark: string;
  road_number: string;
  unit_model: UnitModel;
  build_date?: string;

  // Section B — Inspection details
  inspection_type: InspectionType;
  inspection_date: string;
  previous_inspection_date?: string;
  place_inspected: string;
  inspector_name: string;
  inspector_qualification?: string;

  // Section C — Items checklist (each item maps to a CFR §229 sub-section)
  items: {
    code: string;          // e.g. "229.45" (general condition), "229.55" (suspension)
    label: string;         // human label
    result: ItemResult;
    note?: string;
  }[];

  // Section D — Defects discovered
  defects: {
    fra_part: string;      // e.g. "229.59" for leakage
    description: string;
    location: string;
    severity: Severity;
  }[];

  // Section E — Repairs performed
  repairs: {
    description: string;
    parts_replaced?: string[];
    completed_at: string;
  }[];

  // Section F — Air brake test (if performed during inspection)
  air_brake_test?: {
    test_type: "Class I" | "Class IA";
    pass: boolean;
    readings: Record<string, number>;
  };

  // Section G — Status
  out_of_service: boolean;
  out_of_service_at?: string;
  returned_to_service_at?: string;

  // Section H — Certification
  signature?: { name: string; signed_at: string };
};

// Daily Locomotive Inspection per 49 CFR §229.21.
// Required for every locomotive in use, every calendar day.
// Items list is pre-populated from §229.21 + cross-referenced sections.
export type DailyInspection_229_21 = {
  unit: { reporting_mark: string; road_number: string; unit_model: UnitModel };
  inspector_name: string;
  inspector_qualification?: string;
  inspected_at: string;
  place_inspected?: string;
  previous_daily_inspection_at?: string;

  // Each item is a regulatory inspection point. The items array is pre-filled
  // on ticket creation; the tech/AI updates `result` and optional `note`.
  items: {
    code: string;          // e.g. "cab_safety", "sanders", "horn"
    cfr_ref: string;       // e.g. "§229.45", "§229.129"
    label: string;
    result: ItemResult;
    note?: string;
    photo_path?: string;
  }[];

  // Failed items get summarized here for the bad-order tag flow.
  exceptions: string[];

  signature?: { name: string; signed_at: string };
};

export type FormPayloadByType = {
  F6180_49A: F6180_49A;
  DAILY_INSPECTION_229_21: DailyInspection_229_21;
};

export type Form =
  | {
      ticket_id: number;
      form_type: "F6180_49A";
      payload: F6180_49A;
      status: FormStatus;
      pdf_path: string | null;
      updated_at: string;
    }
  | {
      ticket_id: number;
      form_type: "DAILY_INSPECTION_229_21";
      payload: DailyInspection_229_21;
      status: FormStatus;
      pdf_path: string | null;
      updated_at: string;
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
  | {
      type: "form_updated";
      form_type: FormType;
      payload: Record<string, unknown>;
    }
  | { type: "assistant_message_persisted"; message: Message }
  | { type: "done" }
  | { type: "error"; error: string };
