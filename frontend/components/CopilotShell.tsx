"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { createCopilotConversation } from "@/lib/api";
import { copilotSession, type CopilotScope } from "@/lib/chatSession";
import { useRole } from "@/components/RoleProvider";
import { ChatPane } from "./ChatPane";
import { CopilotScopePanel } from "./CopilotScopePanel";

const SIDEBAR_MIN = 300;
const SIDEBAR_MAX = 620;
const SIDEBAR_DEFAULT = 400;
const SIDEBAR_KEY = "railio_copilot_sidebar";

function clampWidth(w: number): number {
  return Math.min(SIDEBAR_MAX, Math.max(SIDEBAR_MIN, Math.round(w)));
}

/**
 * Ticketless Railio Copilot. Same two-pane shell as the ticket workspace, but
 * the left drawer SELECTS scope (a unit or a model) instead of showing ticket
 * details — and there's no wrap-up pane and no work-order CTAs, since there's no
 * ticket. Selecting nothing leaves the copilot in general chat.
 */
export function CopilotShell() {
  const router = useRouter();
  const params = useSearchParams();
  const { role } = useRole();

  // One conversation per shell mount, created on load so the session id is
  // stable for the whole visit. Empty conversations are cheap and harmless.
  const { data: conversation } = useQuery({
    queryKey: ["copilot", "new-conversation"],
    queryFn: createCopilotConversation,
    staleTime: Infinity,
    gcTime: Infinity,
    refetchOnWindowFocus: false,
  });

  // Scope, seeded from ?asset= for the deep-link from a fleet row.
  const [scope, setScope] = useState<CopilotScope>({
    assetId: null,
    unitModel: null,
  });
  const assetParam = params.get("asset");
  useEffect(() => {
    if (assetParam) {
      const id = Number(assetParam);
      if (Number.isFinite(id)) setScope({ assetId: id, unitModel: null });
    }
  }, [assetParam]);

  // Prefill bridge for the sidebar's "Ask about this part".
  const [prefill, setPrefill] = useState<{ text: string; nonce: number }>();
  const nonce = useRef(0);
  function askAbout(text: string) {
    nonce.current += 1;
    setPrefill({ text, nonce: nonce.current });
    setMobileView("chat");
  }

  const [mobileView, setMobileView] = useState<"chat" | "scope">("chat");
  const [ctxOpen, setCtxOpen] = useState(true);
  const [ctxWidth, setCtxWidth] = useState(SIDEBAR_DEFAULT);
  const dragStartX = useRef(0);
  const dragStartW = useRef(0);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(SIDEBAR_KEY);
      if (raw) {
        const s = JSON.parse(raw);
        if (typeof s.width === "number") setCtxWidth(clampWidth(s.width));
      }
    } catch {
      // ignore malformed storage
    }
  }, []);
  useEffect(() => {
    try {
      localStorage.setItem(SIDEBAR_KEY, JSON.stringify({ width: ctxWidth }));
    } catch {
      // ignore quota/availability errors
    }
  }, [ctxWidth]);

  function onResizeDown(e: React.PointerEvent) {
    e.preventDefault();
    dragStartX.current = e.clientX;
    dragStartW.current = ctxWidth;
    document.body.style.userSelect = "none";
    document.body.style.cursor = "col-resize";
    function onMove(ev: PointerEvent) {
      setCtxWidth(clampWidth(dragStartW.current + (ev.clientX - dragStartX.current)));
    }
    function onUp() {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      document.body.style.userSelect = "";
      document.body.style.cursor = "";
    }
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  }

  return (
    <div className="work work--full">
      <div className="work-inner">
        <div className="work-topbar">
          <Link href="/dashboard" className="work-topbar-back dash-link">
            <span className="ico-arr-back" aria-hidden="true" /> Dashboard
          </Link>
          {scope.assetId && (
            <div className="work-topbar-actions">
              <button
                type="button"
                className="work-cta"
                onClick={() =>
                  router.push(`/dispatcher/new?asset=${scope.assetId}`)
                }
              >
                Open a ticket for this unit{" "}
                <span className="ico-arr" aria-hidden="true" />
              </button>
            </div>
          )}
        </div>

        <div className="work-tabs" role="tablist">
          <button
            type="button"
            className="work-tab"
            data-active={mobileView === "chat"}
            aria-selected={mobileView === "chat"}
            onClick={() => setMobileView("chat")}
          >
            Chat
          </button>
          <button
            type="button"
            className="work-tab"
            data-active={mobileView === "scope"}
            aria-selected={mobileView === "scope"}
            onClick={() => setMobileView("scope")}
          >
            Focus
          </button>
        </div>

        <div
          className="work-body"
          data-mobile-view={mobileView === "scope" ? "details" : "chat"}
          data-ctx-open={ctxOpen}
        >
          <aside
            className="work-ctx-drawer"
            data-open={ctxOpen}
            style={{ width: ctxOpen ? ctxWidth : 0 }}
            aria-hidden={!ctxOpen}
          >
            <div className="work-ctx-head">
              <span className="work-ctx-title">Ask Railio</span>
              <button
                type="button"
                className="work-ctx-close"
                onClick={() => setCtxOpen(false)}
                aria-label="Collapse focus panel"
              >
                <span className="ico-arr-back" aria-hidden="true" />
              </button>
            </div>

            <div className="work-context work-ctx-body">
              <CopilotScopePanel
                scope={scope}
                onScopeChange={setScope}
                onAskAbout={askAbout}
              />
            </div>

            <div
              className="work-ctx-resize"
              onPointerDown={onResizeDown}
              aria-label="Drag to resize"
            />
          </aside>

          {!ctxOpen && (
            <button
              type="button"
              className="work-ctx-open"
              onClick={() => setCtxOpen(true)}
              aria-label="Show focus panel"
            >
              <span className="work-ctx-open-head">
                <span className="ico-arr" aria-hidden="true" />
              </span>
            </button>
          )}

          <section className="dash-card work-copilot">
            <div className="work-copilot-body">
              {conversation && (
                <ChatPane
                  session={copilotSession(conversation.id, scope)}
                  role={role}
                  bare
                  prefill={prefill}
                  emptyHint="Ask Railio anything about your fleet. Pick a unit or model on the left to focus, or just start typing."
                />
              )}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
