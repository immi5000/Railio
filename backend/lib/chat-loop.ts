import type OpenAI from "openai";
import { getOpenAI, OPENAI_CHAT_MODEL } from "./openai";
import { SYSTEM_PROMPT } from "./system-prompt";
import { TOOL_DEFS, executeTool, type ToolEmit } from "./tools";
import { insertMessage, listMessages } from "./messages-repo";
import { getTicketDetail } from "./tickets-repo";
import { getStorage, STORAGE_BUCKET, STORAGE_URL_PREFIX } from "./storage";
import type {
  Attachment,
  Citation,
  Form,
  Message,
  ToolCall,
} from "@contract/contract";

// Convert our DB messages → OpenAI Chat Completions messages.
async function toOpenAIMessages(history: Message[]): Promise<OpenAI.Chat.Completions.ChatCompletionMessageParam[]> {
  const out: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
    { role: "system", content: SYSTEM_PROMPT },
  ];
  for (const m of history) {
    if (m.role === "system" || m.role === "tool") continue;
    if (m.role === "assistant") {
      if (m.content) out.push({ role: "assistant", content: m.content });
      continue;
    }
    const parts: OpenAI.Chat.Completions.ChatCompletionContentPart[] = [];
    if (m.attachments) {
      for (const a of m.attachments) {
        if (a.kind === "image" && a.path) {
          const b64 = await readImageBase64(a.path);
          if (b64) {
            parts.push({
              type: "image_url",
              image_url: { url: `data:${a.mime};base64,${b64}` },
            });
          }
        }
      }
    }
    parts.push({ type: "text", text: `[${m.role}] ${m.content}` });
    out.push({ role: "user", content: parts });
  }
  return out;
}

async function buildTicketContext(ticket_id: number): Promise<string | null> {
  const t = await getTicketDetail(ticket_id);
  if (!t) return null;
  const lines: string[] = ["=== TICKET CONTEXT ==="];
  lines.push(
    `Ticket: #${t.id} · status: ${t.status} · severity: ${t.severity} · opened: ${t.opened_at}` +
      (t.closed_at ? ` · closed: ${t.closed_at}` : "")
  );
  const a = t.asset;
  const inSvc = a.in_service_date ? `, in service since ${a.in_service_date}` : "";
  const lastInsp = a.last_inspection_at ? `, last inspected ${a.last_inspection_at}` : "";
  lines.push(`Asset: ${a.reporting_mark} ${a.road_number} — ${a.unit_model}${inSvc}${lastInsp}.`);

  if (t.initial_symptoms) lines.push(`Initial symptoms: ${t.initial_symptoms}`);
  if (t.initial_error_codes) lines.push(`Initial error codes: ${t.initial_error_codes}`);

  if (t.fault_dump_parsed && t.fault_dump_parsed.length > 0) {
    lines.push("Parsed faults:");
    for (const f of t.fault_dump_parsed) {
      const ts = f.ts ? ` at ${f.ts}` : "";
      lines.push(`  - ${f.code} (${f.severity})${ts} — ${f.description}`);
    }
  }

  if (t.pre_arrival_summary) lines.push(`Pre-arrival summary: ${t.pre_arrival_summary}`);

  if (t.ticket_parts.length > 0) {
    lines.push("Parts already used on this repair:");
    for (const tp of t.ticket_parts) lines.push(`  - part_id=${tp.part_id} qty=${tp.qty}`);
  }

  const fra = t.forms.find((f) => f.form_type === "F6180_49A") as
    | (Form & { form_type: "F6180_49A" })
    | undefined;
  if (fra?.payload) {
    const fp = fra.payload;
    if (fp.defects.length > 0) {
      lines.push("Open defects on F6180_49A:");
      for (const d of fp.defects) {
        lines.push(`  - ${d.fra_part} @ ${d.location} (${d.severity}) — ${d.description}`);
      }
    }
    if (fp.repairs.length > 0) {
      lines.push("Repairs already recorded on F6180_49A:");
      for (const r of fp.repairs) {
        const parts = r.parts_replaced?.length ? ` [${r.parts_replaced.join(", ")}]` : "";
        lines.push(`  - ${r.description} @ ${r.completed_at}${parts}`);
      }
    }
  }

  const daily = t.forms.find((f) => f.form_type === "DAILY_INSPECTION_229_21") as
    | (Form & { form_type: "DAILY_INSPECTION_229_21" })
    | undefined;
  if (daily?.payload) {
    const failed = daily.payload.items.filter((i) => i.result === "fail");
    if (failed.length > 0) {
      lines.push("Failed items on Daily §229.21 inspection:");
      for (const f of failed) {
        lines.push(`  - ${f.cfr_ref} ${f.label}${f.note ? ` (${f.note})` : ""}`);
      }
    }
  }

  lines.push("======================");
  return lines.join("\n");
}

