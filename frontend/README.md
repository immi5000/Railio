# Railio frontend

Next.js 15 App Router UI for Railio. Talks to the backend on `:3001` via the
shared contract in `../contract/contract.ts`.

## Run

```bash
npm install
npm run dev   # http://localhost:3000
```

`NEXT_PUBLIC_API_BASE` defaults to `http://localhost:3001` (see `.env.local`).

## Structure

- `app/` — routes (RolePicker, dispatcher queue/intake, tech queue/ticket/forms, admin/parts).
- `components/` — `ChatPane`, `RepairContext`, `FormsTab`, `PartsAdmin`, `TribalCapture`, etc.
- `lib/contract.ts` — re-export of `../contract/contract.ts` (the canonical types).
- `lib/api.ts` — fetch helpers; SSE streaming uses `@microsoft/fetch-event-source` directly inside `ChatPane`.

See `MVP_v0_FRONTEND.md` for the full spec.
