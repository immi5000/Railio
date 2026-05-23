"""FRA-style form PDFs via reportlab."""

from __future__ import annotations

import io
from typing import Any

from reportlab.lib import colors
from reportlab.lib.colors import HexColor
from reportlab.lib.pagesizes import LETTER
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import inch
from reportlab.platypus import (
    Paragraph,
    SimpleDocTemplate,
    Spacer,
    Table,
    TableStyle,
)

from .contract import FormType
from .storage import upload_to_bucket

_INSPECTION_TYPE_LABEL = {
    "92_day": "92-Day Periodic Inspection",
    "annual": "Annual Inspection",
    "biennial": "Biennial Inspection",
    "after_repair": "After-Repair Inspection",
}


def _styles() -> dict[str, ParagraphStyle]:
    base = getSampleStyleSheet()
    return {
        "agency": ParagraphStyle(
            "agency", parent=base["Normal"], fontName="Helvetica-Bold", fontSize=9
        ),
        "form_no": ParagraphStyle(
            "form_no", parent=base["Normal"], fontName="Helvetica-Bold", fontSize=10
        ),
        "title": ParagraphStyle(
            "title",
            parent=base["Normal"],
            fontName="Helvetica-Bold",
            fontSize=14,
            spaceBefore=4,
        ),
        "subtitle": ParagraphStyle(
            "subtitle",
            parent=base["Normal"],
            fontSize=8,
            textColor=HexColor("#444444"),
        ),
        "notice": ParagraphStyle(
            "notice",
            parent=base["Normal"],
            fontSize=7,
            textColor=HexColor("#666666"),
            spaceBefore=4,
        ),
        "sect": ParagraphStyle(
            "sect",
            parent=base["Normal"],
            fontName="Helvetica-Bold",
            fontSize=9,
            backColor=colors.black,
            textColor=colors.white,
            spaceBefore=10,
            spaceAfter=4,
            leftIndent=4,
            rightIndent=4,
            leading=12,
        ),
        "kv_k": ParagraphStyle(
            "kv_k",
            parent=base["Normal"],
            fontSize=7,
            textColor=HexColor("#666666"),
        ),
        "kv_v": ParagraphStyle("kv_v", parent=base["Normal"], fontSize=10),
        "small": ParagraphStyle(
            "small",
            parent=base["Normal"],
            fontSize=7,
            textColor=HexColor("#888888"),
            alignment=1,
            spaceBefore=16,
        ),
        "body": ParagraphStyle("body", parent=base["Normal"], fontSize=9),
    }


def _kv_table(pairs: list[tuple[str, str]]) -> Table:
    s = _styles()
    rows = []
    for label, value in pairs:
        rows.append(
            [
                Paragraph(label, s["kv_k"]),
                Paragraph(value or "—", s["kv_v"]),
            ]
        )
    t = Table(rows, colWidths=[1.5 * inch, 5.0 * inch])
    t.setStyle(
        TableStyle(
            [
                ("LINEBELOW", (1, 0), (1, -1), 0.5, HexColor("#888888")),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 2),
                ("TOPPADDING", (0, 0), (-1, -1), 2),
            ]
        )
    )
    return t


def _section_header(text: str) -> Paragraph:
    return Paragraph(text.upper(), _styles()["sect"])


def _result_label(result: str) -> str:
    return {"pass": "PASS", "fail": "FAIL", "na": "N/A"}.get(result, result.upper())


def _result_color(result: str):
    return {
        "pass": HexColor("#1f7a3a"),
        "fail": HexColor("#a31b1b"),
        "na": HexColor("#888888"),
    }.get(result, colors.grey)


