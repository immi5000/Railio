# Railio — Strategic Directions After BMWED + MaintainX

## Context

Two inputs reshape Railio's positioning:

1. **BMWED conversation** (Director of Education, ex-BNSF bridge worker). Surfaces a different worker class (Maintenance of Way — tracks, bridges, signals), a hard safety/distraction constraint (radio monitoring is non-negotiable, voice output is dangerous near tracks), a real dead-zone problem (no signal in the field), and a structural mentorship gap (bid-seniority pairings put junior techs with junior techs). BMWED is willing to be a real design partner.
2. **MaintainX walkthrough** (the standard modern CMMS — 14,000 customers, Norfolk Southern is one of them). Lays out exactly what the "existing stack" can do, so the boundary line for "complement, don't compete" is no longer abstract.

Your anchors: no build constraints; ambition is horizontal across all rail maintenance disciplines; complement existing systems bidirectionally.

**One-sentence positioning:** Railio is the rail-specific, voice-first, FRA-defensible capture and co-pilot layer that sits on top of whatever CMMS / OEM stack the railroad already runs — replacing the manual paperwork step at the end of every job and the manual-flip step in the middle of one.

---

## What MaintainX already owns (and Railio should not rebuild)

MaintainX is a comprehensive, modern, AI-flavored CMMS. Work order edit form alone captures: title, description, photos, location, customer, asset, attached procedure/checklist, assignee, estimated time, due/start dates, recurrence, work type (Reactive/Preventive/etc.), priority, files, parts (from inventory), categories, vendors, cost tracking. Sidebar shows the full surface: Work Orders · Reporting · Requests · Assets · Messages · Categories · Parts Inventory · Library (Procedures + Work Order Blueprints) · Meters · Automations · Locations · Teams · Vendors · Customers. They publish an API (maintainx.dev) and an Integrations Marketplace.

| Capability MaintainX owns | What it looks like in their product |
|---|---|
| Work order management | Create, assign, prioritize, track, recur, cost-track |
| Asset registry & hierarchy | Assets, Locations, Meters, asset/location links |
| Parts inventory | Stock, low-stock alerts, auto-reorder, part availability on WO |
| Procedures & checklists | Reusable "Procedure" templates attached to WOs |
| Preventive / condition-based maintenance | Recurrence, meters, automations |
| Reporting & dashboards | Prebuilt + natural-language analytics |
| Generic AI troubleshooting | "Turn manuals, procedures, work history into recommendations" — no rail context, no citation discipline visible |
| Vendor & customer management | Standard CMMS modules |
| Multi-site rollups | Locations hierarchy, enterprise scale |
| API + integrations | Published API, marketplace |

**Implication for Railio:** drop everything in this list as a product feature. The `parts` table, `lookup_parts` tool, standalone `assets` registry, work-order routing/queuing — all cede to the CMMS. Railio reads from MaintainX (asset list, open WO assigned to a tech) and writes back (completed reports, status, attachments, comments) via their API.

---

## What MaintainX does NOT do (the actual Railio product)

| Gap in MaintainX (and every CMMS) | Railio's answer |
|---|---|
| **No rail-specific anything** — no FRA forms, no 49 CFR / AAR corpus, no locomotive or track-segment asset types | Rail-typed asset model overlay, FRA form generators (F6180.49A, Daily 229.21, 213.233/235 track defects, …), licensed AAR/OEM corpus per tenant |
| **No citation-disciplined RAG** — their AI "recommends" from manuals but no per-chunk source label, no refuse-by-default | Cited answers with verbatim `source_label`; refuse if the corpus is silent ("I don't have this in your manuals or tribal notes") |
| **No tribal-knowledge layer** | `tribal_knowledge` corpus, continuously captured at job close ("anything a junior should know?"), curated and promoted |
| **No voice-first capture** — work-order edit is a 18-field web form | Push-to-talk dictation, photo with metadata, structured field extraction; forms auto-fill from what the tech *said*, not what they typed |
| **No offline-first** — pure web app | Local-first SQLite + sync; AI degrades to recorder + local RAG when no signal; resolves on reconnect |
| **No tamper-evident audit chain** — standard DB writes | sha256 hash-chained event log; FRA-defensible PDF + JSON bundle, externally verifiable |
| **No multi-participant job briefing** — WOs are single-assignee | Track-gang briefing with roll call, RWP authority, QR sign-in, hazards, train traffic windows |
| **No safety-aware UX** — desktop UI shrunk to a phone, voice output, ambient assumptions | Glanceable surfaces, PTT-only input, audio that ducks for radio, single-earbud assumption, text-only output near tracks |
| **No "qualified person" gating** for release-to-service (FRA 229.7 / 229.9) | Per-user qualified flag, gated server-side at the API |
| **No MoW coverage** — built for shop/plant maintenance, not track gangs in the field | First-class MoW workflow: briefing → defect capture → 213/214 reports |

