# Ingesting new manuals (native vs. scanned PDFs)

A practical, step-by-step guide for loading a new OEM manual into Railio with
the `railio-ingest` tool. It covers the two kinds of PDF you'll run into:

- **Native PDF** — you can select/copy text with your mouse. The text is a real
  layer in the file.
- **Scanned PDF** — you *can't* select text; each page is essentially an image
  (a photo/scan of a paper page).

The good news: **the same command handles both.** The pipeline detects, page by
page, whether a usable text layer exists and falls back to OCR only where it
doesn't. The difference between the two cases is mostly **cost, time, and which
settings you reach for** — not a different command.

> This tool writes **directly to production Supabase**. There is no staging DB.
> Always dry-run first (below).

> **On rate limits & timing.** The vision pass and embeddings call OpenAI; this
> org's gpt-4o limit is low (30k tokens/min), so a large manual gets
> rate-limited (HTTP 429) repeatedly. The tool now **waits and retries
> automatically** (exponential backoff) instead of crashing, so a big manual
> just runs *slowly* — it can take many minutes, that's expected. **Ingest one
> manual at a time**; running several at once splits the same token budget and
> only makes each slower. A real write is all-or-nothing — if it does crash,
> nothing is written, so just re-run it.

---

## 0. One-time setup

```bash
cd railio-ingest
python -m venv .venv && source .venv/bin/activate
pip install -e .            # core
cp .env.example .env        # fill PROD DATABASE_URL / SUPABASE_* / OPENAI_API_KEY
```

For scanned manuals with dense schematics, the optional layout extra gives the
figure detector better bounding boxes (pulls in torch, ~2 GB — optional):

```bash
pip install -e ".[layout]"
```

Put the PDF somewhere you can point at, e.g. `railio-ingest/manuals/`.

---

## 1. Decide: is this PDF native or scanned?

Open the PDF and try to **select a sentence with your mouse / cursor**.

| You can select text | → | **Native PDF** — follow §2 |
| You can't (it's like an image) | → | **Scanned PDF** — follow §3 |

If *some* pages select and others don't (common in older manuals — typed body
text but scanned foldout diagrams), treat it as **scanned** (§3): the higher DPI
and the vision pass cost you a little more but extract the image-only pages
correctly. The native-text pages are still read from their text layer for free.

---

## 2. Native PDF (selectable text)

This is the cheap, fast path. Text comes straight from the PDF's text layer;
`gpt-4o` vision is only spent on **figures** (validating + captioning + cropping
them), not on reading body text.

### 2a. Dry-run first (no DB writes)

```bash
python -m railio_ingest.extract \
  --pdf manuals/<file>.pdf \
  --model "EMD <MODEL>" \
  --doc-id <stable_doc_id> \
  --doc-title "<Human Readable Title>" \
  --oem "Electro-Motive Division" \
  --dry-run
```

This writes `out/<doc_id>/chunks.json` and `out/<doc_id>/figures/*.png` and
touches **nothing** in prod. Open `chunks.json` and spot-check:

- Does the `text` of a few chunks read like the manual (not garbled)?
- Do the `source_label`s look right (correct page numbers)?
- Are figures captioned sensibly?

Tip: add `--max-pages 10` to dry-run only the first 10 pages while you're
checking that the doc-id/title/model look right — much faster and cheaper.

### 2b. Real write

Drop `--dry-run` (and `--max-pages`) once the dry-run looks good:

```bash
python -m railio_ingest.extract \
  --pdf manuals/<file>.pdf \
  --model "EMD <MODEL>" \
  --doc-id <stable_doc_id> \
  --doc-title "<Human Readable Title>" \
  --oem "Electro-Motive Division"
```

It ensures the schema, creates the model row if new (prompts unless `--yes`),
uploads the source PDF, embeds every chunk (1024-dim), and writes
`models` + `documents` + `corpus_chunks`.

---

## 3. Scanned PDF (image-only, no selectable text)

Same command, but two things change because every page must be **read by
vision** (OCR) rather than lifted from a text layer:

1. **It costs more and takes longer** — `gpt-4o` runs on *every* page, not just
   figure pages. Still typically single-digit dollars per manual, but budget for
   it and don't be surprised if a big manual takes a while.
2. **Render quality matters more.** Bump the DPI so the OCR has crisp pixels,
   especially for small text and fine schematics:

