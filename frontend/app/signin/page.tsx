"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

type Provider = "google" | "azure";

function SignInInner() {
  const params = useSearchParams();
  const router = useRouter();
  const [busy, setBusy] = useState<Provider | null>(null);
  const [error, setError] = useState<string | null>(
    params.get("error") ? "Sign-in failed. Please try again." : null,
  );

  const next = params.get("next") || "/app";
  const isSignup = params.get("mode") === "signup";

  // Already signed in (e.g. arriving from the landing CTA) — forward straight
  // through the /app gate instead of asking them to authenticate again.
  useEffect(() => {
    createClient()
      .auth.getSession()
      .then(({ data }) => {
        if (data.session) router.replace(next);
      });
  }, [router, next]);

  async function signIn(provider: Provider) {
    setError(null);
    setBusy(provider);
    try {
      const supabase = createClient();
      const { error } = await supabase.auth.signInWithOAuth({
        provider,
        options: {
          redirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent(next)}`,
        },
      });
      if (error) {
        setError(error.message);
        setBusy(null);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not start sign-in.");
      setBusy(null);
    }
  }

  return (
    <main
      style={{
        position: "relative",
        minHeight: "100vh",
        display: "grid",
        placeItems: "center",
        background: "var(--dash-bg)",
        padding: "24px",
      }}
    >
      <a
        href="/landing/index.html"
        className="dash-link"
        style={{ position: "absolute", top: 24, left: 24 }}
      >
        <span className="ico-arr-back" aria-hidden="true" /> Back to home
      </a>
      <div
        className="dash-card"
        style={{
          width: "100%",
          maxWidth: 400,
          padding: "40px 32px",
          textAlign: "center",
        }}
      >
        <a
          href="/landing/index.html"
          className="brand"
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 10,
            fontFamily: '"Inter", "Helvetica Neue", Arial, sans-serif',
            fontWeight: 700,
            fontSize: 34,
            letterSpacing: "-0.06em",
            textTransform: "none",
            color: "#000",
            marginBottom: 28,
          }}
        >
          <span
            className="mk"
            style={
              {
                "--mark-size": "28px",
                "--mark-stroke": "4.4px",
              } as React.CSSProperties
            }
          >
            <i />
          </span>
          Railio
        </a>
        <p
          style={{
            fontFamily: '"Source Serif 4", serif',
            fontSize: 18,
            color: "var(--dash-muted)",
            margin: "0 0 28px",
          }}
        >
          The AI co-pilot for rail maintenance.
        </p>

        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <button
            className="btn btn-super"
            style={{ width: "100%" }}
            disabled={busy !== null}
            onClick={() => signIn("google")}
          >
            {busy === "google"
              ? "Redirecting…"
              : isSignup
                ? "Sign up with Google"
                : "Continue with Google"}
          </button>
          <button
            className="btn"
            style={{ width: "100%" }}
            disabled={busy !== null}
            onClick={() => signIn("azure")}
          >
            {busy === "azure"
              ? "Redirecting…"
              : isSignup
                ? "Sign up with Microsoft"
                : "Continue with Microsoft"}
          </button>
        </div>

        {error && (
          <p style={{ color: "#c0392b", fontSize: 13, marginTop: 18 }}>{error}</p>
        )}

        <p
          style={{
            fontFamily: '"IBM Plex Mono", monospace',
            color: "var(--dash-faint)",
            fontSize: 12,
            marginTop: 28,
          }}
        >
          Company employees are routed to their organization automatically.
        </p>
      </div>
    </main>
  );
}

export default function SignInPage() {
  return (
    <Suspense fallback={null}>
      <SignInInner />
    </Suspense>
  );
}
