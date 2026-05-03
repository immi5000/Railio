"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { clearRoleCookie, getRoleCookie } from "@/lib/role";

export function TopNav() {
  const pathname = usePathname();
  const router = useRouter();
  const [role, setRole] = useState<"dispatcher" | "tech" | null>(null);

  useEffect(() => {
    setRole(getRoleCookie());
  }, [pathname]);

  // The role picker page is fullscreen — hide the nav there.
  if (pathname === "/app") return null;

  function switchRole() {
    clearRoleCookie();
    router.push("/app");
  }

  const isAdmin = pathname?.startsWith("/admin");

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
        <Link href={role === "tech" ? "/tech" : "/dispatcher"} className="brand">
          <span className="mk">
            <i />
          </span>
          Railio
        </Link>
        <nav style={{ display: "flex", gap: 24, alignItems: "center" }}>
          <a
            href="/landing/index.html"
            style={navLinkStyle(false)}
            title="Back to landing page"
          >
            ← Landing
          </a>
          {role === "dispatcher" && (
            <>
              <Link
                href="/dispatcher"
                style={navLinkStyle(pathname === "/dispatcher")}
              >
                Queue
              </Link>
              <Link
                href="/dispatcher/new"
                style={navLinkStyle(pathname === "/dispatcher/new")}
              >
                New ticket
              </Link>
            </>
          )}
          {role === "tech" && (
            <Link href="/tech" style={navLinkStyle(pathname === "/tech")}>
              Queue
            </Link>
          )}
          <Link
            href="/knowledge"
            style={navLinkStyle(pathname?.startsWith("/knowledge") ?? false)}
            title="Browse what the LLM cites"
          >
            Knowledge
          </Link>
          <Link href="/admin/parts" style={navLinkStyle(!!isAdmin)}>
            Parts admin
          </Link>
          <button onClick={switchRole} className="btn btn-ghost btn-sm">
            {role ? `${role} · switch` : "Pick role"}
          </button>
        </nav>
      </div>
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
