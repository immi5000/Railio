# Railio v0 — Backend Build Spec

> Read [MVP_v0.md](../MVP_v0.md) for the product context. This file is for the engineer building the backend. The frontend is being built in parallel against the same contract — see [MVP_v0_FRONTEND.md](../frontend/MVP_v0_FRONTEND.md).

The backend is a standalone Next.js app exposing API routes (port `:3001`) backed by a SQLite database and an Anthropic-powered chat/tool-use loop. No auth, localhost only. The frontend is a separate Next.js app on `:3000` that calls these routes via CORS.

---

## 1. What you own

- **SQLite schema** (`better-sqlite3` + Drizzle ORM) and migrations
- **Seed scripts** for assets, parts KB, manual corpus, tribal knowledge corpus, sample tickets
- **Vector search** via `sqlite-vec` over the corpus
- **All API routes** under `/api/*` (Next.js App Router)
- **AI message loop**: receives a user message + attached images, runs Claude Sonnet 4.6 with the fixed toolset, executes tool calls, persists messages with citations, streams back to the client
- **All AI tools' implementations** (`search_corpus`, `parse_fault_dump`, `request_photo`, `lookup_parts`, `append_part_to_requisition`, `update_form_field`, `set_ticket_status`)
- **Photo storage** under `./.railio-uploads/`
- **PDF generation** for the four forms via `@react-pdf/renderer` (server-side)
- **Append-only message log** with `prev_hash` chain
- **System prompt + retrieval rules** (manual-prefer, tribal-fallback, refuse-by-default)

---

## 2. What you do NOT own

- React components, pages, routing, role cookie reading on the client
- The chat textarea, mic button (Web Speech API), drag-and-drop UI, image previews
- Form rendering UI, citation pill UI, photo timeline UI
- The `/admin/parts` editor UI

The frontend will call your endpoints exactly as specified in §4. Your job is to make those endpoints behave to spec and stream where streaming is required.

---

## 3. Stack

- **Next.js 15** App Router, route handlers under `/app/api/`. Run on **port 3001** (`PORT=3001 npm run dev` or set in `package.json` `"dev": "next dev -p 3001"`).
- **CORS** enabled for `http://localhost:3000` (the frontend origin) on every API route. Use `cors` middleware or set headers in route handlers.
- **`better-sqlite3`** with **Drizzle ORM** for typed DB access
- **`sqlite-vec`** loaded as a SQLite extension on connection open
- **Anthropic SDK** (`@anthropic-ai/sdk`) — model `claude-sonnet-4-6`, multimodal (accepts images), prompt caching on the system prompt + corpus
- **`@react-pdf/renderer`** for typed PDF templates of the four forms
- Embeddings: **Voyage** (`voyage-3-large`) or **Cohere** (`embed-v3`); reranker: **Cohere rerank-3** (or skip rerank in v0 if cost is a concern)

```bash
cd backend
npm install
npm run db:migrate
npm run db:seed
npm run dev    # listens on http://localhost:3001
```

The frontend (separate Next.js app under `../frontend/`) calls these routes via fetch with the absolute base `http://localhost:3001`. The shared TypeScript contract lives in `../contract/contract.ts` (a tiny shared module both projects import from — see §4.3).

---

## 4. Shared contract (frontend reads this; do not change without coordinating)

### 4.1 SQLite schema

