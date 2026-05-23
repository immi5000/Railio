# update_MVP — Refocus the Demo on One GE ES44AC Locomotive

## Why this rework

A walkthrough of [NeoLens.ai](https://app.neolens.ai) (a maintenance AI assistant — military-equipment focused, but the closest UX analog to what Railio is trying to be) shows how dramatically simpler the demo experience should feel:

- **One equipment per job.** You start a job by picking the equipment from a card grid; the chat then opens scoped to that equipment with a personalized greeting ("I see you're working on a URAL-4320. How can I help?").
- **Single chat per job.** No dispatcher/tech split. One thread, one role.
- **Cited responses with PDF page-deep links** (e.g. `…/ural.pdf#page=177`). Tap the citation, the manual opens at the right page.
- **Refuse-by-default works.** Off-corpus questions get `"I don't know."` with a "Send detailed feedback" button.
- **Mic input is first-class** (record button next to send).
- **Thumbs up/down per assistant message.**
- **No forms tab, no parts requisition, no two-role state machine.** Chat is the entire surface.

Railio v0 is fundamentally the same model but currently buried under:
- 5 assets across 4 railroads (BNSF / UP / CSX / NS, mixing ES44AC and ET44AC)
- Two-role flow (Dispatcher → Tech) with status transitions
- Parts requisition + parts KB lookup as a visible tool
- Two FRA forms wired into the UI (F6180.49A + Daily Inspection)
- 3 demo tickets seeded against different units

For the focused MVP demo, **strip to one locomotive**, NeoLens-style. Keep the technically impressive parts (citation discipline, refuse-by-default, tribal-knowledge layer, hash chain) — drop the multi-asset / multi-role surface area that obscures the value.

---

## The one unit

**BNSF 8754 — GE ES44AC**, in service since 2018-06-12, last inspection 2026-04-15. This is the unit the demo opens on; every chat, every history entry, every citation is in this unit's context.

No asset picker. No "All Equipment" dropdown. No second locomotive seeded.

---

## Strip / Keep / Add

### Strip
| Surface | Where it lives | Why strip |
|---|---|---|
| Multi-asset picker / asset list | [frontend/app/dispatcher/new](frontend/app/dispatcher/), seeds/assets.json | One unit. No picker needed. |
| Dispatcher role + page | [frontend/app/dispatcher/](frontend/app/dispatcher/) | NeoLens has one role; demo is the tech. |
| Two-pane "Repair Context" panel | [frontend/components/](frontend/components/) | Chat is the surface. Move minimal context into the chat header. |
| Parts requisition as a visible tool | `lookup_parts`, `append_part_to_requisition` calls in chat | Parts are a backend detail, not a demo wedge. Keep `record_part_used` as a side-effect only. |
| FRA forms tab | [frontend/app/tech/ticket/[id]/forms](frontend/app/tech/) | Defer. The forms loop is real but it competes with chat clarity in the demo. Add back after chat-first lands. |
| Status state machine UI | tickets-repo, ticket header | Demo shows one open chat; status is implicit. |
| Other unit families | seeds/parts.json (ET44AC entries), seeds/corpus-tribal.json references | ES44AC only. |

### Keep
- Citation-disciplined RAG over 49 CFR 229/232/218 ([backend/lib/tools/search-corpus.ts](backend/lib/tools/search-corpus.ts))
- Refuse-by-default ([backend/lib/system-prompt.ts](backend/lib/system-prompt.ts)) — verbatim *"I don't have this in your manuals or tribal notes."*
- `tribal_knowledge` doc class with `source_label` attribution (corpus_chunks table, [corpus-tribal.json](backend/seeds/corpus-tribal.json))
- Hash-chained append-only messages ([backend/lib/messages-repo.ts](backend/lib/messages-repo.ts), `prev_hash`/`hash`)
- `request_photo` loop ([backend/lib/tools/](backend/lib/tools/))
- Streaming chat via SSE ([backend/lib/chat-loop.ts](backend/lib/chat-loop.ts))
- Mic input (Web Speech API on chat boxes)
- Per-assistant-message thumbs up/down (add if not present)

### Add
- **Unit header card** at the top of the chat: reporting mark + road number + model + photo + last-inspection date. Personalize the assistant greeting ("Welcome — let's work on BNSF 8754. What's going on?").
- **Service History panel**, visible from the unit overview, showing the previous-work seed entries: date, symptoms, what was done, parts used, inspector name. Read-only.
- **PDF page-deep citation links** (NeoLens pattern). When a chunk has `page`, the citation chip is a link to the source PDF at that page anchor. Requires the corpus build to track a `source_pdf_url` on each chunk (or generate one from the eCFR source).
- **"Send detailed feedback" button** on assistant messages that returned `"I don't have this in your manuals…"` — captures the failed prompt + context for the tribal-curation queue.

---

## Concrete code changes

| File | Change |
|---|---|
| [backend/seeds/assets.json](backend/seeds/assets.json) | Replace with single BNSF 8754 ES44AC. (Or: seed script reads from the new MVP_test_data_GE_ES44AC bundle when `SEED_BUNDLE=MVP_test_data_GE_ES44AC` env var is set, leaving the original seeds intact.) |
| [backend/seeds/corpus-tribal.json](backend/seeds/corpus-tribal.json) | Replace with the 8 sample senior-tech notes from the new bundle (varied author names; all ES44AC-relevant). |
| [backend/seeds/parts.json](backend/seeds/parts.json) | Prune to ES44AC-only parts (most already are; drop ET44AC-exclusive entries — current seed has none, so this is a no-op). Keep the existing 30. |
| [backend/seeds/demo-tickets.json](backend/seeds/demo-tickets.json) | Remove UP 7416 and CSX 3221 demo tickets. Keep BNSF 8754 smoke ticket as the single open demo. |
| [backend/scripts/seed.ts](backend/scripts/seed.ts) | Add a `service_history` insertion step that loads from `previous-work.json` and writes to a new `service_history` table (or seeds CLOSED tickets with summaries — pick one, see "Decision" below). |
| [backend/lib/db/schema.ts](backend/lib/db/schema.ts) | Add `service_history` table (or rely on tickets with `status='CLOSED'` — see Decision). |
| [frontend/app/](frontend/app/) | Collapse dispatcher route. Tech route becomes the only page; landing redirects there. Unit is hardcoded to BNSF 8754 for the demo. |
| Tech ticket page | Replace two-pane layout with single-chat + collapsible unit header. Add Service History accordion. |
| [backend/lib/pre-arrival.ts](backend/lib/pre-arrival.ts) | Greeting becomes: *"Welcome — let's work on BNSF 8754 (GE ES44AC). What's going on?"* — no fault dump required. |
| [backend/lib/system-prompt.ts](backend/lib/system-prompt.ts) | Add: "You are scoped to BNSF 8754, a GE ES44AC. Don't entertain questions about other units." |

**Decision on Service History storage:**
- Option A — separate `service_history` table seeded from `previous-work.json`. Cleaner conceptually; no need to fake CLOSED tickets with full message logs.
- Option B — seed each previous-work entry as a CLOSED ticket with a single assistant message summarizing the outcome.
- **Recommend A.** Service history is reference material, not a thread. A separate table keeps the model honest about what was real chat vs. seeded background.

---

## The seed bundle: `MVP_test_data_GE_ES44AC`

Location: `backend/seeds/MVP_test_data_GE_ES44AC/`

Four files:
- `asset.json` — the single BNSF 8754 ES44AC
- `tribal-notes.json` — 8 senior-tech notes from 8 distinct named authors
- `previous-work.json` — 7 historical maintenance entries on this unit (last ~6 months)
- `parts.json` — ES44AC-compatible parts only (carry forward existing relevant entries)

The seed script reads this bundle when the env var is set:
```bash
SEED_BUNDLE=MVP_test_data_GE_ES44AC npm run db:seed
```
Without the env var, falls back to the legacy seeds — so the original v0 demo still runs.

### `asset.json`
```json
{
  "reporting_mark": "BNSF",
  "road_number": "8754",
  "unit_model": "ES44AC",
  "in_service_date": "2018-06-12",
  "last_inspection_at": "2026-04-15T09:00:00Z"
}
```

### `tribal-notes.json` (8 authors, all ES44AC-relevant)
Senior-tech notes from: Bob Carlson, John Mendoza, Akshay Patel, Devan Reeves, Maria Chen, Tomás Ortiz, Priya Singh, Carl Whitfield. Each entry is a short heuristic the manual doesn't capture (false-positive sensor patterns, install gotchas, diagnostic ordering, bench-test rules).

### `previous-work.json` (7 entries spanning 2025-12 → 2026-04 on BNSF 8754)
Each entry: date, symptoms, error codes, what was done, parts used, inspector name, outcome. Shows a realistic maintenance cadence: PMs, one-off defects, fault-dump-driven repairs, brake test re-checks.

### `parts.json`
Carry forward [backend/seeds/parts.json](backend/seeds/parts.json) — virtually every entry already lists ES44AC in `compatible_units`. No copy needed if the seed script falls back to the canonical parts file when the bundle's `parts.json` is absent.

---

## What success looks like (demo flow)

1. Open `localhost:3000` → lands directly on the BNSF 8754 chat page (no role picker, no asset list).
2. Header card: `BNSF 8754 · GE ES44AC · in service 2018 · last inspection Apr 15`.
3. Assistant greeting: *"Welcome — let's work on BNSF 8754. What's going on?"*
4. Tech types or dictates: *"smoke from the #3 power assembly during notch 7 climb."*
5. Assistant replies with cited steps from 49 CFR 229 + a tribal note from Bob Carlson about checking the fuel rail transducer first. Each citation chip links to the PDF page.
6. Off-corpus question → *"I don't have this in your manuals or tribal notes."* + "Send detailed feedback" button.
7. Collapsible "Service History" panel shows the 7 previous jobs on this unit; tech glances at the Mar 2026 EOA-3 false-positive entry for context.
8. Mic button on every input. Photo upload via drag/paste.

That's the whole demo. No forms tab, no role toggle, no second unit, no parts dropdown. Everything that's left is the wedge.

---

## Backend runtime: TypeScript → Python

Done as part of this rework. The backend is now **FastAPI on `:3001`** (same port, same API shape) — the TS Next.js backend has been replaced wholesale by a Python port under [backend/](backend/). Frontend ([frontend/lib/api.ts](frontend/lib/api.ts)) still calls `http://localhost:3001` and didn't need changes.

| Concern | Old (TS) | New (Python) |
|---|---|---|
| HTTP framework | Next.js App Router | FastAPI + uvicorn |
| DB driver | drizzle-orm + postgres-js | SQLAlchemy 2 async + asyncpg + pgvector |
| LLM SDK | `openai` (Node) | `openai` async (Python) |
| Streaming | Web `ReadableStream` SSE | `StreamingResponse` SSE |
| Storage | `@supabase/supabase-js` | `supabase-py` |
| PDF | `@react-pdf/renderer` | `reportlab` |
| Corpus ingest | `fast-xml-parser` | `xml.etree.ElementTree` |
| Migrations | drizzle-kit | inline `IF NOT EXISTS` DDL in `scripts/migrate.py` |
| Scripts | `tsx` | `python -m scripts.<name>` |

Hash chain (`messages.prev_hash`/`hash`) uses the same `sha256(prev || \\x00 || JSON.stringify(payload))` shape with identical key order, so the old verify script and the new `python -m scripts.verify_chain` produce identical results against the same rows. Tool schemas (`TOOL_DEFS`) and the system prompt are byte-equivalent to the TS originals.

The old TS backend is archived at [backend_ts/](backend_ts/) for reference and can be deleted once the Python port has been smoke-tested.

Run the new backend per [backend/RUN.md](backend/RUN.md).

---

## Out of scope for this rework (do later)

- Re-introducing the FRA forms loop (it works; just adds visual noise to the focused demo)
- Multi-tenant / auth (still v1)
- Mobile-native shell (still v1)
- Offline capture (still v1)
- CMMS connector (still post-v0, see [STRATEGY.md](STRATEGY.md))
