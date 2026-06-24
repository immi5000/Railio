"""Locomotive model-family normalization for corpus retrieval scope.

A ticket's unit_model (e.g. "EMD SD60M") and a chunk's stored model strings
(e.g. "EMD SD60") are compared by *family* — the OEM prefix and any trailing
variant letters are stripped, leaving the base series ("SD60"). Dash-number
suffixes (the "-2" in "GP38-2") are a distinct model generation and are kept.

The same algorithm is mirrored in SQL (search_corpus._sql_family); the test
suite asserts the two implementations agree on a battery of inputs. Keep this
function and that SQL expression in lockstep.
"""

from __future__ import annotations

import re
from typing import Optional

_WS = re.compile(r"\s+")
# Alpha run that follows a digit and sits at the end ("SD60M"→"SD60",
# "ES44DC"→"ES44"). Requires a preceding digit so a dash-number like "-2" and a
# bare alpha series stay intact.
_TRAILING_VARIANT = re.compile(r"(?<=[0-9])[A-Z]+$")


def model_family(s: Optional[str]) -> Optional[str]:
    """Reduce a model string to its core series family.

    "EMD SD60M" -> "SD60"   "EMD GP38-2" -> "GP38-2"   "GE ES44DC" -> "ES44"
    None passes through unchanged (NULL = shared/all in the caller).
    """
    if s is None:
        return None
    f = _WS.sub(" ", s.strip().upper())
    parts = f.split(" ")
    # Drop leading all-alpha OEM tokens (EMD, GE, "GENERAL ELECTRIC"…) but never
    # the series itself: stop while only one token remains.
    while len(parts) > 1 and parts[0].isalpha():
        parts.pop(0)
    f = " ".join(parts)
    return _TRAILING_VARIANT.sub("", f)


def _sql_family(expr: str) -> str:
    """SQL mirror of model_family(): normalize a model string to its core series
    family so a fleet/ticket model matches a manual tagged for a prefix/suffix
    variant (e.g. "EMD SD60M" ~ "SD60"). Kept in lockstep with model_family
    above (asserted by test_model_family against real Postgres)."""
    return (
        "regexp_replace("
        "  regexp_replace("
        "    btrim(regexp_replace(upper(" + expr + "), '\\s+', ' ', 'g')),"
        "  '^([A-Z]+ )+', ''),"
        "'([0-9])[A-Z]+$', '\\1')"
    )
