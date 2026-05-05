"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { deleteTicket } from "@/lib/api";

/**
 * Two-step destructive button: click once to arm ("Delete"), click "Yes,
 * delete" to fire `DELETE /api/tickets/:id`. Invalidates relevant caches and
 * notifies the parent via `onDeleted` so it can re-route if needed.
 */
export function DeleteTicketButton({
  ticketId,
  size = "sm",
  variant = "ghost",
  label = "Delete",
  onDeleted,
}: {
  ticketId: number;
  size?: "sm" | "md";
  variant?: "ghost" | "primary";
  label?: string;
  onDeleted?: () => void;
}) {
  const qc = useQueryClient();
  const [confirming, setConfirming] = useState(false);

  const mut = useMutation({
    mutationFn: () => deleteTicket(ticketId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["tickets"] });
      qc.removeQueries({ queryKey: ["ticket", ticketId] });
      qc.removeQueries({ queryKey: ["forms", ticketId] });
      setConfirming(false);
      onDeleted?.();
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
        title="Permanently delete this ticket"
      >
        🗑 {label}
      </button>
    );
  }

  return (
    <span style={{ display: "inline-flex", gap: 6, alignItems: "center" }}>
      <span className="micro" style={{ color: "#8a1f15" }}>
        Delete forever?
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
        {mut.isPending ? "Deleting…" : "Yes, delete"}
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
