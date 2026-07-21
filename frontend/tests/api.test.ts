import { beforeEach, describe, expect, it, vi } from "vitest";

// Hoisted so the factory below can close over it.
const { getSession } = vi.hoisted(() => ({ getSession: vi.fn() }));

vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({ auth: { getSession } }),
}));

import { apiUrl, authHeaders, currentOrgSlug, fileUrl, orgHeaders } from "@/lib/api";

beforeEach(() => {
  document.cookie = "railio_org=; expires=Thu, 01 Jan 1970 00:00:00 GMT";
  getSession.mockReset();
});

describe("apiUrl", () => {
  it("normalizes a missing leading slash", () => {
    expect(apiUrl("api/tickets")).toBe(apiUrl("/api/tickets"));
  });

  it("points at the backend", () => {
    expect(apiUrl("/api/tickets")).toMatch(/\/api\/tickets$/);
  });
});

describe("fileUrl", () => {
  // undefined, not "" — React drops the attribute entirely rather than issuing
  // a request against the current page URL.
  it("gives undefined for nothing", () => {
    expect(fileUrl(null)).toBeUndefined();
    expect(fileUrl(undefined)).toBeUndefined();
    expect(fileUrl("")).toBeUndefined();
  });

  it("passes an absolute URL through untouched", () => {
    const signed = "https://xyz.supabase.co/storage/v1/object/sign/photo.jpg?token=abc";
    expect(fileUrl(signed)).toBe(signed);
    expect(fileUrl("http://example.com/a.png")).toBe("http://example.com/a.png");
  });

  it("routes a relative path through the backend", () => {
    expect(fileUrl("/api/uploads/x.jpg")).toBe(apiUrl("/api/uploads/x.jpg"));
  });
});

describe("currentOrgSlug", () => {
  it("reads the cookie", () => {
    document.cookie = "railio_org=acme-rail";
    expect(currentOrgSlug()).toBe("acme-rail");
  });

  it("falls back when the cookie is unset", () => {
    expect(currentOrgSlug()).toBeTruthy();
  });

  it("url-decodes the cookie value", () => {
    document.cookie = `railio_org=${encodeURIComponent("org with spaces")}`;
    expect(currentOrgSlug()).toBe("org with spaces");
  });
});

describe("authHeaders", () => {
  it("attaches the bearer token from the session", async () => {
    getSession.mockResolvedValue({ data: { session: { access_token: "tok-123" } } });
    expect(await authHeaders()).toMatchObject({ Authorization: "Bearer tok-123" });
  });

  it("omits Authorization when signed out", async () => {
    getSession.mockResolvedValue({ data: { session: null } });
    expect(await authHeaders()).not.toHaveProperty("Authorization");
  });

  // Deliberate: a Supabase misconfiguration should surface as a backend 401,
  // not as an exception thrown out of every call site.
  it("still returns headers when the session lookup throws", async () => {
    getSession.mockRejectedValue(new Error("supabase down"));
    const headers = await authHeaders();
    expect(headers).not.toHaveProperty("Authorization");
    expect(headers).toHaveProperty("X-Org-Id");
  });

  it("carries the legacy org header, which the backend ignores", async () => {
    document.cookie = "railio_org=acme-rail";
    getSession.mockResolvedValue({ data: { session: null } });
    expect(await authHeaders()).toMatchObject({ "X-Org-Id": "acme-rail" });
    expect(orgHeaders()).toEqual({ "X-Org-Id": "acme-rail" });
  });
});
