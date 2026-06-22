# org-data — per-tenant onboarding format

Tenant data lives in **Supabase**, not in this folder. These subfolders are
**ephemeral, not committed**: to onboard a railroad you drop a `<slug>/` folder
here, load it into Supabase, then delete the folder. This file documents the
folder format `load_org` expects.

Each subfolder is **one organization (railroad tenant)**. You (the admin) prepare
a company's data here, then load it with:

```bash
python -m scripts.load_org <slug>
# then remove the local folder — Supabase is the source of truth
rm -r org-data/<slug>
```

Tenants do **not** upload their own data in the pilot — everything is loaded by
the admin. Data loaded for one org is invisible to every other org. Shared federal
regulation (49 CFR) is loaded separately by `scripts.corpus_build` with
`org_id = NULL` and is visible to all orgs.

## Folder layout

```
org-data/<slug>/
  org.json          REQUIRED  {"name": "Display Name", "slug": "<slug>"}
  assets.json       optional  the org's locomotive fleet
  parts.json        optional  the org's parts inventory (org-exclusive)
  history.json      optional  structured maintenance history, keyed by road number
  corpus/*.json     optional  knowledge docs (manuals, tribal notes, history)
```

### assets.json
```json
[
  { "reporting_mark": "BNSF", "road_number": "7670", "unit_model": "ES44DC",
    "in_service_date": "2006-08-15", "last_inspection_at": "2026-04-15T09:00:00Z" }
]
```

### history.json
Structured maintenance history per unit (rendered as a table in `/admin/fleet`
and embedded into the corpus as `tribal_knowledge` so the copilot can cite it).
Keyed by `road_number`; each value is a list of records. A road number with no
matching asset is skipped.
```json
{
  "3901": [
    { "reported_date": "2026-05-04", "completed_date": "2026-05-19",
      "record_type": "Quarterly Periodic Inspection",
      "repairs": ["Replaced: main air valve leak front and rear"],
      "tests": [{ "date": "2026-05-05", "name": "AFM CAL" }],
      "technician": "Pate, Phillip" }
  ]
}
```
A new locomotive model needs **no code change** — just use its name in `unit_model`
and add the matching manual under `corpus/`.

### parts.json
Same shape as a part row: `part_number, name, description, compatible_units[],
bin_location, qty_on_hand, supplier, lead_time_days, alternate_part_numbers[],
last_used_at`. Inventory is org-exclusive — `part_number` is unique per org, so two
railroads may stock the same number.

### corpus/*.json
Each file is an array of chunks:
```json
[
  { "doc_class": "manual" | "tribal_knowledge",
    "doc_id": "...", "doc_title": "...", "source_label": "...",
    "text": "...",
    "page": 7,                 // optional
    "unit_model": "ES44DC",    // optional — else inferred from road_number's asset
    "road_number": "7670" }    // optional — scopes the chunk to one asset
]
```

Scope applied at load time:
- **org_id** → always this org (org-private).
- **asset_id** → the asset matching `road_number` (explicit field, or a road number
  found inside `doc_id`); otherwise NULL (applies to the whole unit model).
- **unit_model** → `unit_model` if set, else the matched asset's model, else NULL
  (org-wide).

Re-running `load_org` for a slug fully replaces that org's assets, parts, and
private corpus. CFR and other orgs are never touched.
```
