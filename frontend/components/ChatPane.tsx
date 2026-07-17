"use client";

import { fetchEventSource } from "@microsoft/fetch-event-source";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import ReactMarkdown, { defaultUrlTransform } from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  addTicketPart,
  apiUrl,
  authHeaders,
  fileUrl,
  getCorpusChunk,
  getTicket,
  removeTicketPart,
  uploadPhotos,
} from "@/lib/api";
import type {
  Citation,
  CorpusFigure,
  Message,
  StreamEvent,
  TicketDetail,
  ToolCall,
  Attachment,
} from "@/lib/contract";
import { CitationDrawer } from "./CitationDrawer";
import { MicButton } from "./MicButton";
import { PhotoUpload, type PendingAttachment } from "./PhotoUpload";

type ShownFigure = { chunkId: number; figure: CorpusFigure };

type LiveAssistant = {
  text: string;
  citations: Citation[];
  toolCalls: ToolCall[];
  requestPhoto: { prompt: string; reason: string } | null;
  figures: ShownFigure[];
  suggestions: string[];
};

type Props = {
  ticketId: string;
  role: "dispatcher" | "tech";
  /** Render an empty-state hint when there are no messages yet. */
  emptyHint?: string;
  /** Inline upload UI handler — defaults to opening the file picker. */
  onRequestPhoto?: (prompt: string) => void;
  /** Drop the pane's own border/background to fill a parent card (Copilot). */
  bare?: boolean;
};

