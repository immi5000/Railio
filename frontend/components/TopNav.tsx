"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

export function TopNav() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  const isAdmin = pathname?.startsWith("/admin");

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
      <Link href="/admin/parts" style={navLinkStyle(!!isAdmin)}>
        Parts
      </Link>
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
