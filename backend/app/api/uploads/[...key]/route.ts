import type { NextRequest } from "next/server";
import { jsonError, preflight } from "@/lib/cors";
import { signStorageKey } from "@/lib/storage";

export async function OPTIONS(req: NextRequest) {
  return preflight(req);
}

export async function GET(_req: NextRequest, ctx: { params: Promise<{ key: string[] }> }) {
  const { key } = await ctx.params;
  if (!key?.length) return jsonError("missing key", 400);
  const storageKey = key.map(decodeURIComponent).join("/");
  try {
    const signed = await signStorageKey(storageKey);
    return Response.redirect(signed, 302);
  } catch (e) {
    return jsonError((e as Error).message, 404);
  }
}
