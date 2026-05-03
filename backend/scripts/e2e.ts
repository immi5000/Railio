import "dotenv/config";

const BASE = `http://localhost:${process.env.PORT ?? "3001"}`;

async function j<T>(method: string, url: string, body?: unknown): Promise<T> {
  const r = await fetch(BASE + url, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!r.ok) throw new Error(`${method} ${url} → ${r.status} ${await r.text()}`);
  return (await r.json()) as T;
}

async function consumeSse(url: string, body: unknown) {
  const r = await fetch(BASE + url, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
    body: JSON.stringify(body),
  });
  if (!r.ok || !r.body) throw new Error(`${url} → ${r.status}`);
  const reader = r.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let idx;
    while ((idx = buf.indexOf("\n\n")) !== -1) {
      const frame = buf.slice(0, idx).trim();
      buf = buf.slice(idx + 2);
      if (!frame.startsWith("data:")) continue;
      const ev = JSON.parse(frame.slice(5).trim());
      console.log("sse", ev.type, ev.type === "assistant_token" ? `(+${ev.delta?.length ?? 0}ch)` : "");
      if (ev.type === "done" || ev.type === "error") return;
    }
  }
}

(async () => {
  const ticket = await j<any>("POST", "/api/tickets", {
    asset_id: 1,
    initial_symptoms: "Smoke from #3 power assembly per crew",
    initial_error_codes: "EOA-3, FUEL-PRESS-LOW",
    fault_dump_raw: "2026-04-30 06:14:02 EOA-3 SEVERITY=MAJOR Engine oil aeration\n2026-04-30 06:14:02 FUEL-PRESS-LOW WARN rail pressure 1180 bar in notch 5",
    opened_by_role: "dispatcher",
  });
  console.log("created ticket", ticket.id);

  await j("POST", `/api/tickets/${ticket.id}/parse-fault-dump`, {
    raw: ticket.fault_dump_raw,
  });

  await consumeSse(`/api/tickets/${ticket.id}/messages`, {
    role: "dispatcher",
    content: "ES44AC 8754, smoke from #3 power assembly per crew. Pre-brief the tech.",
  });

  await consumeSse(`/api/tickets/${ticket.id}/messages`, {
    role: "tech",
    content: "On site. Smoke residue confirmed at #3. What should I check first?",
  });

  await consumeSse(`/api/tickets/${ticket.id}/messages`, {
    role: "tech",
    content: "Pressure looks normal. Need part for the injector.",
  });

  for (const ft of ["F6180_49A", "DEFECT_CARD", "DAILY_INSPECTION_229_21", "PARTS_REQUISITION"]) {
    const out = await j<any>("POST", `/api/tickets/${ticket.id}/forms/${ft}/export`);
    console.log("exported", ft, "→", out.pdf_path);
  }

  console.log("e2e: done. Run `npm run verify-chain` to validate the message hash chain.");
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
