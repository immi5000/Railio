import { createClient } from "./supabase/client";
import type {
  CreateTicketBody,
  CreateAssetBody,
  AttachDocumentBody,
  DeleteTicketResponse,
  ResetTicketResponse,
  ListCorpusChunksResponse,
  WrapUpDraft,
  FinalizeWrapUpBody,
  Asset,
  Part,
  ParsedFault,
  Ticket,
  TicketDetail,
  CorpusChunk,
  Attachment,
  DocClass,
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
export function fileUrl(path: string | null | undefined): string {
  if (!path) return "";
  if (/^https?:\/\//.test(path)) return path;
  return apiUrl(path);
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
    throw new Error(`${res.status} ${res.statusText}: ${body || path}`);
  }
  return (await res.json()) as T;
}

// === Tickets ===
export async function listTickets(status?: string): Promise<Ticket[]> {
  const q = status ? `?status=${encodeURIComponent(status)}` : "";
  return jsonFetch<Ticket[]>(`/api/tickets${q}`);
}

export async function getTicket(id: number): Promise<TicketDetail> {
  return jsonFetch<TicketDetail>(`/api/tickets/${id}`);
}

export async function createTicket(body: CreateTicketBody): Promise<Ticket> {
  return jsonFetch<Ticket>(`/api/tickets`, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export async function patchTicket(
  id: number,
  patch: Partial<Pick<Ticket, "status">> & Record<string, unknown>,
): Promise<Ticket> {
  return jsonFetch<Ticket>(`/api/tickets/${id}`, {
    method: "PATCH",
    body: JSON.stringify(patch),
  });
}

/** Permanently delete a ticket and all of its messages/parts. */
export async function deleteTicket(id: number): Promise<DeleteTicketResponse> {
  return jsonFetch<DeleteTicketResponse>(`/api/tickets/${id}`, {
    method: "DELETE",
  });
}

/** Demo-only: wipe the chat and restore the ticket to its original state. */
export async function resetTicket(id: number): Promise<ResetTicketResponse> {
  return jsonFetch<ResetTicketResponse>(`/api/tickets/${id}/reset`, {
    method: "POST",
  });
}

/** AI-drafted repair record (summary + notes) for the post-ticket wrap-up. */
export async function getWrapUpDraft(id: number): Promise<WrapUpDraft> {
  return jsonFetch<WrapUpDraft>(`/api/tickets/${id}/wrap-up/draft`);
}

/** File the repair record into the unit's corpus and close the ticket. */
export async function finalizeWrapUp(
  id: number,
  body: FinalizeWrapUpBody,
): Promise<{ chunk_id: number; ticket: TicketDetail }> {
  return jsonFetch<{ chunk_id: number; ticket: TicketDetail }>(
    `/api/tickets/${id}/wrap-up`,
    { method: "POST", body: JSON.stringify(body) },
  );
}

export async function parseFaultDump(
  ticketId: number,
  raw: string,
): Promise<{ parsed: ParsedFault[] }> {
  return jsonFetch(`/api/tickets/${ticketId}/parse-fault-dump`, {
    method: "POST",
    body: JSON.stringify({ raw }),
  });
}

// === Photos ===
export async function uploadPhotos(
  ticketId: number,
  files: File[],
): Promise<{ attachments: Attachment[] }> {
  const fd = new FormData();
  files.forEach((f) => fd.append("files", f));
  const res = await fetch(apiUrl(`/api/tickets/${ticketId}/photos`), {
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

export async function attachAssetDocument(
  assetId: number,
  body: AttachDocumentBody,
): Promise<{ chunk_id: number }> {
  return jsonFetch<{ chunk_id: number }>(`/api/assets/${assetId}/documents`, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

// === Parts ===
export async function listParts(opts?: {
  unit_model?: string;
  q?: string;
}): Promise<Part[]> {
  const params = new URLSearchParams();
  if (opts?.unit_model) params.set("unit_model", opts.unit_model);
  if (opts?.q) params.set("q", opts.q);
  const qs = params.toString();
  return jsonFetch<Part[]>(`/api/parts${qs ? `?${qs}` : ""}`);
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
  q?: string;
  limit?: number;
}): Promise<CorpusChunk[]> {
  const params = new URLSearchParams();
  if (opts?.doc_class) params.set("doc_class", opts.doc_class);
  if (opts?.q) params.set("q", opts.q);
  if (opts?.limit) params.set("limit", String(opts.limit));
  const qs = params.toString();
  const res = await jsonFetch<ListCorpusChunksResponse>(
    `/api/corpus/chunks${qs ? `?${qs}` : ""}`,
  );
  return res.chunks;
}

