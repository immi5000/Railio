"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { resetTicket } from "@/lib/api";

/**
 * Two-step reset button (sibling of DeleteTicketButton): click once to arm
 * ("Reset ticket"), click "Yes, reset" to fire `POST /api/tickets/:id/reset`.
 * Wipes the chat and restores the ticket's original AWAITING_TECH state.
 * Disabled (grayed out) when the ticket is already pristine.
 */
export function ResetTicketButton({
  ticketId,
  disabled = false,
  block = false,
  label = "Reset ticket",
}: {
  ticketId: string;
  disabled?: boolean;
  block?: boolean;
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

  const blockClass = block ? " dash-danger-btn--block" : "";

  if (disabled) {
    return (
      <button
        type="button"
        className={`dash-danger-btn${blockClass}`}
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
        className={`dash-danger-btn${blockClass}`}
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
    <div className="dash-delete-confirm">
      <span className="dash-delete-confirm-text">Reset chat?</span>
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
        {mut.isPending ? "Resetting…" : "Yes, reset"}
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
