import type OpenAI from "openai";
import { searchCorpus } from "./search-corpus";
import { parseFaultDump } from "./parse-fault-dump";
import { lookupParts } from "./lookup-parts";
import { recordPartUsed } from "./record-part-used";
import { updateFormField } from "./update-form-field";
import { setTicketStatus } from "./set-ticket-status";
import type { StreamEvent } from "@contract/contract";

// OpenAI Chat Completions tool definitions (function calling).
export const TOOL_DEFS: OpenAI.Chat.Completions.ChatCompletionTool[] = [
  {
    type: "function",
    function: {
      name: "search_corpus",
      description:
        "Vector-search the corpus across both doc classes. Returns top-k chunks with (id, doc_class, doc_id, doc_title, source_label, page, text). Prefer manual chunks; fall back to tribal_knowledge.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string" },
          k: { type: "number", default: 6 },
          doc_class_filter: {
            type: "string",
            enum: ["manual", "tribal_knowledge", "any"],
            default: "any",
          },
        },
        required: ["query"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "parse_fault_dump",
      description:
        "Parse a raw locomotive diagnostic dump into structured {code, ts, severity, description}[]. Persists to tickets.fault_dump_parsed. Call once on dispatcher intake.",
      parameters: {
        type: "object",
        properties: {
          ticket_id: { type: "number" },
          raw_text: { type: "string" },
        },
        required: ["ticket_id", "raw_text"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "request_photo",
      description:
        "Ask the user to send a photo. Renders an inline upload prompt in the chat. Use whenever the user's words are ambiguous about a physical condition.",
      parameters: {
        type: "object",
        properties: {
          prompt: { type: "string" },
          reason: { type: "string" },
        },
        required: ["prompt", "reason"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "lookup_parts",
      description:
        "Look up parts compatible with the given unit_model and matching the query. The query is tokenized — each whitespace-separated word is matched independently against name, description, and part_number, and results are ranked by how many tokens hit. Prefer SHORT keyword queries over full phrases: use \"brake shoe\" not \"brake shoe component for the truck\", and use \"injector\" not \"fuel injector replacement\". If the first query returns no matches, retry with a single broader keyword (e.g. \"brake\", \"fuel\", \"traction\") before telling the user the part isn't stocked.",
      parameters: {
        type: "object",
        properties: {
          unit_model: { type: "string", enum: ["ES44AC", "ET44AC"] },
          query: { type: "string" },
        },
        required: ["unit_model", "query"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "record_part_used",
      description:
        "Record a part as used on this repair. Writes to ticket_parts (which the right-pane shows) and adds the part_number to F6180_49A.repairs[<last>].parts_replaced if a repair entry exists.",
      parameters: {
        type: "object",
        properties: {
          ticket_id: { type: "number" },
          part_id: { type: "number" },
          qty: { type: "number" },
        },
        required: ["ticket_id", "part_id", "qty"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "update_form_field",
      description:
        "Update one field on one of the two forms for this ticket. Examples: form_type='F6180_49A' field_path='items[2].result' value='pass'; or form_type='DAILY_INSPECTION_229_21' field_path='items[5].note' value='oil sheen at #3'.",
      parameters: {
        type: "object",
        properties: {
          ticket_id: { type: "number" },
          form_type: {
            type: "string",
            enum: ["F6180_49A", "DAILY_INSPECTION_229_21"],
          },
          field_path: { type: "string" },
          value: {},
          source_message_id: { type: "number" },
        },
        required: ["ticket_id", "form_type", "field_path", "value", "source_message_id"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "set_ticket_status",
      description: "Update the ticket lifecycle. Limited to legal transitions.",
      parameters: {
        type: "object",
        properties: {
          ticket_id: { type: "number" },
          status: {
            type: "string",
            enum: ["AWAITING_TECH", "IN_PROGRESS", "AWAITING_REVIEW", "CLOSED"],
          },
        },
        required: ["ticket_id", "status"],
      },
    },
  },
];

export type ToolEmit = (ev: StreamEvent) => void;

export async function executeTool(
  name: string,
  input: Record<string, unknown>,
  emit: ToolEmit
): Promise<Record<string, unknown>> {
  switch (name) {
    case "search_corpus":
      return await searchCorpus(input as any);
    case "parse_fault_dump":
      return await parseFaultDump(input as any, emit);
    case "request_photo":
      emit({
        type: "request_photo",
        prompt: String(input.prompt ?? ""),
        reason: String(input.reason ?? ""),
      });
      return { ok: true, requested: true };
    case "lookup_parts":
      return await lookupParts(input as any);
    case "record_part_used":
      return await recordPartUsed(input as any, emit);
    case "update_form_field":
      return await updateFormField(input as any, emit);
    case "set_ticket_status":
      return await setTicketStatus(input as any);
    default:
      return { error: `unknown tool: ${name}` };
  }
}
