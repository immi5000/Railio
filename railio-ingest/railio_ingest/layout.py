"""Page rendering + adaptive book-page splitting + figure-box candidates.

Two concerns:
  1. Render each PDF page to a PNG at a target DPI (PyMuPDF).
  2. Decide whether a rendered page holds ONE book-page or TWO side-by-side
     (the two-up spread case), and split accordingly — detected, not hardcoded.

The split heuristic uses the PDF's own text geometry: if there's a tall, mostly
text-free vertical gutter band near the horizontal center with substantial text
on BOTH sides, it's a two-up spread. Single-page PDFs (one book-page per PDF
page) fall through untouched. Surya is optional and only used (when installed)
to propose figure boxes; the vision pass refines them regardless.
"""

from __future__ import annotations

import io
from dataclasses import dataclass, field
from typing import Any, Optional

import fitz  # PyMuPDF
from PIL import Image


@dataclass
class BookPage:
    """One logical book-page extracted from (possibly half of) a PDF page."""

    pdf_index: int  # 0-based PDF page
    side: str  # "full" | "left" | "right"
    png: bytes  # rendered image of just this book-page
    width: int
    height: int
    native_text: str  # text layer for this region ("" if none / scanned)
    candidate_figure_boxes: list[list[float]] = field(default_factory=list)


def _pixmap_png(page: "fitz.Page", clip: Optional["fitz.Rect"], dpi: int) -> tuple[bytes, int, int]:
    mat = fitz.Matrix(dpi / 72, dpi / 72)
    pix = page.get_pixmap(matrix=mat, clip=clip, alpha=False)
    img = Image.open(io.BytesIO(pix.tobytes("png"))).convert("RGB")
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return buf.getvalue(), img.width, img.height


def _detect_two_up(page: "fitz.Page") -> bool:
    """True if the page looks like two book-pages side by side.

    Heuristic on the text layer: split the page into a left half and right half
    by the vertical center; require meaningful text in BOTH halves AND a narrow
    central band that is nearly text-free (the gutter)."""
    rect = page.rect
    words = page.get_text("words")  # [x0,y0,x1,y1,word,...]
    if len(words) < 40:
        return False  # too little text to judge (likely a full-page figure)
    cx = (rect.x0 + rect.x1) / 2.0
    width = rect.width
    left = right = gutter = 0
    band = 0.04 * width  # +/- 4% of width around center = candidate gutter
    for w in words:
        x0, x1 = w[0], w[2]
        wmid = (x0 + x1) / 2.0
        if abs(wmid - cx) < band:
            gutter += 1
        elif wmid < cx:
            left += 1
        else:
            right += 1
    if left < 15 or right < 15:
        return False
    total = left + right + gutter
    # Real gutter: very few words straddle the center relative to the page.
    return gutter / max(total, 1) < 0.06


def render_book_pages(pdf_path: str, dpi: int = 300) -> list[BookPage]:
    """Render every PDF page into one or two BookPages (adaptive split)."""
    doc = fitz.open(pdf_path)
    out: list[BookPage] = []
    try:
        for i in range(doc.page_count):
            page = doc.load_page(i)
            rect = page.rect
            if _detect_two_up(page):
                cx = (rect.x0 + rect.x1) / 2.0
                halves = [
                    ("left", fitz.Rect(rect.x0, rect.y0, cx, rect.y1)),
                    ("right", fitz.Rect(cx, rect.y0, rect.x1, rect.y1)),
                ]
            else:
                halves = [("full", rect)]
            for side, clip in halves:
                png, w, h = _pixmap_png(page, clip if side != "full" else None, dpi)
                native = page.get_text("text", clip=clip).strip()
                out.append(
                    BookPage(
                        pdf_index=i,
                        side=side,
                        png=png,
                        width=w,
                        height=h,
                        native_text=native,
                        candidate_figure_boxes=_surya_boxes(png),
                    )
                )
    finally:
        doc.close()
    return out


# --- Optional Surya figure-box hints (best-effort; vision refines regardless) ---

_surya_predictor: Any = None
_surya_tried = False


def _get_surya() -> Any:
    global _surya_predictor, _surya_tried
    if _surya_tried:
        return _surya_predictor
    _surya_tried = True
    try:  # surya pulls torch; optional extra
        from surya.layout import LayoutPredictor  # type: ignore

        _surya_predictor = LayoutPredictor()
    except Exception:
        _surya_predictor = None
    return _surya_predictor


def _surya_boxes(png: bytes) -> list[list[float]]:
    """Return normalized figure/picture boxes from Surya if installed, else []."""
    pred = _get_surya()
    if pred is None:
        return []
    try:
        img = Image.open(io.BytesIO(png)).convert("RGB")
        results = pred([img])
        if not results:
            return []
        W, H = img.width, img.height
        boxes: list[list[float]] = []
        for b in getattr(results[0], "bboxes", []):
            label = (getattr(b, "label", "") or "").lower()
            if label in ("figure", "picture"):
                x0, y0, x1, y1 = b.bbox
                boxes.append([x0 / W, y0 / H, x1 / W, y1 / H])
        return boxes
    except Exception:
        return []
