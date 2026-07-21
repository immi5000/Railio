# Railio backend — run guide

FastAPI service on `:3001`. The frontend in `frontend/` talks to it over CORS.

## Stack

- Python 3.11+
- FastAPI + uvicorn (SSE-friendly streaming)
- SQLAlchemy 2 (async) + asyncpg + pgvector
- OpenAI async SDK (streaming chat with tool-use accumulation)
- supabase-py (storage; `railio-uploads` bucket)
- httpx (corpus fetch + e2e)
- stdlib `xml.etree.ElementTree` (eCFR section chunking)

## Install

```bash
cd backend
python3 -m venv .venv   # macOS: use python3 if `python` is not found
source .venv/bin/activate
pip install -e .
cp .env.example .env
# fill in OPENAI_API_KEY, DATABASE_URL, DATABASE_URL_DIRECT, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
```

## Scripts

| Command                                                       | Purpose                                |
|---------------------------------------------------------------|----------------------------------------|
| `uvicorn railio.main:app --reload --port 3001`                | Dev server                             |
| `python -m scripts.migrate`                                   | Create / migrate Postgres schema       |
| `python -m scripts.seed`                                      | Seed assets + parts + demo tickets     |
| `python -m scripts.corpus_fetch`                              | Fetch eCFR source docs                 |
| `python -m scripts.corpus_build`                              | Embed + load corpus into pgvector      |
| `python -m scripts.verify_chain`                              | Verify the messages hash chain         |
| `python -m scripts.copy_org test unit_tests`                  | Seed the test org (one-time, see tests/README.md) |
| `pytest tests/api -q`                                         | API + invariant tests (no OpenAI spend) |
| `pytest tests/chat -n 4 --dist loadscope`                     | Live chat tool-invocation tests (~$2–3) |

## One-time setup, in order

```bash
python -m scripts.migrate
python -m scripts.seed
python -m scripts.corpus_fetch
python -m scripts.corpus_build
uvicorn railio.main:app --reload --port 3001
```

## Notes

- `scripts/migrate.py` is idempotent (`IF NOT EXISTS` everywhere). Safe to re-run.
- SSE events emitted by `/api/tickets/{id}/messages`: `assistant_token`, `tool_call_started`, `tool_call_completed`, `user_message_persisted`, `assistant_message_persisted`, `done`, `error`.
