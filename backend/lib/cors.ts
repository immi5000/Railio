import { NextRequest, NextResponse } from "next/server";

const ORIGIN = process.env.FRONTEND_ORIGIN ?? "http://localhost:3000";

export function corsHeaders(): Record<string, string> {
  return {
    "Access-Control-Allow-Origin": ORIGIN,
    "Access-Control-Allow-Methods": "GET,POST,PATCH,DELETE,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Max-Age": "86400",
  };
}

export function withCors(res: NextResponse): NextResponse {
  for (const [k, v] of Object.entries(corsHeaders())) res.headers.set(k, v);
  return res;
}

export function json(body: unknown, init?: ResponseInit): NextResponse {
  return withCors(NextResponse.json(body, init));
}

export function jsonError(message: string, status = 400): NextResponse {
  return json({ error: message }, { status });
}

export function preflight(_req: NextRequest): NextResponse {
  return withCors(new NextResponse(null, { status: 204 }));
}
