"""Pydantic mirror of contract/contract.ts. Single source of truth for API I/O."""

from __future__ import annotations

from typing import Any, Literal, Optional

from pydantic import BaseModel, Field

# Unit models are data, not a fixed enum — the dispatcher can add new locomotive
# models, so this is an open string keyed off the assets table.
UnitModel = str
TicketStatus = Literal["AWAITING_TECH", "IN_PROGRESS", "AWAITING_REVIEW", "CLOSED"]
Role = Literal["dispatcher", "tech", "assistant", "system", "tool"]
DocClass = Literal["manual", "tribal_knowledge"]
Severity = Literal["minor", "major", "critical"]


# === Domain ===

class Organization(BaseModel):
    id: int
    name: str
    slug: str
    created_at: Optional[str] = None


class OnboardingBody(BaseModel):
    name: str
    phone: Optional[str] = None
    join_code: Optional[str] = None


class MeResponse(BaseModel):
    id: int
    email: str
    name: Optional[str] = None
    phone: Optional[str] = None
    profile_completed: bool
    org: Optional[Organization] = None
    locked_company: Optional[str] = None


class Asset(BaseModel):
    id: int
    org_id: int
    reporting_mark: str
    road_number: str
    unit_model: UnitModel
    in_service_date: Optional[str] = None
    last_inspection_at: Optional[str] = None


class Citation(BaseModel):
    doc_class: DocClass
    doc_id: str
    page: Optional[int] = None
    source_label: str
    chunk_id: int


class Attachment(BaseModel):
    kind: Literal["image", "pdf"]
    path: str
    mime: str


class ToolCall(BaseModel):
    name: str
    input: dict[str, Any]
    output: dict[str, Any]
    call_id: Optional[str] = None


class ParsedFault(BaseModel):
    code: str
    ts: Optional[str] = None
    severity: Severity
    description: str


class Message(BaseModel):
    id: int
    ticket_id: int
    role: Role
    content: str
    citations: Optional[list[Citation]] = None
    attachments: Optional[list[Attachment]] = None
    tool_calls: Optional[list[ToolCall]] = None
    created_at: str
    prev_hash: Optional[str] = None
    hash: str


class Ticket(BaseModel):
    id: int
    org_id: int
    asset: Asset
    status: TicketStatus
    severity: Severity
    opened_at: str
    initial_error_codes: Optional[str] = None
    initial_symptoms: Optional[str] = None
    fault_dump_raw: Optional[str] = None
    fault_dump_parsed: Optional[list[ParsedFault]] = None
    pre_arrival_summary: Optional[str] = None
    closed_at: Optional[str] = None
    is_pristine: Optional[bool] = None


class Part(BaseModel):
    id: int
    part_number: str
    name: str
    description: Optional[str] = None
    compatible_units: list[UnitModel]
    bin_location: str
    qty_on_hand: int
    supplier: Optional[str] = None
    lead_time_days: Optional[int] = None
    alternate_part_numbers: list[str] = Field(default_factory=list)
    last_used_at: Optional[str] = None


class TicketPart(BaseModel):
    id: int
    part_id: int
    qty: int
    added_via: Literal["ai_suggestion", "tech_manual"]
    added_at: str


class CorpusChunk(BaseModel):
    id: int
    doc_class: DocClass
    doc_id: str
    doc_title: str
    source_label: str
    page: Optional[int] = None
    text: str


class TicketDetail(Ticket):
    messages: list[Message] = Field(default_factory=list)
    ticket_parts: list[TicketPart] = Field(default_factory=list)


# === API request bodies ===

class CreateTicketBody(BaseModel):
    asset_id: int
    initial_symptoms: Optional[str] = None
    initial_error_codes: Optional[str] = None
    fault_dump_raw: Optional[str] = None
    severity: Optional[Severity] = None
    opened_by_role: Literal["dispatcher"]


class SendMessageBody(BaseModel):
    role: Literal["dispatcher", "tech"]
    content: str
    attachment_paths: Optional[list[str]] = None


class PatchTicketBody(BaseModel):
    status: Optional[TicketStatus] = None
    pre_arrival_summary: Optional[str] = None
    severity: Optional[Severity] = None


class CreateAssetBody(BaseModel):
    reporting_mark: str
    road_number: str
    unit_model: str
    in_service_date: Optional[str] = None
    last_inspection_at: Optional[str] = None


class WrapUpDraft(BaseModel):
    summary: Optional[str] = None
    notes: Optional[str] = None


class FinalizeWrapUpBody(BaseModel):
    summary: str
    notes: Optional[str] = None
    author: Optional[str] = None


class AttachDocumentBody(BaseModel):
    # doc_class: "manual" for OEM manuals/wiring; "tribal_knowledge" for history/notes.
    doc_class: DocClass
    doc_title: str
    source_label: str
    text: str
    # When true the doc is scoped to this specific unit (asset_id); otherwise it
    # applies to the whole unit_model (e.g. a shared manual).
    unit_specific: bool = False
    page: Optional[int] = None
