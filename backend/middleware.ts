import { NextResponse, type NextRequest } from "next/server";

// Comma-separated allowlist. e.g. "https://railiosystems.vercel.app,https://railio.xyz"
const ALLOWED = (process.env.FRONTEND_ORIGIN ?? "http://localhost:3000")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

function isAllowed(origin: string | null): origin is string {
  if (!origin) return false;
  if (ALLOWED.includes(origin)) return true;
  // Allow Vercel preview deploys for the configured project (origin ends with .vercel.app
  // and matches a wildcard if the user used "*.vercel.app" in the allowlist).
  return ALLOWED.some(
    (a) => a.startsWith("*.") && origin.endsWith(a.slice(1))
  );
}

function corsHeaders(origin: string): Record<string, string> {
  return {
    "Access-Control-Allow-Origin": origin,
    "Vary": "Origin",
    "Access-Control-Allow-Methods": "GET,POST,PATCH,DELETE,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Max-Age": "86400",
  };
}

export function middleware(req: NextRequest) {
  const origin = req.headers.get("origin");

  // Preflight
  if (req.method === "OPTIONS") {
    if (isAllowed(origin)) {
      return new NextResponse(null, { status: 204, headers: corsHeaders(origin) });
    }
    return new NextResponse(null, { status: 204 });
  }

  const res = NextResponse.next();
  if (isAllowed(origin)) {
    for (const [k, v] of Object.entries(corsHeaders(origin))) res.headers.set(k, v);
  }
  return res;
}

export const config = {
  matcher: "/api/:path*",
};
