# Railio

The AI co-pilot for rail maintenance. Voice-first. Manual-grounded.

Railio replaces the radio and the paper manual with one voice-driven copilot. A **dispatcher** opens a ticket from the office; a **field tech** joins the same thread on a phone at the locomotive. Railio runs the diagnostic conversation, grounds every answer in the tech's own CFR manuals, OEM manuals, and tribal notes — citing real passages — and asks for photos when a description is ambiguous.

This repo is the v0 localhost MVP, running on `http://localhost:3000`.

---

## What it does

1. **Dispatcher opens a ticket** against a locomotive with whatever they have: error codes, symptoms, or a raw fault dump pasted from the unit's display.
2. **Railio parses the fault dump** (one tool call on intake), persists structured faults, and writes a pre-arrival briefing for the tech.
3. **Tech joins the same thread** on a phone, sees the briefing + asset/fault context, and works the problem in plain language.
4. **Railio answers from the corpus** — federal regulation (49 CFR Parts 229, 232, 218), the unit's OEM manual, and senior-tech notes. Every substantive reply cites a chunk by its exact `source_label`. If the corpus is silent, it refuses rather than guessing.
5. **Parts tracking.** As the tech consumes parts, Railio looks them up in that org's inventory and records them on the ticket.
6. **Photo loop.** When a physical detail is ambiguous (a leak, a sheen, a gauge), Railio requests a photo and reads it in the next vision turn.
7. **Status** moves `AWAITING_TECH → IN_PROGRESS → AWAITING_REVIEW` as the conversation progresses; a wrap-up files the repair record back into the unit's corpus and closes the ticket.

The conversation is an append-only log with a sha256 hash chain, so the audit trail is verifiable (`python -m scripts.verify_chain`).

---

## Multi-tenancy

Railio is multi-tenant by **organization** (railroad). Each org's assets, tickets, parts inventory, and private knowledge are isolated by `org_id` and never visible to another org. Shared federal regulation (CFR) has `org_id = NULL` and is visible to all.

Per-request org resolves through one seam — `get_current_org` ([backend/railio/org_context.py](backend/railio/org_context.py)) reading the `X-Org-Id` header. Auth isn't built yet; when it is, that header read swaps for a JWT-claim read and nothing else changes.

---

## The knowledge base

Two tiers, queried together by `search_corpus` (top-K KNN over pgvector):

- **Shared** — real, public-domain federal regulation fetched from the eCFR API: 49 CFR Part **229** (locomotive safety), **232** (brakes), **218** (operating practices). Loaded by `corpus_fetch` + `corpus_build` (`org_id = NULL`).
- **Org-private** — each company's OEM manuals and senior-tech / repair / inspection notes, loaded per tenant from `backend/org-data/<slug>/corpus/` via `load_org` (scoped to that `org_id`, optionally to a specific unit).

The system prompt enforces: **prefer manual over tribal; cite both when relevant; refuse if the corpus is silent.** Citations render the chunk's exact `source_label` and the UI makes them clickable.

---

## Repo layout

```
.
├── contract/contract.ts    shared TS types (Pydantic mirror in backend/railio/contract.py)
├── backend/                FastAPI on :3001 — API, Postgres, AI tools
│   ├── railio/             app, routers, AI tools, DB models, org_context
│   ├── scripts/            migrate · seed (clean baseline) · corpus_fetch · corpus_build (CFR)
│   │                       · load_org (per-tenant) · verify_chain · e2e
│   ├── org-data/<slug>/    per-tenant onboarding data (org.json, assets.json, parts.json, corpus/*.json)
│   └── corpus-sources/     sources.json manifest + (gitignored) raw/ CFR XML
├── frontend/               Next.js on :3000 — chat UI, mic, /work workspace
└── landing_page/           static marketing site (unrelated to v0/v1)
```

---

## Stack

- **Backend**: Python 3.11+, FastAPI + uvicorn on `:3001`
- **Frontend**: Next.js App Router on `:3000`, over CORS
- **DB**: Postgres (Supabase), SQLAlchemy 2 async + asyncpg; pgvector HNSW index for KNN
- **LLM**: OpenAI async SDK — streaming Chat Completions with tool calls, vision via base64 image parts, `text-embedding-3-large` truncated to 1024 dims
- **Storage**: Supabase Storage for photos (`railio-uploads` bucket)
- **Streaming**: Server-Sent Events for chat tokens and tool events
- **Corpus ingest**: httpx + stdlib `xml.etree.ElementTree` (eCFR XML)

---

## Running it

Needs **Python 3.11+**, **Node 20+**, and a **Postgres** DB with **pgvector** (Supabase works out of the box). Full sequence and env vars in [backend/RUN.md](backend/RUN.md).

```bash
# backend (terminal 1)
cd backend
python3 -m venv .venv && source .venv/bin/activate   # macOS: use python3 (no bare `python` by default)
pip install -e .
cp .env.example .env      # OPENAI_API_KEY, DATABASE_URL, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
python -m scripts.migrate && python -m scripts.seed            # clean baseline (no demo data)
python -m scripts.corpus_fetch && python -m scripts.corpus_build   # shared CFR
python -m scripts.load_org demo-rail                          # load a tenant (repeat per org)
uvicorn railio.main:app --reload --port 3001

# frontend (terminal 2)
cd frontend
npm install
npm run dev               # :3000
```

Open `http://localhost:3000`. Verify the audit trail with `python -m scripts.verify_chain`; run the test suite with `pytest` in `backend/` and `npm test` in `frontend/` (see [backend/tests/README.md](backend/tests/README.md)).

---
