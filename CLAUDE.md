# CLAUDE.md — Railio context for new chats

You are working on **Railio**, an AI co-pilot for rail maintenance. This file gives you the durable context that doesn't change between sessions: the vision, the user, the stack, the conventions, and the things that have been deliberately decided. Read [README.md](README.md) for the user-facing summary.

---

## The vision (one sentence)

Railio replaces the radio and the manual with one voice-driven copilot that grounds every answer in the tech's own CFR manuals, OEM manual, and tribal notes — so the tech gets immediate, citation-backed guidance while standing at the locomotive.

## Who actually uses it

A **road car inspector** or **locomotive maintainer** standing next to a defective unit holding gloves and a flashlight. Today they radio the foreman and flip through a paper manual. Railio compresses that loop into a conversation: the tech speaks the symptom, Railio searches the manuals and tribal notes, cites the relevant passages, asks for photos when the description is ambiguous, and walks them through the repair.

Two roles share one ticket thread:

- **Dispatcher** — opens the ticket from the office or radio, pastes whatever they have (error codes, symptoms, raw fault dump), hands off to the tech.
- **Tech** — joins on a phone in the yard, walks through the repair conversationally, says facts out loud, snaps photos when asked.

## What we're building right now (v0)

A web MVP. Now multi-tenant with **real Supabase auth + onboarding** (see the multi-tenant convention below) — the "no auth, single locomotive family" framing this doc launched with is outdated. Tenants self-onboard; each carries its own assets/parts/OEM corpus across multiple locomotive models (e.g. GE ES44DC, EMD GP39-2, EMD SD60). The goal is still to validate that techs will actually talk to it in the yard.

**Scope: chatbot only.** v0 is the chat experience + corpus citations + parts tracking + photo capture. **No FRA document generation.** The earlier two-form generation flow (FRA F 6180.49A and 49 CFR §229.21 daily inspection) was deliberately removed to focus the product on the copilot conversation. The inspection-history corpus is still loaded so the model can *cite* past inspections, but Railio no longer *creates* new ones from the app.

## v1 (the eventual product)

Voice-first React Native + Expo mobile app, thin web admin, multi-tenant, RBAC + "qualified person" gating, real audit hash chain, offline capture + online AI, per-tenant OEM/AAR corpus ingestion. Form generation (the old FRA-document flow) is **out of scope for the current build**. Schema additions are fine, but don't re-add form generation without an explicit product decision.

---

## Stack

| Layer | Choice | Notes |
|---|---|---|
| Backend runtime | **FastAPI + uvicorn** on `:3001` | Python 3.11+. |
| Frontend runtime | **Next.js 15 App Router** on `:3000` | Talks to backend over CORS. |
| Lang | Backend in Python, frontend in TypeScript | Frontend imports shared types from [contract/contract.ts](contract/contract.ts) via `@contract/*` path alias; backend mirrors them in [backend/railio/contract.py](backend/railio/contract.py). Both must update together when types change. |
| DB | **Postgres** (Supabase) | Async via SQLAlchemy 2 + asyncpg. Schema in [backend/railio/db.py](backend/railio/db.py); migrations via `python -m scripts.migrate`. |
| Vector | **pgvector** | `corpus_chunks.embedding` is `vector(1024)` with an HNSW index; KNN via `embedding <-> CAST(:vec AS vector)`. |
| LLM | **OpenAI async SDK**, streaming | `text-embedding-3-large` truncated to **1024 dims** via the `dimensions` param (Matryoshka). |
| Streaming | Server-Sent Events from `/api/tickets/{id}/messages` | UI consumes `assistant_token`, `tool_call_started`, `tool_call_completed`, `request_photo`, `done`. |
| Corpus ingest | `xml.etree.ElementTree`, `httpx` | Manifest-driven fetch + build (`python -m scripts.corpus_fetch` then `python -m scripts.corpus_build`). |
| Frontend UI | Plain React + small Tailwind surface | One design language — the dashboard/`/work` "Figma" look (tokens `--dash-*` in `globals.css`), fully documented in [frontend/DESIGN.md](frontend/DESIGN.md). Follow it for **all** UI; extrapolate in its idiom for anything not yet drawn. Don't introduce other styles. |

