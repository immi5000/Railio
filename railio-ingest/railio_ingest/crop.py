"""Crop a normalized bbox out of a rendered page PNG → PNG bytes."""

from __future__ import annotations

import io

from PIL import Image


def crop_bbox(page_png: bytes, bbox: list[float], pad: float = 0.01) -> bytes:
    """bbox is normalized [x0,y0,x1,y1] in 0..1. Small pad avoids edge-clipping
    leader-line labels. Returns PNG bytes."""
    img = Image.open(io.BytesIO(page_png)).convert("RGB")
    W, H = img.width, img.height
    x0, y0, x1, y1 = bbox
    x0 = max(0.0, min(1.0, x0 - pad))
    y0 = max(0.0, min(1.0, y0 - pad))
    x1 = max(0.0, min(1.0, x1 + pad))
    y1 = max(0.0, min(1.0, y1 + pad))
    box = (int(x0 * W), int(y0 * H), int(x1 * W), int(y1 * H))
    if box[2] <= box[0] or box[3] <= box[1]:
        box = (0, 0, W, H)
    out = io.BytesIO()
    img.crop(box).save(out, format="PNG")
    return out.getvalue()
