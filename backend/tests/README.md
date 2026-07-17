# Railio tests

Three layers, run locally before a push. Two are free; one costs a couple of dollars.

```bash
cd backend && pytest tests/api tests/test_corpus_retrieval.py tests/test_model_family.py -q
cd backend && pytest tests/chat -n 4 --dist loadscope     # live model calls
cd frontend && npm test
```

Everything at once (backend): `pytest -n 4 --dist loadscope`.

## One-time setup: the `unit_tests` org

Everything runs against a real Postgres and a dedicated tenant. Seed it once:

```bash
cd backend && python -m scripts.copy_org test unit_tests
```

That clones assets, parts, history, tickets and private corpus from the `test`
org. **It costs no OpenAI tokens** — nothing is rewritten, so nothing is
re-embedded. Shared OEM manuals and their figures are `org_id IS NULL` and are
already visible to every org, so they aren't copied and don't need to be.

Re-seed only when the source `test` org changes. Tests clean up after themselves
(each deletes the tickets it created), so the org stays stable indefinitely.
Don't seed from a fixture: `copy_org` wipes its destination first, and parallel
workers would delete each other's data mid-run.

Requires `DATABASE_URL` (or `DATABASE_URL_DIRECT`) and `OPENAI_API_KEY` in
`backend/.env`.

## The layers

### `tests/chat` — does the model still call the right tool? (live, ~$2–3)

The point of the whole suite. Each tool gets **four different phrasings** of the
same intent, and each must make the model invoke it. Tool choice is
probabilistic, so a miss gets **one automatic retry on a fresh ticket** (retrying
the same ticket would replay the failed exchange as history and bias the retry);
a second miss fails with what the model did instead.

These drive the real `run_chat` against the real key. `run_chat` takes an
injected synchronous `emit`, so `list.append` is the emit — no HTTP, no auth, no
SSE parsing.

| File | Covers |
|---|---|
| `test_search_corpus.py` | retrieval fires; args sane; tenant boundary; answers cite (rule 1) |
| `test_request_photo.py` | ambiguous physical description → photo asked for first (rule 3) |
| `test_show_figure.py` | diagram requests render a real figure from a really-retrieved chunk (rule 4) |
| `test_lookup_parts.py` | parts lookup uses **the ticket's unit_model** — proves TICKET CONTEXT is being read |
| `test_record_part_used.py` | records only on confirmation, with the stated qty (rule 5) |
| `test_refusal.py` | corpus-silent → the verbatim refusal (rule 2) |
| `test_auto_status.py` | tech's first message starts the ticket, exactly once |

**Every run also pays for `assert_stream_contract`** (`helpers/events.py`), which
holds regardless of what the model said: event ordering, `done` last,
started/completed pairing by `call_id`, streamed tokens == persisted content,
contract conformance, no citation pointing at a chunk the run never retrieved,
and an intact hash chain. That's why ~27 live runs verify far more than 27
things — and why adding an assertion there is usually better than adding a run.

**Citation labels are not asserted against the model's prose**, on purpose. The
model drifts on the label wording (toward a figure name, or a merged page range a
single-chunk link can't deliver), so `ChatPane` renders the `source_label`
recorded on the citation instead of what the model typed — the property holds by
construction, and `frontend/tests/ChatPane.test.tsx` pins it for free. What *is*
asserted live is the half no code can guarantee: a `cite:` never points at a
chunk the run didn't retrieve.

### `tests/api` + `test_corpus_retrieval.py` + `test_model_family.py` — free, run first

No OpenAI. Auth is overridden via `dependency_overrides`; `ASGITransport` skips
lifespan, so PostHog never initializes and the app never disposes our engine.

Highest-value: **`test_org_scoping.py`** (the tenant boundary — every request
authenticates as `unit_tests` and reaches for the `test` org's data),
`test_status_transitions.py` (the legality table and the PATCH route that must
obey it), `test_parts_locations.py` (`qty_on_hand == sum(locations)`),
`test_hash_chain.py` (that tampering is actually *detected*).

`test_corpus_retrieval.py` calls `search_corpus` directly with fixed queries.
That split is deliberate: `search_corpus` swallows every query exception into an
empty chunk list, so a DB problem looks exactly like "the manual doesn't cover
this" and the model then refuses in good faith. Testing retrieval here means an
outage fails a test instead of hiding inside a plausible refusal.

### `frontend/tests` — component specs (vitest + jsdom)

`lib/api.ts` is mocked and the SSE stream is scripted, so these never prove the
app boots — **walk a ticket in the browser for UI changes.** `ChatPane.test.tsx`
scripts the `StreamEvent` union to cover every branch, including a 429 and a
malformed frame.

## Gotchas worth knowing

- **Both loop scopes must be `session`** (`pyproject.toml`). `railio.db._engine`
  is a module singleton holding loop-bound asyncpg connections; a per-test loop
  leaves it pointing at a closed one. Setting only the fixture scope isn't enough.
- **The `figure_asset` fixture selects on figure availability.** Only three
  seeded unit models have figures, so "first asset" silently makes
  `show_figure` untestable.
- **Tickets are inserted with raw SQL, not `create_ticket`** — that fires
  `generate_pre_arrival_summary`, a live OpenAI call, per ticket.
- **Cleanup deletes whole tickets, never individual messages.** The hash chain is
  per-ticket: dropping a subset breaks `verify_chain`; dropping the ticket
  removes its chain entirely. `--keep-test-data` skips cleanup when debugging.
- **`-n 4`, not 8.** Each round carries the system prompt plus up to 6 full
  manual chunks (~20–40k input tokens); 8 workers brush the TPM ceiling.
- `record_part_used` seeds one assistant message instead of paying for a first
  turn. That's faithful, not a shortcut: `_to_openai_messages` drops system/tool
  roles and replays only assistant text, so history tool_calls are never shown to
  the model anyway.
