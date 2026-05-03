import type {
  CreateTicketBody,
  Form,
  FormType,
  ListCorpusChunksResponse,
  Part,
  ParsedFault,
  ResetTicketResponse,
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

/** Wipe messages/forms/state on a ticket so the demo flow can be re-played. */
export async function resetTicket(id: number): Promise<ResetTicketResponse> {
  return jsonFetch<ResetTicketResponse>(`/api/tickets/${id}/reset`, {
    method: "POST",
  });
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
  });
  if (!res.ok) throw new Error(`Upload failed: ${res.status}`);
  return (await res.json()) as { attachments: Attachment[] };
}

// === Forms ===
export async function listForms(ticketId: number): Promise<Form[]> {
  return jsonFetch<Form[]>(`/api/tickets/${ticketId}/forms`);
}

export async function patchForm(
  ticketId: number,
  formType: FormType,
  payload: Record<string, unknown>,
): Promise<Form> {
  return jsonFetch<Form>(`/api/tickets/${ticketId}/forms/${formType}`, {
    method: "PATCH",
    body: JSON.stringify({ payload }),
  });
}

export async function exportForm(
  ticketId: number,
  formType: FormType,
): Promise<{ pdf_path: string }> {
  return jsonFetch<{ pdf_path: string }>(
    `/api/tickets/${ticketId}/forms/${formType}/export`,
    { method: "POST" },
  );
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

