"""Form field-path validator + applier."""

from __future__ import annotations

import copy
import re
from typing import Any

from .contract import FormType

_ALLOWED: dict[str, list[str]] = {
    "F6180_49A": [
        "reporting_mark",
        "road_number",
        "unit_model",
        "build_date",
        "inspection_type",
        "inspection_date",
        "previous_inspection_date",
        "place_inspected",
        "inspector_name",
        "inspector_qualification",
        "items[]",
        "items[].code",
        "items[].label",
        "items[].result",
        "items[].note",
        "defects[]",
        "defects[].fra_part",
        "defects[].description",
        "defects[].location",
        "defects[].severity",
        "repairs[]",
        "repairs[].description",
        "repairs[].parts_replaced",
        "repairs[].completed_at",
        "air_brake_test",
        "air_brake_test.test_type",
        "air_brake_test.pass",
        "air_brake_test.readings",
        "out_of_service",
        "out_of_service_at",
        "returned_to_service_at",
        "signature",
        "signature.name",
        "signature.signed_at",
    ],
    "DAILY_INSPECTION_229_21": [
        "unit.reporting_mark",
        "unit.road_number",
        "unit.unit_model",
        "inspector_name",
        "inspector_qualification",
        "inspected_at",
        "place_inspected",
        "previous_daily_inspection_at",
        "items[]",
        "items[].code",
        "items[].cfr_ref",
        "items[].label",
        "items[].result",
        "items[].note",
        "items[].photo_path",
        "exceptions",
        "signature",
        "signature.name",
        "signature.signed_at",
    ],
}

_INDEX_RE = re.compile(r"\[(\d+)\]")


def validate_field_path(form_type: FormType, path: str) -> bool:
    template = _INDEX_RE.sub("[]", path)
    return template in _ALLOWED.get(form_type, [])


def apply_field_path(payload: dict[str, Any], path: str, value: Any) -> dict[str, Any]:
    """Set value at path on a deep-cloned payload. Grows arrays/dicts as needed."""
    tokens: list[str | int] = []
    for part in path.split("."):
        # Split "items[0][1]" into head "items" + numeric indices
        indices = [int(m) for m in _INDEX_RE.findall(part)]
        head = _INDEX_RE.sub("", part)
        if head:
            tokens.append(head)
        for i in indices:
            tokens.append(i)

    root = copy.deepcopy(payload)
    cursor: Any = root
    for i in range(len(tokens) - 1):
        t = tokens[i]
        nxt = tokens[i + 1]
        if isinstance(cursor, list):
            assert isinstance(t, int)
            while len(cursor) <= t:
                cursor.append([] if isinstance(nxt, int) else {})
            if cursor[t] is None:
                cursor[t] = [] if isinstance(nxt, int) else {}
            cursor = cursor[t]
        else:
            assert isinstance(t, str)
            if cursor.get(t) is None:
                cursor[t] = [] if isinstance(nxt, int) else {}
            cursor = cursor[t]
    last = tokens[-1]
    if isinstance(cursor, list):
        assert isinstance(last, int)
        while len(cursor) <= last:
            cursor.append(None)
        cursor[last] = value
    else:
        cursor[last] = value
    return root
