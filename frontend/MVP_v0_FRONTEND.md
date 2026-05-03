# Railio v0 — Frontend Build Spec

> Read [MVP_v0.md](../MVP_v0.md) for the product context. This file is for the engineer building the frontend. The backend is being built in parallel against the same contract — see [MVP_v0_BACKEND.md](../backend/MVP_v0_BACKEND.md).

The frontend is a Next.js 15 App Router UI. No mobile, no auth, no service workers. A role cookie picks between two top-level views; the rest is chat, forms, and a small admin tool.

---

## 1. What you own

- All pages and React components under `/app/*` (excluding `/app/api/*`)
- The role cookie flow (`/` picker → `role=dispatcher|tech` cookie → routes)
- **Chat UI**: streaming token rendering, tool-event rendering, citations, photo timeline, drag/paste/upload of images, **mic input via Web Speech API**, inline `request_photo` upload prompt
- **Dispatcher intake**: structured form + paste-fault-dump textarea + chat panel
- **Tech ticket view**: two-pane layout (chat left, repair-context right)
- **Forms tab**: four tabs, editable form renderers, "Export PDF" button
- **`/admin/parts`** editor table
- All client-side state (TanStack Query for server cache; local state for chat composer)
- All visual styling (Tailwind; Shadcn UI is fine)
- Optimistic UI for message send (show user bubble immediately, then stream the assistant response)

You consume the backend API exactly as documented in §4. Do not invent endpoints; if you need something missing, add it to the contract by coordinating with the backend chat.

---

## 2. What you do NOT own

