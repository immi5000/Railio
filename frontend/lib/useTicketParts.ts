"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { addTicketPart, removeTicketPart } from "./api";
import type { PartAllocation, TicketDetail, TicketPart } from "./contract";

// Shared, optimistic controller for a ticket's used-parts. One implementation
// behind the chat allocator popup and the sidebar, so they mutate the same
// ["ticket", ref] cache and stay in lockstep. Every action writes the cache on
// the same tick (no invalidate→refetch wait) and reconciles with the
// authoritative TicketDetail the API returns; a failure rolls back.

export type TicketPartsController = {
  addedPartIds: Set<number>;
  qtyByPartId: Map<number, number>;
  allocationsByPartId: Map<number, PartAllocation[]>;
  pendingPartIds: Set<number>;
  /** Whether this controller can write (false for the ticket-less copilot). */
  enabled: boolean;
  /** Set an absolute total qty with no bin breakdown (parts with no locations). */
  setQty: (partId: number, qty: number) => void;
  /** Set the per-bin breakdown; total qty = sum. Empty/zero total removes. */
  setAllocations: (partId: number, allocations: PartAllocation[]) => void;
  remove: (partId: number) => void;
};

const NOOP: TicketPartsController = {
  addedPartIds: new Set(),
  qtyByPartId: new Map(),
  allocationsByPartId: new Map(),
  pendingPartIds: new Set(),
  enabled: false,
  setQty: () => {},
  setAllocations: () => {},
  remove: () => {},
};

export function useTicketParts(ref: string | null | undefined): TicketPartsController {
  const qc = useQueryClient();
  const key = useMemo(() => ["ticket", ref] as const, [ref]);

  const [pendingPartIds, setPendingPartIds] = useState<Set<number>>(new Set());
  const timers = useRef<Map<number, ReturnType<typeof setTimeout>>>(new Map());

  const markPending = useCallback((partId: number, on: boolean) => {
    setPendingPartIds((prev) => {
      const next = new Set(prev);
      if (on) next.add(partId);
      else next.delete(partId);
      return next;
    });
  }, []);

  // Write ticket_parts optimistically: set qty (+ allocations) for an existing
  // part, append a synthetic row for a new one (negative id, replaced on
  // reconcile), or drop it when qty <= 0. Returns the snapshot for rollback.
  const optimistic = useCallback(
    (
      partId: number,
      qty: number,
      allocations: PartAllocation[] | null,
    ): TicketDetail | undefined => {
      const prev = qc.getQueryData<TicketDetail>(key);
      if (!prev) return prev;
      const has = prev.ticket_parts.some((tp) => tp.part_id === partId);
      let ticket_parts: TicketPart[];
      if (qty <= 0) {
        ticket_parts = prev.ticket_parts.filter((tp) => tp.part_id !== partId);
      } else if (has) {
        ticket_parts = prev.ticket_parts.map((tp) =>
          tp.part_id === partId ? { ...tp, qty, allocations } : tp,
        );
      } else {
        ticket_parts = [
          ...prev.ticket_parts,
          {
            id: -Date.now(),
            part_id: partId,
            qty,
            allocations,
            added_via: "tech_manual",
            added_at: new Date().toISOString(),
          },
        ];
      }
      qc.setQueryData<TicketDetail>(key, { ...prev, ticket_parts });
      return prev;
    },
    [qc, key],
  );

  const commit = useCallback(
    async (
      partId: number,
      qty: number,
      allocations: PartAllocation[] | null,
      snapshot: TicketDetail | undefined,
    ) => {
      if (!ref) return;
      markPending(partId, true);
      try {
        const fresh =
          qty <= 0
            ? await removeTicketPart(ref, partId)
            : await addTicketPart(ref, partId, qty, allocations ?? undefined);
        qc.setQueryData<TicketDetail>(key, fresh);
      } catch {
        if (snapshot) qc.setQueryData<TicketDetail>(key, snapshot);
      } finally {
        markPending(partId, false);
      }
    },
    [ref, qc, key, markPending],
  );

  // Debounce the network write so a stepper burst sends one final value.
  const debouncedCommit = useCallback(
    (
      partId: number,
      qty: number,
      allocations: PartAllocation[] | null,
      snapshot: TicketDetail | undefined,
    ) => {
      const existing = timers.current.get(partId);
      if (existing) clearTimeout(existing);
      const tm = setTimeout(() => {
        timers.current.delete(partId);
        void commit(partId, qty, allocations, snapshot);
      }, 300);
      timers.current.set(partId, tm);
    },
    [commit],
  );

  const setQty = useCallback(
    (partId: number, qty: number) => {
      if (!ref) return;
      const snap = optimistic(partId, qty, null);
      debouncedCommit(partId, qty, null, snap);
    },
    [ref, optimistic, debouncedCommit],
  );

  const setAllocations = useCallback(
    (partId: number, allocations: PartAllocation[]) => {
      if (!ref) return;
      const clean = allocations.filter((a) => a.qty > 0);
      const total = clean.reduce((s, a) => s + a.qty, 0);
      const snap = optimistic(partId, total, total > 0 ? clean : null);
      debouncedCommit(partId, total, total > 0 ? clean : null, snap);
    },
    [ref, optimistic, debouncedCommit],
  );

  const remove = useCallback(
    (partId: number) => {
      if (!ref) return;
      const snap = optimistic(partId, 0, null);
      void commit(partId, 0, null, snap);
    },
    [ref, optimistic, commit],
  );

  const detail = qc.getQueryData<TicketDetail>(key);
  const addedPartIds = useMemo(
    () => new Set<number>((detail?.ticket_parts ?? []).map((tp) => tp.part_id)),
    [detail?.ticket_parts],
  );
  const qtyByPartId = useMemo(
    () =>
      new Map<number, number>(
        (detail?.ticket_parts ?? []).map((tp) => [tp.part_id, tp.qty]),
      ),
    [detail?.ticket_parts],
  );
  const allocationsByPartId = useMemo(
    () =>
      new Map<number, PartAllocation[]>(
        (detail?.ticket_parts ?? []).map((tp) => [tp.part_id, tp.allocations ?? []]),
      ),
    [detail?.ticket_parts],
  );

  if (!ref) return NOOP;

  return {
    addedPartIds,
    qtyByPartId,
    allocationsByPartId,
    pendingPartIds,
    enabled: true,
    setQty,
    setAllocations,
    remove,
  };
}
