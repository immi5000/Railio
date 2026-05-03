import type { NextRequest } from "next/server";
import { randomUUID } from "node:crypto";
import { json, jsonError, preflight } from "@/lib/cors";
import { uploadToBucket } from "@/lib/storage";
import type { Attachment } from "@contract/contract";

export async function OPTIONS(req: NextRequest) {
  return preflight(req);
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const formData = await req.formData();
  const files = formData.getAll("files") as File[];
  if (!files.length) return jsonError("no files", 400);

  const attachments: Attachment[] = [];
  for (const file of files) {
    if (!file || typeof (file as any).arrayBuffer !== "function") continue;
    const ext = (file.name.match(/\.[^.]+$/)?.[0] ?? "").toLowerCase();
    const filename = `${Date.now()}-${randomUUID()}${ext}`;
    const storageKey = `${id}/${filename}`;
    const buf = Buffer.from(await file.arrayBuffer());
    const mime = file.type || guessMime(ext);
    const path = await uploadToBucket(storageKey, buf, mime);
    const kind: "image" | "pdf" = mime === "application/pdf" ? "pdf" : "image";
    attachments.push({ kind, path, mime });
  }
  return json({ attachments });
}

function guessMime(ext: string): string {
  switch (ext) {
    case ".png": return "image/png";
    case ".jpg":
    case ".jpeg": return "image/jpeg";
    case ".webp": return "image/webp";
    case ".gif": return "image/gif";
    case ".pdf": return "application/pdf";
    default: return "application/octet-stream";
  }
}
