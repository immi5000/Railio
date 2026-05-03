import type { TicketStatus } from "./contract";

export function formatDate(iso: string | null | undefined) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function formatDateOnly(iso: string | null | undefined) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

export function statusLabel(s: TicketStatus): string {
  switch (s) {
    case "AWAITING_TECH":
      return "Awaiting tech";
    case "IN_PROGRESS":
      return "In progress";
    case "AWAITING_REVIEW":
      return "Awaiting review";
    case "CLOSED":
      return "Closed";
  }
}

export function statusPillClass(s: TicketStatus): string {
  switch (s) {
    case "AWAITING_TECH":
      return "pill pill-warn";
    case "IN_PROGRESS":
      return "pill pill-blue";
    case "AWAITING_REVIEW":
      return "pill pill-soft";
    case "CLOSED":
      return "pill";
  }
}

export function severityClass(s: "minor" | "major" | "critical"): string {
  return `pill sev-${s}`;
}