```sql
CREATE TABLE assets (
  id INTEGER PRIMARY KEY,
  reporting_mark TEXT NOT NULL,
  road_number TEXT NOT NULL,
  unit_model TEXT NOT NULL,            -- 'ES44AC' | 'ET44AC'
  in_service_date TEXT,
  last_inspection_at TEXT
);

CREATE TABLE tickets (
  id INTEGER PRIMARY KEY,
  asset_id INTEGER REFERENCES assets(id),
  status TEXT NOT NULL,                -- 'AWAITING_TECH' | 'IN_PROGRESS' | 'AWAITING_REVIEW' | 'CLOSED'
  opened_by_role TEXT NOT NULL,
  opened_at TEXT NOT NULL,
  initial_error_codes TEXT,
  initial_symptoms TEXT,
  fault_dump_raw TEXT,
  fault_dump_parsed TEXT,              -- JSON: {code, ts, severity, description}[]
  pre_arrival_summary TEXT,
  closed_at TEXT
);

CREATE TABLE messages (
  id INTEGER PRIMARY KEY,
  ticket_id INTEGER REFERENCES tickets(id),
  role TEXT NOT NULL,                  -- 'dispatcher' | 'tech' | 'assistant' | 'system' | 'tool'
  content TEXT NOT NULL,
  citations TEXT,                      -- JSON: {doc_class, doc_id, page, source_label, chunk_id}[]
  attachments TEXT,                    -- JSON: {kind:'image'|'pdf', path, mime}[]
  tool_calls TEXT,                     -- JSON: {name, input, output}[]  (assistant rows only)
  created_at TEXT NOT NULL,
  prev_hash TEXT,
  hash TEXT NOT NULL
);

CREATE TABLE parts (
  id INTEGER PRIMARY KEY,
  part_number TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  description TEXT,
  compatible_units TEXT NOT NULL,      -- JSON array
  bin_location TEXT NOT NULL,
  qty_on_hand INTEGER NOT NULL,
  supplier TEXT,
  lead_time_days INTEGER,
  alternate_part_numbers TEXT,         -- JSON array
  last_used_at TEXT
);

CREATE TABLE ticket_parts (
  id INTEGER PRIMARY KEY,
  ticket_id INTEGER REFERENCES tickets(id),
  part_id INTEGER REFERENCES parts(id),
  qty INTEGER NOT NULL,
  added_via TEXT NOT NULL,             -- 'ai_suggestion' | 'tech_manual'
  added_at TEXT NOT NULL
);

CREATE TABLE forms (
  id INTEGER PRIMARY KEY,
  ticket_id INTEGER REFERENCES tickets(id),
  form_type TEXT NOT NULL,             -- 'F6180_49A' | 'DEFECT_CARD' | 'DAILY_INSPECTION_229_21' | 'PARTS_REQUISITION'
  payload TEXT NOT NULL,               -- JSON, typed per form_type (see 4.3)
  status TEXT NOT NULL,                -- 'draft' | 'tech_signed' | 'exported'
  pdf_path TEXT,
  updated_at TEXT NOT NULL,
  UNIQUE(ticket_id, form_type)
);

CREATE TABLE corpus_chunks (
  id INTEGER PRIMARY KEY,
  doc_class TEXT NOT NULL,             -- 'manual' | 'tribal_knowledge'
  doc_id TEXT NOT NULL,
  doc_title TEXT NOT NULL,
  source_label TEXT NOT NULL,
  page INTEGER,
  text TEXT NOT NULL
);
CREATE VIRTUAL TABLE corpus_chunks_vec USING vec0(embedding float[1024]);

-- Captured at ticket close, curated later into corpus_chunks
CREATE TABLE tribal_capture (
  id INTEGER PRIMARY KEY,
  ticket_id INTEGER REFERENCES tickets(id),
  author TEXT,
  text TEXT NOT NULL,
  captured_at TEXT NOT NULL,
  promoted_chunk_id INTEGER             -- nullable; set when SME promotes into corpus
);
```

### 4.2 API endpoints

All return `application/json` unless noted. Errors: `{ error: string }` with appropriate HTTP status.

