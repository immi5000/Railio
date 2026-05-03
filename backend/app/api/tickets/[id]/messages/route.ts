import type { NextRequest } from "next/server";
import path from "node:path";
import { jsonError, preflight } from "@/lib/cors";
import { runChat } from "@/lib/chat-loop";
import type { Attachment, SendMessageBody, StreamEvent } from "@contract/contract";

export async function OPTIONS(req: NextRequest) {
  return preflight(req);
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const ticket_id = Number(id);

  let body: SendMessageBody;
  try {
    body = (await req.json()) as SendMessageBody;
  } catch {
    return jsonError("invalid json", 400);
  }
  if (!body.role || !body.content) return jsonError("role and content required", 400);

  const attachments: Attachment[] = (body.attachment_paths ?? []).map((p) => {
    const ext = path.extname(p).toLowerCase();
    const mime =
      ext === ".png"
        ? "image/png"
        : ext === ".jpg" || ext === ".jpeg"
        ? "image/jpeg"
        : ext === ".webp"
        ? "image/webp"
        : ext === ".gif"
        ? "image/gif"
        : ext === ".pdf"
        ? "application/pdf"
        : "application/octet-stream";
    const kind: "image" | "pdf" = mime === "application/pdf" ? "pdf" : "image";
    return { kind, path: p, mime };
  });

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (ev: StreamEvent) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(ev)}\n\n`));
      };
      try {
        await runChat(
          {
            ticket_id,
            user_role: body.role,
            user_content: body.content,
            attachments,
          },
          send
        );
      } catch (e) {
        send({ type: "error", error: String(e) });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
