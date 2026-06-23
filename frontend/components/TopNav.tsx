"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import { getMe } from "@/lib/api";

type NavItem = { href: string; label: string; title?: string; external?: boolean };

// Same navigation options as before — only the styling now mirrors the Figma nav.
const NAV_ITEMS: NavItem[] = [
  { href: "/landing/index.html", label: "← Landing", title: "Back to landing page", external: true },
  { href: "/dashboard", label: "Dashboard" },
  { href: "/work", label: "Tickets" },
  { href: "/knowledge", label: "Knowledge", title: "Browse what the copilot cites" },
  { href: "/admin/fleet", label: "Fleet", title: "Fleet roster & historical records" },
  { href: "/admin/parts", label: "Parts" },
];

function initials(name: string | null | undefined): string {
  if (!name) return "RO";
  const parts = name.trim().split(/\s+/);
  return ((parts[0]?.[0] ?? "") + (parts[1]?.[0] ?? "")).toUpperCase() || "RO";
}

export function TopNav() {
  const pathname = usePathname();
  const router = useRouter();
  const [open, setOpen] = useState(false);

  const standalone =
    pathname === "/signin" ||
    pathname === "/onboarding" ||
    (pathname?.startsWith("/auth") ?? false);

  const { data: me } = useQuery({
    queryKey: ["me"],
    queryFn: getMe,
    enabled: !standalone,
    staleTime: 60_000,
    retry: false,
  });

  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  // The sign-in, onboarding, and OAuth-callback screens stand alone — no chrome.
  if (standalone) return null;

  async function signOut() {
    try {
      await createClient().auth.signOut();
    } finally {
      router.replace("/signin");
    }
  }

  function isActive(item: NavItem): boolean {
    if (item.external) return false;
    return pathname === item.href || (pathname?.startsWith(`${item.href}/`) ?? false);
  }

  const navLinks = NAV_ITEMS.map((item) => {
    const active = isActive(item);
    const inner = (
      <>
        {active && <span className="fig-nav-dot" />}
        {item.label}
      </>
    );
    return item.external ? (
      <a
        key={item.href}
        href={item.href}
        className="fig-nav-link"
        data-active={active}
        title={item.title}
      >
        {inner}
      </a>
    ) : (
      <Link
        key={item.href}
        href={item.href}
        className="fig-nav-link"
        data-active={active}
        title={item.title}
      >
        {inner}
      </Link>
    );
  });

  return (
    <header className="fig-nav">
      <div className="fig-nav-inner">
        <Link href="/dashboard" className="fig-brand">
          <span className="mk">
            <i />
          </span>
          Railio
        </Link>

        <nav className="fig-nav-links fig-nav-links--desktop">{navLinks}</nav>

        <div className="fig-nav-user">
          {(me?.name || me?.org) && (
            <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", lineHeight: 1.2 }}>
              {me?.name && <span className="fig-user-name">{me.name}</span>}
              {me?.org && <span className="fig-user-org">{me.org.name}</span>}
            </div>
          )}
          <span className="fig-avatar" title={me?.email ?? undefined}>
            {initials(me?.name)}
          </span>
          <button type="button" onClick={signOut} className="fig-signout">
            Sign out
          </button>
          <button
            type="button"
            aria-label={open ? "Close menu" : "Open menu"}
            aria-expanded={open}
            className="fig-nav-burger"
            onClick={() => setOpen((v) => !v)}
          >
            <span />
            <span />
            <span />
          </button>
        </div>
      </div>

      <div className={`fig-nav-drawer${open ? " is-open" : ""}`}>
        <nav className="fig-nav-links" onClick={() => setOpen(false)}>
          {navLinks}
          <button type="button" onClick={signOut} className="fig-signout">
            Sign out
          </button>
        </nav>
      </div>
    </header>
  );
}