| Method | Path | Purpose | Body | Returns |
| --- | --- | --- | --- | --- |
| `GET` | `/api/tickets` | List, optional `?status=` filter | — | `Ticket[]` |
| `POST` | `/api/tickets` | Dispatcher creates ticket; pre-fills all four forms with known fields | `CreateTicketBody` | `Ticket` |
| `GET` | `/api/tickets/:id` | Ticket + all messages + all four forms (current state) | — | `TicketDetail` |
| `POST` | `/api/tickets/:id/messages` | **Streaming.** Tech/dispatcher sends a message + optional image refs. Server runs the AI loop, executes tool calls, persists messages, streams events. | `SendMessageBody` | **SSE stream** of `MessageEvent`s |
| `POST` | `/api/tickets/:id/photos` | Multipart upload of one or more images. Returns paths to be referenced in subsequent `messages` POSTs. | multipart | `{ attachments: Attachment[] }` |
| `POST` | `/api/tickets/:id/parse-fault-dump` | Synchronous helper called by dispatcher intake before first chat turn. Parses raw text, persists to `tickets.fault_dump_parsed`. | `{ raw: string }` | `{ parsed: ParsedFault[] }` |
| `PATCH` | `/api/tickets/:id` | Update status (e.g. `AWAITING_TECH` after dispatcher submits) | `{ status?, ... }` | `Ticket` |
| `GET` | `/api/tickets/:id/forms` | All four forms with current `payload` | — | `Form[]` |
| `PATCH` | `/api/tickets/:id/forms/:form_type` | Tech edits a form field (overrides AI). Validates against the typed schema. | `{ payload: Partial<FormPayload> }` | `Form` |
| `POST` | `/api/tickets/:id/forms/:form_type/export` | Render PDF to disk, set `status='exported'`, return path | — | `{ pdf_path: string }` |
| `GET` | `/api/parts` | Search/list. `?unit_model=&q=` | — | `Part[]` |
| `PATCH` | `/api/parts/:id` | Admin edit (used by `/admin/parts` UI) | `Partial<Part>` | `Part` |
| `GET` | `/api/corpus/chunks/:id` | Fetch a single chunk for citation click-through (text + label + page) | — | `CorpusChunk` |
| `POST` | `/api/tickets/:id/tribal-capture` | Tech's post-ticket "what would you tell a junior tech?" answer | `{ author, text }` | `{ id }` |

#### Streaming `MessageEvent` shape

The `/api/tickets/:id/messages` endpoint streams Server-Sent Events. Each `data:` line is one of:

```ts
type MessageEvent =
  | { type: "user_message_persisted"; message: Message }
  | { type: "assistant_token"; delta: string }
  | { type: "tool_call_started"; name: string; input: object; call_id: string }
  | { type: "tool_call_completed"; call_id: string; output: object }
  | { type: "request_photo"; prompt: string; reason: string }       // mirrors a tool call but the FE shows an inline upload UI
  | { type: "form_updated"; form_type: string; payload: object }    // emitted whenever update_form_field tool runs
  | { type: "assistant_message_persisted"; message: Message }
  | { type: "done" }
  | { type: "error"; error: string };
```

The frontend renders these progressively. `assistant_token` events stream the visible text; the persisted message at the end is authoritative.

### 4.3 Shared TypeScript types

Lives at `../contract/contract.ts` (sibling to `frontend/` and `backend/`). Both projects import via path alias or relative path. Backend writes here first; frontend pulls via the same module.

