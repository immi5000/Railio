"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { resetTicket } from "@/lib/api";

/**
 * Dispatcher-only demo helper: confirm, then POST /api/tickets/:id/reset.
 * Invalidates the ticket and forms caches on success.
 */
export function ResetTicketButton({
  ticketId,
  size = "sm",
  variant = "ghost",
  label = "Reset for demo",
  onReset,
}: {
  ticketId: number;
  size?: "sm" | "md";
  variant?: "ghost" | "primary";
  label?: string;
  onReset?: () => void;
}) {
  const qc = useQueryClient();
  const [confirming, setConfirming] = useState(false);

  const mut = useMutation({
    mutationFn: () => resetTicket(ticketId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["ticket", ticketId] });
      qc.invalidateQueries({ queryKey: ["forms", ticketId] });
      qc.invalidateQueries({ queryKey: ["tickets"] });
      setConfirming(false);
      onReset?.();
    },
  });

  const baseClass = `btn btn-${variant}${size === "sm" ? " btn-sm" : ""}`;

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
        title="Wipes messages, forms, and state — for demo replay"
      >
        ↻ {label}
      </button>
    );
  }

  return (
    <span style={{ display: "inline-flex", gap: 6, alignItems: "center" }}>
      <span
        className="micro"
        style={{ color: "#8a1f15" }}
      >
        Wipe everything?
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
