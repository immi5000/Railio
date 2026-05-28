"""Pydantic mirror of contract/contract.ts. Single source of truth for API I/O."""

from __future__ import annotations

from typing import Any, Literal, Optional

from pydantic import BaseModel, Field

UnitModel = Literal["ES44DC"]
TicketStatus = Literal["AWAITING_TECH", "IN_PROGRESS", "AWAITING_REVIEW", "CLOSED"]
Role = Literal["dispatcher", "tech", "assistant", "system", "tool"]
DocClass = Literal["manual", "tribal_knowledge"]
Severity = Literal["minor", "major", "critical"]


# === Domain ===

class Asset(BaseModel):
    id: int
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