def _items_table(items: list[dict[str, Any]], cfr_key: str) -> Table:
    """Render an inspection-items table. cfr_key picks 'code' or 'cfr_ref'."""
    header = [
        Paragraph("<b>CFR §</b>", _styles()["body"]),
        Paragraph("<b>Item</b>", _styles()["body"]),
        Paragraph("<b>Result</b>", _styles()["body"]),
        Paragraph("<b>Note</b>", _styles()["body"]),
    ]
    rows = [header]
    style_cmds: list[tuple[Any, ...]] = [
        ("BACKGROUND", (0, 0), (-1, 0), HexColor("#eeeeee")),
        ("BOX", (0, 0), (-1, -1), 0.5, colors.black),
        ("INNERGRID", (0, 0), (-1, -1), 0.25, HexColor("#cccccc")),
        ("FONTSIZE", (0, 0), (-1, -1), 8),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("LEFTPADDING", (0, 0), (-1, -1), 3),
        ("RIGHTPADDING", (0, 0), (-1, -1), 3),
        ("TOPPADDING", (0, 0), (-1, -1), 3),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 3),
    ]
    for i, it in enumerate(items, start=1):
        cfr = str(it.get(cfr_key, ""))
        label = str(it.get("label", ""))
        result = str(it.get("result", "na"))
        note = str(it.get("note") or "")
        rows.append(
            [
                Paragraph(cfr, _styles()["body"]),
                Paragraph(label, _styles()["body"]),
                Paragraph(
                    f"<b>{_result_label(result)}</b>", _styles()["body"]
                ),
                Paragraph(note, _styles()["body"]),
            ]
        )
        style_cmds.append(("TEXTCOLOR", (2, i), (2, i), _result_color(result)))
    t = Table(rows, colWidths=[0.7 * inch, 3.5 * inch, 0.7 * inch, 1.6 * inch])
    t.setStyle(TableStyle(style_cmds))
    return t


def _signature_block(name: str | None, signed_at: str | None) -> Table:
    s = _styles()
    rows = [
        [
            Paragraph("Inspector signature", s["kv_k"]),
            Paragraph("Date signed", s["kv_k"]),
        ],
        [
            Paragraph(name or "", s["kv_v"]),
            Paragraph(signed_at or "", s["kv_v"]),
        ],
    ]
    t = Table(rows, colWidths=[3.25 * inch, 3.25 * inch])
    t.setStyle(
        TableStyle(
            [
                ("LINEABOVE", (0, 0), (-1, 0), 1, colors.black),
                ("LINEBELOW", (0, 1), (-1, 1), 0.5, colors.black),
                ("TOPPADDING", (0, 0), (-1, -1), 6),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 16),
            ]
        )
    )
    return t


