"""Turn a manual PDF into chunk dicts (+ figure crops) ready for the DB writer.

Per book-page (after adaptive split):
  1. Text: native text layer if present; else gpt-4o OCR (triage — vision only
     when the page has no usable text layer).
  2. Figures: gpt-4o validates/captions candidate boxes → tight crops → PNGs.
  3. Chunk: one chunk per book-page (these manual pages are section-coherent),
     carrying its figures. Figure captions are appended to the embeddable text so
     the chunk is findable by what the diagram shows (the Neolens mechanic).
  4. Figure anchoring: figures attach to the chunk for the page that contains
     them. Each figure dict = {path, caption, page, bbox, figure_label, callouts}.

`figure_writer(storage_key, png) -> path` is injected so the CLI can route to the
Supabase bucket (real run) or to local out/ (dry-run).
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Callable, Optional

from . import vision
from .crop import crop_bbox
from .layout import BookPage, render_book_pages

# Skip vision OCR for pages that already have at least this many native chars.
_NATIVE_TEXT_MIN = 40


@dataclass
class Chunk:
    page_label: str  # printed book-page if known, else PDF-page ref
    page_num: Optional[int]  # printed page (for display); may be None
    pdf_page: int  # 1-based PDF page index — the #page=N deep-link target
    text: str
    source_label: str
    figures: list[dict[str, Any]] = field(default_factory=list)


def _printed_page_number(native_text: str) -> Optional[str]:
    """Best-effort: many manuals print a page id like '6-14' or 'I-5' near the
    bottom. We don't hard-depend on it; it only improves source labels."""
    import re

    # Look at the last few non-empty lines for a short page token.
    lines = [ln.strip() for ln in native_text.splitlines() if ln.strip()]
    for ln in reversed(lines[-6:]):
        m = re.fullmatch(r"[A-Z]?-?\d{1,3}(?:-\d{1,3})?", ln)
        if m:
            return m.group(0)
    return None


def _build_figures(
    bp: BookPage,
    pdf_page_human: int,
    doc_id: str,
    figure_writer: Callable[[str, bytes], str],
    fig_counter: list[int],
) -> list[dict[str, Any]]:
    analyses = vision.analyze_page_figures(bp.png, bp.candidate_figure_boxes or None)
    figures: list[dict[str, Any]] = []
    for a in analyses:
        bbox = a.get("bbox")
        if not (isinstance(bbox, list) and len(bbox) == 4):
            continue
        png = crop_bbox(bp.png, [float(x) for x in bbox])
        fig_counter[0] += 1
        key = f"manuals/{doc_id}/p{pdf_page_human}-{bp.side}-fig{fig_counter[0]}.png"
        path = figure_writer(key, png)
        figures.append(
            {
                "path": path,
                "caption": (a.get("caption") or "").strip(),
                "page": pdf_page_human,
                "bbox": [float(x) for x in bbox],
                "figure_label": a.get("figure_label"),
                "callouts": a.get("callouts") or [],
            }
        )
    return figures


def extract(
    pdf_path: str,
    *,
    doc_id: str,
    doc_title: str,
    figure_writer: Callable[[str, bytes], str],
    dpi: int = 300,
    max_pages: Optional[int] = None,
    log: Callable[[str], None] = print,
) -> list[Chunk]:
    pages = render_book_pages(pdf_path, dpi=dpi)
    if max_pages is not None:
        pages = [bp for bp in pages if bp.pdf_index < max_pages]
        log(f"  (limited to first {max_pages} PDF page(s))")
    log(f"  rendered {len(pages)} book-page(s) from PDF")
    chunks: list[Chunk] = []
    fig_counter = [0]

    for bp in pages:
        pdf_page_human = bp.pdf_index + 1
        # 1. text (triage: native first, vision OCR only if thin)
        text = bp.native_text
        if len(text) < _NATIVE_TEXT_MIN:
            text = vision.transcribe_page(bp.png)
            ocr_note = " (vision OCR)"
        else:
            ocr_note = ""

        # 2/3. figures for this page
        figures = _build_figures(bp, pdf_page_human, doc_id, figure_writer, fig_counter)

        # A page that is ONLY a figure (no real text) still becomes a chunk whose
        # searchable text is the figure caption(s) — so the diagram is findable.
        if not text.strip() and not figures:
            continue

        printed = _printed_page_number(bp.native_text)
        page_label = printed or f"PDF p.{pdf_page_human}{'' if bp.side=='full' else f' ({bp.side})'}"

        # Append figure captions to the embeddable text (the retrieval key).
        cap_text = "\n".join(
            f"[{f.get('figure_label') or 'Figure'}] {f['caption']}"
            + (
                " Callouts: " + "; ".join(f"({c.get('num')}) {c.get('text')}" for c in f["callouts"])
                if f.get("callouts")
                else ""
            )
            for f in figures
            if f.get("caption")
        )
        body = (text.strip() + ("\n\n" + cap_text if cap_text else "")).strip()

        source_label = f"{doc_title} — p.{printed}" if printed else f"{doc_title} — PDF p.{pdf_page_human}"

        chunks.append(
            Chunk(
                page_label=page_label,
                page_num=_safe_int(printed),
                pdf_page=pdf_page_human,
                text=body,
                source_label=source_label,
                figures=figures,
            )
        )
        log(
            f"  p{pdf_page_human}{'/'+bp.side if bp.side!='full' else ''}: "
            f"{len(body)} chars{ocr_note}, {len(figures)} figure(s)"
        )

    return chunks


def _safe_int(s: Optional[str]) -> Optional[int]:
    if not s:
        return None
    digits = "".join(ch for ch in s if ch.isdigit())
    return int(digits) if digits else None
