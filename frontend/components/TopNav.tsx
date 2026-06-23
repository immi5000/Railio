"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import { getMe } from "@/lib/api";
import { useRole } from "@/components/RoleProvider";
import type { Role } from "@/lib/role";

type NavItem = { href: string; label: string; title?: string; external?: boolean };

const NAV_ITEMS: NavItem[] = [
  { href: "/landing/index.html", label: "← Landing", title: "Back to landing page", external: true },
  { href: "/dashboard", label: "Dashboard" },
  { href: "/work", label: "Tickets" },
  { href: "/knowledge", label: "Knowledge", title: "Browse what the copilot cites" },
  { href: "/admin/fleet", label: "Fleet", title: "Fleet roster & historical records" },
  { href: "/admin/parts", label: "Parts" },
];

const ROLE_OPTIONS: { value: Role; label: string; hint: string }[] = [
  { value: "tech", label: "Tech", hint: "Field repairs & copilot" },
  { value: "dispatcher", label: "Dispatcher", hint: "Intake & handoff" },
];

function initials(name: string | null | undefined): string {
  if (!name) return "RO";
  const parts = name.trim().split(/\s+/);
  return ((parts[0]?.[0] ?? "") + (parts[1]?.[0] ?? "")).toUpperCase() || "RO";
}

function ProfileMenu({
  name,
  org,
  email,
  onSignOut,
}: {
  name?: string | null;
  org?: string | null;
  email?: string | null;
  onSignOut: () => void;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const { role, setRole } = useRole();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (!open) return;
    function onPointerDown(ev: MouseEvent) {
      if (!rootRef.current?.contains(ev.target as Node)) setOpen(false);
    }
    function onKey(ev: KeyboardEvent) {
      if (ev.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  function switchRole(next: Role) {
    if (next === role) {
      setOpen(false);
      return;
    }
    setRole(next);
    if (pathname?.startsWith("/work")) router.push("/work");
    setOpen(false);
  }

  return (
    <div className="fig-profile-menu" ref={rootRef}>
      <button
        type="button"
        className="fig-profile-trigger"
        aria-expanded={open}
        aria-haspopup="menu"
        onClick={() => setOpen((v) => !v)}
      >
        {(name || org) && (
          <span className="fig-profile-text">
            {name && <span className="fig-user-name">{name}</span>}
            {org && <span className="fig-user-org">{org}</span>}
          </span>
        )}
        <span className="fig-avatar" title={email ?? undefined}>
          {initials(name)}
        </span>
        <span
          className={`dash-chevron fig-profile-chevron${open ? " is-open" : ""}`}
          aria-hidden
        />
      </button>

      {open && (
        <div className="fig-profile-dropdown" role="menu">
          <div className="fig-profile-dropdown-label">View as</div>
          {ROLE_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              type="button"
              role="menuitemradio"
              aria-checked={role === opt.value}
              className="fig-profile-option"
              data-active={role === opt.value}
              onClick={() => switchRole(opt.value)}
            >
              <span className="fig-profile-option-main">
                <span className="fig-profile-option-dot" aria-hidden>
                  {role === opt.value && <span className="fig-nav-dot" />}
                </span>
                <span>{opt.label}</span>
              </span>
              <span className="fig-profile-option-hint">{opt.hint}</span>
            </button>
          ))}
          <div className="fig-profile-divider" />
          <button
            type="button"
            role="menuitem"
            className="fig-profile-option fig-profile-signout"
            onClick={() => {
              setOpen(false);
              onSignOut();
            }}
          >
            Sign out
          </button>
        </div>
      )}
    </div>
  );
}

export function TopNav() {
  const pathname = usePathname();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const { role, setRole } = useRole();

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

  function switchRoleMobile(next: Role) {
    setRole(next);
    if (pathname?.startsWith("/work")) router.push("/work");
    setOpen(false);
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
          <ProfileMenu
            name={me?.name}
            org={me?.org?.name}
            email={me?.email}
            onSignOut={signOut}
          />
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
        </nav>
        <div className="fig-nav-drawer-profile">
          <div className="fig-profile-dropdown-label">View as</div>
          {ROLE_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              type="button"
              className="fig-profile-option"
              data-active={role === opt.value}
              onClick={() => switchRoleMobile(opt.value)}
            >
              <span className="fig-profile-option-main">
                <span className="fig-profile-option-dot" aria-hidden>
                  {role === opt.value && <span className="fig-nav-dot" />}
                </span>
                <span>{opt.label}</span>
              </span>
              <span className="fig-profile-option-hint">{opt.hint}</span>
            </button>
          ))}
          <div className="fig-profile-divider" />
          <button type="button" className="fig-profile-option fig-profile-signout" onClick={signOut}>
            Sign out
          </button>
        </div>
      </div>
    </header>
  );
}
