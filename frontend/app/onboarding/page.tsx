"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { getMe, completeOnboarding, ApiError } from "@/lib/api";

const cardStyle: React.CSSProperties = {
  width: "100%",
  maxWidth: 420,
  border: "1px solid var(--border)",
  padding: "40px 32px",
};

const inputStyle: React.CSSProperties = {
  width: "100%",
  padding: "10px 12px",
  border: "1px solid var(--border)",
  fontFamily: "inherit",
  fontSize: 14,
  boxSizing: "border-box",
};

const labelStyle: React.CSSProperties = {
  display: "block",
  fontSize: 12,
  fontWeight: 700,
  textTransform: "uppercase",
  letterSpacing: "0.06em",
  color: "var(--ink-2)",
  margin: "0 0 6px",
};

export default function OnboardingPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [step, setStep] = useState<1 | 2>(1);

  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [lockedCompany, setLockedCompany] = useState<string | null>(null);

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const me = await getMe();
        if (me.profile_completed) {
          router.replace("/work");
          return;
        }
        if (me.name) setName(me.name);
        if (me.phone) setPhone(me.phone);
        setLockedCompany(me.locked_company);
      } catch (e) {
        if (e instanceof ApiError && e.status === 401) router.replace("/signin");
      } finally {
        setLoading(false);
      }
    })();
  }, [router]);

  function continueToCompany() {
    if (!name.trim()) {
      setError("Please enter your name.");
      return;
    }
    setError(null);
    setStep(2);
  }

  async function submit() {
    setError(null);
    setBusy(true);
    try {
      await completeOnboarding({
        name: name.trim(),
        phone: phone.trim() || undefined,
        join_code: lockedCompany ? undefined : code.trim() || undefined,
      });
      router.replace("/work");
    } catch (e) {
      if (e instanceof ApiError && e.status === 400) {
        setError("That join code isn't valid. Check it, or leave it blank.");
      } else {
        setError(e instanceof Error ? e.message : "Something went wrong.");
      }
      setBusy(false);
    }
  }

  if (loading) return null;

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
      <div style={cardStyle}>
        <div
          className="brand"
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 8,
            fontWeight: 800,
            fontSize: 22,
            marginBottom: 16,
          }}
        >
          <span className="mk">
            <i />
          </span>
          Railio
        </div>

        {step === 1 ? (
          <>
            <h1 style={{ fontSize: 20, fontWeight: 700, margin: "0 0 4px" }}>
              Welcome — let&apos;s set up your account
            </h1>
            <p className="body" style={{ color: "var(--muted)", margin: "0 0 24px" }}>
              Step 1 of 2 · Your details
            </p>

            <div style={{ marginBottom: 16 }}>
              <label style={labelStyle} htmlFor="name">
                Full name
              </label>
              <input
                id="name"
                style={inputStyle}
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Jordan Tech"
                autoFocus
              />
            </div>
            <div style={{ marginBottom: 24 }}>
              <label style={labelStyle} htmlFor="phone">
                Phone <span style={{ fontWeight: 400, textTransform: "none" }}>(optional)</span>
              </label>
              <input
                id="phone"
                style={inputStyle}
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="(555) 123-4567"
                inputMode="tel"
              />
            </div>

            <button
              className="btn btn-super"
              style={{ width: "100%", padding: "12px 18px" }}
              onClick={continueToCompany}
            >
              Continue →
            </button>
          </>
        ) : (
          <>
            <h1 style={{ fontSize: 20, fontWeight: 700, margin: "0 0 4px" }}>
              Your company
            </h1>
            <p className="body" style={{ color: "var(--muted)", margin: "0 0 24px" }}>
              Step 2 of 2 · Workspace
            </p>

            {lockedCompany ? (
              <div style={{ marginBottom: 24 }}>
                <label style={labelStyle}>Company</label>
                <input
                  style={{ ...inputStyle, background: "var(--pale)", color: "var(--muted)" }}
                  value={lockedCompany}
                  readOnly
                />
                <p className="body" style={{ color: "var(--muted)", fontSize: 12, marginTop: 8 }}>
                  You&apos;ll join <b>{lockedCompany}</b> automatically based on your
                  work email.
                </p>
              </div>
            ) : (
              <div style={{ marginBottom: 24 }}>
                <label style={labelStyle} htmlFor="code">
                  Join code{" "}
                  <span style={{ fontWeight: 400, textTransform: "none" }}>(optional)</span>
                </label>
                <input
                  id="code"
                  style={inputStyle}
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  placeholder="e.g. ACME-JOIN"
                  autoFocus
                />
                <p className="body" style={{ color: "var(--muted)", fontSize: 12, marginTop: 8 }}>
                  Have a company code? Enter it to join your team. Leave blank to
                  create your own workspace.
                </p>
              </div>
            )}

            <div style={{ display: "flex", gap: 12 }}>
              <button
                className="btn btn-ghost"
                style={{ padding: "12px 18px" }}
                onClick={() => {
                  setError(null);
                  setStep(1);
                }}
                disabled={busy}
              >
                ← Back
              </button>
              <button
                className="btn btn-super"
                style={{ flex: 1, padding: "12px 18px" }}
                onClick={submit}
                disabled={busy}
              >
                {busy ? "Setting up…" : "Enter Railio →"}
              </button>
            </div>
          </>
        )}

        {error && (
          <p style={{ color: "#B00020", fontSize: 13, marginTop: 18 }}>{error}</p>
        )}
      </div>
    </main>
  );
}