export function ChatPane({
  ticketId,
  role,
  emptyHint,
  bare = false,
}: Props) {
  const qc = useQueryClient();
  const { data } = useQuery({
    queryKey: ["ticket", ticketId],
    queryFn: () => getTicket(ticketId),
  });

  const messages: Message[] = useMemo(() => data?.messages || [], [data?.messages]);

  // Parts already recorded on the ticket — drives the Add/Added toggle state on
  // inline lookup_parts results (and reflects the sidebar + wrap-up).
  const addedPartIds = useMemo(
    () => new Set((data?.ticket_parts ?? []).map((tp) => tp.part_id)),
    [data?.ticket_parts],
  );
  const [pendingPartIds, setPendingPartIds] = useState<Set<number>>(new Set());

  async function togglePart(partId: number, add: boolean) {
    setPendingPartIds((prev) => new Set(prev).add(partId));
    try {
      if (add) await addTicketPart(ticketId, partId, 1);
      else await removeTicketPart(ticketId, partId);
      qc.invalidateQueries({ queryKey: ["ticket", ticketId] });
      qc.invalidateQueries({ queryKey: ["tickets"] });
    } catch {
      setError("Couldn't update parts — try again.");
    } finally {
      setPendingPartIds((prev) => {
        const next = new Set(prev);
        next.delete(partId);
        return next;
      });
    }
  }

  const partActions: PartActions = {
    addedPartIds,
    pendingPartIds,
    onTogglePart: togglePart,
  };

  const [draft, setDraft] = useState("");
  const [interim, setInterim] = useState("");
  const [pending, setPending] = useState<PendingAttachment[]>([]);
  const [streaming, setStreaming] = useState(false);
  const [live, setLive] = useState<LiveAssistant | null>(null);
  const [openChunk, setOpenChunk] = useState<number | null>(null);
  const [previewFigure, setPreviewFigure] = useState<CorpusFigure | null>(null);
  // Map tool-call call_id → tool name so `tool_call_completed` (which only
  // carries call_id) can dispatch on the original tool name.
  const callIdToName = useRef<Map<string, string>>(new Map());
  const [error, setError] = useState<string | null>(null);
  // Timestamp (ms) until which sending is blocked after a 429. null = no cooldown.
  const [cooldownUntil, setCooldownUntil] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const listRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  // Whether the user is scrolled to (near) the bottom of the chat. We only
  // auto-scroll when this is true, so scrolling up to read history — or the
  // composer growing/shrinking as you type — never yanks the view around.
  const atBottomRef = useRef(true);

  // Track whether the view is pinned to the bottom. A small threshold treats
  // "close enough" as bottom so streaming text and rounding don't unstick it.
  useEffect(() => {
    const el = listRef.current;
    if (!el) return;
    const onScroll = () => {
      atBottomRef.current =
        el.scrollHeight - el.scrollTop - el.clientHeight < 80;
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll);
  }, []);

  // Auto-scroll to the latest content whenever the conversation grows: a new
  // message is sent/received or the live "thinking" bubble streams text/tool
  // calls/figures. Only pin to the bottom when the user is already there, so
  // reading history is never interrupted. rAF defers the scroll until after the
  // browser has laid out the freshly rendered content so scrollHeight is
  // accurate (images/figures can render taller than the initial commit).
  useEffect(() => {
    const el = listRef.current;
    if (!el || !atBottomRef.current) return;
    const id = requestAnimationFrame(() => {
      el.scrollTop = el.scrollHeight;
    });
    return () => cancelAnimationFrame(id);
  }, [messages, live, pending.length, streaming]);


  // Tick once a second while a cooldown is active so the countdown updates and
  // the composer re-enables when the window passes.
  useEffect(() => {
    if (cooldownUntil == null) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [cooldownUntil]);

  const cooldownLeft =
    cooldownUntil != null ? Math.max(0, Math.ceil((cooldownUntil - now) / 1000)) : 0;
  const inCooldown = cooldownLeft > 0;

  async function send(overrideContent?: string) {
    const content = (overrideContent ?? draft).trim();
    if (!content && pending.length === 0) return;
    if (streaming) return;
    // Block sends (incl. auto-send paths: photo attach, suggestion clicks) while
    // a server-issued rate-limit cooldown is active.
    if (cooldownUntil != null && Date.now() < cooldownUntil) return;

    setError(null);
    setStreaming(true);
    // The "Railio is thinking" live bubble is deferred until the user's own
    // message is persisted (see handleEvent → user_message_persisted) so it
    // appears below the user bubble, not before it.

    const body = {
      role,
      content,
      attachment_paths: pending.map((p) => p.path),
    };

    setDraft("");
    setInterim("");
    setPending([]);

    const ac = new AbortController();
    abortRef.current = ac;

    try {
      await fetchEventSource(apiUrl(`/api/tickets/${ticketId}/messages`), {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(await authHeaders()) },
        body: JSON.stringify(body),
        signal: ac.signal,
        openWhenHidden: true,
        async onopen(response) {
          if (response.ok) return; // SSE stream opened normally
          if (response.status === 429) {
            const ra = Number(response.headers.get("Retry-After") || "30");
            const secs = Number.isFinite(ra) && ra > 0 ? ra : 30;
            setCooldownUntil(Date.now() + secs * 1000);
            setNow(Date.now());
            setError(
              `You're sending messages too fast — try again in ${secs}s.`,
            );
            // RateLimited is non-retriable: throw a plain Error so fetchEventSource
            // stops and our catch swallows it without re-opening the stream.
            throw new Error("rate_limited");
          }
          let detail = `Request failed (${response.status})`;
          try {
            const j = await response.json();
            if (j?.detail) detail = j.detail;
          } catch {
            // non-JSON body; keep the status message
          }
          setError(detail);
          throw new Error(detail);
        },
        onmessage(ev) {
          if (!ev.data) return;
          let payload: StreamEvent;
          try {
            payload = JSON.parse(ev.data) as StreamEvent;
          } catch {
            return;
          }
          handleEvent(payload);
        },
        onerror(err) {
          // Re-throw to stop retries; onopen already set a user-facing message
          // for HTTP errors (incl. 429). Don't overwrite it here.
          throw err;
        },
      });
    } catch (e) {
      // onopen sets the precise message for HTTP errors (e.g. the 429 cooldown);
      // only fill in a generic message if nothing was surfaced and we weren't
      // intentionally aborted.
      const msg = e instanceof Error ? e.message : "";
      const handled = msg === "rate_limited" || (cooldownUntil != null && Date.now() < cooldownUntil);
      if (!ac.signal.aborted && !handled) {
        setError((prev) => prev ?? "Connection failed");
      }
    } finally {
      setStreaming(false);
      abortRef.current = null;
    }
  }

  // Write a persisted message straight into the cache (deduped by id) instead of
  // refetching. The event already carries the authoritative Message (citations +
  // tool_calls), so this closes the gap that otherwise let a message vanish
  // between setLive(null) and the refetch landing.
  function appendMessage(m: Message) {
    qc.setQueryData<TicketDetail>(["ticket", ticketId], (old) =>
      old && !old.messages.some((x) => x.id === m.id)
        ? { ...old, messages: [...old.messages, m] }
        : old,
    );
  }

  function handleEvent(ev: StreamEvent) {
    switch (ev.type) {
      case "user_message_persisted":
        // Append the user bubble and reveal the thinking bubble in the same
        // batched render, so "Railio is thinking" shows directly below the
        // user's message rather than ahead of it.
        appendMessage(ev.message);
        setLive({ text: "", citations: [], toolCalls: [], requestPhoto: null, figures: [], suggestions: [] });
        break;
      case "assistant_message_persisted":
        // Swap the live streaming bubble for the persisted one in a single
        // batched render — no frame where the response is absent. The cache now
        // holds the authoritative message, so no ["ticket"] refetch is needed
        // (set_ticket_status invalidates ["ticket"] from its own branch when the
        // status actually changes). Still refresh the inbox list/status pills.
        appendMessage(ev.message);
        setLive(null);
        qc.invalidateQueries({ queryKey: ["tickets"] });
        break;
      case "assistant_token":
        setLive((prev) =>
          prev
            ? { ...prev, text: prev.text + ev.delta }
            : {
                text: ev.delta,
                citations: [],
                toolCalls: [],
                requestPhoto: null,
                figures: [],
                suggestions: [],
              },
        );
        break;
      case "tool_call_started":
        callIdToName.current.set(ev.call_id, ev.name);
        setLive((prev) =>
          prev
            ? {
                ...prev,
                toolCalls: [
                  ...prev.toolCalls,
                  {
                    name: ev.name,
                    input: ev.input,
                    output: {},
                    call_id: ev.call_id,
                  },
                ],
              }
            : prev,
        );
        break;
      case "tool_call_completed": {
        setLive((prev) =>
          prev
            ? {
                ...prev,
                toolCalls: prev.toolCalls.map((tc) =>
                  tc.call_id === ev.call_id ? { ...tc, output: ev.output } : tc,
                ),
              }
            : prev,
        );
        const toolName = callIdToName.current.get(ev.call_id);
        if (toolName === "set_ticket_status") {
          // Backend has committed the new status; invalidate so every observer
          // (TicketDetail's Start/wrap-up buttons, status pill, queue badges)
          // re-renders with the fresh ticket.
          qc.invalidateQueries({ queryKey: ["ticket", ticketId] });
          qc.invalidateQueries({ queryKey: ["tickets"] });
        }
        if (toolName === "record_part_used") {
          // AI recorded a part; refresh so the sidebar's "Parts to bring", the
          // wrap-up used-parts list, and the inline Add/Added toggle all update.
          qc.invalidateQueries({ queryKey: ["ticket", ticketId] });
        }
        callIdToName.current.delete(ev.call_id);
        break;
      }
      case "request_photo":
        setLive((prev) =>
          prev
            ? { ...prev, requestPhoto: { prompt: ev.prompt, reason: ev.reason } }
            : {
                text: "",
                citations: [],
                toolCalls: [],
                requestPhoto: { prompt: ev.prompt, reason: ev.reason },
                figures: [],
                suggestions: [],
              },
        );
        break;
      case "show_figure":
        setLive((prev) =>
          prev
            ? {
                ...prev,
                figures: [
                  ...prev.figures,
                  { chunkId: ev.chunk_id, figure: ev.figure },
                ],
              }
            : {
                text: "",
                citations: [],
                toolCalls: [],
                requestPhoto: null,
                figures: [{ chunkId: ev.chunk_id, figure: ev.figure }],
                suggestions: [],
              },
        );
        break;
      case "suggest_replies":
        setLive((prev) =>
          prev
            ? { ...prev, suggestions: ev.replies }
            : {
                text: "",
                citations: [],
                toolCalls: [],
                requestPhoto: null,
                figures: [],
                suggestions: ev.replies,
              },
        );
        break;
      case "done":
        setStreaming(false);
        break;
      case "error":
        setError(ev.error);
        setStreaming(false);
        break;
    }
  }

  // Inline upload from request_photo prompt
  async function uploadAndSend(file: File) {
    try {
      const { attachments } = await uploadPhotos(ticketId, [file]);
      setPending((p) => [
        ...p,
        ...attachments.map((a) => ({
          ...a,
          localUrl: URL.createObjectURL(file),
        })),
      ]);
      // Auto-send a thin message so the AI immediately sees the photo
      setDraft("Photo attached.");
      // Use setTimeout so state lands first
      setTimeout(send, 50);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Upload failed");
    }
  }

  // Inline citation click. Manual/CFR cites route straight to the source (the
  // PDF at the right page, or the eCFR section) in a new tab; tribal notes have
  // no external document, so they open the in-app chunk drawer instead. We open
  // the tab synchronously (inside the click) to dodge popup blockers, then point
  // it at the resolved URL once the chunk's source_url comes back.
  async function openCitation(c: Citation) {
    if (c.doc_class !== "manual") {
      setOpenChunk(c.chunk_id);
      return;
    }
    const w = window.open("about:blank", "_blank");
    try {
      const chunk = await getCorpusChunk(c.chunk_id);
      const url = chunk.source_url ? fileUrl(chunk.source_url) : undefined;
      if (url && w) {
        w.location.href = url;
        return;
      }
    } catch {
      // fall through to the drawer below
    }
    if (w) w.close();
    setOpenChunk(c.chunk_id);
  }

  const composerValue = interim || draft;

  // Grow the composer with its content (up to the CSS max-height) so earlier
  // lines stay visible instead of scrolling out of a fixed one-row textarea.
  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    const prev = el.style.height;
    // Measure the content height. Resetting to "auto" lets scrollHeight shrink
    // back down when text is deleted; we restore the prior height immediately
    // if it turns out unchanged so no reflow is committed.
    el.style.height = "auto";
    const next = `${Math.min(el.scrollHeight, 120)}px`;
    if (next === prev) {
      // Same height as before — typing within the current line count. Restore
      // and bail without touching layout, so the message bubbles above don't
      // jump on every keystroke.
      el.style.height = prev;
      return;
    }
    el.style.height = next;
    // The composer's height actually changed, which resizes the message list.
    // If the user was reading the latest message, re-pin to the bottom so the
    // content above the input doesn't appear to jump.
    const list = listRef.current;
    if (list && atBottomRef.current) {
      list.scrollTop = list.scrollHeight;
    }
  }, [composerValue]);

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        flex: 1,
        minWidth: 0,
        minHeight: 0,
        height: "100%",
        overflow: "hidden",
        background: "#fff",
        border: bare ? "none" : "1px solid var(--border)",
      }}
    >
      <div
        ref={listRef}
        className="scroll-chat chat-list"
        style={{
          flex: 1,
          minHeight: 0,
          padding: bare ? "24px 28px 16px" : 24,
          display: "flex",
          flexDirection: "column",
          gap: 16,
        }}
      >
        {messages.length === 0 && !live && (
          <EmptyState
            hint={emptyHint || "Press the mic to talk, or type."}
            ticket={data}
            disabled={streaming || inCooldown}
            onPick={(q) => send(q)}
          />
        )}

        {messages.map((m, i) => (
          <MessageBubble
            key={m.id}
            message={m}
            onCitationClick={openCitation}
            onOpenChunk={(id) => setOpenChunk(id)}
            onPreviewFigure={setPreviewFigure}
            isLast={i === messages.length - 1 && !live}
            onPick={(q) => send(q)}
            picksDisabled={streaming || inCooldown}
            partActions={partActions}
          />
        ))}

        {live && (
          <LiveBubble
            live={live}
            onCitationClick={openCitation}
            onOpenChunk={(id) => setOpenChunk(id)}
            onPreviewFigure={setPreviewFigure}
            onPhotoSend={uploadAndSend}
            onPick={(q) => send(q)}
            picksDisabled={streaming || inCooldown}
            partActions={partActions}
          />
        )}
      </div>

      {(inCooldown || error) && (
        <div
          style={{
            background: "#ffe6e3",
            color: "#8a1f15",
            margin: bare ? "0 28px 12px" : 0,
            padding: "8px 16px",
            fontSize: 13,
            borderRadius: bare ? 12 : 0,
            borderTop: bare ? "none" : "1px solid #f08d80",
          }}
        >
          {inCooldown
            ? `You're sending messages too fast — try again in ${cooldownLeft}s.`
            : error}
        </div>
      )}

      <div className="rc-composer" style={{ flexShrink: 0 }}>
        {pending.length > 0 && (
          <div className="rc-pending">
            {pending.map((p) => (
              <PendingThumb
                key={p.path}
                src={p.localUrl || fileUrl(p.path)}
                onRemove={() =>
                  setPending((prev) => prev.filter((x) => x.path !== p.path))
                }
              />
            ))}
          </div>
        )}
        <textarea
          ref={inputRef}
          className="rc-input"
          rows={1}
          placeholder={
            streaming ? "Railio is responding…" : "Message Railio…"
          }
          value={composerValue}
          onChange={(e) => {
            setInterim("");
            setDraft(e.target.value);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              send();
            }
          }}
          disabled={streaming}
          style={{
            fontStyle: interim ? "italic" : "normal",
            color: interim ? "var(--dash-muted)" : "#000",
          }}
        />
        <div className="rc-composer-actions">
          <div className="rc-actions-left">
            <PhotoUpload
              ticketId={ticketId}
              pending={pending}
              onAdd={(a) => setPending((p) => [...p, ...a])}
              onRemove={(path) =>
                setPending((p) => p.filter((x) => x.path !== path))
              }
              compact
            />
            <MicButton
              onInterim={(t) => setInterim(t)}
              onFinal={(t) => {
                setInterim("");
                if (t) setDraft((prev) => (prev ? prev + " " + t : t));
              }}
            />
          </div>
          <button
            className="rc-send rc-pill"
            onClick={() => send()}
            aria-label="Send"
            disabled={
              streaming || inCooldown || (!draft.trim() && pending.length === 0)
            }
          >
            {streaming ? (
              "…"
            ) : inCooldown ? (
              cooldownLeft
            ) : (
              <>
                <span aria-hidden className="ico-arr-up rc-pill-ico" />
                <span className="rc-pill-label">Send</span>
              </>
            )}
          </button>
        </div>
      </div>

      {openChunk != null && (
        <CitationDrawer chunkId={openChunk} onClose={() => setOpenChunk(null)} />
      )}

      {previewFigure && (
        <FigureLightbox
          figure={previewFigure}
          onClose={() => setPreviewFigure(null)}
        />
      )}
    </div>
  );
}