def _render_f6180_49a(p: dict[str, Any]) -> bytes:
    s = _styles()
    buf = io.BytesIO()
    doc = SimpleDocTemplate(
        buf,
        pagesize=LETTER,
        leftMargin=36,
        rightMargin=36,
        topMargin=36,
        bottomMargin=36,
        title="FRA F 6180.49A",
    )

    story: list[Any] = []
    story.append(Paragraph("U.S. DEPARTMENT OF TRANSPORTATION", s["agency"]))
    story.append(Paragraph("FEDERAL RAILROAD ADMINISTRATION", s["agency"]))
    story.append(Paragraph("FRA F 6180.49A", s["form_no"]))
    story.append(Paragraph("Locomotive Inspection and Repair Record", s["title"]))
    story.append(Paragraph("49 CFR Part 229 — Subpart B", s["subtitle"]))
    story.append(
        Paragraph(
            "This form is rendered by Railio for demo purposes. Production use should fill the "
            "official FRA blank PDF (OMB control number 2130-0004).",
            s["notice"],
        )
    )
    story.append(Spacer(1, 8))

    story.append(_section_header("A. Locomotive Identification"))
    story.append(
        _kv_table(
            [
                ("Reporting mark", p.get("reporting_mark", "")),
                ("Road number", p.get("road_number", "")),
                ("Unit model", p.get("unit_model", "")),
                ("Build date", p.get("build_date") or ""),
            ]
        )
    )

    story.append(_section_header("B. Inspection Details"))
    story.append(
        _kv_table(
            [
                (
                    "Inspection type",
                    _INSPECTION_TYPE_LABEL.get(
                        p.get("inspection_type", ""), str(p.get("inspection_type", ""))
                    ),
                ),
                ("Inspection date", p.get("inspection_date", "")),
                ("Previous inspection", p.get("previous_inspection_date") or ""),
                ("Place inspected", p.get("place_inspected", "")),
                ("Inspector name", p.get("inspector_name", "")),
                ("Qualification", p.get("inspector_qualification") or ""),
            ]
        )
    )

    items = p.get("items") or []
    if items:
        story.append(_section_header(f"C. Inspection Items ({len(items)})"))
        story.append(_items_table(items, cfr_key="code"))

    story.append(_section_header("D. Defects Discovered"))
    defects = p.get("defects") or []
    if not defects:
        story.append(Paragraph("None recorded.", s["body"]))
    else:
        rows = [
            [
                Paragraph("<b>FRA §</b>", s["body"]),
                Paragraph("<b>Description</b>", s["body"]),
                Paragraph("<b>Location</b>", s["body"]),
                Paragraph("<b>Severity</b>", s["body"]),
            ]
        ]
        for d in defects:
            rows.append(
                [
                    Paragraph(str(d.get("fra_part", "")), s["body"]),
                    Paragraph(str(d.get("description", "")), s["body"]),
                    Paragraph(str(d.get("location", "")), s["body"]),
                    Paragraph(str(d.get("severity", "")), s["body"]),
                ]
            )
        t = Table(rows, colWidths=[0.7 * inch, 3.5 * inch, 1.6 * inch, 0.7 * inch])
        t.setStyle(
            TableStyle(
                [
                    ("BACKGROUND", (0, 0), (-1, 0), HexColor("#eeeeee")),
                    ("BOX", (0, 0), (-1, -1), 0.5, colors.black),
                    ("INNERGRID", (0, 0), (-1, -1), 0.25, HexColor("#cccccc")),
                    ("FONTSIZE", (0, 0), (-1, -1), 8),
                ]
            )
        )
        story.append(t)

    story.append(_section_header("E. Repairs Performed"))
    repairs = p.get("repairs") or []
    if not repairs:
        story.append(Paragraph("None recorded.", s["body"]))
    else:
        rows = [
            [
                Paragraph("<b>Description</b>", s["body"]),
                Paragraph("<b>Parts replaced</b>", s["body"]),
                Paragraph("<b>Completed</b>", s["body"]),
            ]
        ]
        for r in repairs:
            rows.append(
                [
                    Paragraph(str(r.get("description", "")), s["body"]),
                    Paragraph(", ".join(r.get("parts_replaced") or []), s["body"]),
                    Paragraph(str(r.get("completed_at", "")), s["body"]),
                ]
            )
        t = Table(rows, colWidths=[3.5 * inch, 2.0 * inch, 1.0 * inch])
        t.setStyle(
            TableStyle(
                [
                    ("BACKGROUND", (0, 0), (-1, 0), HexColor("#eeeeee")),
                    ("BOX", (0, 0), (-1, -1), 0.5, colors.black),
                    ("INNERGRID", (0, 0), (-1, -1), 0.25, HexColor("#cccccc")),
                    ("FONTSIZE", (0, 0), (-1, -1), 8),
                ]
            )
        )
        story.append(t)

    abt = p.get("air_brake_test")
    if abt:
        story.append(_section_header("F. Air-Brake Test"))
        readings = abt.get("readings") or {}
        readings_str = "  ·  ".join(f"{k}={v}" for k, v in readings.items()) or "—"
        story.append(
            _kv_table(
                [
                    ("Test type", str(abt.get("test_type", ""))),
                    ("Result", "PASS" if abt.get("pass") else "FAIL"),
                    ("Readings", readings_str),
                ]
            )
        )

    story.append(_section_header("G. Status"))
    oos = "YES — bad-ordered" if p.get("out_of_service") else "No — in service"
    pairs = [("Out of service", oos)]
    if p.get("out_of_service") and p.get("out_of_service_at"):
        pairs.append(("Out-of-service at", p["out_of_service_at"]))
    if p.get("returned_to_service_at"):
        pairs.append(("Returned to service", p["returned_to_service_at"]))
    story.append(_kv_table(pairs))

    story.append(_section_header("H. Certification"))
    sig = p.get("signature") or {}
    story.append(_signature_block(sig.get("name"), sig.get("signed_at")))

    story.append(
        Paragraph(
            "Rendered by Railio · Form layout based on FRA F 6180.49A", s["small"]
        )
    )

    doc.build(story)
    return buf.getvalue()


