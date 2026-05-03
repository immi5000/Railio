import { NextRequest, NextResponse } from "next/server";

// CORS headers are added by backend/middleware.ts for all /api/* routes.
// These helpers just produce JSON responses — middleware decorates them.

export function json(body: unknown, init?: ResponseInit): NextResponse {
  return NextResponse.json(body, init);
}

export function jsonError(message: string, status = 400): NextResponse {
  return json({ error: message }, { status });
}

export function preflight(_req: NextRequest): NextResponse {
  // Middleware already handles OPTIONS; this is just a fallback.
  return new NextResponse(null, { status: 204 });
}
