import type { Ticket } from "./contract";
import type { Role } from "./role";

// AWAITING_HANDOFF is dispatcher-owned intake: the ticket exists, but the
// dispatcher hasn't released it yet, so it must not reach the tech's board on
// any surface. Kept as one predicate rather than a status check per list —
// every board that forgets it silently leaks work nobody has handed over.
//
// This is posture, not authorization: role is a client cookie, so the API still
// returns every ticket in the org. Real RBAC is v1.
export function visibleToRole(ticket: Ticket, role: Role): boolean {
  return role !== "tech" || ticket.status !== "AWAITING_HANDOFF";
}

export function visibleTickets(tickets: Ticket[], role: Role): Ticket[] {
  return tickets.filter((t) => visibleToRole(t, role));
}
