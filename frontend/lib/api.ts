import { createClient } from "./supabase/client";
import type {
  CreateTicketBody,
  CreateAssetBody,
  PatchAssetBody,
  AttachDocumentBody,
  HistoricalRecord,
  CreateHistoricalRecordBody,
  DeleteTicketResponse,
  ResetTicketResponse,
  ListCorpusChunksResponse,
  ListCorpusDocumentsResponse,
  CorpusDocument,
  WrapUpDraft,
  FinalizeWrapUpBody,
  Asset,
  Part,
  ListPartsResponse,
  CreatePartBody,
  ParsedFault,
  Ticket,
  TicketDetail,
  CorpusChunk,
  KnowledgeModel,
  Attachment,
  DocClass,
  Organization,
  OnboardingBody,
  MeResponse,
  OrgMember,
} from "./contract";

export const API_BASE =
  process.env.NEXT_PUBLIC_API_BASE || "http://localhost:3001";

export function apiUrl(path: string) {
  return `${API_BASE}${path.startsWith("/") ? path : `/${path}`}`;
}

/**
 * Legacy org-slug hint sent as X-Org-Id. The backend now derives the tenant
 * from the verified Supabase JWT and IGNORES this header — it is kept only for
 * back-compat and carries no authority. The real tenant is the signed-in user's
 * org (see authHeaders / the backend get_current_org).
 */
export function currentOrgSlug(): string {
  if (typeof document !== "undefined") {
    const m = document.cookie.match(/(?:^|;\s*)railio_org=([^;]+)/);
    if (m) return decodeURIComponent(m[1]);
  }
  return process.env.NEXT_PUBLIC_DEFAULT_ORG || "demo-rail";
}

/** Headers that scope a request to the current org. Merge into every fetch. */
export function orgHeaders(): Record<string, string> {
  return { "X-Org-Id": currentOrgSlug() };
}

/**
 * Auth + org headers for an API request. The Supabase access token is the
 * source of truth for the tenant (the backend ignores X-Org-Id); X-Org-Id is
 * kept only for back-compat. Async because the token is read from the session.
 */
export async function authHeaders(): Promise<Record<string, string>> {
  const headers: Record<string, string> = { ...orgHeaders() };
  try {
    const { data } = await createClient().auth.getSession();
    const token = data.session?.access_token;
    if (token) headers["Authorization"] = `Bearer ${token}`;
  } catch {
    // No session / Supabase not configured — request goes out unauthenticated
    // and the backend will answer 401, which callers surface as a sign-in nudge.
  }
  return headers;
}

/** Resolve a backend-stored path (e.g. /uploads/foo.jpg) into a fully-qualified URL the browser can load. */
// Returns undefined (not "") for a missing path so React drops the src/href
// attribute entirely — an empty string triggers the browser's "empty src"
// warning and a wasteful re-request of the current page.
export function fileUrl(path: string | null | undefined): string | undefined {
  if (!path) return undefined;
  if (/^https?:\/\//.test(path)) return path;
  return apiUrl(path);
}

/** Carries the HTTP status so callers can branch (e.g. 409 = onboarding needed). */
export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

async function jsonFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(apiUrl(path), {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(await authHeaders()),
      ...(init?.headers || {}),
    },
  });
  if (!res.ok) {
    let body = "";
    try {
      body = await res.text();
    } catch {}
    throw new ApiError(res.status, `${res.status} ${res.statusText}: ${body || path}`);
  }
  return (await res.json()) as T;
}

// === Tickets ===
export async function listTickets(status?: string): Promise<Ticket[]> {
  const q = status ? `?status=${encodeURIComponent(status)}` : "";
  return jsonFetch<Ticket[]>(`/api/tickets${q}`);
}

// Ticket lookups use the public short_id (string); the numeric id is internal.
export async function getTicket(ref: string): Promise<TicketDetail> {
  return jsonFetch<TicketDetail>(`/api/tickets/${ref}`);
}

