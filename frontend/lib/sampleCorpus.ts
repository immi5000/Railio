import type { CorpusChunk } from "./contract";

/**
 * Fallback corpus shown on the /knowledge page when the backend hasn't
 * implemented `GET /api/corpus/chunks` yet. Representative of the kind of
 * sources the LLM cites — manuals (📖) + tribal knowledge (👤).
 *
 * Once the backend wires the endpoint, this is no longer used.
 */
export const SAMPLE_CORPUS: CorpusChunk[] = [
  // ====== Manuals ======
  {
    id: -1,
    doc_class: "manual",
    doc_id: "AAR-OPS-2024",
    doc_title: "AAR Field Manual — Operating Practices, 2024 ed.",
    source_label: "AAR §4.2.7",
    page: 412,
    text: "Angle cock gaskets shall be inspected for cracks, cuts, or set-out at every Class I brake test. Replace at any sign of leakage; torque retainer ring to 18 ft-lb. Failure to seat the gasket squarely is the most common cause of recurring brake-pipe pressure loss in service.",
  },
  {
    id: -2,
    doc_class: "manual",
    doc_id: "CFR-49-229",
    doc_title: "49 CFR Part 229 — Locomotive Safety Standards",
    source_label: "§229.21",
    page: null,
    text: "Each locomotive in use shall be inspected at least once during each calendar day. The inspection shall include all items prescribed by §229.21(a) through (g), with results recorded on Form FRA F 6180.49A or an equivalent.",
  },
  {
    id: -3,
    doc_class: "manual",
    doc_id: "CFR-49-229",
    doc_title: "49 CFR Part 229 — Locomotive Safety Standards",
    source_label: "§229.59",
    page: null,
    text: "A locomotive may not be used if any leakage from its main reservoir or air-brake system, with a full service-brake application and the brake valve in lap position, exceeds 3 PSI per minute.",
  },
  {
    id: -4,
    doc_class: "manual",
    doc_id: "GE-ES44AC-OEM",
    doc_title: "GE ES44AC Maintenance Manual — Air Brake System",
    source_label: "GE ES44AC §6.4",
    page: 184,
    text: "When the brake-pipe pressure cannot be maintained above 75 PSI with the locomotive on charge, isolate at the angle cock on each car in sequence to localize the leak. Most failures occur within the first three cars of the consist.",
  },
  {
    id: -5,
    doc_class: "manual",
    doc_id: "GE-ET44AC-OEM",
    doc_title: "GE ET44AC Maintenance Manual — Diagnostics",
    source_label: "ET44AC §3.1",
    page: 47,
    text: "Fault code EM-2107 indicates a low-side EM2000 communication failure. First check the ribbon cable seating at the I/O cabinet; do not replace the EM2000 board without ruling out cable seating, which accounts for ~70% of EM-2107 occurrences in the field.",
  },

  // ====== Tribal knowledge ======
  {
    id: -6,
    doc_class: "tribal_knowledge",
    doc_id: "tribal-jm-2025-03",
    doc_title: "Tech notes — Tech JM, March 2025",
    source_label: "JM · Mar '25",
    page: null,
    text: "On Unit 4423 specifically, the angle cock at the B-end of car six fails about every 90 days — the bracket is bent slightly and stresses the gasket. Worth carrying two spare gaskets when working that consist.",
  },
  {
    id: -7,
    doc_class: "tribal_knowledge",
    doc_id: "tribal-shop-floor",
    doc_title: "Shop-floor heuristics — Yard 7",
    source_label: "Yard 7 · floor",
    page: null,
    text: "If you see EM-2107 paired with AB-44, it's almost always the I/O cabinet ribbon cable. The single EM-2107 by itself is more often the actual board. Don't pull the board until you've reseated the cable twice and watched it for a charging cycle.",
  },
  {
    id: -8,
    doc_class: "tribal_knowledge",
    doc_id: "tribal-air-brakes",
    doc_title: "Tribal — Air-brake quick reference",
    source_label: "Air-brake QR",
    page: null,
    text: "Class IA test passes but the unit fails Class I three minutes later? Check the dummy coupling on the trailing end. New techs often forget to seat it after a cut, and the system holds momentarily on residual pressure before bleeding through.",
  },
  {
    id: -9,
    doc_class: "tribal_knowledge",
    doc_id: "tribal-jm-2025-03",
    doc_title: "Tech notes — Tech JM, March 2025",
    source_label: "JM · Mar '25",
    page: null,
    text: "When pressure-testing after a gasket swap, give it 60 seconds at 90 PSI before declaring pass. The new gaskets weep for the first ~30 seconds while they seat — that's normal, not a failure.",
  },
];
