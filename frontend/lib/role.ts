"use client";

export type Role = "dispatcher" | "tech";

const COOKIE = "role";

export function setRoleCookie(role: Role) {
  if (typeof document === "undefined") return;
  // 30 days; not Secure on localhost.
  document.cookie = `${COOKIE}=${role}; path=/; max-age=${60 * 60 * 24 * 30}`;
}

export function getRoleCookie(): Role | null {
  if (typeof document === "undefined") return null;
  const m = document.cookie.match(/(?:^|; )role=([^;]+)/);
  if (!m) return null;
  const v = decodeURIComponent(m[1]);
  return v === "dispatcher" || v === "tech" ? v : null;
}

export function clearRoleCookie() {
  if (typeof document === "undefined") return;
  document.cookie = `${COOKIE}=; path=/; max-age=0`;
}