## Repo layout

```
contract/contract.ts            single source of truth for types (frontend)
backend/                        FastAPI on :3001 — API, Postgres, AI tools, PDFs
  railio/
    main.py                     FastAPI app + CORS + lifespan
    config.py                   env-driven settings
    db.py                       SQLAlchemy models + async engine
    contract.py                 Pydantic mirror of contract/contract.ts
    chat_loop.py                OpenAI streaming + tool-call accumulation by index
    system_prompt.py            the rules the model has to follow
    tools/                      one tool per file (search_corpus, request_photo, …) + registry
    messages_repo.py            append-only inserts with sha256 hash chain
    tickets_repo.py             ticket / ticket_parts CRUD
    pre_arrival.py              LLM-generated pre-arrival briefing
    embeddings.py               OpenAI / Voyage / Cohere providers, 1024-dim
    storage.py                  Supabase storage helpers
    openai_client.py            singleton AsyncOpenAI
    routers/                    tickets, messages (SSE), photos, parts, corpus, uploads
  scripts/                      migrate, seed (clean baseline), corpus_fetch, corpus_build (CFR), load_org (per-tenant), verify_chain, e2e
  org-data/                     onboarding-format docs only; tenant data lives in Supabase. A <slug>/ folder here is ephemeral (drop, run load_org, delete) — not committed. See org-data/README.md.
  seeds/                        (emptied of demo data — was assets/tickets/tribal/repair/inspection; now only _snapshot backups)
  corpus-sources/sources.json   manifest of CFR parts to fetch (raw/ is gitignored)
  pyproject.toml                Python deps (FastAPI, SQLAlchemy, openai, reportlab, …)
  RUN.md                        local run guide
frontend/                       Next.js :3000 — pages, chat UI, mic
  app/dispatcher, app/tech, app/admin, app/app
  lib/api.ts                    typed HTTP client; `apiUrl()` and `fileUrl()` helpers
  components/                   ChatPane, RepairContext, PhotoUpload, etc.
landing_page/                   static marketing site, unrelated to v0/v1
```

## Knowledge base (what `search_corpus` returns)

Two doc classes, two tenancy tiers. A chunk is `manual` or `tribal_knowledge`, and is either **shared** (`org_id = NULL`, visible to all orgs) or **org-private** (`org_id` set).

- **`manual`** — shared: real federal regulation (49 CFR Parts **229**, **232**, **218**) fetched from the eCFR API and chunked at section boundaries (loaded by `corpus_build`, CFR manifest [backend/corpus-sources/sources.json](backend/corpus-sources/sources.json)). Org-private: each tenant's OEM manuals (e.g. the hand-extracted **GE ES44DC Operating Manual GEJ-6915**), loaded into Supabase via `load_org` from an org's `corpus/*.json`.
- **`tribal_knowledge`** — always org-private: a tenant's senior-tech notes, prior repair history, and daily 49 CFR §229.21 inspection history, loaded from `backend/org-data/<slug>/corpus/`. Each chunk's `source_label` names its source document so citations identify the file.

The system prompt enforces: **prefer manual over tribal; cite both when relevant; refuse if the corpus is silent.** Citations render the chunk's exact `source_label` (never paraphrase it). Shared CFR is ~261 chunks; org-private counts vary per tenant.

## Tools available to the model (in [backend/railio/tools/](backend/railio/tools/))

`search_corpus`, `lookup_parts`, `record_part_used` (writes `ticket_parts`), `request_photo`, `show_figure`, `set_ticket_status`. There is intentionally no form-mutation tool — Railio does not generate FRA documents.

**`parse_fault_dump` is not a chat tool.** It was removed: the system prompt ordered the model to call it when the ticket had a non-null `fault_dump_raw`, but `_build_ticket_context` never injects `fault_dump_raw`, so the model could not see the dump it was required to pass as `raw_text` — the rule was unsatisfiable. Parsing runs through `POST /api/tickets/{ref}/parse-fault-dump`, which `DispatcherIntake` calls with the dump explicitly. `railio/tools/parse_fault_dump.py` still exists as that route's implementation. Don't re-add it to `TOOL_DEFS` without first giving the model a way to see the dump.