```ts
// === Core ===
export type UnitModel = "ES44AC" | "ET44AC";
export type TicketStatus = "AWAITING_TECH" | "IN_PROGRESS" | "AWAITING_REVIEW" | "CLOSED";
export type Role = "dispatcher" | "tech" | "assistant" | "system" | "tool";
export type FormType = "F6180_49A" | "DEFECT_CARD" | "DAILY_INSPECTION_229_21" | "PARTS_REQUISITION";
export type DocClass = "manual" | "tribal_knowledge";

// === API ===
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
  attachment_paths?: string[];   // from POST /photos
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

export type TicketDetail = Ticket & { messages: Message[]; forms: Form[]; ticket_parts: TicketPart[] };

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

export type Citation = { doc_class: DocClass; doc_id: string; page: number | null; source_label: string; chunk_id: number };
export type Attachment = { kind: "image" | "pdf"; path: string; mime: string };
export type ToolCall = { name: string; input: object; output: object };
export type ParsedFault = { code: string; ts: string | null; severity: "minor" | "major" | "critical"; description: string };

export type Asset = { id: number; reporting_mark: string; road_number: string; unit_model: UnitModel; in_service_date: string | null; last_inspection_at: string | null };

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

export type TicketPart = { id: number; part_id: number; qty: number; added_via: "ai_suggestion" | "tech_manual"; added_at: string };

export type CorpusChunk = { id: number; doc_class: DocClass; doc_id: string; doc_title: string; source_label: string; page: number | null; text: string };

export type Form =
  | { ticket_id: number; form_type: "F6180_49A"; payload: F6180_49A; status: FormStatus; pdf_path: string | null; updated_at: string }
  | { ticket_id: number; form_type: "DEFECT_CARD"; payload: DefectCard; status: FormStatus; pdf_path: string | null; updated_at: string }
  | { ticket_id: number; form_type: "DAILY_INSPECTION_229_21"; payload: DailyInspection_229_21; status: FormStatus; pdf_path: string | null; updated_at: string }
  | { ticket_id: number; form_type: "PARTS_REQUISITION"; payload: PartsRequisition; status: FormStatus; pdf_path: string | null; updated_at: string };

export type FormStatus = "draft" | "tech_signed" | "exported";

// === Form payloads ===
export type F6180_49A = {
  reporting_mark: string; road_number: string; unit_model: UnitModel;
  inspection_date: string; inspector_name: string;
  defects: { fra_part: string; description: string; location: string; severity: "minor"|"major"|"critical" }[];
  repairs: { description: string; parts_replaced?: string[]; completed_at: string }[];
  air_brake_test?: { test_type: "Class I"|"Class IA"; pass: boolean; readings: Record<string, number> };
  out_of_service: boolean;
  signature?: { name: string; signed_at: string };
};

export type DefectCard = {
  unit: { reporting_mark: string; road_number: string; unit_model: UnitModel };
  opened_by: string; opened_at: string;
  error_codes: string[]; symptoms: string;
  severity: "minor"|"major"|"critical"; bad_ordered: boolean;
  cleared_by?: string; cleared_at?: string;
};

export type DailyInspection_229_21 = {
  unit: { reporting_mark: string; road_number: string; unit_model: UnitModel };
  inspector_name: string; inspected_at: string;
  items: { code: string; label: string; result: "pass"|"fail"|"na"; note?: string; photo_path?: string }[];
  exceptions: string[];
};

export type PartsRequisition = {
  ticket_id: number; requested_by: string; requested_at: string;
  lines: { part_number: string; name: string; bin_location: string; qty: number; on_hand: number }[];
};
```

### 4.4 AI tools (server-side execution; frontend never calls these directly)

```ts
const tools = [
  // Returns top-k chunks. The model's system prompt requires it to prefer 'manual' citations and fall back to 'tribal_knowledge'.
  { name: "search_corpus",       input: { query, k, doc_class_filter: "manual"|"tribal_knowledge"|"any" } },

  // Called once on dispatcher intake. Parses raw text → ParsedFault[]; persists to tickets.fault_dump_parsed; emits a form_updated event for any form whose payload references error codes.
  { name: "parse_fault_dump",    input: { ticket_id, raw_text } },

  // Emits a `request_photo` event in the SSE stream. Does not block the response — tech can answer in their next message.
  { name: "request_photo",       input: { prompt, reason } },

  { name: "lookup_parts",        input: { unit_model, query } },
  { name: "append_part_to_requisition", input: { ticket_id, part_id, qty } },

  // Validates field_path against the form's typed schema; rejects unknown paths.
  // Emits a `form_updated` SSE event with the new full payload.
  { name: "update_form_field",   input: { ticket_id, form_type, field_path, value, source_message_id } },

  { name: "set_ticket_status",   input: { ticket_id, status } },
];
```

