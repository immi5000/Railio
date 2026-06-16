"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import { getMe } from "@/lib/api";

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

  const links = (
    <>
      <a
        href="/landing/index.html"
        style={navLinkStyle(false)}
        title="Back to landing page"
      >
        ← Landing
      </a>
      <Link
        href="/work"
        style={navLinkStyle(pathname?.startsWith("/work") ?? false)}
      >
        Tickets
      </Link>
      <Link
        href="/knowledge"
        style={navLinkStyle(pathname?.startsWith("/knowledge") ?? false)}
        title="Browse what the copilot cites"
      >
        Knowledge
      </Link>
      <Link
        href="/admin/fleet"
        style={navLinkStyle(pathname?.startsWith("/admin/fleet") ?? false)}
        title="Fleet roster & historical records"
      >
        Fleet
      </Link>
      <Link
        href="/admin/parts"
        style={navLinkStyle(pathname?.startsWith("/admin/parts") ?? false)}
      >
        Parts
      </Link>
      {(me?.name || me?.org) && (
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "flex-start",
            lineHeight: 1.2,
            paddingLeft: 8,
            borderLeft: "1px solid var(--pale)",
          }}
          title={me?.email ?? undefined}
        >
          {me?.name && (
            <span style={{ fontSize: 13, fontWeight: 700, color: "var(--ink)" }}>
              {me.name}
            </span>
          )}
          {me?.org && (
            <span
              style={{
                fontSize: 11,
                fontWeight: 700,
                textTransform: "uppercase",
                letterSpacing: "0.06em",
                color: "var(--mta)",
              }}
            >
              {me.org.name}
            </span>
          )}
        </div>
      )}
      <button
        type="button"
        onClick={signOut}
        style={{
          fontSize: 11,
          fontWeight: 700,
          textTransform: "uppercase",
          letterSpacing: "0.06em",
          color: "var(--muted)",
          background: "none",
          border: "1px solid var(--border)",
          borderRadius: 6,
          padding: "6px 12px",
          cursor: "pointer",
        }}
      >
        Sign out
      </button>
    </>
  );

  return (
    <header
      style={{
        position: "sticky",
        top: 0,
        zIndex: 50,
        background: "#fff",
        borderBottom: "1px solid var(--pale)",
      }}
    >
      <div
        className="wrap"
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          height: 56,
        }}
      >
        <Link href="/work" className="brand">
          <span className="mk">
            <i />
          </span>
          Railio
        </Link>
        <nav
          className="topnav-links"
          style={{ display: "flex", gap: 24, alignItems: "center" }}
        >
          {links}
        </nav>
        <button
          type="button"
          aria-label={open ? "Close menu" : "Open menu"}
          aria-expanded={open}
          className="topnav-burger"
          onClick={() => setOpen((v) => !v)}
        >
          <span />
          <span />
          <span />
        </button>
      </div>
      {open && (
        <div className="topnav-drawer">
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 16,
              padding: "16px 16px 20px",
            }}
            onClick={() => setOpen(false)}
          >
            {links}
          </div>
        </div>
      )}
    </header>
  );
}

function navLinkStyle(active: boolean): React.CSSProperties {
  return {
    fontSize: 12,
    fontWeight: 700,
    textTransform: "uppercase",
    letterSpacing: "0.06em",
    color: active ? "var(--mta)" : "var(--ink)",
    borderBottom: active ? "2px solid var(--mta)" : "2px solid transparent",
    paddingBottom: 4,
  };
}
