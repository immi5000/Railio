"""OpenAI gpt-4o vision pass: validate/caption figures and extract callouts.

Two jobs, both on the full page image:
  - analyze_page_figures: given the page image (and any candidate figure boxes
    from the layout model), return the real figures with a tight bbox, a
    searchable CAPTION (the Neolens mechanic — this caption is embedded as the
    figure's text), a figure_label (e.g. "Fig. I-9"), and callouts [{num,text}].
  - transcribe_page: OCR fallback for scanned/low-confidence pages — return the
    page's body text in reading order.

Bboxes are normalized [x0,y0,x1,y1] in 0..1 of the rendered image, so they're
resolution-independent and we crop against the actual pixel size.
"""

from __future__ import annotations

import base64
import json
from typing import Any, Optional

from openai import OpenAI

from .config import get_settings
from .retry import with_retries


def _client() -> OpenAI:
    return OpenAI(api_key=get_settings().require_openai())


def _img_part(png_bytes: bytes) -> dict[str, Any]:
    b64 = base64.b64encode(png_bytes).decode("ascii")
    return {
        "type": "image_url",
        "image_url": {"url": f"data:image/png;base64,{b64}", "detail": "high"},
    }


_FIGURE_SYS = (
    "You are extracting engineering figures from a single page of a locomotive "
    "maintenance manual for a retrieval system. A figure is a technical line "
    "drawing, schematic, wiring/block diagram, exploded parts view, pinout, or a "
    "photo of equipment — NOT a plain data table, NOT body text, NOT a page "
    "header/footer or logo. For EACH real figure return:\n"
    "- bbox: [x0,y0,x1,y1] normalized 0..1 of the image, tight around the drawing "
    "BUT including its caption line and any small table/legend physically attached "
    "to and explaining the figure (do not clip an attached CHANNEL/IO INFORMATION "
    "table).\n"
    "- figure_label: the printed figure number/label if visible (e.g. 'Fig. I-9', "
    "'Figure 4-3'), else null.\n"
    "- caption: a dense 1-3 sentence description a technician could search for — "
    "name the system, components, and what it shows. Include the printed caption "
    "text if present, then expand it. This is the only text that makes the figure "
    "findable, so be specific.\n"
    "- callouts: array of {num, text} for every numbered leader-line callout in the "
    "drawing (e.g. {num:'1', text:'quick disconnect coupling'}). [] if none.\n"
    "Merge boxes that are really one figure. If the page has NO real figure, return "
    'an empty list. Respond ONLY with JSON: {"figures":[...]}.'
)


def analyze_page_figures(
    page_png: bytes, candidate_boxes: Optional[list[list[float]]] = None
) -> list[dict[str, Any]]:
    """Return [{bbox, figure_label, caption, callouts}] for real figures."""
    hint = ""
    if candidate_boxes:
        hint = (
            "\nA layout model proposed these candidate figure boxes (normalized "
            f"[x0,y0,x1,y1]); use them as hints, refine/merge/reject as needed: "
            f"{json.dumps(candidate_boxes)}"
        )
    r = with_retries(
        lambda: _client().chat.completions.create(
            model=get_settings().vision_model,
            temperature=0,
            response_format={"type": "json_object"},
            messages=[
                {"role": "system", "content": _FIGURE_SYS},
                {
                    "role": "user",
                    "content": [
                        {"type": "text", "text": "Extract figures from this page." + hint},
                        _img_part(page_png),
                    ],
                },
            ],
        ),
        what="figure analysis",
    )
    content = r.choices[0].message.content or "{}"
    try:
        data = json.loads(content)
    except json.JSONDecodeError:
        return []
    figs = data.get("figures") or []
    return [
        f
        for f in figs
        if isinstance(f, dict) and f.get("bbox") and _is_real_figure(f)
    ]


# Vision sometimes ignores "return empty list" and emits a box whose own caption
# admits there's no figure. Drop those, plus near-full-page text boxes that carry
# neither a printed figure label nor any callout (a genuine diagram on these
# pages always has one or the other).
_NEGATION = (
    "no technical figure",
    "no figures",
    "no figure",
    "no schematic",
    "no diagram",
    "not a figure",
    "no real figure",
    "consists of text",
)


def _is_real_figure(f: dict[str, Any]) -> bool:
    caption = (f.get("caption") or "").lower()
    if any(p in caption for p in _NEGATION):
        return False
    bbox = f.get("bbox") or [0, 0, 1, 1]
    try:
        x0, y0, x1, y1 = (float(v) for v in bbox)
    except (TypeError, ValueError):
        return False
    area = max(0.0, x1 - x0) * max(0.0, y1 - y0)
    if area >= 0.85 and not f.get("figure_label") and not (f.get("callouts")):
        return False
    return True


_OCR_SYS = (
    "Transcribe ALL readable text from this manual page in natural reading order. "
    "Preserve numbered/lettered list structure and any callout numbers like (1), "
    "(2). Do not summarize, omit, or add commentary. If a region is a figure with "
    "no text, skip it. Respond ONLY with JSON: {\"text\": \"...\"}."
)


def transcribe_page(page_png: bytes) -> str:
    r = with_retries(
        lambda: _client().chat.completions.create(
            model=get_settings().vision_model,
            temperature=0,
            response_format={"type": "json_object"},
            messages=[
                {"role": "system", "content": _OCR_SYS},
                {
                    "role": "user",
                    "content": [
                        {"type": "text", "text": "Transcribe this page."},
                        _img_part(page_png),
                    ],
                },
            ],
        ),
        what="page OCR",
    )
    content = r.choices[0].message.content or "{}"
    try:
        return str(json.loads(content).get("text", "")).strip()
    except json.JSONDecodeError:
        return ""
