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
        minHeight: "100vh",
        display: "grid",
        placeItems: "center",
        background: "#fff",
        padding: "24px",
      }}
    >
      <div
        style={{
          width: "100%",
          maxWidth: 380,
          border: "1px solid var(--border)",
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
            gap: 8,
            fontWeight: 800,
            fontSize: 22,
            marginBottom: 8,
          }}
        >
          <span className="mk">
            <i />
          </span>
          Railio
        </a>
        <h1 style={{ fontSize: 20, fontWeight: 700, margin: "16px 0 4px" }}>
          {isSignup ? "Create your account" : "Log in"}
        </h1>
        <p
          className="body"
          style={{ color: "var(--muted)", margin: "0 0 28px" }}
        >
          The AI co-pilot for rail maintenance.
        </p>

        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <button
            className="btn btn-super"
            style={{ width: "100%", padding: "12px 18px" }}
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
            className="btn btn-ghost"
            style={{ width: "100%", padding: "12px 18px" }}
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
          <p style={{ color: "#B00020", fontSize: 13, marginTop: 18 }}>{error}</p>
        )}

        <p
          className="body"
          style={{ color: "var(--muted)", fontSize: 12, marginTop: 28 }}
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
