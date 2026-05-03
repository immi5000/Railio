# Railio backend

Standalone Next.js app on **port 3001**. Backed by SQLite (`better-sqlite3` + `sqlite-vec`) and an OpenAI chat / tool-use loop.

Spec: [MVP_v0_BACKEND.md](./MVP_v0_BACKEND.md). Shared types: [`../contract/contract.ts`](../contract/contract.ts).

## Setup

```bash
cd backend
cp .env.example .env       # then fill in the API keys
npm install
npm run db:migrate         # creates .railio.db, runs schema
npm run db:seed            # loads assets + parts + demo tickets
npm run corpus:fetch       # downloads real CFR sources (~700 KB, public eCFR API)
npm run db:seed-corpus     # parses + chunks + embeds + loads the corpus
npm run dev                # listens on http://localhost:3001
```

CORS is open to `http://localhost:3000` (the frontend). Adjust `FRONTEND_ORIGIN` in `.env` if needed.

## Environment

See [.env.example](./.env.example). Keys you must fill:

- `OPENAI_API_KEY` — chat + tool use (model defaults to `gpt-4o`) and embeddings.
- `OPENAI_CHAT_MODEL` — override the chat model if you want (e.g. `gpt-4o-mini`).
- `EMBEDDINGS_PROVIDER` — defaults to `openai` (1024 dims via `text-embedding-3-large`). Switch to `voyage` or `cohere` and supply the matching key if you prefer.

The `.env` is gitignored. Placeholders are pre-filled — replace them.

## End-to-end check

```bash
npm run dev      # in one terminal
npm run e2e      # in another — drives the full happy path
npm run verify-chain   # validates the messages hash chain
```

## API surface

See [MVP_v0_BACKEND.md §4.2](./MVP_v0_BACKEND.md). All routes return JSON unless noted; `/api/tickets/:id/messages` streams Server-Sent Events.

| Method | Path | Notes |
| --- | --- | --- |
| GET | `/api/tickets` | optional `?status=` filter |
| POST | `/api/tickets` | creates ticket + pre-fills 4 forms |
| GET | `/api/tickets/:id` | full detail (messages, forms, ticket_parts) |
| PATCH | `/api/tickets/:id` | status / pre_arrival_summary |
| POST | `/api/tickets/:id/messages` | **SSE** chat + tool-use stream |
| POST | `/api/tickets/:id/photos` | multipart upload |
| POST | `/api/tickets/:id/parse-fault-dump` | sync helper, persists parsed faults |
| GET | `/api/tickets/:id/forms` | all 4 forms |
| PATCH | `/api/tickets/:id/forms/:form_type` | tech overrides AI |
| POST | `/api/tickets/:id/forms/:form_type/export` | renders PDF, marks `exported` |
| POST | `/api/tickets/:id/reset` | **demo only** — rewind to AWAITING_TECH, wipe messages + parts + form edits |
| GET | `/api/parts` | search/list (`?unit_model=&q=`) |
| PATCH | `/api/parts/:id` | admin edit |
| GET | `/api/corpus/chunks/:id` | citation click-through |

## Layout

```
backend/
  app/api/                 # Next.js route handlers
  lib/
    openai.ts              # OpenAI client
    chat-loop.ts           # AI message loop + SSE emitter
    cors.ts                # CORS for the FE origin
    db/                    # better-sqlite3 + sqlite-vec
    embeddings.ts          # OpenAI (default), Voyage, Cohere
    forms/
      pre-fill.ts          # initial 4-form payloads on ticket create
      field-path.ts        # update_form_field path validator + applier
      pdf/                 # @react-pdf/renderer templates + render
    hash.ts                # prev_hash sha256 chain
    messages-repo.ts       # append-only message log
    system-prompt.ts       # citation + refusal + photo + form rules
    tickets-repo.ts        # tickets / forms / ticket_parts queries
    tools/                 # 7 tools the model can call
  scripts/
    migrate.ts seed.ts corpus-fetch.ts corpus-build.ts e2e.ts verify-chain.ts
  seeds/
    assets.json parts.json corpus-tribal.json demo-tickets.json
  corpus-sources/
    sources.json            # manifest of downloaded knowledge bases (committed)
    raw/                    # downloaded XML/PDF files (gitignored)
```

## Knowledge base

The `manual` half of the corpus is real, public-domain federal regulation:

- **49 CFR Part 229** — Railroad Locomotive Safety Standards (~113 sections)
- **49 CFR Part 232** — Brake System Safety Standards (~85 sections)
- **49 CFR Part 218** — Railroad Operating Practices (~63 sections)

Source manifest: [`corpus-sources/sources.json`](./corpus-sources/sources.json). Fetcher: [`scripts/corpus-fetch.ts`](./scripts/corpus-fetch.ts) — downloads via the public eCFR XML API. Builder: [`scripts/corpus-build.ts`](./scripts/corpus-build.ts) — parses each `<DIV8>` section into one chunk (sub-splitting anything over 6 KB), labels it `49 CFR §N — title`, embeds via OpenAI `text-embedding-3-large` at 1024 dims, inserts into `corpus_chunks` + `corpus_chunks_vec`.

The `tribal_knowledge` half is hand-written stand-ins ([`seeds/corpus-tribal.json`](./seeds/corpus-tribal.json)) — six fictional "Senior-tech note — Imran" entries that demo the manual-vs-tribal citation split. Production replaces these with a recorded SME session per the MVP spec.

To add another source: append an entry to [`corpus-sources/sources.json`](./corpus-sources/sources.json), then `npm run corpus:fetch && npm run db:seed-corpus`.

## Notes

- `corpus_chunks_vec` is a `sqlite-vec` virtual table holding 1024-dim float vectors. Both `manual` and `tribal_knowledge` chunks live there; `search_corpus` filters by `doc_class`.
- Photo uploads land in `./.railio-uploads/<ticket_id>/<uuid>.<ext>` — paths are passed back to the chat as attachments and inlined into the next OpenAI message as `image_url` data-URI parts.
- The AI's tool calls are persisted in full (`{name, input, output}`) on the assistant message's `tool_calls` JSON — that's the audit trail the SME and the UI both read.
- The hash chain is `sha256(prev_hash || canonical(row))`; `verify-chain` walks it per ticket. 
