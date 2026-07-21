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

# 49 CFR §229.23 periodic inspection intervals (days).
# Keep in sync with INSPECTION_INTERVALS in frontend/lib/inspections.ts.
INSPECTION_INTERVALS = {
    "last_92_day_at": ("92-Day", 92),
    "last_368_day_at": ("368-Day", 368),
    "last_1104_day_at": ("1104-Day", 1104),
}


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


class OrgMember(BaseModel):
    id: int
    name: Optional[str] = None
    email: str
    is_self: bool


class OosPeriod(BaseModel):
    id: int
    asset_id: int
    started_at: str  # YYYY-MM-DD, matches oos_since
    ended_at: Optional[str] = None  # NULL while ongoing


class Asset(BaseModel):
    id: int
    org_id: int
    reporting_mark: str
    road_number: str
    unit_model: UnitModel
    in_service_date: Optional[str] = None
    last_92_day_at: Optional[str] = None
    last_368_day_at: Optional[str] = None
    last_1104_day_at: Optional[str] = None
    out_of_service: bool = False
    oos_since: Optional[str] = None
    oos_periods: list[OosPeriod] = Field(default_factory=list)


class HistoricalTest(BaseModel):
    date: Optional[str] = None
    name: str


class HistoricalRecord(BaseModel):
    id: int
    org_id: int
    asset_id: int
    reported_date: Optional[str] = None
    completed_date: Optional[str] = None
    record_type: Optional[str] = None
    repairs: list[str] = []
    tests: list[HistoricalTest] = []
    technician: Optional[str] = None
    notes: Optional[str] = None
    created_at: str


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
    short_id: str
    title: Optional[str] = None
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


class PartLocation(BaseModel):
    location: str
    qty: float
    avg_cost: Optional[float] = None
    value: Optional[float] = None


class Part(BaseModel):
    id: int
    part_number: str
    name: str
    description: Optional[str] = None
    compatible_units: list[UnitModel] = Field(default_factory=list)
    bin_location: Optional[str] = None
    qty_on_hand: int
    supplier: Optional[str] = None
    lead_time_days: Optional[int] = None
    alternate_part_numbers: list[str] = Field(default_factory=list)
    last_used_at: Optional[str] = None
    # External-ledger fields (NetSuite stock ledger).
    avg_cost: Optional[float] = None
    on_hand_value: Optional[float] = None
    locations: list[PartLocation] = Field(default_factory=list)
    department: Optional[str] = None
    subsidiary: Optional[str] = None
    inv_class: Optional[str] = None


class ListPartsResponse(BaseModel):
    parts: list[Part]
    total: int


class TicketPart(BaseModel):
    id: int
    part_id: int
    qty: int
    added_via: Literal["ai_suggestion", "tech_manual"]
    added_at: str


class KnowledgeModel(BaseModel):
    model_code: str
    oem: Optional[str] = None
    chunk_count: int = 0


# Also the payload of the `show_figure` SSE event (contract.ts StreamEvent).
class CorpusFigure(BaseModel):
    path: str
    caption: str = ""
    page: Optional[int] = None
    figure_label: Optional[str] = None
    bbox: Optional[list[float]] = None
    callouts: list[dict[str, str]] = Field(default_factory=list)


class CorpusChunk(BaseModel):
    id: int
    doc_class: DocClass
    doc_id: str
    doc_title: str
    source_label: str
    page: Optional[int] = None
    text: str
    unit_model: Optional[str] = None
    figures: list[CorpusFigure] = Field(default_factory=list)


class TicketDetail(Ticket):
    messages: list[Message] = Field(default_factory=list)
    ticket_parts: list[TicketPart] = Field(default_factory=list)


# === Ticketless copilot conversations ===
# A saved Railio Copilot chat with no ticket. Deliberately NOT in the `messages`
# hash chain — advisory browsing isn't a regulated maintenance record.
# asset_id/unit_model are the last scope used, for restoring the sidebar on
# reload (not authorization — scope is re-derived server-side per request).
class CopilotConversation(BaseModel):
    id: int
    org_id: int
    created_by: str
    title: Optional[str] = None
    asset_id: Optional[int] = None
    unit_model: Optional[str] = None
    created_at: str
    updated_at: str


# Copilot messages reuse the ticket `Message` shape so the SSE pipeline and
# ChatPane render them unchanged. No hash chain, so ticket_id is 0 and
# prev_hash/hash are empty on copilot rows.
class CopilotConversationDetail(CopilotConversation):
    messages: list[Message] = Field(default_factory=list)


# === API request bodies ===

class CreateTicketBody(BaseModel):
    asset_id: int
    title: Optional[str] = None
    initial_symptoms: Optional[str] = None
    initial_error_codes: Optional[str] = None
    fault_dump_raw: Optional[str] = None
    severity: Optional[Severity] = None
    opened_by_role: Literal["dispatcher"]


class SendMessageBody(BaseModel):
    role: Literal["dispatcher", "tech"]
    content: str
    attachment_paths: Optional[list[str]] = None


# A message on the ticketless Railio Copilot. The client names a scope (asset_id
# OR unit_model); the SERVER re-derives it from the JWT org — a client-supplied
# unit_model or org is never trusted. Neither set = general, unscoped chat.
class CopilotMessageBody(BaseModel):
    role: Literal["dispatcher", "tech"]
    content: str
    asset_id: Optional[int] = None
    unit_model: Optional[str] = None
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
    last_92_day_at: Optional[str] = None
    last_368_day_at: Optional[str] = None
    last_1104_day_at: Optional[str] = None
    out_of_service: bool = False
    oos_since: Optional[str] = None


class PatchAssetBody(BaseModel):
    reporting_mark: str
    road_number: str
    unit_model: str
    in_service_date: Optional[str] = None
    last_92_day_at: Optional[str] = None
    last_368_day_at: Optional[str] = None
    last_1104_day_at: Optional[str] = None
    out_of_service: Optional[bool] = None
    oos_since: Optional[str] = None


class WrapUpDraft(BaseModel):
    summary: Optional[str] = None
    notes: Optional[str] = None


class WrapUpPartEntry(BaseModel):
    part_id: int
    qty: int


class FinalizeWrapUpBody(BaseModel):
    summary: str
    notes: Optional[str] = None
    author: Optional[str] = None
    # Parts the tech entered manually at wrap-up. Filed as tech_manual
    # ticket_parts and decremented from inventory (qty_on_hand).
    parts: Optional[list[WrapUpPartEntry]] = None


class CreateHistoricalRecordBody(BaseModel):
    reported_date: Optional[str] = None
    completed_date: Optional[str] = None
    record_type: Optional[str] = None
    repairs: list[str] = []
    tests: list[HistoricalTest] = []
    technician: Optional[str] = None
    notes: Optional[str] = None


class CreatePartBody(BaseModel):
    part_number: str
    name: str
    description: Optional[str] = None
    compatible_units: list[UnitModel] = Field(default_factory=list)
    bin_location: Optional[str] = None
    qty_on_hand: int = 0
    supplier: Optional[str] = None
    lead_time_days: Optional[int] = None
    alternate_part_numbers: list[str] = Field(default_factory=list)
    avg_cost: Optional[float] = None


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
