"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { resetTicket } from "@/lib/api";

/**
 * Two-step demo button: click once to arm ("Reset"), click "Yes, reset" to
 * fire `POST /api/tickets/:id/reset`. Wipes the chat and restores the ticket's
 * original state. Disabled (grayed out) when the ticket is already pristine.
 */
export function ResetTicketButton({
  ticketId,
  disabled = false,
  size = "sm",
  variant = "ghost",
  label = "Reset",
}: {
  ticketId: string;
  disabled?: boolean;
  size?: "sm" | "md";
  variant?: "ghost" | "primary";
  label?: string;
}) {
  const qc = useQueryClient();
  const [confirming, setConfirming] = useState(false);

  const mut = useMutation({
    mutationFn: () => resetTicket(ticketId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["tickets"] });
      qc.invalidateQueries({ queryKey: ["ticket", ticketId] });
      setConfirming(false);
    },
  });

  const baseClass = `btn btn-${variant}${size === "sm" ? " btn-sm" : ""}`;

  if (disabled) {
    return (
      <button
        type="button"
        className={baseClass}
        disabled
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
        }}
        title="Already in original state"
      >
        {label}
      </button>
    );
  }

  if (!confirming) {
    return (
      <button
        type="button"
        className={baseClass}
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setConfirming(true);
        }}
        title="Wipe the chat and restore this ticket's original state"
      >
        {label}
      </button>
    );
  }

  return (
    <span style={{ display: "inline-flex", gap: 6, alignItems: "center" }}>
      <span className="micro" style={{ color: "var(--muted)" }}>
        Reset chat?
      </span>
      <button
        type="button"
        className={`btn btn-super${size === "sm" ? " btn-sm" : ""}`}
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          mut.mutate();
        }}
        disabled={mut.isPending}
      >
        {mut.isPending ? "Resetting…" : "Yes, reset"}
      </button>
      <button
        type="button"
        className={`btn btn-ghost${size === "sm" ? " btn-sm" : ""}`}
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setConfirming(false);
        }}
        disabled={mut.isPending}
      >
        Cancel
      </button>
      {mut.error && (
        <span style={{ color: "#8a1f15", fontSize: 11 }}>
          {(mut.error as Error).message}
        </span>
      )}
    </span>
  );
}
