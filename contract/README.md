# Shared contract

This folder holds the single source of truth for types and API shapes used by both `../backend/` and `../frontend/`.

`contract.ts` is the canonical TypeScript definition; the backend mirrors it in [../backend/railio/contract.py](../backend/railio/contract.py). The frontend imports from here — never redefines. Both must update together when types change.

If either side needs a type or endpoint that doesn't exist yet, edit `contract.ts` here and update `contract.py` to match.
