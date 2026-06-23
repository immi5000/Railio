"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { deleteTicket } from "@/lib/api";

/**
 * Two-step destructive button: click once to arm, click "Yes, delete" to fire
 * `DELETE /api/tickets/:id`. Invalidates relevant caches and notifies the
 * parent via `onDeleted` so it can re-route if needed.
 */
export function DeleteTicketButton({
  ticketId,
  block = false,
  label = "Delete ticket",
  onDeleted,
}: {
  ticketId: string;
  block?: boolean;
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
      setConfirming(false);
      onDeleted?.();
    },
  });

  const blockClass = block ? " dash-danger-btn--block" : "";

  if (!confirming) {
    return (
      <button
        type="button"
        className={`dash-danger-btn${blockClass}`}
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setConfirming(true);
        }}
        title="Permanently delete this ticket"
      >
        {label}
      </button>
    );
  }

  return (
    <div className="dash-delete-confirm">
      <span className="dash-delete-confirm-text">Delete this ticket forever?</span>
      <button
        type="button"
        className={`dash-danger-btn dash-danger-btn--confirm${blockClass}`}
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
        className="dash-danger-btn dash-danger-btn--cancel"
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
        <span style={{ color: "#8a1f15", fontSize: 12, width: "100%" }}>
          {(mut.error as Error).message}
        </span>
      )}
    </div>
  );
}