async function readImageBase64(p: string): Promise<string | null> {
  try {
    if (!p.startsWith(STORAGE_URL_PREFIX + "/")) return null;
    const storageKey = p.slice(STORAGE_URL_PREFIX.length + 1);
    const { data, error } = await getStorage().storage.from(STORAGE_BUCKET).download(storageKey);
    if (error || !data) return null;
    const buf = Buffer.from(await data.arrayBuffer());
    return buf.toString("base64");
  } catch {
    return null;
  }
}

export type RunChatInput = {
  ticket_id: number;
  user_role: "dispatcher" | "tech";
  user_content: string;
  attachments: Attachment[];
};

const MAX_TOOL_ROUNDS = 8;

type StreamedToolCall = {
  id: string;
  name: string;
  argsJson: string;
};

export async function runChat(inp: RunChatInput, emit: ToolEmit): Promise<void> {
  const userMsg = await insertMessage({
    ticket_id: inp.ticket_id,
    role: inp.user_role,
    content: inp.user_content,
    attachments: inp.attachments.length ? inp.attachments : null,
  });
  emit({ type: "user_message_persisted", message: userMsg });

  const client = getOpenAI();
  const history = await listMessages(inp.ticket_id);
  const messages = await toOpenAIMessages(history);

  const isFirstTurn = history.length === 1;
  if (isFirstTurn) {
    const ctx = await buildTicketContext(inp.ticket_id);
    if (ctx) messages.splice(1, 0, { role: "system", content: ctx });
  }

  let assistantText = "";
  const allToolCalls: ToolCall[] = [];
  const allCitations: Citation[] = [];

  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    const stream = await client.chat.completions.create({
      model: OPENAI_CHAT_MODEL,
      messages,
      tools: TOOL_DEFS,
      stream: true,
    });

    let textThisRound = "";
    const toolByIndex = new Map<number, StreamedToolCall>();
    let finishReason: string | null = null;

    for await (const chunk of stream) {
      const choice = chunk.choices[0];
      if (!choice) continue;
      const delta = choice.delta;
      if (delta?.content) {
        textThisRound += delta.content;
        emit({ type: "assistant_token", delta: delta.content });
      }
      if (delta?.tool_calls) {
        for (const tc of delta.tool_calls) {
          const idx = tc.index ?? 0;
          const cur = toolByIndex.get(idx) ?? { id: "", name: "", argsJson: "" };
          if (tc.id) cur.id = tc.id;
          if (tc.function?.name) cur.name = tc.function.name;
          if (tc.function?.arguments) cur.argsJson += tc.function.arguments;
          toolByIndex.set(idx, cur);
        }
      }
      if (choice.finish_reason) finishReason = choice.finish_reason;
    }

    assistantText += textThisRound;

    if (toolByIndex.size === 0 || finishReason === "stop") {
      messages.push({ role: "assistant", content: textThisRound });
      break;
    }

    const assistantMessage: OpenAI.Chat.Completions.ChatCompletionAssistantMessageParam = {
      role: "assistant",
      content: textThisRound || null,
      tool_calls: Array.from(toolByIndex.values())
        .sort((a, b) => Number(a.id > b.id) - Number(a.id < b.id))
        .map((t) => ({
          id: t.id,
          type: "function" as const,
          function: { name: t.name, arguments: t.argsJson || "{}" },
        })),
    };
    messages.push(assistantMessage);

    for (const t of toolByIndex.values()) {
      let input: Record<string, unknown> = {};
      try {
        input = t.argsJson ? JSON.parse(t.argsJson) : {};
      } catch {
        input = { _raw: t.argsJson };
      }
      emit({ type: "tool_call_started", name: t.name, input, call_id: t.id });

      let output: Record<string, unknown> = {};
      try {
        output = await executeTool(t.name, input, emit);
      } catch (e) {
        output = { error: String(e) };
      }
      emit({ type: "tool_call_completed", call_id: t.id, output });

      allToolCalls.push({ name: t.name, input, output, call_id: t.id });

      if (t.name === "search_corpus" && Array.isArray((output as any).chunks)) {
        for (const c of (output as any).chunks as any[]) {
          if (!allCitations.some((x) => x.chunk_id === c.id)) {
            allCitations.push({
              doc_class: c.doc_class,
              doc_id: c.doc_id,
              page: c.page,
              source_label: c.source_label,
              chunk_id: c.id,
            });
          }
        }
      }

      messages.push({
        role: "tool",
        tool_call_id: t.id,
        content: JSON.stringify(output),
      });
    }
  }

  const assistantMsg = await insertMessage({
    ticket_id: inp.ticket_id,
    role: "assistant",
    content: assistantText.trim(),
    citations: allCitations.length ? allCitations : null,
    tool_calls: allToolCalls.length ? allToolCalls : null,
  });
  emit({ type: "assistant_message_persisted", message: assistantMsg });
  emit({ type: "done" });
}