- Database, migrations, seeds
- AI calls, tool execution, system prompt
- Corpus ingest, retrieval, citation source-of-truth
- PDF generation (you trigger it, you don't render it)
- The append-only message log + hash chain
- Photo storage on disk

If the UI ever needs to compute something the backend already computes (a form field, a citation label, a parsed fault), call the backend instead of duplicating the logic.

---

## 3. Stack

- **Next.js 15** App Router. UI-only — no `/app/api/` routes here. Run on **port 3000** (the default).
- All API calls go to `http://localhost:3001` (the backend, separate Next.js app under `../backend/`). Set this as `NEXT_PUBLIC_API_BASE` in `.env.local` and never hardcode it.
- **TanStack Query** for fetching tickets, parts, etc.
- **Server-Sent Events** consumed via `@microsoft/fetch-event-source` (the native `EventSource` doesn't support POST, and `/api/tickets/:id/messages` is a POST that returns a stream).
- **Web Speech API** (`window.SpeechRecognition` / `webkitSpeechRecognition`) for mic dictation. No external service.
- **Tailwind** + **Shadcn UI** for components.
- **react-dropzone** (or native drag/drop) for image upload.
- **PDF preview**: open the `pdf_path` returned by the backend in a new tab. The backend serves `/uploads/*` and the rendered PDFs from its origin; you'll need to handle absolute URLs.

```bash
cd frontend
npm install
npm run dev    # listens on http://localhost:3000
```

The shared TypeScript contract lives at `../contract/contract.ts` and is imported by both apps. Don't redefine types — pull them.

---

## 4. Shared contract (backend writes; do not change without coordinating)

> This section is **identical** in [MVP_v0_BACKEND.md §4](../backend/MVP_v0_BACKEND.md). If you find yourself wanting to change a type or endpoint, post in the shared chat and update both files.

### 4.1 API endpoints (what you call)

| Method | Path | Purpose | Body | Returns |
| --- | --- | --- | --- | --- |
| `GET` | `/api/tickets` | List, optional `?status=` filter | — | `Ticket[]` |
| `POST` | `/api/tickets` | Dispatcher creates ticket; pre-fills all 4 forms | `CreateTicketBody` | `Ticket` |
| `GET` | `/api/tickets/:id` | Ticket + messages + forms | — | `TicketDetail` |
| `POST` | `/api/tickets/:id/messages` | **Streaming SSE.** Send a message + image refs; consume `MessageEvent`s | `SendMessageBody` | SSE stream |
| `POST` | `/api/tickets/:id/photos` | Multipart upload; returns paths for next `messages` POST | multipart | `{ attachments: Attachment[] }` |
| `POST` | `/api/tickets/:id/parse-fault-dump` | Sync; called once during intake before first chat turn | `{ raw: string }` | `{ parsed: ParsedFault[] }` |
| `PATCH` | `/api/tickets/:id` | Update status (e.g. dispatcher→tech handoff) | `{ status?, ... }` | `Ticket` |
| `GET` | `/api/tickets/:id/forms` | All four forms | — | `Form[]` |
| `PATCH` | `/api/tickets/:id/forms/:form_type` | Tech edits a field directly | `{ payload: Partial<FormPayload> }` | `Form` |
| `POST` | `/api/tickets/:id/forms/:form_type/export` | Render PDF, return path | — | `{ pdf_path: string }` |
| `GET` | `/api/parts` | `?unit_model=&q=` | — | `Part[]` |
| `PATCH` | `/api/parts/:id` | Admin edit | `Partial<Part>` | `Part` |
| `GET` | `/api/corpus/chunks/:id` | Citation click-through (text + label + page) | — | `CorpusChunk` |
| `POST` | `/api/tickets/:id/tribal-capture` | Post-ticket "what would you tell a junior tech?" | `{ author, text }` | `{ id }` |

### 4.2 Streaming `MessageEvent` shape (SSE on `/api/tickets/:id/messages`)

```ts
type MessageEvent =
  | { type: "user_message_persisted"; message: Message }
  | { type: "assistant_token"; delta: string }
  | { type: "tool_call_started"; name: string; input: object; call_id: string }
  | { type: "tool_call_completed"; call_id: string; output: object }
  | { type: "request_photo"; prompt: string; reason: string }
  | { type: "form_updated"; form_type: string; payload: object }
  | { type: "assistant_message_persisted"; message: Message }
  | { type: "done" }
  | { type: "error"; error: string };
```

Render rules:
- `assistant_token.delta` → append to the live assistant bubble.
- `tool_call_started` for `lookup_parts` / `search_corpus` → small inline status pill ("Looking up parts...", "Checking the manual...").
- `tool_call_started` for `update_form_field` → discreet toast "Form updated" + invalidate forms cache.
- `request_photo` → render an inline upload UI inside the assistant bubble: a one-tap button that opens the file picker, with `prompt` shown as the question.
- `form_updated` → invalidate the forms cache for this ticket so the `/forms` tab is fresh when opened.
- `assistant_message_persisted` → replace the live bubble with the persisted message (citations + tool_calls + hash become available).
- `done` → close the EventSource, re-enable the composer.
- `error` → show a banner; keep the user's draft.

### 4.3 Shared TypeScript types

Identical to backend. Pull from `../contract/contract.ts` (sibling folder to `frontend/` and `backend/`). Backend writes here first; you import from here. Do not redefine.

```ts
export type UnitModel = "ES44AC" | "ET44AC";
export type TicketStatus = "AWAITING_TECH" | "IN_PROGRESS" | "AWAITING_REVIEW" | "CLOSED";
export type Role = "dispatcher" | "tech" | "assistant" | "system" | "tool";
export type FormType = "F6180_49A" | "DEFECT_CARD" | "DAILY_INSPECTION_229_21" | "PARTS_REQUISITION";
export type DocClass = "manual" | "tribal_knowledge";

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

// (See backend spec §4.3 for Asset, Part, Form, F6180_49A, DefectCard, DailyInspection_229_21, PartsRequisition.)
```

---

## 5. Pages and components

### 5.1 Routes

| Route | Component | Notes |
| --- | --- | --- |
| `/` | `<RolePicker />` | Two big cards. Click sets `role=dispatcher` or `role=tech` cookie, redirects. |
| `/dispatcher` | `<DispatcherQueue />` | List from `GET /api/tickets`. "New ticket" button → `/dispatcher/new`. |
| `/dispatcher/new` | `<DispatcherIntake />` | See §5.3. |
| `/tech` | `<TechQueue />` | List filtered to `AWAITING_TECH` + `IN_PROGRESS`. |
| `/tech/ticket/:id` | `<TechTicketView />` | Two-pane: `<ChatPane />` left, `<RepairContext />` right. |
| `/tech/ticket/:id/forms` | `<FormsTab />` | Four sub-tabs, one per form_type. |
| `/admin/parts` | `<PartsAdmin />` | Editable table; `PATCH /api/parts/:id` on edit. |

### 5.2 `<ChatPane />` (the main shared component)

Used by both dispatcher intake and tech ticket view.

**Layout:** message list scrolling up; composer pinned bottom; image previews in composer above the textarea.

**Composer:**
- Multiline textarea
- **Mic button** — press-and-hold to start dictation; `SpeechRecognition.continuous=false`, `interimResults=true`. Interim text shown grayed in the textarea; final text replaces it on release. Send is still manual (Cmd/Ctrl+Enter or button).
- **Image input**: drag onto the pane, paste from clipboard, or `<input type="file" multiple accept="image/*">`. Each image: upload via `POST /api/tickets/:id/photos`, append the returned `path` to a local `pendingAttachments[]`, render thumbnail with × to remove.
- On send: `POST /api/tickets/:id/messages` with `{ role, content, attachment_paths: pendingAttachments.map(a=>a.path) }`. Open SSE stream; render per §4.2.

**Message rendering:**
- User bubble: text + thumbnails of images (click → lightbox).
- Assistant bubble: streamed text, then citation pills inline at end. Each pill shows `source_label`. Click → fetch `GET /api/corpus/chunks/:id` and open a side drawer with the full chunk text + page number. **Visually distinguish** `doc_class='manual'` (book icon, neutral color) from `doc_class='tribal_knowledge'` (person icon, accent color).
- Tool call rendering: collapse by default; show pill like "🔧 looked up parts (3 results)" → expand to show `input`/`output` JSON for SME debugging.
- Inline `request_photo` block inside an assistant bubble: prompt text + camera icon + "Send photo" button. Clicking opens file picker; on select, upload + auto-send next message with the image attached.

**Empty/loading states:** skeleton pulse while ticket loads; "Press the mic to talk, or type" hint in the empty composer.

### 5.3 `<DispatcherIntake />` (the most custom screen)

Two columns:

- **Left — structured intake form**:
  - Asset selector (`<Combobox />` populated from `GET /api/parts` ... wait no, from `GET /api/tickets/assets` if needed; or pre-seeded list of demo units).
  - Free-text symptoms.
  - **Paste fault dump** textarea (large, monospace). On blur or "Parse" button click, `POST /api/tickets/:id/parse-fault-dump` and render the structured `ParsedFault[]` underneath as chips.
  - Photo upload (same component as in chat).
  - Submit button → `POST /api/tickets`. On success, ticket goes to `AWAITING_TECH` and the screen flips to the chat view (right column) preloaded with the ticket context.

- **Right — chat panel**: the same `<ChatPane />`, but talking *about* the ticket the dispatcher just created. Used for the AI to produce the pre-arrival summary and to tell the dispatcher what the tech should bring.

The intake form fields and the chat both write into the same ticket. The form is the structured front door; the chat is the conversational wrap-up.

### 5.4 `<TechTicketView />`

- **Left pane** — `<ChatPane />` for `ticket_id`. Pre-loaded with all dispatcher and AI messages so the tech sees full context.
- **Right pane — `<RepairContext />`**:
  - Unit info card (reporting mark, road number, model, in-service date).
  - Parsed fault codes (chips, from `tickets.fault_dump_parsed`).
  - Pre-arrival summary block (`tickets.pre_arrival_summary`).
  - **Suggested parts** list (from `ticket_parts`, joined to `parts`). Each row: part #, name, bin, qty on hand, "Open requisition" link → `/tech/ticket/:id/forms?tab=PARTS_REQUISITION`.
  - **Cited chunks timeline** — every citation from any assistant message in this ticket, deduped, with the doc_class icon.
  - **Photo timeline** — every image sent in chat, scrollable strip.
- **Top right** — "Forms (3 ready / 4)" pill linking to `/tech/ticket/:id/forms`. Counter shows how many of the 4 forms have at least one auto-populated field beyond the pre-fill.

### 5.5 `<FormsTab />`

Four tabs (in this order): **Defect Card · Parts Requisition · Daily Inspection · F6180.49A**. The order matches the workflow timeline (defect first, parts mid-repair, inspection late, FRA form last).

Each tab renders the form's `payload` as **fully editable fields** (all text inputs / selects / date pickers, etc.). Save button per tab → `PATCH /api/tickets/:id/forms/:form_type`. **Live updates from SSE** (`form_updated` event) animate the changed fields with a brief highlight so the tech *sees* the AI fill them in.

Per-tab "Export PDF" button → `POST .../export` → opens returned `pdf_path` in a new tab.

A small "**Provenance**" toggle next to each field shows which message established the value (link to that message in the chat). Reads from `tool_calls[].input.source_message_id` in the message log.

### 5.6 `<RolePicker />`

Just `/`. Sets a cookie and redirects. No fancy logic.

### 5.7 `<PartsAdmin />`

Single table with inline editing. `GET /api/parts`, `PATCH /api/parts/:id` on cell blur. For SME use during pilot setup; not polished.

---

## 6. Web Speech API specifics

- Feature-detect; if unavailable, hide the mic button (don't crash).
- Chrome / Edge work natively. Safari has partial support — test before pilot.
- `SpeechRecognition.lang = 'en-US'`. `continuous = false`, `interimResults = true`, `maxAlternatives = 1`.
- Events: `onresult` → update textarea with interim transcript (italic gray) until final, then commit. `onerror` → toast "Mic unavailable, please type."
- Press-and-hold UX: `pointerdown` → `start()`; `pointerup`/`pointerleave` → `stop()`. Don't toggle on click; the press-and-hold is more accident-resistant in a shop.

---

## 7. Implementation order

Build top-down, integrating against backend endpoints as they come online (see backend §5 for their order). After each step, the feature should work end-to-end on `localhost:3000`.

| Step | Deliverable | Depends on backend step |
| --- | --- | --- |
| 1 | `/lib/contract.ts` shared types module | — |
| 2 | `<RolePicker />` + cookie + redirects | — |
| 3 | `<DispatcherQueue />` and `<TechQueue />` lists | BE 2 |
| 4 | `<DispatcherIntake />` form half (no chat yet, no parse) | BE 3 |
| 5 | Photo upload component (drag/paste/file picker) | BE 4 |
| 6 | Paste-fault-dump → parsed chips | BE 8 |
| 7 | `<ChatPane />` shell — render existing messages, basic composer (no streaming, no mic) | BE 9 |
| 8 | SSE consumption + token streaming + tool-call pills | BE 10 |
| 9 | Inline `request_photo` UI | BE 11 |
| 10 | Mic input via Web Speech API | — (frontend only) |
| 11 | Citation pills + click-through drawer with manual/tribal styling | BE 5–6 |
| 12 | `<TechTicketView />` two-pane with `<RepairContext />` | BE 2, 3, 7 |
| 13 | `<FormsTab />` editable + live `form_updated` highlights + provenance toggle | BE 7, 12 |
| 14 | "Export PDF" wiring | BE 12 |
| 15 | `<PartsAdmin />` editable table | — |
| 16 | Tribal-capture prompt on ticket close | BE 14 |

---

## 8. Definition of done

- Every page in §5.1 renders against a seeded backend with real data.
- A user can drive the full flow with no console errors:
  1. `/` → pick Dispatcher
  2. `/dispatcher/new` → fill intake, paste fault dump (parsed chips appear), chat with AI in the right panel, submit
  3. `/` → pick Tech
  4. `/tech` → click the new ticket
  5. Read pre-arrival summary in right pane; chat with AI on left pane, dictate via mic, drop photos, see `request_photo` prompts when AI asks for them
  6. Open `/tech/ticket/:id/forms` → see all 4 forms pre-populated, edit a field, see provenance link work, export each as PDF
  7. Close the ticket → tribal-capture prompt appears
- All long-running operations (SSE message stream, photo upload, PDF export) show progress feedback; nothing silently hangs.
- Visual distinction between manual citations and tribal-knowledge citations is obvious to a non-technical user without explanation.
- Mic input works in Chrome; gracefully hidden in browsers without the API.
- `npm run build` succeeds with no type errors against `/lib/contract.ts`.