**The product is exclusively this list.** Every row is something a CMMS structurally won't address (rail-specific, safety/regulatory, voice/offline UX) — not a feature gap that will close in the next release.

---

## The central tension

> **You:** "all types of railway maintenance"
> **BMWED:** "no one-size-fits-all"

Resolution: **platform + per-discipline workflows + per-customer connectors.** Shared primitives at the core; discipline-specific surfaces at the edge; customer-specific connectors (MaintainX, eRail, RailComm, paper-only) that pipe data both ways. Same backbone, different shapes — like Stripe shipping different surfaces for marketplaces vs. SaaS.

---

## Offline vs. online split (the architectural rule)

Offline is expensive to build and maintain. Keep it minimal but absolute — every dead-zone capability must work with zero connectivity. Everything else queues and resolves on reconnect; the tech sees "queued," never an error.

### Offline (in-the-moment, real-time)
- Voice capture / dictation (on-device STT)
- Manual lookup / RAG over pre-synced corpus subset for assigned units / work zone
- Diagnostic Q&A — symptom → likely cause, grounded in local corpus
- Historical context lookup — pre-synced recent tickets for assigned assets
- Tribal-knowledge retrieval (same local vector store)
- Real-time note dictation + transcription
- Photo / video capture with metadata tagging (asset, GPS, time)
- Safety / lockout / procedure checklist guidance (deterministic flows)
- Text-to-speech for hands-free playback (per workflow; off by default near tracks)
- Intent classification — lookup vs. record vs. action
- Structured field extraction from dictation — asset ID, defect type, location

### Online (deferred, runs on reconnect)
- FRA-compliant report generation from raw captures
- Polished structured documentation from raw transcripts
- **CMMS sync** — write completed reports, status changes, attachments back to MaintainX / etc.
- Cross-fleet pattern detection & analytics
- Corpus updates and new bulletin sync
- Tribal-knowledge ingestion (SME authoring sessions, curation, promotion)
- Cross-tech collaboration — "tag for senior review"
- Training/onboarding queries (larger model, broader corpus)
- Supervisor / executive dashboards
- Audio cleanup, speaker separation
- Multi-modal vision analysis of captured photos
- Heavy diagnostic reasoning — multi-hop, cross-document
- Background corpus re-indexing

Sign-off / release-to-service is the only thing **blocked offline** (qualified-person check must hit server).

---

## Architecture (four layers)

```
┌──────────────────────────────────────────────────────────────────┐
│  Discipline Surfaces (per-workflow plugins)                      │
│  Locomotive Shop  │  MoW Track  │  Bridge  │  Signal  │  Car    │
└──────────────────────────────────────────────────────────────────┘
┌──────────────────────────────────────────────────────────────────┐
│  Connectors (per-customer, bidirectional)                        │
│  MaintainX · eRail · RailComm · OEM diag readers · paper/CSV     │
│  fallback · FRA forms PDF in/out                                  │
└──────────────────────────────────────────────────────────────────┘
┌──────────────────────────────────────────────────────────────────┐
│  Workflow Engine (discipline-agnostic primitives)                │
│  Pluggable form schemas · roles · state machines · tool registry │
│  · capture loop (online/offline, photo, citations)               │
└──────────────────────────────────────────────────────────────────┘
┌──────────────────────────────────────────────────────────────────┐
│  Platform Core                                                   │
│  Corpus pipeline · citation discipline · refuse-by-default ·     │
│  hash chain · tribal capture · offline-first store + sync ·      │
│  safety-aware UX kit · audit / PDF / JSON export                 │
└──────────────────────────────────────────────────────────────────┘
```

A `discipline` registers forms/roles/tools/UX shell at boot. A `connector` registers read/write integrations with a specific customer's stack. Disciplines with no CMMS coverage (most MoW shortlines) run with an empty connector layer — Railio owns the data because nothing else does.

---

## Why MoW with BMWED is the right beachhead

1. **Forces the refactor** — no locomotive assumptions can leak into the platform.
2. **Forces the hard bets** — dead zones, radio monitoring, gang work. If the platform survives MoW, shop disciplines become *easier*, not harder.
3. **No CMMS to compete with** — MaintainX et al. don't cover MoW field work. Railio owns this data cleanly without integration drag.
4. **Real design partner** — BMWED access + likely working-tech intros.
5. **Larger, labor-aligned market** — tens of thousands of BMWED members; union-backed tools are uniquely defensible.
6. **Buys time for the connector layer** before the locomotive arm (which integrates with MaintainX et al.) needs it.

---

## What carries forward, rebuilt, thrown away

