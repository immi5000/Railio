// A ChatSession names the handful of things that vary between the ticket chat
// and the ticketless copilot, so ChatPane can drive both without forking. Every
// hard-wired coupling ChatPane used to have on `ticketId` is one of these.

import { getCopilotConversation, getTicket } from "@/lib/api";
import type { Message, TicketDetail } from "@/lib/contract";

// The scope the copilot chat is bound to. Both null = general, unscoped chat.
export type CopilotScope = {
  assetId: number | null;
  unitModel: string | null;
};

export type ChatSession = {
  /** React Query key for this conversation's message list. */
  queryKey: readonly unknown[];
  /** Fetch persisted history. */
  fetchMessages: () => Promise<Message[]>;
  /** SSE endpoint path for a send (passed to apiUrl). */
  sendUrl: string;
  /** Extra fields merged into the send body (copilot: the selected scope). */
  sendBody?: Record<string, unknown>;
  /** Upload target ref; null means uploads are unsupported (hides PhotoUpload). */
  uploadRef: string | null;
  /** Empty-state "TRY ASKING" chips. */
  suggestions: string[];
  /**
   * True for the ticket chat: message events invalidate ["tickets"] and the
   * ["ticket", id] detail so status pills / CTAs refresh. False for the copilot,
   * which has no ticket to refresh.
   */
  invalidatesTickets: boolean;
};

// Suggested starter questions, seeded from the ticket's fault code. Moved out of
// ChatPane because ChatPane no longer holds the TicketDetail — only Message[].
export function buildTicketSuggestions(
  ticket: TicketDetail | undefined,
): string[] {
  if (!ticket) return [];
  const firstParsed = ticket.fault_dump_parsed?.[0]?.code;
  const firstInitial = ticket.initial_error_codes
    ?.split(",")
    .map((s) => s.trim())
    .filter(Boolean)[0];
  const code = firstParsed || firstInitial;
  const codeRef = code ? `fault ${code}` : "these symptoms";
  return [
    "Give me a full briefing on this ticket.",
    `What's the most likely root cause of ${codeRef}?`,
    `What does the manual say about ${codeRef}?`,
    "Are there senior-tech notes for this kind of issue?",
    "What parts should I bring? Show bin locations.",
  ];
}

// The ticket chat session. The message list caches under a KEY DISTINCT from the
// ["ticket", ref] detail key that WorkspaceShell/RepairContext own — writing
// Message[] to the detail key would corrupt the sidebar's TicketDetail object.
export function ticketSession(
  ticket: TicketDetail | undefined,
  ref: string,
): ChatSession {
  return {
    queryKey: ["ticket", ref, "messages"],
    fetchMessages: async () => (await getTicket(ref)).messages,
    sendUrl: `/api/tickets/${ref}/messages`,
    uploadRef: ref,
    suggestions: buildTicketSuggestions(ticket),
    invalidatesTickets: true,
  };
}

// Scope-aware starter chips for the ticketless copilot. Unscoped chat needs the
// most guidance, since the user has the least context on what it can do.
function buildCopilotSuggestions(scope: CopilotScope): string[] {
  if (scope.assetId) {
    return [
      "Is this unit due for any FRA inspection?",
      "What's the maintenance history on this unit?",
      "What parts do we stock for this model?",
      "Walk me through a common fault for this locomotive.",
    ];
  }
  if (scope.unitModel) {
    return [
      "What does the manual say about the traction system?",
      "What parts do we stock for this model?",
      "What are the periodic inspection intervals?",
    ];
  }
  return [
    "Which units are out of service right now?",
    "How do the FRA periodic inspections work?",
    "What can you help me with?",
  ];
}

// The ticketless copilot session. Uploads are unsupported (no ticket to attach a
// photo to), and message events never touch the tickets cache. The selected
// scope rides on every send in sendBody, where the backend re-derives it.
export function copilotSession(
  conversationId: number,
  scope: CopilotScope,
): ChatSession {
  return {
    queryKey: ["copilot", conversationId, "messages"],
    fetchMessages: async () =>
      (await getCopilotConversation(conversationId)).messages,
    sendUrl: `/api/copilot/conversations/${conversationId}/messages`,
    sendBody: { asset_id: scope.assetId, unit_model: scope.unitModel },
    uploadRef: null,
    suggestions: buildCopilotSuggestions(scope),
    invalidatesTickets: false,
  };
}
