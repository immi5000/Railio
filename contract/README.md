# Shared contract

This folder holds the single source of truth for types and API shapes used by both `../backend/` and `../frontend/`.

The backend chat populates `contract.ts` first (during BE step 1 — see [../backend/MVP_v0_BACKEND.md](../backend/MVP_v0_BACKEND.md)). The frontend imports from here — never redefines.

If either side needs a type or endpoint that doesn't exist yet, edit `contract.ts` here, post in your shared chat, and update the relevant spec file's §4 so the docs stay aligned with reality.
