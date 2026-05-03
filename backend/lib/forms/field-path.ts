import type { FormType } from "@contract/contract";

// Permitted top-level field paths per form type. Array indexing and array
// element subkeys are matched by prefix-with-shape: e.g. "defects[2].severity"
// matches the "defects[].severity" template below.
const ALLOWED: Record<FormType, string[]> = {
  F6180_49A: [
    "reporting_mark",
    "road_number",
    "unit_model",
    "build_date",
    "inspection_type",
    "inspection_date",
    "previous_inspection_date",
    "place_inspected",
    "inspector_name",
    "inspector_qualification",
    "items[]",
    "items[].code",
    "items[].label",
    "items[].result",
    "items[].note",
    "defects[]",
    "defects[].fra_part",
    "defects[].description",
    "defects[].location",
    "defects[].severity",
    "repairs[]",
    "repairs[].description",
    "repairs[].parts_replaced",
    "repairs[].completed_at",
    "air_brake_test",
    "air_brake_test.test_type",
    "air_brake_test.pass",
    "air_brake_test.readings",
    "out_of_service",
    "out_of_service_at",
    "returned_to_service_at",
    "signature",
    "signature.name",
    "signature.signed_at",
  ],
  DAILY_INSPECTION_229_21: [
    "unit.reporting_mark",
    "unit.road_number",
    "unit.unit_model",
    "inspector_name",
    "inspector_qualification",
    "inspected_at",
    "place_inspected",
    "previous_daily_inspection_at",
    "items[]",
    "items[].code",
    "items[].cfr_ref",
    "items[].label",
    "items[].result",
    "items[].note",
    "items[].photo_path",
    "exceptions",
    "signature",
    "signature.name",
    "signature.signed_at",
  ],
};

const INDEX_RE = /\[(\d+)\]/g;

export function validateFieldPath(form_type: FormType, path: string): boolean {
  const template = path.replace(INDEX_RE, "[]");
  return ALLOWED[form_type]?.includes(template) ?? false;
}

// Apply a value at field_path on a deep-cloned payload, growing arrays as needed.
export function applyFieldPath<T>(payload: T, path: string, value: unknown): T {
  // Tokenize "a.b[0].c" → ["a","b",0,"c"]
  const tokens: (string | number)[] = [];
  for (const part of path.split(".")) {
    let m: RegExpExecArray | null;
    let head = part;
    const arrayIdxs: number[] = [];
    const re = /\[(\d+)\]/g;
    while ((m = re.exec(part))) arrayIdxs.push(Number(m[1]));
    head = part.replace(/\[\d+\]/g, "");
    if (head) tokens.push(head);
    for (const i of arrayIdxs) tokens.push(i);
  }

  const root = JSON.parse(JSON.stringify(payload)) as Record<string, unknown>;
  let cursor: any = root;
  for (let i = 0; i < tokens.length - 1; i++) {
    const t = tokens[i];
    const next = tokens[i + 1];
    if (cursor[t] == null) cursor[t] = typeof next === "number" ? [] : {};
    cursor = cursor[t];
  }
  const last = tokens[tokens.length - 1];
  cursor[last] = value;
  return root as T;
}
