"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { listTickets } from "@/lib/api";
import { formatDate, statusLabel, statusPillClass } from "@/lib/format";
import type { Ticket, TicketStatus } from "@/lib/contract";
import { ResetTicketButton } from "./ResetTicketButton";

export function QueueList({
  audience,
}: {
  audience: "dispatcher" | "tech";
}) {
  const router = useRouter();
  const filter = audience === "tech" ? ["AWAITING_TECH", "IN_PROGRESS"] : null;
  const { data, isLoading, error } = useQuery({
    queryKey: ["tickets", audience],
    queryFn: () => listTickets(),
  });

  const tickets: Ticket[] = (data || []).filter((t) =>
    filter ? filter.includes(t.status) : true,
  );

  return (
    <section style={{ padding: "48px 0" }}>
      <div className="wrap">
        <div
          style={{
            display: "flex",
            alignItems: "baseline",
            justifyContent: "space-between",
            marginBottom: 32,
            flexWrap: "wrap",
            gap: 16,
          }}
        >
          <div>
            <span className="sect-eyebrow">
              {audience === "dispatcher" ? "01 — Dispatcher queue" : "01 — Tech queue"}
            </span>
            <h1 className="h1" style={{ marginTop: 16 }}>
              {audience === "dispatcher" ? "Open Tickets" : "On The Floor"}
            </h1>
          </div>
          {audience === "dispatcher" && (
            <Link href="/dispatcher/new" className="btn btn-super">
              + New ticket <span className="arr">→</span>
            </Link>
          )}
        </div>

        {isLoading && <SkeletonRows />}
        {error && (
          <div className="card" style={{ borderColor: "#f08d80" }}>
            <div className="micro" style={{ color: "#8a1f15" }}>Backend unreachable</div>
            <p style={{ marginTop: 8, color: "var(--muted)", fontSize: 14 }}>
              Could not load tickets from{" "}
              <code>{process.env.NEXT_PUBLIC_API_BASE}</code>. Make sure the
              backend is running on port 3001.
            </p>
          </div>
        )}
        {!isLoading && !error && tickets.length === 0 && (
          <EmptyQueue audience={audience} />
        )}

        {tickets.length > 0 && (
          <div
            style={{
              border: "1px solid var(--border)",
              background: "#fff",
            }}
          >
            <div
              className="queue-row queue-header"
              style={{
                background: "var(--pale)",
                fontSize: 11,
                fontWeight: 700,
                textTransform: "uppercase",
                letterSpacing: "0.06em",
                color: "var(--muted)",
                cursor: "default",
                padding: "12px 8px",
              }}
            >
              <span>Ticket</span>
              <span>Asset / Symptoms</span>
              <span>Opened</span>
              <span>Status</span>
              <span style={{ textAlign: "right" }}>—</span>
            </div>
            {tickets.map((t) => {
              const href =
                audience === "tech"
                  ? `/tech/ticket/${t.id}`
                  : `/dispatcher/ticket/${t.id}`;
              return (
                <div
                  key={t.id}
                  className="queue-row"
                  role="link"
                  tabIndex={0}
                  onClick={() => router.push(href)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      router.push(href);
                    }
                  }}
                  style={{ color: "inherit" }}
                >
                  <span className="qid">#{t.id}</span>
                  <span>
                    <div style={{ fontWeight: 700 }}>
                      {t.asset.reporting_mark} {t.asset.road_number} ·{" "}
                      {t.asset.unit_model}
                    </div>
                    <div
                      style={{
                        color: "var(--muted)",
                        fontSize: 13,
                        marginTop: 2,
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {t.initial_symptoms || t.initial_error_codes || "—"}
                    </div>
                  </span>
                  <span style={{ fontSize: 13, color: "var(--muted)" }}>
                    {formatDate(t.opened_at)}
                  </span>
                  <span>
                    <span className={statusPillClass(t.status as TicketStatus)}>
                      {statusLabel(t.status as TicketStatus)}
                    </span>
                  </span>
                  <span
                    style={{
                      display: "flex",
                      gap: 8,
                      justifyContent: "flex-end",
                      alignItems: "center",
                    }}
                  >
                    {audience === "dispatcher" && (
                      <ResetTicketButton ticketId={t.id} label="Reset" />
                    )}
                    <span style={{ fontSize: 16, color: "var(--mta)" }}>→</span>
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </section>
  );
}

function EmptyQueue({ audience }: { audience: "dispatcher" | "tech" }) {
  return (
    <div className="card" style={{ textAlign: "center", padding: 64 }}>
      <div className="micro">No tickets yet</div>
      <h3 className="h3" style={{ marginTop: 12 }}>
        {audience === "tech" ? "All clear in the yard" : "Quiet right now"}
      </h3>
      <p
        style={{
          marginTop: 12,
          color: "var(--muted)",
          maxWidth: 480,
          marginInline: "auto",
        }}
      >
        {audience === "dispatcher"
          ? "When fault dumps come in, open a ticket so the tech has context before they touch the locomotive."
          : "When dispatch hands off a ticket, it&rsquo;ll show up here with a pre-arrival briefing."}
      </p>
      {audience === "dispatcher" && (
        <Link
          href="/dispatcher/new"
          className="btn btn-super"
          style={{ marginTop: 24 }}
        >
          + Open a ticket <span className="arr">→</span>
        </Link>
      )}
    </div>
  );
}

function SkeletonRows() {
  return (
    <div style={{ border: "1px solid var(--border)", background: "#fff" }}>
      {Array.from({ length: 4 }).map((_, i) => (
        <div
          key={i}
          className="queue-row"
          style={{ cursor: "default", opacity: 0.6 }}
        >
          <span style={{ background: "var(--pale)", height: 16, width: 40 }} />
          <span style={{ background: "var(--pale)", height: 16 }} />
          <span style={{ background: "var(--pale)", height: 14, width: 80 }} />
          <span style={{ background: "var(--pale)", height: 24, width: 100 }} />
          <span />
        </div>
      ))}
    </div>
  );
}
