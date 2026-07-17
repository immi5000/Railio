/**
 * ChatPane's decoding of the SSE stream.
 *
 * The backend contract is proven live in backend/tests/chat; this proves the
 * other half — that the UI turns those events into the right thing. The stream
 * is scripted rather than real, so every branch (including a 429 and a mid-turn
 * error) is reachable without a server.
 */
import type { Message, StreamEvent, TicketDetail } from "@contract";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { fetchEventSource, getTicket, uploadPhotos, getCorpusChunk } = vi.hoisted(() => ({
  fetchEventSource: vi.fn(),
  getTicket: vi.fn(),
  uploadPhotos: vi.fn(),
  getCorpusChunk: vi.fn(),
}));

vi.mock("@microsoft/fetch-event-source", () => ({ fetchEventSource }));
vi.mock("@/lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api")>()),
  getTicket,
  uploadPhotos,
  getCorpusChunk,
  addTicketPart: vi.fn(),
  removeTicketPart: vi.fn(),
  authHeaders: vi.fn(async () => ({})),
}));
// MicButton reaches for SpeechRecognition, which jsdom has no notion of.
vi.mock("@/components/MicButton", () => ({ MicButton: () => null }));

import { ChatPane } from "@/components/ChatPane";

const TICKET: TicketDetail = {
  id: 1,
  short_id: "ABC123",
  title: "smoke from the blower",
  org_id: 33,
  asset: {
    id: 84,
    org_id: 33,
    reporting_mark: "RTUN",
    road_number: "3814",
    unit_model: "EMD GP38-2",
    in_service_date: null,
    last_92_day_at: null,
    last_368_day_at: null,
    last_1104_day_at: null,
    out_of_service: false,
    oos_since: null,
    oos_periods: [],
  },
  status: "IN_PROGRESS",
  severity: "major",
  opened_at: "2026-07-01T10:00:00.000Z",
  initial_error_codes: null,
  initial_symptoms: null,
  fault_dump_raw: null,
  fault_dump_parsed: null,
  pre_arrival_summary: null,
  closed_at: null,
  is_pristine: false,
  messages: [],
  ticket_parts: [],
};

function msg(id: number, role: Message["role"], content: string, extra: Partial<Message> = {}): Message {
  return {
    id,
    ticket_id: 1,
    role,
    content,
    citations: null,
    attachments: null,
    tool_calls: null,
    created_at: "2026-07-01T10:00:00.000Z",
    prev_hash: null,
    hash: `h${id}`,
    ...extra,
  };
}

/** Scripted stream: every event is delivered to onmessage in order. */
function script(events: StreamEvent[]) {
  fetchEventSource.mockImplementation(async (_url: string, opts: any) => {
    await opts.onopen?.({ ok: true, status: 200, headers: new Headers() });
    for (const ev of events) opts.onmessage({ data: JSON.stringify(ev) });
  });
}

/**
 * A stream the test drives event by event, so mid-turn state (the live bubble,
 * the inline uploader) can be asserted before the turn ends and clears it.
 */
function controlledStream() {
  let opts: any;
  const opened = new Promise<void>((resolve) => {
    fetchEventSource.mockImplementation(async (_url: string, o: any) => {
      opts = o;
      await o.onopen?.({ ok: true, status: 200, headers: new Headers() });
      resolve();
    });
  });
  return {
    opened,
    push: (ev: StreamEvent) => opts.onmessage({ data: JSON.stringify(ev) }),
  };
}

function renderPane(role: "tech" | "dispatcher" = "tech") {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <ChatPane ticketId="ABC123" role={role} />
    </QueryClientProvider>,
  );
  return { user: userEvent.setup(), qc };
}

async function send(user: ReturnType<typeof userEvent.setup>, text = "hello") {
  const box = await screen.findByPlaceholderText(/./);
  await user.type(box, text);
  await user.click(screen.getByLabelText("Send"));
}

beforeEach(() => {
  getTicket.mockResolvedValue(TICKET);
});