### 4.5 System prompt rules (non-negotiable)

1. Cite at least one `corpus_chunks` row per substantive answer. Render `source_label` exactly as stored — no paraphrasing.
2. Prefer `doc_class='manual'` citations. Cite `tribal_knowledge` when the manual is silent OR when the tribal note adds heuristic value the manual lacks.
3. Refuse-by-default outside the corpus: "I don't have this in your manuals or tribal notes."
4. **Before recommending a repair from an ambiguous physical description**, call `request_photo`. Do not paper over with a guess.
5. On every fact that maps to a form field (date/time, part used, defect description, repair completed, signature, air brake reading, etc.), call `update_form_field` immediately, with `source_message_id` set to the user message that established the fact.
6. On dispatcher intake when `fault_dump_raw` is non-null, call `parse_fault_dump` exactly once before any free-form chat reasoning.

---

## 5. Implementation order

Build in this order so the frontend always has something working to integrate against. After each step, deploy locally and verify the relevant endpoint with `curl`.

| Step | Deliverable | Verify with |
| --- | --- | --- |
| 1 | Drizzle schema + migrations + seed (assets, parts, sample tickets) | `npm run db:migrate && npm run db:seed`; sqlite3 inspection |
| 2 | `GET /api/tickets`, `GET /api/tickets/:id`, `GET /api/parts` (read-only) | curl returns seeded data |
| 3 | `POST /api/tickets` with form pre-fill (no AI yet) | New ticket has all 4 forms with `unit.*` and `*_at` populated |
| 4 | Photo upload endpoint + `./.railio-uploads/` storage | Multipart upload returns paths; file exists on disk |
| 5 | Corpus ingest script: chunk + embed + insert into `corpus_chunks` and `corpus_chunks_vec`. Both doc classes. | Vector search query returns expected manual + tribal hits |
| 6 | `search_corpus` tool implementation + `GET /api/corpus/chunks/:id` | Manual call returns ranked chunks with `source_label` |
| 7 | `lookup_parts` + `append_part_to_requisition` + `update_form_field` tool implementations (no AI yet — direct invocation tests) | Forms table updates correctly; `field_path` validation rejects bad paths |
| 8 | `parse_fault_dump` synchronous endpoint + tool wrapper | Pasting a sample dump returns structured codes |
| 9 | Anthropic client wired up; non-streaming chat for one round-trip with the tool list | A test message yields a cited response and triggers `update_form_field` |
| 10 | SSE streaming on `/api/tickets/:id/messages` with the full event shape from §4.2 | curl `--no-buffer` shows tokens and tool events flowing |
| 11 | `request_photo` event emission + `set_ticket_status` | Sending a vague tech message triggers a `request_photo` SSE event |
| 12 | PDF rendering for all 4 forms via `@react-pdf/renderer` | `POST .../forms/:type/export` writes a valid PDF to disk |
| 13 | Append-only `messages` log with `prev_hash` chain | `verify` script walks the chain and matches |
| 14 | `tribal_capture` endpoint | Tech-submitted note persists with `promoted_chunk_id=NULL` |

---

## 6. Definition of done

- Every endpoint in §4.2 returns the documented shape.
- A scripted end-to-end run (no UI) drives the full happy-path: dispatcher creates ticket → fault dump parsed → message exchange with cited responses → `request_photo` triggered on a vague message → photo uploaded and referenced in the next message → parts looked up and added to requisition → forms auto-updated → all 4 PDFs exported → message log hash chain verifies.
- README has a `npm run e2e` that runs that scripted flow.
- Tools log every call's `input`/`output` to a `tool_calls` JSON column on the assistant message — this is the audit trail the SME and frontend both rely on.
- Manual + tribal corpus retrieval works end-to-end; sample queries in `__tests__/retrieval.test.ts` cover: (a) manual-prefer when both available, (b) tribal-fallback when manual silent, (c) refusal when neither has a hit.
