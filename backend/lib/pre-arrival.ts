import { getOpenAI, OPENAI_CHAT_MODEL } from "./openai";
import { searchCorpus } from "./tools/search-corpus";
import type { Asset, Severity } from "@contract/contract";

type Input = {
  asset: Asset;
  severity: Severity;
  initial_symptoms: string | null;
  initial_error_codes: string | null;
  fault_dump_raw: string | null;
};

const SYSTEM = `You are Railio, a rail-maintenance dispatcher's AI co-pilot.
Write a TIGHT pre-arrival brief — 2 to 4 sentences max — for the technician
walking up to the locomotive. State the unit, the symptom, the most likely
root cause, and what the tech should bring or check first.

Rules:
- Be concrete. No fluff, no greetings, no headings.
- Lean on the manual / tribal context if provided. Cite source labels in
  parentheses inline (e.g. "(AAR §4.2.7)") when you use them.
- If you genuinely don't know, say "Cause unclear; tech to confirm on site."
- Never invent part numbers, page numbers, or torque values.`;

export async function generatePreArrivalSummary(
  inp: Input,
): Promise<string | null> {
  const hasAnyContext =
    !!inp.initial_symptoms?.trim() ||
    !!inp.initial_error_codes?.trim() ||
    !!inp.fault_dump_raw?.trim();
  if (!hasAnyContext) return null;

  // Best-effort retrieval to ground the brief. Don't block on failure.
  let citations: { source_label: string; text: string }[] = [];
  try {
    const query = [
      inp.asset.unit_model,
      inp.initial_symptoms,
      inp.initial_error_codes,
    ]
      .filter(Boolean)
      .join(" ");
    if (query.trim()) {
      const res = await searchCorpus({ query, k: 4, doc_class_filter: "any" });
      citations = res.chunks.map((c) => ({
        source_label: c.source_label,
        text: c.text.slice(0, 400),
      }));
    }
  } catch {
    // ignore — generation can proceed without grounding
  }

  const userMsg = [
    `Unit: ${inp.asset.reporting_mark} ${inp.asset.road_number} (${inp.asset.unit_model})`,
    `Severity: ${inp.severity}`,
    inp.initial_symptoms ? `Symptoms: ${inp.initial_symptoms}` : null,
    inp.initial_error_codes ? `Error codes: ${inp.initial_error_codes}` : null,
    inp.fault_dump_raw
      ? `Fault dump (truncated): ${inp.fault_dump_raw.slice(0, 1500)}`
      : null,
    citations.length
      ? `\nGrounding (use only what's relevant):\n${citations
          .map((c) => `- (${c.source_label}) ${c.text}`)
          .join("\n")}`
      : null,
  ]
    .filter(Boolean)
    .join("\n");

  try {
    const client = getOpenAI();
    const completion = await client.chat.completions.create({
      model: OPENAI_CHAT_MODEL,
      temperature: 0.3,
      max_tokens: 220,
      messages: [
        { role: "system", content: SYSTEM },
        { role: "user", content: userMsg },
      ],
    });
    const text = completion.choices[0]?.message?.content?.trim();
    return text ? text : null;
  } catch (e) {
    console.error("[pre-arrival] generation failed:", e);
    return null;
  }
}
