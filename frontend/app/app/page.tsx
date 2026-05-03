"use client";

import { useRouter } from "next/navigation";
import { setRoleCookie } from "@/lib/role";

export default function RolePickerPage() {
  const router = useRouter();

  function pick(role: "dispatcher" | "tech") {
    setRoleCookie(role);
    router.push(role === "tech" ? "/tech" : "/dispatcher");
  }

  return (
    <div
      style={{
        minHeight: "100vh",
        background: "#fff",
        display: "flex",
        flexDirection: "column",
      }}
    >
      <div className="wrap" style={{ padding: "32px 32px 0" }}>
        <a href="/" className="brand">
          <span className="mk">
            <i />
          </span>
          Railio
        </a>
      </div>

      <div
        className="wrap"
        style={{
          flex: 1,
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          paddingBottom: 80,
        }}
      >
        <span className="sect-eyebrow">01 — Pick your role</span>
        <h1 className="display" style={{ margin: "24px 0 16px" }}>
          Who&rsquo;s on shift?
        </h1>
        <p className="lede" style={{ marginBottom: 48 }}>
          Railio sits between the dispatcher who opens the ticket and the
          technician who closes it. Pick where you sit today.
        </p>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 1fr",
            gap: 0,
            border: "1px solid var(--ink)",
          }}
        >
          <RoleCard
            number="01"
            title="Dispatcher"
            sub="Open a ticket, paste the fault dump, hand off a clean briefing to the tech."
            onClick={() => pick("dispatcher")}
            divider
          />
          <RoleCard
            number="02"
            title="Technician"
            sub="Pick up an open ticket, talk through the repair, watch the paperwork file itself."
            onClick={() => pick("tech")}
          />
        </div>
      </div>

      <footer
        style={{
          borderTop: "1px solid var(--pale)",
          padding: "20px 0",
          fontSize: 11,
          fontWeight: 700,
          textTransform: "uppercase",
          letterSpacing: "0.06em",
          color: "var(--muted)",
        }}
      >
        <div
          className="wrap"
          style={{
            display: "flex",
            justifyContent: "space-between",
            flexWrap: "wrap",
            gap: 8,
          }}
        >
          <span>© 2026 Railio Systems, Inc.</span>
          <span>Made for the yard.</span>
        </div>
      </footer>
    </div>
  );
}

function RoleCard({
  number,
  title,
  sub,
  onClick,
  divider,
}: {
  number: string;
  title: string;
  sub: string;
  onClick: () => void;
  divider?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      className="role-card"
      style={{
        appearance: "none",
        border: 0,
        borderRight: divider ? "1px solid var(--ink)" : "0",
        background: "#fff",
        color: "var(--ink)",
        cursor: "pointer",
        textAlign: "left",
        padding: "56px 40px",
        fontFamily: "inherit",
        transition:
          "background 0.15s ease, color 0.15s ease, transform 0.12s ease",
        display: "flex",
        flexDirection: "column",
        gap: 16,
        minHeight: 320,
      }}
      onMouseDown={(e) =>
        ((e.currentTarget as HTMLButtonElement).style.transform =
          "translateY(1px)")
      }
      onMouseUp={(e) =>
        ((e.currentTarget as HTMLButtonElement).style.transform = "")
      }
    >
      <span
        style={{
          fontSize: 12,
          fontWeight: 700,
          letterSpacing: "0.08em",
          opacity: 0.7,
        }}
      >
        STEP {number}
      </span>
      <span
        style={{
          fontSize: 56,
          fontWeight: 800,
          textTransform: "uppercase",
          letterSpacing: "-0.01em",
          lineHeight: 0.95,
        }}
      >
        {title}
      </span>
      <span
        style={{
          fontSize: 16,
          maxWidth: "44ch",
          lineHeight: 1.45,
          marginTop: "auto",
        }}
      >
        {sub}
      </span>
      <span
        style={{
          fontSize: 12,
          fontWeight: 700,
          letterSpacing: "0.06em",
          textTransform: "uppercase",
          marginTop: 16,
        }}
      >
        Continue →
      </span>
    </button>
  );
}
