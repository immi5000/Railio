# railio-ingest

**Isolated admin tool. NEVER deployed.** It extracts OEM manual PDFs into
model-scoped corpus chunks + figure crops and writes them **directly into the
production Supabase**. The only thing that reaches prod is the data in the DB +
storage; this code stays on your machine.

## What it does

For one manual PDF:

1. Renders each page (PyMuPDF, 300 DPI) and **adaptively splits two-up spreads**
   into left/right book-pages (single-page PDFs pass through untouched).
2. Gets text from the **native text layer** where present; **OpenAI `gpt-4o`
   OCR** only on pages without a usable text layer (triage).
3. **`gpt-4o` validates/captions figures** and extracts numbered callouts; crops
   each figure **tight but caption/attached-table-inclusive**; uploads PNGs to
   the `railio-uploads` bucket.
4. Embeds chunk text with **OpenAI `text-embedding-3-large` @ 1024 dims** (same
   as prod) and writes:
   - a `models` row (created if missing),
   - a `documents` row (`org_id = NULL` → **shared by model**),
   - `corpus_chunks` rows with `embedding` + a `figures` JSONB list.

Figure captions are appended to each chunk's embeddable text, so a diagram is
findable by what it shows.

## Scope

**Model-level OEM manuals only** — shared across every org that owns the model,
stored once. Per-asset history/inspection docs are a separate, later effort and
are NOT handled here; this tool never touches the `assets` table.

## Setup

```bash
cd railio-ingest
python -m venv .venv && source .venv/bin/activate
pip install -e .            # core
pip install -e ".[layout]"  # + Surya figure-box hints (pulls torch ~2GB; optional)
cp .env.example .env        # fill with PROD DATABASE_URL / SUPABASE / OPENAI_API_KEY
```

## Run

Always dry-run first to inspect extraction before touching prod:

```bash
python -m railio_ingest.extract \
  --pdf ./SD60.pdf \
  --model "EMD SD60" \
  --doc-id emd_sd60_computer_troubleshooting \
  --doc-title "EMD SD60 Computer & Troubleshooting Guide" \
  --oem "Electro-Motive Division" \
  --dry-run
# → out/<doc_id>/chunks.json + out/<doc_id>/figures/*.png ; no DB/storage writes
```

Then the real write (creates schema if needed, prompts before creating a model):

```bash
python -m railio_ingest.extract \
  --pdf ./SD60.pdf --model "EMD SD60" \
  --doc-id emd_sd60_computer_troubleshooting \
  --doc-title "EMD SD60 Computer & Troubleshooting Guide" \
  --oem "Electro-Motive Division"
```

### One manual, several models

If a manual covers more than one model (e.g. a 645E engine manual used by both
the GP38-2 and SD38-2), pass `--model` **once per model** — the manual is
ingested **once** and retrievable from tickets on any of them:

```bash
python -m railio_ingest.extract \
  --pdf ./645E_Blower.pdf \
  --model "EMD GP38-2" --model "EMD SD38-2" \
  --doc-id emd_645e_engine_blower \
  --doc-title "EMD 645E Engine & Blower Manual" \
  --oem "Electro-Motive Division"
```

The first `--model` is the **primary** (it backs the legacy scalar `unit_model`
and the `documents`/`corpus_chunks` `model_id`); the full set is stored in
`corpus_chunks.unit_models[]`. Retrieval matches a ticket's model against that
array, so the manual surfaces under every model you list. A single `--model`
behaves exactly as before.

Re-running the same `--doc-id` **replaces** that document's chunks (scoped
delete + reinsert); other docs/models/orgs are untouched. The real write also
uploads the source PDF to `manuals/<doc_id>/source.pdf` and records it on
`documents.pdf_path`, and stores each chunk's true PDF page index in
`corpus_chunks.pdf_page` — so the website can deep-link a citation to the manual
at its page (`<pdf>#page=N`).

### Backfill (data ingested before pdf_path / pdf_page existed)

For a manual already in prod, give it an openable PDF + per-chunk PDF page
**without** re-running the vision pipeline or re-minting chunk ids:

```bash
python -m railio_ingest.backfill_pdf_pages \
  --pdf ./SD60.pdf --doc-id emd_sd60_computer_troubleshooting
```

It uploads the PDF, re-renders book-pages (native text only, cheap) to recompute
each page's `source_label`, and updates the matching chunk's `pdf_page` in place.

## Notes

- `--dpi` defaults to 300. Bump for very fine schematics.
- Without the `[layout]` extra, figure detection relies entirely on `gpt-4o`
  (lighter, slightly less precise boxes).
- Cost is single-digit $/manual (vision runs only on figure/scanned pages).