def _render_daily_229_21(p: dict[str, Any]) -> bytes:
    s = _styles()
    buf = io.BytesIO()
    doc = SimpleDocTemplate(
        buf,
        pagesize=LETTER,
        leftMargin=36,
        rightMargin=36,
        topMargin=36,
        bottomMargin=36,
        title="Daily Inspection §229.21",
    )

    story: list[Any] = []
    story.append(Paragraph("DAILY LOCOMOTIVE INSPECTION RECORD", s["agency"]))
    story.append(Paragraph("Required by 49 CFR §229.21", s["subtitle"]))
    story.append(Paragraph("§ 229.21", s["form_no"]))
    story.append(
        Paragraph(
            "One inspection per locomotive per calendar day. Performed by a qualified person. "
            "Defects noted shall be repaired or the locomotive removed from service per §229.9.",
            s["notice"],
        )
    )
    story.append(Spacer(1, 8))

    unit = p.get("unit") or {}
    story.append(_section_header("A. Unit & Inspection"))
    story.append(
        _kv_table(
            [
                ("Reporting mark", unit.get("reporting_mark", "")),
                ("Road number", unit.get("road_number", "")),
                ("Unit model", unit.get("unit_model", "")),
                ("Inspected at", p.get("inspected_at", "")),
                ("Place", p.get("place_inspected") or ""),
                ("Previous daily", p.get("previous_daily_inspection_at") or ""),
                ("Inspector name", p.get("inspector_name", "")),
                ("Qualification", p.get("inspector_qualification") or ""),
            ]
        )
    )

    items = p.get("items") or []
    story.append(_section_header(f"B. Inspection Items ({len(items)})"))
    story.append(_items_table(items, cfr_key="cfr_ref"))

    failed = [i for i in items if i.get("result") == "fail"]
    title = "C. Exceptions / Bad-Order Items"
    if failed:
        title += f" ({len(failed)} failed)"
    story.append(_section_header(title))
    exceptions = p.get("exceptions") or []
    if exceptions:
        for e in exceptions:
            story.append(Paragraph(f"• {e}", s["body"]))
    else:
        story.append(Paragraph("None.", s["body"]))

    story.append(_section_header("D. Certification"))
    sig = p.get("signature") or {}
    story.append(_signature_block(sig.get("name"), sig.get("signed_at")))

    story.append(
        Paragraph(
            "Rendered by Railio · Checklist derived from 49 CFR §229.21 and cross-referenced sections",
            s["small"],
        )
    )

    doc.build(story)
    return buf.getvalue()


async def render_form_pdf(
    ticket_id: int, form_type: FormType, payload: dict[str, Any]
) -> str:
    if form_type == "F6180_49A":
        body = _render_f6180_49a(payload)
    elif form_type == "DAILY_INSPECTION_229_21":
        body = _render_daily_229_21(payload)
    else:
        raise ValueError(f"unknown form_type: {form_type}")

    storage_key = f"{ticket_id}/forms/{form_type}.pdf"
    return upload_to_bucket(storage_key, body, "application/pdf")
