# Railio

The AI co-pilot for rail maintenance. Voice-first. Manual-grounded. FRA-aware.

Railio sits between a **dispatcher** (who opens the ticket from the office or radio) and a **field tech** (who walks up to the locomotive with a phone). It runs the diagnostic conversation, cites real federal rail regulations, requests photos when an answer is ambiguous, and auto-fills the two FRA forms that legally have to leave the shop with the unit.

This repo is the v0 localhost MVP — a working end-to-end demo on `http://localhost:3000`.

---

## What the MVP currently does

1. **Dispatcher opens a ticket** against a locomotive (reporting mark + road number, e.g. *CSX 3221, ES44AC*) with whatever they have: error codes, symptoms, raw fault dump pasted from the unit's display.
2. **Railio parses the fault dump** (one tool call, on intake), persists structured faults on the ticket, and writes a pre-arrival summary the tech can read before walking up.
3. **Tech joins the same thread** on a phone, sees the briefing + the asset/fault context, and starts working through the problem in plain language ("there's oil under the #3 traction motor, what should I check?").
4. **Railio answers from a real corpus**: 49 CFR Parts 229, 232, 218 (locomotive safety, brakes, operating practices) plus a small set of hand-written senior-tech notes. Every substantive reply cites a chunk by its real `source_label` (e.g. *49 CFR §229.21(a)(1)*). If the corpus is silent, it refuses rather than guessing.
5. **Forms auto-fill from the conversation.** As the tech says things like "speed indicator failed at 45 mph" or "replaced traction motor blower with TM-BLW-44AC ×1", Railio calls `update_form_field` and `record_part_used` to write into the two real federal forms attached to the ticket.
6. **Photo loop.** When the tech describes something physical that's ambiguous (a leak, a sheen, a gauge reading), Railio calls `request_photo` instead of guessing — the tech snaps it, it goes back into the same vision turn.
7. **Status transitions** through `AWAITING_TECH → IN_PROGRESS → AWAITING_REVIEW` happen automatically as the conversation progresses.
8. **Export.** When the tech is done, the two forms can be rendered to PDF (FRA-styled) and the ticket is ready for review.

The whole conversation is an append-only log with a sha256 hash chain, so the audit trail is verifiable (`npm run verify-chain`).

---

## The two forms

Railio intentionally wraps only the two documents that are tedious to fill out by hand and are federally required to travel with the unit:

| Form | Authority | What's in it |
|---|---|---|
| **F6180.49A** | FRA Form F 6180.49A | Locomotive Inspection and Repair Record. Sections A–H: identification, inspection details, items checklist, defects, repairs (with parts replaced), air-brake test, out-of-service status, signature. |
| **DAILY_INSPECTION_229_21** | 49 CFR §229.21 | Daily Locomotive Inspection. Pre-populated with **26 real CFR-referenced items** (cab safety, sanders, horn, brakes, leaks, event recorder, etc.). Each item gets `pass` / `fail` / `na` + optional note + optional photo. Failures auto-append to `exceptions`. |

Both can be edited directly in the UI by the tech or dispatcher and exported as a PDF that mirrors the real federal layout.

---

## The knowledge base

The "manual" half of the corpus is **real, public-domain federal rail regulation**, fetched on build from the eCFR API:

- **49 CFR Part 229** — Railroad Locomotive Safety Standards
- **49 CFR Part 232** — Brake System Safety Standards
- **49 CFR Part 218** — Railroad Operating Practices

The fetch script (`backend/scripts/corpus-fetch.ts`) downloads the XML; the build script (`backend/scripts/corpus-build.ts`) walks the `<DIV8>` section nodes, sub-splits anything over ~6000 chars at paragraph boundaries, embeds with OpenAI `text-embedding-3-large` truncated to 1024 dims, and stores everything in a `sqlite-vec` virtual table for KNN.

The "tribal" half is a small file of hand-written senior-tech notes in [backend/seeds/corpus-tribal.json](backend/seeds/corpus-tribal.json) — heuristics, war stories, "always check X before Y on this unit." In production these would come from SME recording sessions; for the demo they're written by hand and clearly labelled (`👤 Senior-tech note`).