describe("ChatPane streaming", () => {
  it("renders the user's message and the streamed reply", async () => {
    script([
      { type: "user_message_persisted", message: msg(1, "tech", "hello") },
      { type: "assistant_token", delta: "Check " },
      { type: "assistant_token", delta: "the relay." },
      { type: "assistant_message_persisted", message: msg(2, "assistant", "Check the relay.") },
      { type: "done" },
    ] as StreamEvent[]);

    const { user } = renderPane();
    await send(user);

    expect(await screen.findByText("hello")).toBeInTheDocument();
    expect(await screen.findByText("Check the relay.")).toBeInTheDocument();
  });

  it("accumulates tokens in order", async () => {
    script([
      { type: "user_message_persisted", message: msg(1, "tech", "hi") },
      ...["A", "B", "C", "D"].map((delta) => ({ type: "assistant_token", delta })),
      { type: "assistant_message_persisted", message: msg(2, "assistant", "ABCD") },
      { type: "done" },
    ] as StreamEvent[]);

    const { user } = renderPane();
    await send(user, "hi");
    expect(await screen.findByText("ABCD")).toBeInTheDocument();
  });

  it("does not double-render a message that streamed and then persisted", async () => {
    script([
      { type: "user_message_persisted", message: msg(1, "tech", "just once") },
      { type: "assistant_token", delta: "reply" },
      { type: "assistant_message_persisted", message: msg(2, "assistant", "reply") },
      { type: "done" },
    ] as StreamEvent[]);

    const { user } = renderPane();
    await send(user, "just once");
    await screen.findByText("reply");
    expect(screen.getAllByText("reply")).toHaveLength(1);
    expect(screen.getAllByText("just once")).toHaveLength(1);
  });

  it("shows a running tool's label mid-turn, then keeps it on the finished message", async () => {
    const s = controlledStream();
    const { user } = renderPane();
    await send(user, "q");
    await s.opened;

    s.push({ type: "user_message_persisted", message: msg(1, "tech", "q") });
    s.push({ type: "tool_call_started", name: "search_corpus", input: { query: "relay" }, call_id: "c1" });
    expect(await screen.findByText("Checking the manual...")).toBeInTheDocument();

    s.push({ type: "tool_call_completed", call_id: "c1", output: { chunks: [] } });
    // The finished message carries the tool_calls, so the pill survives the
    // live bubble being cleared — and survives a reload.
    s.push({
      type: "assistant_message_persisted",
      message: msg(2, "assistant", "done", {
        tool_calls: [{ name: "search_corpus", input: { query: "relay" }, output: { chunks: [] }, call_id: "c1" }],
      }),
    });
    s.push({ type: "done" });

    expect(await screen.findByText("done")).toBeInTheDocument();
    expect(screen.getByText("Checking the manual...")).toBeInTheDocument();
  });

  it("renders the photo request inline while the turn is live", async () => {
    const s = controlledStream();
    const { user } = renderPane();
    await send(user, "oil everywhere");
    await s.opened;

    s.push({ type: "user_message_persisted", message: msg(1, "tech", "oil everywhere") });
    s.push({ type: "tool_call_started", name: "request_photo", input: {}, call_id: "c1" });
    s.push({
      type: "request_photo",
      prompt: "Send a photo of the pooling oil.",
      reason: "need to see the source",
    });

    // Deliberately live-only: the uploader rides on the live bubble and is gone
    // once the turn persists (the composer's own Attach button remains).
    expect(await screen.findByText("Send a photo of the pooling oil.")).toBeInTheDocument();
  });

  it("renders a shown figure from the persisted tool_calls", async () => {
    // The figure is reconstructed from tool_calls rather than a message field,
    // which is what keeps the hash chain untouched — so the persisted output
    // shape is load-bearing, not incidental.
    const figure = {
      path: "/api/uploads/fig.png",
      caption: "Ground relay wiring",
      page: 230,
      figure_label: "Fig. DG-1",
      callouts: [],
    };
    script([
      { type: "user_message_persisted", message: msg(1, "tech", "diagram?") },
      { type: "tool_call_started", name: "show_figure", input: { chunk_id: 5 }, call_id: "c1" },
      { type: "show_figure", chunk_id: 5, figure },
      { type: "tool_call_completed", call_id: "c1", output: { ok: true, chunk_id: 5, figure } },
      {
        type: "assistant_message_persisted",
        message: msg(2, "assistant", "here", {
          tool_calls: [
            { name: "show_figure", input: { chunk_id: 5 }, output: { ok: true, chunk_id: 5, figure }, call_id: "c1" },
          ],
        }),
      },
      { type: "done" },
    ] as StreamEvent[]);

    const { user } = renderPane();
    await send(user, "diagram?");
    await waitFor(() => {
      expect(document.querySelector('img[src*="fig.png"]')).not.toBeNull();
    });
  });

  it("skips a figure whose tool call failed", async () => {
    script([
      { type: "user_message_persisted", message: msg(1, "tech", "diagram?") },
      {
        type: "assistant_message_persisted",
        message: msg(2, "assistant", "no figure", {
          tool_calls: [
            { name: "show_figure", input: { chunk_id: 5 }, output: { ok: false, error: "no such figure" }, call_id: "c1" },
          ],
        }),
      },
      { type: "done" },
    ] as StreamEvent[]);

    const { user } = renderPane();
    await send(user, "diagram?");
    await screen.findByText("no figure");
    expect(document.querySelector('img[src*="fig.png"]')).toBeNull();
  });

  it("drops an image the model wrote itself", async () => {
    // Verbatim from a real reply (message 1233): having seen a figure path in
    // show_figure's result, the model invented a host for it and embedded the
    // image alongside the thumbnail show_figure had already rendered. The URL
    // does not exist, so it 404s into a broken-image box mid-paragraph.
    const hallucinated =
      "![Fig.AR10-13](https://urlcube.com/api/uploads/manuals/emd_gp38_2/p115-full-fig146.png)";
    script([
      { type: "user_message_persisted", message: msg(1, "tech", "diagram?") },
      {
        type: "assistant_message_persisted",
        message: msg(2, "assistant", `Here is the circuit: ${hallucinated}`),
      },
      { type: "done" },
    ] as StreamEvent[]);

    const { user } = renderPane();
    await send(user, "diagram?");
    await screen.findByText(/Here is the circuit/);
    expect(document.querySelector("img[src*='urlcube']")).toBeNull();
    expect(document.querySelectorAll(".md img")).toHaveLength(0);
  });

  it("surfaces a mid-stream error", async () => {
    script([
      { type: "user_message_persisted", message: msg(1, "tech", "x") },
      { type: "error", error: "the model exploded" },
    ] as StreamEvent[]);

    const { user } = renderPane();
    await send(user, "x");
    expect(await screen.findByText(/the model exploded/)).toBeInTheDocument();
  });

  it("ignores a malformed frame instead of tearing down the stream", async () => {
    fetchEventSource.mockImplementation(async (_url: string, opts: any) => {
      await opts.onopen?.({ ok: true, status: 200, headers: new Headers() });
      opts.onmessage({ data: "{not json" });
      opts.onmessage({ data: "" });
      opts.onmessage({
        data: JSON.stringify({ type: "assistant_message_persisted", message: msg(2, "assistant", "survived") }),
      });
      opts.onmessage({ data: JSON.stringify({ type: "done" }) });
    });

    const { user } = renderPane();
    await send(user, "x");
    expect(await screen.findByText("survived")).toBeInTheDocument();
  });

  it("explains a rate limit rather than showing a generic failure", async () => {
    fetchEventSource.mockImplementation(async (_url: string, opts: any) => {
      await opts.onopen?.({
        ok: false,
        status: 429,
        headers: new Headers({ "Retry-After": "30" }),
        json: async () => ({ detail: "rate limited" }),
      });
    });

    const { user } = renderPane();
    await send(user, "x");
    // Names the wait explicitly, from the Retry-After header — a bare
    // "Connection failed" would read as a bug rather than a cooldown.
    expect(await screen.findByText(/too fast — try again in 30s/)).toBeInTheDocument();
  });
});

