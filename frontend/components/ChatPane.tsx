"use client";

import { fetchEventSource } from "@microsoft/fetch-event-source";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { apiUrl, authHeaders, fileUrl, getTicket, uploadPhotos } from "@/lib/api";
import type {
  Citation,
  Message,
  StreamEvent,
  TicketDetail,
  ToolCall,
  Attachment,
} from "@/lib/contract";
import { CitationDrawer } from "./CitationDrawer";
import { MicButton } from "./MicButton";
import { PhotoUpload, type PendingAttachment } from "./PhotoUpload";

type LiveAssistant = {
  text: string;
  citations: Citation[];
  toolCalls: ToolCall[];
  requestPhoto: { prompt: string; reason: string } | null;
};

type Props = {
  ticketId: string;
  role: "dispatcher" | "tech";
  /** Render an empty-state hint when there are no messages yet. */
  emptyHint?: string;
  /** Inline upload UI handler — defaults to opening the file picker. */
  onRequestPhoto?: (prompt: string) => void;
};

export function ChatPane({
  ticketId,
  role,
  emptyHint,
}: Props) {
  const qc = useQueryClient();
  const { data } = useQuery({
    queryKey: ["ticket", ticketId],
    queryFn: () => getTicket(ticketId),
  });

  const messages: Message[] = data?.messages || [];

  const [draft, setDraft] = useState("");
  const [interim, setInterim] = useState("");
  const [pending, setPending] = useState<PendingAttachment[]>([]);
  const [streaming, setStreaming] = useState(false);
  const [live, setLive] = useState<LiveAssistant | null>(null);
  const [openChunk, setOpenChunk] = useState<number | null>(null);
  // Map tool-call call_id → tool name so `tool_call_completed` (which only
  // carries call_id) can dispatch on the original tool name.
  const callIdToName = useRef<Map<string, string>>(new Map());
  const [toast, setToast] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Timestamp (ms) until which sending is blocked after a 429. null = no cooldown.
  const [cooldownUntil, setCooldownUntil] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const listRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  // Auto-scroll on new content
  useEffect(() => {
    const el = listRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [messages.length, live?.text]);

  // Toast auto-dismiss
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 1800);
    return () => clearTimeout(t);
  }, [toast]);

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
    setLive({ text: "", citations: [], toolCalls: [], requestPhoto: null });

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

  function handleEvent(ev: StreamEvent) {
    switch (ev.type) {
      case "user_message_persisted":
      case "assistant_message_persisted":
        // Invalidate so every observer (status pill, Start/Close buttons,
        // queue badges) picks up authoritative server state — citations,
        // hash, tool_calls, status, pre-arrival summary, etc.
        qc.invalidateQueries({ queryKey: ["ticket", ticketId] });
        if (ev.type === "assistant_message_persisted") {
          qc.invalidateQueries({ queryKey: ["tickets"] });
          setLive(null);
        }
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
          const newStatus = (ev.output as { status?: string } | undefined)
            ?.status;
          setToast(
            newStatus ? `Status → ${newStatus.replace(/_/g, " ")}` : "Status changed",
          );
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

  const composerValue = interim || draft;

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100%",
        background: "#fff",
        border: "1px solid var(--border)",
      }}
    >
      <div
        ref={listRef}
        className="scroll-chat chat-list"
        style={{
          flex: 1,
          padding: 24,
          display: "flex",
          flexDirection: "column",
          gap: 16,
          minHeight: 240,
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

        {messages.map((m) => (
          <MessageBubble
            key={m.id}
            message={m}
            onCitationClick={(c) => setOpenChunk(c.chunk_id)}
          />
        ))}

        {live && (
          <LiveBubble
            live={live}
            onCitationClick={(c) => setOpenChunk(c.chunk_id)}
            onPhotoSend={uploadAndSend}
          />
        )}
      </div>

      {(inCooldown || error) && (
        <div
          style={{
            background: "#ffe6e3",
            color: "#8a1f15",
            padding: "8px 16px",
            fontSize: 13,
            borderTop: "1px solid #f08d80",
          }}
        >
          {inCooldown
            ? `You're sending messages too fast — try again in ${cooldownLeft}s.`
            : error}
        </div>
      )}

      <div
        className="chat-composer"
        style={{
          borderTop: "1px solid var(--border)",
          padding: 12,
          background: "var(--pale)",
        }}
      >
        <PhotoUpload
          ticketId={ticketId}
          pending={pending}
          onAdd={(a) => setPending((p) => [...p, ...a])}
          onRemove={(path) =>
            setPending((p) => p.filter((x) => x.path !== path))
          }
          compact
        />
        <div
          className="chat-composer-row"
          style={{
            display: "flex",
            gap: 8,
            marginTop: 8,
            alignItems: "stretch",
          }}
        >
          <MicButton
            onInterim={(t) => setInterim(t)}
            onFinal={(t) => {
              setInterim("");
              if (t) setDraft((prev) => (prev ? prev + " " + t : t));
            }}
          />
          <textarea
            className="textarea"
            placeholder={streaming ? "Assistant is responding…" : "Message…"}
            value={composerValue}
            onChange={(e) => {
              setInterim("");
              setDraft(e.target.value);
            }}
            onKeyDown={(e) => {
              if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
                e.preventDefault();
                send();
              }
            }}
            disabled={streaming}
            style={{
              flex: 1,
              minHeight: 60,
              fontStyle: interim ? "italic" : "normal",
              color: interim ? "var(--muted)" : "var(--ink)",
            }}
          />
          <button
            className="btn btn-super chat-send"
            onClick={() => send()}
            disabled={
              streaming || inCooldown || (!draft.trim() && pending.length === 0)
            }
            style={{ alignSelf: "stretch" }}
          >
            {streaming ? "Sending…" : inCooldown ? `Wait ${cooldownLeft}s` : "Send"}
          </button>
        </div>
      </div>

      {openChunk != null && (
        <CitationDrawer chunkId={openChunk} onClose={() => setOpenChunk(null)} />
      )}

      {toast && <div className="toast">{toast}</div>}
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
    <div
      style={{
        color: "var(--muted)",
        textAlign: "center",
        padding: "32px 24px",
        fontSize: 13,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: 16,
      }}
    >
      <div>{hint}</div>
      {questions.length > 0 && (
        <div style={{ width: "100%", maxWidth: 460 }}>
          <div
            className="micro"
            style={{ color: "var(--muted)", marginBottom: 8 }}
          >
            Try asking
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {questions.map((q) => (
              <button
                key={q}
                onClick={() => onPick(q)}
                disabled={disabled}
                className="pill pill-soft"
                style={{
                  textAlign: "left",
                  padding: "8px 12px",
                  fontSize: 13,
                  cursor: disabled ? "not-allowed" : "pointer",
                  opacity: disabled ? 0.5 : 1,
                  whiteSpace: "normal",
                  lineHeight: 1.4,
                }}
              >
                {q}
              </button>
            ))}
          </div>
        </div>
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
}: {
  message: Message;
  onCitationClick: (c: Citation) => void;
}) {
  const isUser = message.role === "tech" || message.role === "dispatcher";
  const isSystem = message.role === "system" || message.role === "tool";

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
          style={{
            fontSize: 11,
            fontWeight: 700,
            textTransform: "uppercase",
            letterSpacing: "0.06em",
            color: "var(--muted)",
            marginBottom: 6,
          }}
        >
          {message.role === "assistant" ? "Railio" : message.role}
        </div>
        {message.role === "assistant" ? (
          <Markdown>{message.content}</Markdown>
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

        {message.tool_calls && message.tool_calls.length > 0 && (
          <div style={{ marginTop: 8, display: "flex", flexWrap: "wrap" }}>
            {message.tool_calls.map((tc, i) => (
              <ToolPill key={i} tc={tc} />
            ))}
          </div>
        )}

        {message.citations && message.citations.length > 0 && (
          <div
            style={{
              display: "flex",
              flexWrap: "wrap",
              marginTop: 8,
            }}
          >
            {message.citations.map((c, i) => (
              <button
                key={`${c.chunk_id}-${i}`}
                className={
                  c.doc_class === "manual" ? "cite cite-manual" : "cite cite-tribal"
                }
                onClick={() => onCitationClick(c)}
                title={c.source_label}
              >
                <span aria-hidden>{c.doc_class === "manual" ? "📖" : "👤"}</span>
                {c.source_label}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function AttachmentThumb({ attachment }: { attachment: Attachment }) {
  const url = fileUrl(attachment.path);
  if (attachment.kind === "image") {
    return (
      <a
        href={url}
        target="_blank"
        rel="noreferrer"
        style={{
          display: "inline-block",
          border: "1px solid var(--border)",
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
      📄 PDF
    </a>
  );
}

function ToolPill({ tc }: { tc: ToolCall }) {
  const [open, setOpen] = useState(false);
  const label = describeTool(tc);
  return (
    <div style={{ marginRight: 6, marginBottom: 6 }}>
      <span className="tool-pill" onClick={() => setOpen((v) => !v)}>
        🔧 {label}
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
    case "parse_fault_dump":
      return "Parsing fault codes";
    case "request_photo":
      return "Requested photo";
    case "set_ticket_status":
      return "Status changed";
    default:
      return tc.name;
  }
}

function LiveBubble({
  live,
  onCitationClick,
  onPhotoSend,
}: {
  live: LiveAssistant;
  onCitationClick: (c: Citation) => void;
  onPhotoSend: (file: File) => void;
}) {
  return (
    <div style={{ display: "flex", justifyContent: "flex-start" }}>
      <div
        className="chat-message-assistant"
        style={{ maxWidth: "min(80%, 640px)" }}
      >
        <div
          style={{
            fontSize: 11,
            fontWeight: 700,
            textTransform: "uppercase",
            letterSpacing: "0.06em",
            color: "var(--mta)",
            marginBottom: 6,
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
          }}
        >
          <span className="live-dot" /> Railio
        </div>

        <div style={{ display: "flex", flexWrap: "wrap" }}>
          {live.toolCalls.map((tc, i) => (
            <ToolPill key={i} tc={tc} />
          ))}
        </div>

        {live.text ? (
          <Markdown>{live.text}</Markdown>
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

        {live.citations.length > 0 && (
          <div style={{ marginTop: 8 }}>
            {live.citations.map((c, i) => (
              <button
                key={`${c.chunk_id}-${i}`}
                className={
                  c.doc_class === "manual" ? "cite cite-manual" : "cite cite-tribal"
                }
                onClick={() => onCitationClick(c)}
              >
                {c.doc_class === "manual" ? "📖" : "👤"} {c.source_label}
              </button>
            ))}
          </div>
        )}
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
        border: "1px solid var(--mta)",
      }}
    >
      <div
        style={{
          fontSize: 11,
          fontWeight: 700,
          textTransform: "uppercase",
          letterSpacing: "0.06em",
          color: "var(--mta)",
          marginBottom: 6,
        }}
      >
        📷 Photo needed
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
        Send photo →
      </button>
    </div>
  );
}

function Markdown({ children }: { children: string }) {
  return (
    <div className="md">
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{children}</ReactMarkdown>
    </div>
  );
}