function EmptyState({
  hint,
  ticket,
  disabled,
  onPick,
}: {
  hint: string;
  ticket: TicketDetail | undefined;
  disabled: boolean;
  onPick: (question: string) => void;
}) {
  const questions = useMemo(() => buildSuggestedQuestions(ticket), [ticket]);
  return (
    <div className="rc-empty">
      <div className="rc-empty-hint">{hint}</div>
      {questions.length > 0 && (
        <>
          <div className="rc-try">TRY ASKING</div>
          <div className="rc-suggest-list">
            {questions.map((q) => (
              <button
                key={q}
                onClick={() => onPick(q)}
                disabled={disabled}
                className="rc-suggest"
              >
                {q}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function buildSuggestedQuestions(ticket: TicketDetail | undefined): string[] {
  if (!ticket) return [];
  const firstParsed = ticket.fault_dump_parsed?.[0]?.code;
  const firstInitial = ticket.initial_error_codes
    ?.split(",")
    .map((s) => s.trim())
    .filter(Boolean)[0];
  const code = firstParsed || firstInitial;
  const codeRef = code ? `fault ${code}` : "these symptoms";
  return [
    "Give me a full briefing on this ticket.",
    `What's the most likely root cause of ${codeRef}?`,
    `What does the manual say about ${codeRef}?`,
    "Are there senior-tech notes for this kind of issue?",
    "What parts should I bring? Show bin locations.",
  ];
}

function MessageBubble({
  message,
  onCitationClick,
  onOpenChunk,
  onPreviewFigure,
  isLast,
  onPick,
  picksDisabled,
  partActions,
}: {
  message: Message;
  onCitationClick: (c: Citation) => void;
  onOpenChunk: (chunkId: number) => void;
  onPreviewFigure: (figure: CorpusFigure) => void;
  isLast?: boolean;
  onPick?: (text: string) => void;
  picksDisabled?: boolean;
  partActions: PartActions;
}) {
  const isUser = message.role === "tech" || message.role === "dispatcher";
  const isSystem = message.role === "system" || message.role === "tool";
  // Figures the assistant chose to show are reconstructed from persisted
  // show_figure tool_calls — no separate field on the message, so the hash
  // chain is untouched.
  const shownFigures: ShownFigure[] = (message.tool_calls ?? [])
    .filter(
      (tc) =>
        tc.name === "show_figure" &&
        (tc.output as { ok?: boolean } | undefined)?.ok,
    )
    .map((tc) => {
      const out = tc.output as { chunk_id: number; figure: CorpusFigure };
      return { chunkId: out.chunk_id, figure: out.figure };
    });

  // Quick-reply chips ride on persisted suggest_replies tool_calls (no separate
  // message field → hash chain untouched). They are ephemeral: only the latest
  // assistant turn shows them, so once the tech replies they disappear.
  const suggestions: string[] =
    isLast && message.role === "assistant"
      ? ((message.tool_calls ?? [])
          .filter(
            (tc) =>
              tc.name === "suggest_replies" &&
              (tc.output as { ok?: boolean } | undefined)?.ok,
          )
          .flatMap(
            (tc) => (tc.output as { replies?: string[] } | undefined)?.replies ?? [],
          ))
      : [];

  if (isSystem) {
    return (
      <div className="chat-message-system">
        <span className="micro">{message.role}</span> {message.content}
      </div>
    );
  }

  return (
    <div
      style={{
        display: "flex",
        justifyContent: isUser ? "flex-end" : "flex-start",
      }}
    >
      <div
        className={isUser ? "chat-message-user" : "chat-message-assistant"}
        style={{ maxWidth: "min(80%, 640px)" }}
      >
        <div
          className="chat-message-role"
          style={{
            fontSize: 11,
            textTransform: "uppercase",
            marginBottom: 6,
          }}
        >
          {message.role === "assistant" ? "Railio" : message.role}
        </div>
        {message.role === "assistant" ? (
          <Markdown
            citations={message.citations ?? undefined}
            onCite={(id) => {
              const c = message.citations?.find((x) => x.chunk_id === id);
              c ? onCitationClick(c) : onOpenChunk(id);
            }}
          >
            {message.content}
          </Markdown>
        ) : (
          <div
            style={{ whiteSpace: "pre-wrap", fontSize: 14, lineHeight: 1.5 }}
          >
            {message.content}
          </div>
        )}

        {message.attachments && message.attachments.length > 0 && (
          <div
            style={{
              display: "flex",
              gap: 8,
              flexWrap: "wrap",
              marginTop: 8,
            }}
          >
            {message.attachments.map((a, i) => (
              <AttachmentThumb key={`${a.path}-${i}`} attachment={a} />
            ))}
          </div>
        )}

        {shownFigures.length > 0 && (
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 8 }}>
            {shownFigures.map((f, i) => (
              <FigureThumb
                key={`${f.chunkId}-${i}`}
                figure={f.figure}
                onOpen={() => onPreviewFigure(f.figure)}
              />
            ))}
          </div>
        )}

        {message.tool_calls && message.tool_calls.length > 0 && (
          <div style={{ marginTop: 8, display: "flex", flexWrap: "wrap" }}>
            {message.tool_calls
              .filter(
                (tc) => tc.name !== "suggest_replies" && tc.name !== "lookup_parts",
              )
              .map((tc, i) => (
                <ToolPill key={i} tc={tc} />
              ))}
          </div>
        )}

        {(message.tool_calls ?? [])
          .filter((tc) => tc.name === "lookup_parts")
          .map((tc, i) => (
            <LookupPartsResult key={`lp-${i}`} tc={tc} actions={partActions} />
          ))}

        {suggestions.length > 0 && onPick && (
          <QuickReplies
            replies={suggestions}
            disabled={picksDisabled}
            onPick={onPick}
          />
        )}

      </div>
    </div>
  );
}

function FigureThumb({
  figure,
  onOpen,
}: {
  figure: CorpusFigure;
  onOpen: () => void;
}) {
  const url = fileUrl(figure.path);
  const label = figure.figure_label || figure.caption || "figure";
  if (!url) return null;
  return (
    <button
      onClick={onOpen}
      title={label}
      style={{
        padding: 0,
        border: "1px solid var(--dash-border)",
        borderRadius: 12,
        background: "#fff",
        cursor: "pointer",
        lineHeight: 0,
        overflow: "hidden",
      }}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={url}
        alt={label}
        style={{ width: 96, height: 96, objectFit: "cover", display: "block" }}
      />
    </button>
  );
}

function FigureLightbox({
  figure,
  onClose,
}: {
  figure: CorpusFigure;
  onClose: () => void;
}) {
  const url = fileUrl(figure.path);
  const label = figure.figure_label || figure.caption || "figure";
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  if (!url) return null;
  return (
    <div
      className="figure-lightbox"
      role="dialog"
      aria-modal="true"
      aria-label={label}
      onClick={onClose}
    >
      <button
        type="button"
        aria-label="Close"
        className="figure-lightbox-close"
        onClick={onClose}
      >
        ×
      </button>
      <figure
        className="figure-lightbox-body"
        onClick={(e) => e.stopPropagation()}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={url} alt={label} />
        {(figure.figure_label || figure.caption) && (
          <figcaption>
            {figure.figure_label ? <strong>{figure.figure_label}</strong> : null}
            {figure.figure_label && figure.caption ? " — " : null}
            {figure.caption}
          </figcaption>
        )}
      </figure>
    </div>
  );
}

function PendingThumb({
  src,
  onRemove,
}: {
  src: string | undefined;
  onRemove: () => void;
}) {
  if (!src) return null;
  return (
    <div
      style={{
        position: "relative",
        width: 56,
        height: 56,
        borderRadius: 12,
        overflow: "hidden",
        border: "1px solid var(--dash-border)",
        background: "#fff",
      }}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={src}
        alt="attachment"
        style={{ width: "100%", height: "100%", objectFit: "cover" }}
      />
      <button
        type="button"
        aria-label="Remove"
        onClick={onRemove}
        style={{
          position: "absolute",
          top: 2,
          right: 2,
          width: 16,
          height: 16,
          borderRadius: "50%",
          background: "#000",
          color: "#fff",
          border: 0,
          cursor: "pointer",
          fontSize: 10,
          lineHeight: "16px",
          padding: 0,
        }}
      >
        ×
      </button>
    </div>
  );
}

function AttachmentThumb({ attachment }: { attachment: Attachment }) {
  const url = fileUrl(attachment.path);
  if (!url) return null;
  if (attachment.kind === "image") {
    return (
      <a
        href={url}
        target="_blank"
        rel="noreferrer"
        style={{
          display: "inline-block",
          border: "1px solid var(--dash-border)",
          borderRadius: 12,
          overflow: "hidden",
          background: "#fff",
        }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={url}
          alt="attachment"
          style={{ width: 96, height: 96, objectFit: "cover", display: "block" }}
        />
      </a>
    );
  }
  return (
    <a
      href={url}
      target="_blank"
      rel="noreferrer"
      className="pill pill-soft"
      style={{ textDecoration: "none" }}
    >
      PDF
    </a>
  );
}

function ToolPill({ tc }: { tc: ToolCall }) {
  const [open, setOpen] = useState(false);
  const label = describeTool(tc);
  return (
    <div style={{ marginRight: 6, marginBottom: 6 }}>
      <span className="tool-pill" onClick={() => setOpen((v) => !v)}>
        {label}
      </span>
      {open && (
        <pre
          style={{
            background: "#0a0a0a",
            color: "#e5e5e5",
            padding: 10,
            fontSize: 11,
            marginTop: 4,
            maxWidth: 480,
            overflow: "auto",
            borderRadius: 12,
          }}
        >
          {JSON.stringify({ input: tc.input, output: tc.output }, null, 2)}
        </pre>
      )}
    </div>
  );
}

function describeTool(tc: ToolCall): string {
  switch (tc.name) {
    case "search_corpus":
      return "Checking the manual...";
    case "lookup_parts":
      return "Looking up parts...";
    // No longer a chat tool — parsing runs through POST /parse-fault-dump. Kept
    // because messages are append-only + hash-chained, so threads from before the
    // removal permanently carry this tool_call and still have to render.
    case "parse_fault_dump":
      return "Parsing fault codes";
    case "request_photo":
      return "Requested photo";
    case "show_figure":
      return "Showed figure";
    case "record_part_used":
      return "Recorded part used";
    case "set_ticket_status":
      return "Status changed";
    default:
      return tc.name;
  }
}

type PartMatch = {
  id: number;
  part_number: string;
  name: string;
  bin_location: string | null;
  qty_on_hand: number;
  description?: string | null;
};

type PartActions = {
  addedPartIds: Set<number>;
  pendingPartIds: Set<number>;
  onTogglePart: (partId: number, add: boolean) => void;
};

// Renders a lookup_parts result inline as an actionable list: one row per
// matched part with an Add/Added toggle that records the part as used on the
// ticket (surfacing it in the sidebar + Complete & wrap-up). Works both while
// streaming and after reload, since the matches ride on the persisted
// tool_call output — same reconstruction trick as show_figure.
function LookupPartsResult({
  tc,
  actions,
}: {
  tc: ToolCall;
  actions: PartActions;
}) {
  const output = tc.output as { matches?: PartMatch[] } | undefined;
  const matches = output?.matches;

  if (matches === undefined) {
    return (
      <div style={{ marginTop: 8 }}>
        <span className="tool-pill">Looking up parts…</span>
      </div>
    );
  }
  if (matches.length === 0) {
    return (
      <div style={{ marginTop: 8, fontSize: 13, color: "var(--dash-muted)" }}>
        No matching parts in inventory.
      </div>
    );
  }

  return (
    <div
      style={{
        marginTop: 8,
        display: "flex",
        flexDirection: "column",
        gap: 6,
      }}
    >
      {matches.map((m) => {
        const added = actions.addedPartIds.has(m.id);
        const pending = actions.pendingPartIds.has(m.id);
        return (
          <div
            key={m.id}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              padding: "8px 10px",
              border: "1px solid var(--dash-border)",
              borderRadius: 12,
              background: "#fff",
            }}
          >
            <div style={{ minWidth: 0, flex: 1 }}>
              <div
                style={{
                  fontSize: 13,
                  fontWeight: 700,
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                }}
              >
                {m.name}
              </div>
              <div
                style={{
                  fontSize: 11,
                  color: "var(--dash-muted)",
                  display: "flex",
                  gap: 8,
                  flexWrap: "wrap",
                }}
              >
                <span>{m.part_number}</span>
                {m.bin_location && <span>Bin {m.bin_location}</span>}
                <span style={{ color: m.qty_on_hand <= 0 ? "var(--dash-danger)" : undefined }}>
                  {m.qty_on_hand <= 0 ? "Out of stock" : `${m.qty_on_hand} on hand`}
                </span>
              </div>
            </div>
            <button
              type="button"
              className={added ? "btn btn-ghost btn-sm" : "btn btn-super btn-sm"}
              disabled={pending}
              onClick={() => actions.onTogglePart(m.id, !added)}
              style={{ flexShrink: 0, minWidth: 84 }}
            >
              {pending ? "…" : added ? "✓ Added" : "+ Add"}
            </button>
          </div>
        );
      })}
    </div>
  );
}

function LiveBubble({
  live,
  onCitationClick,
  onOpenChunk,
  onPreviewFigure,
  onPhotoSend,
  onPick,
  picksDisabled,
  partActions,
}: {
  live: LiveAssistant;
  onCitationClick: (c: Citation) => void;
  onOpenChunk: (chunkId: number) => void;
  onPreviewFigure: (figure: CorpusFigure) => void;
  onPhotoSend: (file: File) => void;
  onPick: (text: string) => void;
  picksDisabled?: boolean;
  partActions: PartActions;
}) {
  return (
    <div style={{ display: "flex", justifyContent: "flex-start" }}>
      <div
        className="chat-message-assistant"
        style={{ maxWidth: "min(80%, 640px)" }}
      >
        <div
          className="chat-message-role"
          style={{
            fontSize: 11,
            textTransform: "uppercase",
            marginBottom: 6,
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
          }}
        >
          <span className="live-dot" /> Railio
        </div>

        <div style={{ display: "flex", flexWrap: "wrap" }}>
          {live.toolCalls
            .filter(
              (tc) => tc.name !== "suggest_replies" && tc.name !== "lookup_parts",
            )
            .map((tc, i) => (
              <ToolPill key={i} tc={tc} />
            ))}
        </div>

        {live.toolCalls
          .filter((tc) => tc.name === "lookup_parts")
          .map((tc, i) => (
            <LookupPartsResult key={`lp-${i}`} tc={tc} actions={partActions} />
          ))}

        {live.text ? (
          <Markdown
            citations={live.citations}
            onCite={(id) => {
              const c = live.citations.find((x) => x.chunk_id === id);
              c ? onCitationClick(c) : onOpenChunk(id);
            }}
          >
            {live.text}
          </Markdown>
        ) : (
          <div style={{ fontSize: 14, lineHeight: 1.5 }}>
            <span className="micro" style={{ color: "var(--muted)" }}>
              Thinking…
            </span>
          </div>
        )}

        {live.requestPhoto && (
          <RequestPhotoBlock
            prompt={live.requestPhoto.prompt}
            reason={live.requestPhoto.reason}
            onPick={onPhotoSend}
          />
        )}

        {live.figures.length > 0 && (
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 8 }}>
            {live.figures.map((f, i) => (
              <FigureThumb
                key={`${f.chunkId}-${i}`}
                figure={f.figure}
                onOpen={() => onPreviewFigure(f.figure)}
              />
            ))}
          </div>
        )}

        <QuickReplies
          replies={live.suggestions}
          disabled={picksDisabled}
          onPick={onPick}
        />

      </div>
    </div>
  );
}

function QuickReplies({
  replies,
  disabled,
  onPick,
}: {
  replies: string[];
  disabled?: boolean;
  onPick: (text: string) => void;
}) {
  if (!replies || replies.length === 0) return null;
  return (
    <div className="rc-quickreply-wrap">
      <div className="rc-quickreply-label">Follow Up:</div>
      <div className="rc-quickreply-row">
        {replies.slice(0, 2).map((r, i) => (
          <button
            key={`${r}-${i}`}
            type="button"
            className="rc-quickreply"
            disabled={disabled}
            onClick={() => onPick(r)}
          >
            {r}
          </button>
        ))}
      </div>
    </div>
  );
}

function RequestPhotoBlock({
  prompt,
  reason,
  onPick,
}: {
  prompt: string;
  reason: string;
  onPick: (file: File) => void;
}) {
  const ref = useRef<HTMLInputElement>(null);
  return (
    <div
      style={{
        marginTop: 12,
        padding: 12,
        background: "var(--mta-soft)",
        border: "1px solid var(--dash-link)",
        borderRadius: 14,
      }}
    >
      <div
        className="chat-message-role"
        style={{
          fontSize: 11,
          textTransform: "uppercase",
          marginBottom: 6,
        }}
      >
        Photo needed
      </div>
      <div style={{ fontSize: 14, marginBottom: 8 }}>{prompt}</div>
      <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 12 }}>
        Why: {reason}
      </div>
      <input
        ref={ref}
        type="file"
        accept="image/*"
        capture="environment"
        style={{ display: "none" }}
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) onPick(f);
          e.target.value = "";
        }}
      />
      <button className="btn btn-super btn-sm" onClick={() => ref.current?.click()}>
        Send photo <span className="ico-arr" aria-hidden="true" />
      </button>
    </div>
  );
}