export async function createTicket(body: CreateTicketBody): Promise<Ticket> {
  return jsonFetch<Ticket>(`/api/tickets`, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export async function patchTicket(
  ref: string,
  patch: Partial<Pick<Ticket, "status">> & Record<string, unknown>,
): Promise<Ticket> {
  return jsonFetch<Ticket>(`/api/tickets/${ref}`, {
    method: "PATCH",
    body: JSON.stringify(patch),
  });
}

/** Permanently delete a ticket and all of its messages/parts. */
export async function deleteTicket(ref: string): Promise<DeleteTicketResponse> {
  return jsonFetch<DeleteTicketResponse>(`/api/tickets/${ref}`, {
    method: "DELETE",
  });
}

/** Demo-only: wipe the chat and restore the ticket to its original state. */
export async function resetTicket(ref: string): Promise<ResetTicketResponse> {
  return jsonFetch<ResetTicketResponse>(`/api/tickets/${ref}/reset`, {
    method: "POST",
  });
}

/** AI-drafted repair record (summary + notes) for the post-ticket wrap-up. */
export async function getWrapUpDraft(ref: string): Promise<WrapUpDraft> {
  return jsonFetch<WrapUpDraft>(`/api/tickets/${ref}/wrap-up/draft`);
}

/** File the repair record into the unit's corpus and close the ticket. */
export async function finalizeWrapUp(
  ref: string,
  body: FinalizeWrapUpBody,
): Promise<{ chunk_id: number; ticket: TicketDetail }> {
  return jsonFetch<{ chunk_id: number; ticket: TicketDetail }>(
    `/api/tickets/${ref}/wrap-up`,
    { method: "POST", body: JSON.stringify(body) },
  );
}

export async function parseFaultDump(
  ref: string,
  raw: string,
): Promise<{ parsed: ParsedFault[] }> {
  return jsonFetch(`/api/tickets/${ref}/parse-fault-dump`, {
    method: "POST",
    body: JSON.stringify({ raw }),
  });
}

// === Photos ===
export async function uploadPhotos(
  ref: string,
  files: File[],
): Promise<{ attachments: Attachment[] }> {
  const fd = new FormData();
  files.forEach((f) => fd.append("files", f));
  const res = await fetch(apiUrl(`/api/tickets/${ref}/photos`), {
    method: "POST",
    body: fd,
    headers: await authHeaders(),
  });
  if (!res.ok) throw new Error(`Upload failed: ${res.status}`);
  return (await res.json()) as { attachments: Attachment[] };
}

// === Assets (fleet roster) ===
export async function listAssets(): Promise<Asset[]> {
  return jsonFetch<Asset[]>(`/api/assets`);
}

export async function createAsset(body: CreateAssetBody): Promise<Asset> {
  return jsonFetch<Asset>(`/api/assets`, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export async function patchAsset(
  assetId: number,
  body: PatchAssetBody,
): Promise<Asset> {
  return jsonFetch<Asset>(`/api/assets/${assetId}`, {
    method: "PATCH",
    body: JSON.stringify(body),
  });
}

export async function attachAssetDocument(
  assetId: number,
  body: AttachDocumentBody,
): Promise<{ chunk_id: number }> {
  return jsonFetch<{ chunk_id: number }>(`/api/assets/${assetId}/documents`, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export async function listHistoricalRecords(
  assetId: number,
): Promise<HistoricalRecord[]> {
  return jsonFetch<HistoricalRecord[]>(`/api/assets/${assetId}/history`);
}

export async function createHistoricalRecord(
  assetId: number,
  body: CreateHistoricalRecordBody,
): Promise<HistoricalRecord> {
  return jsonFetch<HistoricalRecord>(`/api/assets/${assetId}/history`, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export async function updateHistoricalRecord(
  assetId: number,
  recordId: number,
  body: CreateHistoricalRecordBody,
): Promise<HistoricalRecord> {
  return jsonFetch<HistoricalRecord>(
    `/api/assets/${assetId}/history/${recordId}`,
    {
      method: "PATCH",
      body: JSON.stringify(body),
    },
  );
}

// === Parts ===
export async function listParts(opts?: {
  unit_model?: string;
  q?: string;
  limit?: number;
  offset?: number;
}): Promise<ListPartsResponse> {
  const params = new URLSearchParams();
  if (opts?.unit_model) params.set("unit_model", opts.unit_model);
  if (opts?.q) params.set("q", opts.q);
  if (opts?.limit != null) params.set("limit", String(opts.limit));
  if (opts?.offset != null) params.set("offset", String(opts.offset));
  const qs = params.toString();
  return jsonFetch<ListPartsResponse>(`/api/parts${qs ? `?${qs}` : ""}`);
}

// Full catalog as a flat array — for callers that build a part_id → Part lookup
// (e.g. resolving a ticket's used parts), which must see every part regardless
// of the paginated table's page.
export async function listAllParts(opts?: {
  unit_model?: string;
  q?: string;
}): Promise<Part[]> {
  const res = await listParts({ ...opts, limit: 10000 });
  return res.parts;
}

export async function createPart(body: CreatePartBody): Promise<Part> {
  return jsonFetch<Part>(`/api/parts`, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export async function patchPart(id: number, patch: Partial<Part>): Promise<Part> {
  return jsonFetch<Part>(`/api/parts/${id}`, {
    method: "PATCH",
    body: JSON.stringify(patch),
  });
}

// === Corpus chunk (citation click-through) ===
export async function getCorpusChunk(id: number): Promise<CorpusChunk> {
  return jsonFetch<CorpusChunk>(`/api/corpus/chunks/${id}`);
}

/** Browse the full knowledge library (manuals + tribal notes). */
export async function listCorpusChunks(opts?: {
  doc_class?: DocClass;
  doc_id?: string;
  q?: string;
  limit?: number;
}): Promise<CorpusChunk[]> {
  const params = new URLSearchParams();
  if (opts?.doc_class) params.set("doc_class", opts.doc_class);
  if (opts?.doc_id) params.set("doc_id", opts.doc_id);
  if (opts?.q) params.set("q", opts.q);
  if (opts?.limit) params.set("limit", String(opts.limit));
  const qs = params.toString();
  const res = await jsonFetch<ListCorpusChunksResponse>(
    `/api/corpus/chunks${qs ? `?${qs}` : ""}`,
  );
  return res.chunks;
}

/** The Knowledge library as source documents (one per CFR part / manual / note set). */
export async function listCorpusDocuments(): Promise<CorpusDocument[]> {
  const res = await jsonFetch<ListCorpusDocumentsResponse>(
    `/api/corpus/documents`,
  );
  return res.documents;
}

/** Locomotive models that have ingested knowledge — drives the add-asset model picker. */
export async function listKnowledgeModels(): Promise<KnowledgeModel[]> {
  const res = await jsonFetch<{ models: KnowledgeModel[] }>(
    `/api/corpus/models`,
  );
  return res.models;
}

// === Users / onboarding ===
export async function getMe(): Promise<MeResponse> {
  return jsonFetch<MeResponse>(`/api/me`);
}

/** Onboarded users in the caller's org — drives the dashboard team roster. */
export async function listOrgMembers(): Promise<OrgMember[]> {
  return jsonFetch<OrgMember[]>(`/api/org/members`);
}

export async function completeOnboarding(
  body: OnboardingBody,
): Promise<{ org: Organization | null }> {
  return jsonFetch<{ org: Organization | null }>(`/api/onboarding`, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