```bash
python -m railio_ingest.extract \
  --pdf manuals/<file>.pdf \
  --model "EMD <MODEL>" \
  --doc-id <stable_doc_id> \
  --doc-title "<Human Readable Title>" \
  --oem "Electro-Motive Division" \
  --dpi 400 \
  --dry-run
```

### Dry-run is non-optional here

For scanned docs the dry-run is your **OCR quality gate**. Open
`out/<doc_id>/chunks.json` and read several chunks end-to-end:

- Is the OCR accurate, or is it dropping/mangling words? If it's poor, raise
  `--dpi` (try 400, then 500) and dry-run again. Higher DPI = sharper input =
  better OCR, at the cost of speed.
- Old manuals are often **two-up scans** (two book-pages photographed side by
  side on one sheet). The pipeline auto-splits these into left/right book-pages
  — confirm in the dry-run that page splitting looks right and text isn't bleeding
  across the gutter.
- Check the figure crops in `out/<doc_id>/figures/` — for image-heavy scanned
  manuals, install the `[layout]` extra (§0) for tighter figure boxes.

Once the dry-run reads cleanly, drop `--dry-run` for the real write (keep the
same `--dpi`).

---

## 4. One manual that applies to several models

If the manual covers more than one locomotive model — e.g. the **645E engine
manual** is used by both the **GP38-2** and **SD38-2** — pass `--model` **once
per model**. The manual is ingested **once** and shows up for tickets on any of
those models:

```bash
python -m railio_ingest.extract \
  --pdf manuals/645E_Blower.pdf \
  --model "EMD GP38-2" --model "EMD SD38-2" \
  --doc-id emd_645e_engine_blower \
  --doc-title "EMD 645E Engine & Blower Manual" \
  --oem "Electro-Motive Division"
```

- The **first** `--model` is the primary; the full set is stored on each chunk's
  `unit_models[]` array.
- Don't ingest the same PDF twice (once per model) — that duplicates chunks and
  doubles cost. One ingest, multiple `--model` flags.
- A single `--model` works exactly as before (single-model manual).

This works for both native and scanned PDFs.

---

## 5. Naming conventions

- **`--model`**: match the exact `unit_model` string used on the assets, e.g.
  `"EMD GP38-2"`, `"EMD SD38-2"`, `"EMD SD60"`, `"GE ES44DC"`. The model string a
  ticket's asset carries is what retrieval matches against, so a typo here means
  the manual silently won't surface. (Models are data, not an enum — a new
  string just creates a new model row.)
- **`--doc-id`**: a stable, lowercase, underscore identifier you'll reuse to
  re-ingest. Re-running the same `--doc-id` **replaces** that document's chunks
  (scoped delete + reinsert); everything else is untouched. Examples:
  `emd_645e_engine_blower`, `emd_gp38_2_sd38_2_locomotive_service_manual`.
- **`--doc-title`**: the human-readable title shown in citations and the
  Knowledge library. This is what techs see — make it clear.
- **`--oem`**: the manufacturer, stored on a newly-created model row, e.g.
  `"Electro-Motive Division"`, `"GE Transportation"`.

---

## 6. Verify it worked

After a real write, confirm the manual is retrievable. A quick SQL check (psql /
Supabase SQL editor):

```sql
SELECT doc_id, unit_model, unit_models, count(*) AS chunks
FROM corpus_chunks
WHERE doc_id = '<your_doc_id>'
GROUP BY doc_id, unit_model, unit_models;
```

- `chunks` should be > 0.
- For a multi-model manual, `unit_models` should list every model you passed
  (e.g. `{EMD GP38-2,EMD SD38-2}`) and `unit_model` should be the primary.

Then check the app: in the **Knowledge library** (corpus browse) the manual
should appear under **each** model it's tagged to, and a ticket on one of those
models should cite it when you ask a relevant question.

---

## 7. Quick reference

| Situation | Command delta |
|---|---|
| Native PDF (selectable text) | default `--dpi 300`, dry-run, then write |
| Scanned PDF (image-only) | `--dpi 400`+, **always** read the dry-run OCR; consider `[layout]` extra |
| Mixed (some pages scanned) | treat as scanned |
| One manual, many models | repeat `--model "..."` per model (first = primary) |
| Cheap preview | add `--max-pages 10 --dry-run` |
| Re-ingest / fix | reuse the same `--doc-id` (replaces in place) |
| Skip the "create model?" prompt | add `--yes` |

All flags: `python -m railio_ingest.extract --help`.
