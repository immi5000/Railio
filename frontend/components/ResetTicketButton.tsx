"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { resetTicket } from "@/lib/api";

/**
 * Two-step reset button (sibling of DeleteTicketButton): click once to arm
 * ("Reset ticket"), then Cancel (left) / Confirm Reset (right). Fires
 * `POST /api/tickets/:id/reset`, wiping the chat and restoring the ticket to the
 * state it was in when the dispatcher created it. Neutral (non-destructive)
 * styling. Disabled (grayed out) when the ticket is already pristine.
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

  const blockClass = block ? " dash-neutral-btn--block" : "";

  if (disabled) {
    return (
      <button
        type="button"
        className={`dash-neutral-btn${blockClass}`}
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
        className={`dash-neutral-btn${blockClass}`}
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setConfirming(true);
        }}
        title="Restore this ticket to the state it was in when it was created"
      >
        {label}
      </button>
    );
  }

  return (
    <div className="dash-delete-confirm">
      <button
        type="button"
        className="dash-neutral-btn dash-neutral-btn--cancel"
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setConfirming(false);
        }}
        disabled={mut.isPending}
      >
        Cancel
      </button>
      <button
        type="button"
        className="dash-neutral-btn dash-neutral-btn--confirm"
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          mut.mutate();
        }}
        disabled={mut.isPending}
      >
        {mut.isPending ? "Resetting…" : "Confirm Reset"}
      </button>
      {mut.error && (
        <span style={{ color: "#8a1f15", fontSize: 12, width: "100%" }}>
          {(mut.error as Error).message}
        </span>
      )}
    </div>
  );
}