The system prompt enforces: **prefer manual over tribal; cite both when relevant; refuse if the corpus is silent.**

The retrieval tool (`search_corpus`) returns top-K chunks with their `doc_class`, `doc_id`, `page`, and `source_label`. The runtime persists the citation list on the assistant message so the UI can render clickable citation chips that open the underlying chunk text.

Total corpus after build: ~270 chunks (≈260 manual, 6 tribal).

---

## Workflow

### Dispatcher

1. Open the **Dispatcher** page, pick an asset, optionally paste a fault dump or symptoms, create the ticket.
2. Railio parses the dump and writes a pre-arrival summary in the chat.
3. Hand the ticket off — the tech opens the same ticket on their phone.

### Tech

1. Open the **Tech** page, see the ticket card (status, asset, error codes, parsed faults, briefing).
2. Click a suggested prompt or type freely. Ask Railio anything that maps to the regs or the senior-tech notes.
3. State facts as you find them ("speed indicator OK", "brake pipe leak at 4 psi/min", "replaced filter element"). Railio writes them into the two forms in the background.
4. When asked, snap photos directly into the chat for the vision turn.
5. When the repair is done, say so — Railio flips the ticket to `AWAITING_REVIEW` and the forms are ready to export as PDFs.

### Both roles share one thread

There is no separate dispatcher/tech log. The conversation is single, append-only, and replayable; either role can rejoin it later. A demo-only `resetTicket` wipes the ticket back to AWAITING_TECH so the same scenario can be re-run.

---

## Repo layout

```
.
├── README.md              this file
├── MVP.md                 v1 product spec (mobile, voice, multi-tenant)
├── MVP_v0.md              v0 validation spec (localhost web build)
│
├── contract/              shared TypeScript types + API surface
│   └── contract.ts        single source of truth for both apps
│
├── backend/               Next.js app on :3001 — API, SQLite, AI tools, PDFs
│   ├── RUN.md             how to install, seed, and start the backend
│   ├── app/api/           tickets, messages (SSE), forms, photos, parts, corpus
│   ├── lib/               chat loop, tools, embeddings, forms (pre-fill + PDF)
│   ├── scripts/           db:migrate, db:seed, corpus:fetch, db:seed-corpus, e2e
│   ├── seeds/             assets.json, parts.json, demo-tickets.json, corpus-tribal.json
│   └── corpus-sources/    sources.json manifest + (gitignored) raw/ XML payloads
│
├── frontend/              Next.js app on :3000 — pages, chat UI, mic, forms
│   └── app/               dispatcher, tech, admin, app pages
│
└── landing_page/          static marketing site (separate, unrelated to v0/v1)
```

---

## Stack

- **Next.js 15** App Router, two apps (backend on `:3001`, frontend on `:3000`) talking over CORS
- **SQLite** via `better-sqlite3` + `sqlite-vec` for KNN over chunk embeddings
- **OpenAI** Chat Completions (streaming with tool-call accumulation by index, vision via base64 image parts) + `text-embedding-3-large` truncated to 1024 dims
- **Drizzle ORM** for typed schema
- **@react-pdf/renderer** for the FRA-styled form PDFs
- **SSE** for streaming chat tokens, tool events, and form updates back to the UI
- **fast-xml-parser** + **pdf-parse** for corpus ingest

---

## Running it

See [backend/RUN.md](backend/RUN.md) for the full sequence. Short version:

```bash
# backend
cd backend
npm install
npm run db:migrate && npm run db:seed
npm run corpus:fetch && npm run db:seed-corpus
npm run dev               # :3001

# frontend (separate terminal)
cd frontend
npm install
npm run dev               # :3000
```

Open `http://localhost:3000`. The seed loads 5 assets, 30 parts, and 3 demo tickets ready to walk through.

---

## What's deliberately out of scope for v0

- No auth, no multi-tenant, no mobile-native client (the v1 spec in [MVP.md](MVP.md) covers all of these).
- Only two forms (the federally-required ones). Defect cards and parts requisitions were intentionally cut after the spec review — `ticket_parts` covers the parts-tracking need without inventing a non-federal document.
- Tribal corpus is hand-written; production would record real SMEs.
- No background jobs, no remote storage; everything is local files + SQLite.
