"""Shared helpers for the optional corpus_chunks.figures column.

`figures` is added by the offline manual-ingest tool and may be absent on a DB
that has never ingested an OEM manual. Detect it once so figure-aware queries
degrade gracefully instead of erroring, and normalize the JSONB (asyncpg may
hand it back as a JSON string).
"""

from __future__ import annotations

import json
from typing import Any, Optional

from sqlalchemy import text

_has_figures: Optional[bool] = None
_has_unit_models: Optional[bool] = None


async def figures_supported(session: Any) -> bool:
    global _has_figures
    if _has_figures is None:
        row = (
            await session.execute(
                text(
                    "SELECT 1 FROM information_schema.columns "
                    "WHERE table_name = 'corpus_chunks' AND column_name = 'figures'"
                )
            )
        ).first()
        _has_figures = row is not None
    return _has_figures


async def unit_models_supported(session: Any) -> bool:
    """The optional corpus_chunks.unit_models TEXT[] column (multi-model tagging).
    Added by the offline ingest tool; absent on a DB that never ingested a
    multi-model manual. Detect once so retrieval degrades to the scalar
    unit_model filter instead of erroring."""
    global _has_unit_models
    if _has_unit_models is None:
        row = (
            await session.execute(
                text(
                    "SELECT 1 FROM information_schema.columns "
                    "WHERE table_name = 'corpus_chunks' AND column_name = 'unit_models'"
                )
            )
        ).first()
        _has_unit_models = row is not None
    return _has_unit_models


def parse_figures(value: Any) -> list[dict[str, Any]]:
    if isinstance(value, str):
        try:
            value = json.loads(value)
        except (ValueError, TypeError):
            value = None
    return value or []