`show_figure(chunk_id, figure_index)` renders a knowledge-base figure inline in the chat as a tap-to-enlarge thumbnail. The model learns which figures exist because `search_corpus` now returns lightweight per-figure metadata (`{index, figure_label, caption}`) on each chunk; it then picks one. The tool loads the figure from `corpus_chunks.figures` (org-scoped — it independently enforces the tenant boundary since the model picks `chunk_id`) and emits a `show_figure` SSE event `{type, chunk_id, figure}`. Shown figures are **not a new persisted message field**: they ride the existing `tool_calls` (already persisted + hash-chained), and the frontend reconstructs the inline thumbnails on reload by filtering `tool_calls` for `show_figure` — so the hash chain is untouched. The optional `corpus_chunks.figures` JSONB column (populated by the offline `railio-ingest` PDF pipeline) is detected once via `figures_supported()` in [backend/railio/corpus_figures.py](backend/railio/corpus_figures.py), so figure-aware queries degrade gracefully on a DB that never ingested an OEM manual. Clicking a thumbnail opens the existing `CitationDrawer`, which already renders figures full-size.

## Conventions to keep

- The conversation is **append-only** with a sha256 `prev_hash` chain. `python -m scripts.verify_chain` proves it. Don't mutate or delete messages.
- Hash payload contains `ticket_id, role, content, citations, attachments, tool_calls, created_at`. `chain_hash` serializes with `sort_keys=True` ([backend/railio/hash.py](backend/railio/hash.py)) so the hash survives a Postgres JSONB round-trip (JSONB does not preserve object key insertion order; an insertion-order hash failed to re-verify for any message with nested tool_calls/citations). The backend is the sole hash writer. Changing the hash serialization invalidates existing chains — reseed to rewrite them.
- Persisted `assistant` messages re-enter chat history as plain text. Tool round-trips happen **inside one user turn**; they don't span turns.
- `TICKET CONTEXT` system block is injected **only on the first turn** (token-saving optimization the user explicitly asked for). On later turns the model leans on its own earlier replies.
- **Multi-tenant by organization, with real Supabase auth.** An `organizations` row is a railroad tenant. Org-private data (`assets`, `tickets`, `parts`, and org-private `corpus_chunks`) carries `org_id`; shared reference data (CFR) has `org_id = NULL` and is visible to every org. Per-request identity + org come from **one** seam: [backend/railio/org_context.py](backend/railio/org_context.py). `get_current_user` verifies the Supabase JWT (`Authorization: Bearer …`, via [backend/railio/auth.py](backend/railio/auth.py) `verify_supabase_jwt`) and ensures an `app_users` row; `get_current_org` returns the tenant for an **onboarded** request (un-onboarded → 409 `onboarding_required`, which redirects into onboarding without any router change). **The org is derived solely from the verified token + our DB — the client-supplied `X-Org-Id` header is now IGNORED**, so a client cannot read another org's data. Every repo query is org-scoped: a cross-org id resolves to None → 404. The frontend attaches the bearer token via `authHeaders()` in [frontend/lib/api.ts](frontend/lib/api.ts) (`createClient().auth.getSession()`); it still also sends a legacy `X-Org-Id` the backend no longer reads. Onboarding lives in [backend/railio/routers/users.py](backend/railio/routers/users.py) (`/api/me`, `/api/onboarding`) + `finalize_onboarding` in [backend/railio/organizations_repo.py](backend/railio/organizations_repo.py).
- **Corpus is scoped per org + unit.** `corpus_chunks.org_id` (null = shared, e.g. CFR) + `unit_model` (null = all models) + `asset_id` (set only for unit-specific history). `search_corpus` filters `(org_id = X OR null) AND (unit_model = Y OR null) AND (asset_id = Z OR null)`. Scope is bound by the **runtime** in [chat_loop.py](backend/railio/chat_loop.py) (`_build_corpus_scope`, from the ticket's org+asset) and passed via `execute_tool(..., scope=)` — the model never chooses scope (especially not its own org, the tenant boundary). The same scope injects `org_id` into the parts tools (`lookup_parts`, `record_part_used`), since inventory is org-exclusive. `insert_corpus_chunk` ([backend/railio/corpus_repo.py](backend/railio/corpus_repo.py)) is the single runtime corpus writer.
- **Knowledge ingestion is two-tier and demo-free.** Shared CFR is loaded by `python -m scripts.corpus_build` (org_id NULL; it replaces only `org_id IS NULL` rows). Per-company data lives in **Supabase**; to (re)onboard an org you drop a `backend/org-data/<slug>/` folder (`org.json`, `assets.json`, `parts.json`, `corpus/*.json`), run `python -m scripts.load_org <slug>`, then delete the folder — these folders are ephemeral, not committed. See [backend/org-data/README.md](backend/org-data/README.md). **You (admin) load all data; tenants don't upload in v0.** Adding a 2nd locomotive model = a new manual file under an org's `corpus/` with its `unit_model` — no Python change. `python -m scripts.seed` is now a clean-baseline reset (no demo data); the old `DEFAULT_UNIT_MODEL` / `_scope_for_chunk` doc_id-prefix logic is gone.
- **Unit models are data, not an enum.** `UnitModel` is a plain `str` in both contract files; available models come from the `assets` table, not a literal. Don't reintroduce a hardcoded model enum.
- **Closing a ticket goes through the wrap-up page** (`/tech/ticket/[id]/wrap-up`), not a direct status PATCH. `finalize_wrap_up` ([tickets_repo.py](backend/railio/tickets_repo.py)) writes a unit-scoped repair-history chunk + a `tribal_capture` row (this is what wires the previously-dormant table) and sets CLOSED. `post_repair.py` drafts the summary/notes (mirror of `pre_arrival.py`). `resetTicket` deletes the promoted chunk + capture so demo re-runs stay clean.
- **Navigation is the `/work` master-detail workspace.** One ticket-first inbox; role (cookie via [lib/role.ts](frontend/lib/role.ts)) sets posture (dispatcher list-forward, tech detail-forward) with a quiet toggle. Selecting a ticket = `/work?ticket=ID` (focus mode: list collapses to a rail). Old `/app`, `/dispatcher`, `/tech`, and `/{role}/ticket/[id]` routes are redirects into `/work`. Don't reintroduce the role-picker landing wall.
- One ticket thread, both roles. Don't split into two logs.
- `resetTicket` is demo-only and wipes everything back to AWAITING_HANDOFF so the same scenario can be re-run from intake, handoff included.
- **Status transitions are legal-only**: `AWAITING_HANDOFF → AWAITING_TECH → IN_PROGRESS → AWAITING_REVIEW → CLOSED` (plus `AWAITING_REVIEW → IN_PROGRESS` to reopen). The table is `_LEGAL` in [set_ticket_status.py](backend/railio/tools/set_ticket_status.py); `transition_error()` is the single check, used by both the chat tool and `PATCH /api/tickets/{ref}` — the route used to write `status` unchecked, which made the HTTP API a back door around the table. A same-status write is a deliberate no-op, not an error. Don't add transitions without a product reason.
- **`AWAITING_HANDOFF` is dispatcher-owned intake.** `create_ticket` opens tickets there, not in `AWAITING_TECH`. The tech's queue filters to `["AWAITING_TECH","IN_PROGRESS"]` ([WorkspaceShell.tsx](frontend/components/WorkspaceShell.tsx)), so a pre-handoff ticket is invisible to them; the dispatcher's "Hand off to tech" button is what releases it, and afterwards renders as a disabled "Handed off" receipt. This is posture, not authorization — role is a cookie.
- Asset lookups key on `(org_id, reporting_mark, road_number)`, not autoincrement id (which drifts) and not `(reporting_mark, road_number)` alone — road numbers can now collide across orgs. `parts.part_number` is unique **per org** (partial unique index), not globally.
- pgvector parameters must be passed as `CAST(:vec AS vector)` with a `"[v1,v2,…]"` text literal — asyncpg won't auto-convert Python lists to the `vector` type.
- Anything talking to the model goes through [railio/chat_loop.py](backend/railio/chat_loop.py). Don't add a second loop.
- Frontend HTTP goes through [frontend/lib/api.ts](frontend/lib/api.ts). Don't `fetch` directly from components.
- Photo upload uses the FormData field name **`files`** (not `file`) — the backend reads it via FastAPI's `files: list[UploadFile] = File(...)`.
- Supabase transaction-pooler connections (port 6543) require `statement_cache_size=0` on asyncpg, set in [backend/railio/db.py](backend/railio/db.py).

## Leave no dead files behind

Delete things the moment they stop being needed — don't let them linger. Specifically:

- **Data pushed to Supabase is deleted locally.** Supabase is the sole store. Once a tenant's `org-data/<slug>/` folder is loaded via `load_org`, delete the folder. The same goes for any local file whose contents now live in the DB — push, verify it's there, then remove the local copy. Don't keep a local "backup" in the repo.
- **Replaced code is deleted, not left beside its replacement.** When you rewrite or supersede a module, component, route, or script, delete the old one in the same change. No `_old`, `_v2`, commented-out blocks, or parallel implementations.
- **Files no longer used are deleted.** When a feature is removed or a file becomes orphaned (no importers/references), delete the file, its now-unused dependencies (e.g. a package in `pyproject.toml`), and any docs or config that point at it — right then, not "later."
- **Unnecessary artifacts are deleted.** Temp/scratch scripts, one-off demo seeders, build artifacts that slipped into git (`*.egg-info/`, caches), and stale generated files don't belong in the tree.

After any deletion, sweep for dangling references (`git grep` the removed name) and fix or remove them so no doc, import, or config points at something gone.

## Things to avoid

- Don't fall back to general LLM knowledge when the corpus is silent. The system prompt requires verbatim refusal: *"I don't have this in your manuals or tribal notes."*
- Don't paraphrase citation labels — render the chunk's exact `source_label`.
- Don't reintroduce FRA document generation (F6180_49A, DAILY_INSPECTION_229_21, defect cards, parts requisitions, PDF export, `update_form_field`, pre-fill, the `forms` table, the Forms tab). The current build is chat + corpus + parts + photos only — this was a deliberate scope decision.
- Auth and multi-tenant are now **live** (Supabase JWT + onboarding; see the multi-tenant convention). Don't route around them: every org-scoped router depends on `get_current_org`, and the org comes from the verified token — never trust a client-supplied org. Mobile-native code paths still belong in v1, not here.
- Don't add comments that explain **what** the code does. Only WHY-comments for non-obvious constraints.
- Don't create planning/decision/analysis markdown files unless explicitly asked.

## Running it

```bash
# backend
cd backend
python -m venv .venv && source .venv/bin/activate
pip install -e .
python -m scripts.migrate && python -m scripts.seed   # seed = clean baseline (no demo data)
python -m scripts.corpus_fetch && python -m scripts.corpus_build   # shared CFR (org_id NULL)
# tenant data already lives in Supabase; to (re)onboard an org, drop a backend/org-data/<slug>/
# folder, run `python -m scripts.load_org <slug>`, then delete the folder.
uvicorn railio.main:app --reload --port 3001

# frontend (separate terminal)
cd frontend
npm install
npm run dev               # :3000
```

`OPENAI_API_KEY`, `DATABASE_URL`, `SUPABASE_URL`, and `SUPABASE_SERVICE_ROLE_KEY` in `backend/.env` are required. See [backend/RUN.md](backend/RUN.md) for the full sequence.

## Verifying changes touch reality

Run the test suite — see [tests/README.md](backend/tests/README.md) for the one-time `unit_tests` org seed:

```bash
cd backend && pytest tests/api -q            # no OpenAI spend; run this first
cd backend && pytest tests/chat -n 4 --dist loadscope   # live model calls (~$2–3)
cd frontend && npm test
```

`tests/chat` drives the real `run_chat` against the real key and asserts each tool fires for four different phrasings — that's what catches a system-prompt or tool-schema regression. Type-check / import-check passing is not the same as feature working, and neither is a green `tests/api`.

For UI changes, still walk a ticket end-to-end in the browser: the component tests mock `lib/api.ts`, so they never prove the app boots.