function Markdown({
  children,
  onCite,
  citations,
}: {
  children: string;
  onCite?: (chunkId: number) => void;
  /** Authoritative labels, keyed by chunk. See the `a` renderer below. */
  citations?: Citation[];
}) {
  return (
    <div className="md">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        // Default sanitization strips the custom `cite:` scheme to ""; preserve it
        // so inline citation links survive to the `a` renderer below.
        urlTransform={(url) =>
          url.startsWith("cite:") ? url : defaultUrlTransform(url)
        }
        components={{
          // Skip images the model emits with an empty/missing URL — a bare
          // src="" trips the browser's empty-src warning and re-requests the page.
          img: ({ src, alt }) =>
            src ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={src} alt={alt ?? ""} style={{ maxWidth: "100%" }} />
            ) : null,
          a: ({ href, children }) => {
            const m = /^cite:(\d+)$/.exec(href ?? "");
            if (m) {
              const chunkId = Number(m[1]);
              // Render the source_label the backend recorded for this chunk, not
              // the text the model typed between the brackets. The model is told
              // to copy the label verbatim and mostly does, but it drifts —
              // usually toward a figure name ("Fig. DG-1") or a merged page range
              // ("p.229, 230, 233") that the link, carrying one chunk_id, can't
              // deliver. The citation array is built from the chunks actually
              // retrieved, so it can't drift. Falls back to the model's text for
              // a chunk that isn't in the array.
              const label = citations?.find((c) => c.chunk_id === chunkId)?.source_label;
              return (
                <a
                  className="cite-link"
                  href={href}
                  onClick={(e) => {
                    e.preventDefault();
                    onCite?.(chunkId);
                  }}
                >
                  {label ?? children}
                </a>
              );
            }
            return (
              <a href={href} target="_blank" rel="noopener noreferrer">
                {children}
              </a>
            );
          },
        }}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}