describe("citation links", () => {
  const citation = {
    chunk_id: 1234,
    doc_class: "manual" as const,
    doc_id: "emd_gp38",
    page: 230,
    source_label: "EMD GP38-2 / SD38-2 Locomotive Service Manual — PDF p.230",
  };

  it("renders the recorded source_label, not whatever the model typed", async () => {
    // The model is told to copy source_label verbatim and mostly does, but it
    // drifts — toward a figure name, or a merged page range the single-chunk
    // link can't deliver. The label is derived from the citation array so the
    // tech always reads the true source.
    getTicket.mockResolvedValue({
      ...TICKET,
      messages: [
        msg(1, "assistant", "The relay trips [Fig. DG-1](cite:1234) under load.", {
          citations: [citation],
        }),
      ],
    });

    renderPane();
    const link = await screen.findByRole("link");
    expect(link).toHaveTextContent(citation.source_label);
    expect(link).not.toHaveTextContent("Fig. DG-1");
  });

  it("falls back to the model's text for a chunk it has no citation for", async () => {
    getTicket.mockResolvedValue({
      ...TICKET,
      messages: [msg(1, "assistant", "See [some label](cite:9999).", { citations: [citation] })],
    });

    renderPane();
    expect(await screen.findByRole("link")).toHaveTextContent("some label");
  });

  it("leaves ordinary links alone", async () => {
    getTicket.mockResolvedValue({
      ...TICKET,
      messages: [msg(1, "assistant", "[docs](https://example.com)", { citations: [citation] })],
    });

    renderPane();
    const link = await screen.findByRole("link");
    expect(link).toHaveTextContent("docs");
    expect(link).toHaveAttribute("href", "https://example.com");
  });
});

describe("ChatPane history", () => {
  it("renders tool calls from a reloaded thread", async () => {
    getTicket.mockResolvedValue({
      ...TICKET,
      messages: [
        msg(1, "tech", "earlier question"),
        msg(2, "assistant", "earlier answer", {
          tool_calls: [
            // Historical only: parse_fault_dump is no longer a chat tool, but
            // hash-chained rows that already carry it must still render.
            { name: "parse_fault_dump", input: {}, output: {}, call_id: "old" },
          ],
        }),
      ],
    });

    renderPane();
    expect(await screen.findByText("earlier answer")).toBeInTheDocument();
    expect(screen.getByText("Parsing fault codes")).toBeInTheDocument();
  });
});