**Carries forward:** `sqlite-vec` retrieval + corpus pipeline ([backend/lib/tools/search-corpus.ts](backend/lib/tools/search-corpus.ts), [backend/scripts/corpus-build.ts](backend/scripts/corpus-build.ts)); manifest-driven corpus fetch ([backend/corpus-sources/sources.json](backend/corpus-sources/sources.json)); tool-use loop ([backend/lib/chat-loop.ts](backend/lib/chat-loop.ts)); platform tools `search_corpus`/`request_photo`/`update_form_field`; hash chain + `verify-chain`; citation discipline ([backend/lib/system-prompt.ts](backend/lib/system-prompt.ts)); `tribal_knowledge` doc class; Drizzle/SSE/PDF patterns.

**Rebuilt:** system prompt becomes composable (platform + discipline + connector context); forms become per-discipline plugins; asset model becomes a CMMS sync cache, not source of truth; state machines per discipline; front-door UI per discipline.

**Thrown away:** `parts` table + `lookup_parts` as core (relegated to connector or no-CMMS fallback); standalone `assets` as source of truth; the single chat / single ticket assumption; locomotive two-pane chat as default front door.

---

## First release on the new platform (MoW track, with BMWED)

**Pre-job briefing + on-track defect capture + post-job documentation, for a track gang.**

- **Front door = briefing screen**, not a chat. EIC dictates roll call, on-track authority, work scope, hazards, weather, train traffic windows. Auto-logs to hash chain. Gang QR sign-in.
- **Field capture = glanceable + push-to-talk.** Tap, photo, voice-note ("rail head crack at MP 142.3"), done. AI tags + classifies per 49 CFR 213. Text output only; no audio competes with radio.
- **Offline-first.** Full flow works with no signal; AI lookups queue.
- **Documentation as side effect.** Briefing → audit log. Defects → 213.233/235 reports. Sign-off → workforce records.
- **Tribal capture per closed job.** EIC prompted on sign-off → curation queue.

**Corpus to seed:** 49 CFR Part 213, Part 214, AAR Field Manual where licensed. Tribal seeding from BMWED + 2 working MoW techs.

**Connectors needed for v0 MoW:** none — buys time to design the connector layer before locomotive forces it.

---

## People to talk to before writing code

Questions to ask people who actually do this work or know it well. Organized by who you'd ask. All field-knowledge, no desk research or tech spikes.

### To the BMWED contact (Director of Education)
1. Are you willing to actively co-design this? Can you facilitate intros to 2–3 working MoW techs and an EIC?
2. Would the education arm sponsor or co-own the mentorship-capture surface?
3. How does the union typically endorse a vendor — preferred-partner, MOU, member discount, joint development?
4. After BMWED, which adjacent rail unions are worth talking to (BLET, SMART-TD, TCU, IBEW signal)?

### To 2–3 working MoW track techs
5. Walk me through your last shift — where did you lose the most time?
6. Where do dead zones actually bite you? What do you do when you have no signal?
7. When you find a defect at MP 142 today, how do you record it, and where does that record end up?
8. If we offered briefing-first vs. chat-first, which would you actually open during track work?
9. Radio + phone in the same hand — describe a moment where a phone would be unsafe to look at.

### To an EIC / foreman
10. Walk me through how you actually run a job briefing today — what's verbal, what's paper, what gets missed?
11. If your gang signed in on their phones via QR, would that fly with both management and the gang?
12. What's the single most painful piece of paperwork in your day?

### To one locomotive shop tech (to sanity-check the existing v0)
13. Walk me through a recent unit repair — when do you flip the manual, when do you radio the foreman, when do you fill out paperwork?
14. Looking at the current Railio v0 demo — what matches how you'd want to work, and what's off?

### To one shortline operations contact (mechanical or MoW manager)
15. What CMMS do you actually run, if any? How would the decision to add a tool like Railio actually get made?
16. What would make Railio an instant "yes," and what would block it on the spot?

### To a senior tech / SME (for designing the tribal-capture surface)
17. What's something you'd tell a junior tech that's NOT in any manual?
18. If you recorded an hour of your knowledge, how would you want it credited and reviewed before others can query it?

### To an FRA inspector or ex-FRA contact (stretch — ask BMWED if anyone in their network qualifies)
19. When you audit a shortline, what do you actually pull? Where do the findings typically come from?
20. Would a cited, hash-chained event log change anything about how findings get written?

Pick the 6–8 highest-impact conversations to schedule first. Treat the rest as follow-ups once the first round reshapes the plan.

---

## Open questions

1. Keep locomotive v0 runnable as `disciplines/locomotive/`, or shelve it during refactor?
2. First MoW release = briefing + defect capture only, or full forms loop too?
3. Union channel → free or labor-subsidized tier? (Design platform so it's a config flag.)
4. Mobile-native (RN+Expo) or PWA? Offline + safety UX probably justifies RN; PWA may be enough for design-partner testing.
5. First CMMS connector target — MaintainX (because Norfolk Southern uses it + clean API), or a shortline-favored lighter CMMS? Determines connector pattern.
6. Does Railio surface in the CMMS UI (embedded panel? procedure attachment?) or stay a separate app that writes back?
