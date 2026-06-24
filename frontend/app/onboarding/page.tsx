"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { getMe, completeOnboarding, ApiError } from "@/lib/api";

const cardStyle: React.CSSProperties = {
  width: "100%",
  maxWidth: 420,
  padding: "40px 32px",
};

const titleStyle: React.CSSProperties = {
  fontFamily: '"Inter", sans-serif',
  fontSize: 24,
  fontWeight: 400,
  letterSpacing: "-0.02em",
  margin: "0 0 6px",
};

const subStyle: React.CSSProperties = {
  fontFamily: '"IBM Plex Mono", monospace',
  fontSize: 12,
  color: "var(--dash-muted)",
  margin: "0 0 24px",
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
          router.replace("/dashboard");
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
      router.replace("/dashboard");
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
        background: "var(--dash-bg)",
        padding: "24px",
      }}
    >
      <div className="dash-card" style={cardStyle}>
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
            <h1 style={titleStyle}>Welcome — let&apos;s set up your account</h1>
            <p style={subStyle}>Step 1 of 2 · Your details</p>

            <div style={{ marginBottom: 16 }}>
              <label className="label" htmlFor="name">
                Full name
              </label>
              <input
                id="name"
                className="input"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Jordan Tech"
                autoFocus
              />
            </div>
            <div style={{ marginBottom: 24 }}>
              <label className="label" htmlFor="phone">
                Phone (optional)
              </label>
              <input
                id="phone"
                className="input"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="(555) 123-4567"
                inputMode="tel"
              />
            </div>

            <button
              className="btn btn-super"
              style={{ width: "100%" }}
              onClick={continueToCompany}
            >
              Continue <span className="ico-arr" aria-hidden="true" />
            </button>
          </>
        ) : (
          <>
            <h1 style={titleStyle}>Your company</h1>
            <p style={subStyle}>Step 2 of 2 · Workspace</p>

            {lockedCompany ? (
              <div style={{ marginBottom: 24 }}>
                <label className="label">Company</label>
                <input
                  className="input"
                  style={{ background: "var(--dash-bg)", color: "var(--dash-muted)" }}
                  value={lockedCompany}
                  readOnly
                />
                <p style={{ fontFamily: '"IBM Plex Mono", monospace', color: "var(--dash-muted)", fontSize: 12, marginTop: 8 }}>
                  You&apos;ll join <b>{lockedCompany}</b> automatically based on your
                  work email.
                </p>
              </div>
            ) : (
              <div style={{ marginBottom: 24 }}>
                <label className="label" htmlFor="code">
                  Join code (optional)
                </label>
                <input
                  id="code"
                  className="input"
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  placeholder="e.g. ACME-JOIN"
                  autoFocus
                />
                <p style={{ fontFamily: '"IBM Plex Mono", monospace', color: "var(--dash-muted)", fontSize: 12, marginTop: 8 }}>
                  Have a company code? Enter it to join your team. Leave blank to
                  create your own workspace.
                </p>
              </div>
            )}

            <div style={{ display: "flex", gap: 12 }}>
              <button
                className="btn"
                onClick={() => {
                  setError(null);
                  setStep(1);
                }}
                disabled={busy}
              >
                <span className="ico-arr-back" aria-hidden="true" /> Back
              </button>
              <button
                className="btn btn-super"
                style={{ flex: 1 }}
                onClick={submit}
                disabled={busy}
              >
                {busy ? "Setting up…" : <>Enter Railio <span className="ico-arr" aria-hidden="true" /></>}
              </button>
            </div>
          </>
        )}

        {error && (
          <p style={{ color: "#c0392b", fontSize: 13, marginTop: 18 }}>{error}</p>
        )}
      </div>
    </main>
  );
}
