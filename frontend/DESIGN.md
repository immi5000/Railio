# DESIGN.md — Railio design profile

The single design language for the Railio web app. It is the **dashboard /
workspace "Figma" look** — a calm, data-dense, modern-utility system on a soft
grey surface. **Every screen, new or updated, follows this profile and nothing
else.**

Reference surfaces (the canonical implementation of this language):
[app/dashboard/page.tsx](app/dashboard/page.tsx) and the ticket workspace
[app/work/page.tsx](app/work/page.tsx). Tokens live in `:root` in
[app/globals.css](app/globals.css); component classes are prefixed `dash-`,
`work-`, `wc-`, `rc-`, and `fig-`.

> **Anything not literally present in the dashboard is extrapolated from it** and
> marked **🔧 Extension** below. Build those in the same idiom (soft surface,
> rounded, Inter + IBM Plex Mono + Source Serif, yellow accent). When in doubt,
> ask: *"how would the dashboard draw this?"* — never reach outside this system.

---

## 1. Principles

1. **Soft surface, sharp data.** A light-grey page holds white rounded cards with
   whisper-soft shadows. Chrome is gentle; data is precise.
2. **Type carries meaning.** Three families, strict jobs: **Mono = data**,
   **Inter = interface**, **Serif = the one human line.** Never swap their roles.
3. **One accent, used sparingly.** Yellow (`#fff246`) is the brand pop — one
   primary action or highlight per view. Black = emphasis & critical state. Blue
   (`#2683eb`) = links/interactive text only. Color is information, not decoration.
4. **Rounded, never square.** Cards 12–14px, controls 12px, pills fully round.
   Nothing in this system uses `border-radius: 0`.
5. **Quiet borders, real hierarchy.** Hierarchy comes from type weight/size and
   the white-on-grey surface — not heavy rules. Borders are hairlines.
6. **Sentence case, plain words.** The user is a tech in the yard. No SHOUTING
   headlines; uppercase survives only in tiny mono micro-labels.

---

## 2. Color

Use the token, never a raw hex, on new work.

### Surfaces & structure
| Token | Value | Use |
|---|---|---|
| `--dash-bg` | `#f4f5f7` | Page background; also fills inset chrome (composer, qty pills, hover rows). |
| white | `#ffffff` | Card / panel / nav-pill / control fill. |
| `--dash-line` | `#eef0f2` | Hairline *inside* cards (row dividers, header underlines). |
| `--dash-border` | `#e4e5e8` | Standard control/border (boxes, qty pills, toggle). |
| `--dash-card-border` | `#ecedef` | Card outline. |

### Text
| Token | Value | Use |
|---|---|---|
| black | `#000000` | Primary text, headings, IDs, emphasis. |
| near-black | `#3a3a3e` | Body / data values / status labels. |
| `--dash-muted` | `#7a7a7e` | Secondary text, captions, roles, sub-lines. |
| `--dash-faint` | `#9a9aa0` | Tertiary: table headers, placeholders, counts, hints. |

### Accent & interactive
| Token | Value | Use |
|---|---|---|
| `--dash-yellow` | `#fff246` | Brand accent: the one primary action per view, highlight block, major-severity chip, "me"/accent avatars, avatar glyph on black. |
| `--dash-link` | `#2683eb` | Links and interactive text; input focus ring. Hover → black. |
| black | `#000` | Critical chips, active toggle/segment, dot-prefixed active nav, dark avatars, the standard non-yellow solid button. |

### Semantic state (keep identical everywhere)
| Meaning | Color | Where |
|---|---|---|
| Awaiting tech | `#e0a200` amber | Status dot |
| In progress | `#2683eb` blue | Status dot |
| Awaiting review | `#9a9aa0` grey | Status dot |
| Closed / OK | `#5fb85f` (token `--ok` `#8dc572`) | Status dot, "all clear" badge |
| Critical | black bg / white text | `.dash-sev-critical`, `.wc-chip--crit`, alert badge |
| Major | yellow bg / black text | `.dash-sev-major` |
| Minor | transparent / muted text / `#d9dadd` border | `.dash-sev-minor` |
| 🔧 Destructive (extension) | text/icon in `#c0392b`; solid variant `#c0392b` bg, white text; soft variant `#fdecea` bg | Delete/reset actions. Lowest-frequency color — prefer a black solid + a confirm step over red where possible. |

Status-dot hexes live in `STATUS_DOT` in
[app/dashboard/page.tsx](app/dashboard/page.tsx) — reuse that map, don't re-pick.

---

## 3. Typography

Three families, loaded in [app/layout.tsx](app/layout.tsx). Each has one job.

| Family | Role | Notes |
|---|---|---|
| **Inter** | Interface: headings, buttons, body, names, stat values, chat text. | Weights 400/500/600/700. Headings are **500–600 sentence case** (not 700+ caps). Negative tracking on large sizes (`-0.02em`…`-0.03em`). |
| **IBM Plex Mono** | Data & labels: IDs, fault codes, unit marks, table headers, section/card titles, metadata, counts, chips, captions. | Weights 400/500/700. The signature of the look — anything machine/identifier-ish is mono. |
| **Source Serif 4** | The one editorial line: the greeting sub-headline / lede. | Weights 400/500. Used rarely, for warmth. |

> Set **Inter explicitly** on new UI. Don't rely on the `<body>` default font.

### Type scale
| Element | Family | Size | Weight | Tracking |
|---|---|---|---|---|
| Greeting title | Inter | `clamp(28px, 4vw, 40px)` | 500 | `-0.03em` |
| Greeting sub (lede) | Source Serif 4 | `clamp(18px, 2.4vw, 30px)` | 400 | — |
| Page/detail title | Inter | `clamp(24px, 3vw, 32px)` | 500 | `-0.02em` |
| Big unit number | Inter | 32px | 500 | `-0.03em` |
| Stat value | Inter | `clamp(40px, 5vw, 52px)` | 700 | — |
| Alert title | Inter | 22px | 600 | — |
| Section title | IBM Plex Mono | 16px | 400 | — |
| Card / panel title | IBM Plex Mono | 14px | 400 | — |
| Body / cell | Inter | 14px | 400 | — |
| Data value | IBM Plex Mono | 13px | 400 | — |
| Sub / caption | IBM Plex Mono | 12px | 400 (`--dash-muted`) | — |
| Table header | IBM Plex Mono | 10.5px | 400 (`--dash-faint`) | `0.04em`, UPPERCASE |
| Chip / count | IBM Plex Mono | 11px | 400 | — |

**Rule of thumb:** number / code / ID / label / status → **mono**; sentence /
name / heading → **Inter**; the hero subline → **serif**. Uppercase +
letter-spacing only on the tiny mono micro-labels.

---

## 4. Spacing, radius, elevation

**Spacing scale:** `--s1…--s7` = `4 / 8 / 12 / 16 / 24 / 32 / 48px`. Working
rhythm is **24px** between cards/sections, **20–28px** card padding.

**Radius:** cards **14px** (`.dash-card`) / **12px** (`.panel`, `.wc-card`,
`.work-ticket`); controls & boxes **12px**; composer **15px**; nav pill **18px**;
pills **20px** → **40px / 99px** (fully round: filters, chips, qty, toggle).

**Elevation** (barely-there — depth reads from white-on-grey, not blur):
| Use | Shadow |
|---|---|
| Card | `0 1px 2px rgba(16, 24, 40, 0.04)` |
| Nav pill | `0 2px 8px rgba(16, 24, 40, 0.03)` |
| Drawer / overlay | `2px 0 16px rgba(16, 24, 40, 0.12)` |

---

## 5. Layout

- **Page wrapper** (`.dash`, `.work`): `--dash-bg`, `min-height: 100vh`,
  horizontal padding **32px** (→ **16px** ≤760px). Grey is pulled up behind the
  sticky nav (`margin-top: calc(-1 * var(--fig-nav-zone)); padding-top:
  var(--fig-nav-zone)`) so scroll-top is one continuous surface — no white seam.
- **Inner container** (`.dash-inner`, `.work-inner`): `max-width: 1440px`,
  centered, vertical flex with `gap: 24px`.

### Grids
| Pattern | Columns | Collapse |
|---|---|---|
| Stat row (`.dash-stats`) | `repeat(3, 1fr)` | 1 col ≤980px |
| Bottom split (`.dash-bottom`) | `1.7fr 1fr` | 1 col ≤980px |
| Ticket body (`.work-body`) | `1.6fr 1fr` (copilot / context) | 1 col ≤980px |
| WO table (`.dash-wo`) | `1.6fr 2fr 0.9fr 1.1fr 1fr` | `1fr 1fr` ≤760px |
| Fleet table (`.dash-fleet`) | `1.4fr 0.8fr 1fr 1fr 0.5fr` | `1fr 1fr` ≤760px |

### Breakpoints
`980px` (multi→1 col), `860px` (nav → burger), `760px` (page padding 32→16,
tables simplify, `.dash-hide-sm` hides columns), `640px` (composer/card padding
tighten, iOS safe-area inset). **On touch widths inputs are ≥16px** to stop iOS
Safari zoom-on-focus.

---

## 6. Components

### Buttons 🔧 (dashboard shows the primary + chrome variants; the rest extrapolate)
One button hierarchy, all Inter 700, rounded, hover dims `filter:
brightness(0.94)`, `:disabled` → `opacity: 0.5`. Heights: **lg 56px** (composer
`.rc-send`), **md ~40–44px** (default), **sm ~32px**.

| Variant | Look | Use | Status |
|---|---|---|---|
| **Primary** | Yellow `#fff246` fill, black text, radius 12 (20 for pill CTAs like `.work-cta`). | The single most-important action per view. | live (`.work-cta`, `.rc-send`) |
| **Secondary** | White fill, `--dash-border`, black text; hover → black border. | Common actions next to a primary. | 🔧 extend (mirror `.rc-box`) |
| **Solid/strong** | Black fill, white text; hover → `#1a1a1a`. | A heavy non-yellow action (e.g. confirm). | 🔧 extend |
| **Ghost / text** | No fill/border, `--dash-link` text (or black); hover → black. | Inline/low-emphasis ("View →", links). | live (`.dash-link`, `.wc-link`) |
| **Icon/chrome** | 56px white box, radius 12, `--dash-border`; hover → black border; `data-active="true"` → black bg + yellow glyph. | Mic, attach, toolbar icons. | live (`.rc-box`) |
| **Destructive** | Soft `#fdecea` + `#c0392b` text, or solid `#c0392b`. Pair with a confirm. | Delete / reset. | 🔧 extend |

There is **no** uppercase, square button anywhere. Don't introduce one.

### Form controls
- **Text input / textarea / select:** white fill, `--dash-border`, **radius 12**,
  Inter or mono 14px (**16px on touch**). Focus = `--dash-link` border + 1px ring
  (`box-shadow: 0 0 0 1px var(--dash-link)`). 🔧 Apply this rounded style to new
  fields rather than any older square field style.
- **Filter select** (`.dash-filter`): rounded (40px) mono `<select>` with an
  inline SVG chevron, `--dash-bg` fill — the standard compact dropdown.
- 🔧 **Checkbox / radio / toggle:** rounded, `--dash-border` unchecked → black or
  yellow checked; the segmented control (`.seg-toggle`) is the model — rounded
  track, active segment solid black with white text.
- **Label:** mono, `--dash-faint`, small; sits above the field.

### Cards & panels
- **Card** (`.dash-card`): white, `--dash-border`, radius 14, soft shadow,
  20–28px padding. Header = mono section title + mono sub-line left, a
  `.dash-link` / `.dash-filter` right. Tables bleed to card edges via negative
  inline margin so row hovers run full-width.
- **Context card** (`.wc-card`) / **collapsible panel** (`.panel` inside
  `.work-context`): white rounded 12, mono title, mono label↔value meta rows.
  Panel header is a button with `data-open` + a rotating `.panel-chevron`.

### Stat card (`.dash-stat`, `min-height: 150px`)
Three layouts on one surface: **(1)** label-over-value column + a yellow
highlight block; **(2)** value + a right column with a faint decorative icon and
a mono trend; **(3)** alert — top row (badge + "View →") over an Inter title +
mono subline. Stat values are big Inter 700; counts pad to two digits (`02`).

### Data table (`.dash-row` + `.dash-wo`/`.dash-fleet`)
CSS-grid rows (not `<table>`). A `.dash-row--head` with mono uppercase `.dash-th`
labels, then `.dash-row--click` rows (rendered as `<Link>`) that hover to
`--dash-bg`. Every grid child gets `min-width: 0` for ellipsis. Cells: `.dash-id`
(mono bold), `.dash-unit` (mono bold, ellipsis), `.dash-cell` (Inter),
`.dash-data` / `.dash-sub` (mono). Right-align trailing meta.

### Pills, chips, badges, status
- **Status** = `.dash-status` / `.work-status` — a dot + Inter label. Dot color
  from `STATUS_DOT`. Never color-only; always pair the label.
- **Severity** = `.dash-sev-{critical|major|minor}` (mono, radius 6).
- **Count badge** = `.dash-count` (mono, rounded; `data-on="true"` → black).
- **Mono chips** = `.wc-chip--{crit|blue|soft}` (fully round). Critical = black,
  blue = soft blue `#e2eaf7` + `--dash-link`, soft = grey.
- **Filter pill** = `.dash-filter`. All pills/chips are mono, 10.5–11px, rounded.

### Avatars
Circular, Inter 700 initials. Default grey `#e9eaed` / black text;
`data-variant="me"` → black bg + yellow glyph; `data-variant="accent"` → yellow
bg + black glyph.

### Top nav (`.fig-nav`)
Sticky **frosted white pill** floating on grey: `rgba(255,255,255,0.96)` fill,
radius 18, soft shadow, with a `::before` gradient/mask that fades at the bottom
(no hard blur edge). Inter brand mark; Inter links (`#6b6f76` → black on hover;
active = black 700 with a 5px black dot prefix). Right: name (Inter 700) + org
(mono) + black circular avatar with **yellow** initials. Collapses to a bordered
burger ≤860px.

### Drawer (`.work-drawer`)
Off-canvas left panel: `translateX(-100%)` → `0` on `.is-open` (0.18s ease),
white, right hairline, overlay shadow, backdrop `rgba(0,0,0,0.32)`. Mono title
head, a `.seg-toggle`, and a scrolling list of `.work-ticket` cards (hover/active
→ black border + ring).

### 🔧 Modal / dialog (extension)
None in the dashboard yet. Build as a centered white **card** (radius 14, card
shadow lifted to the overlay shadow) on a `rgba(0,0,0,0.32)` backdrop. Mono
title, Inter body, actions bottom-right (primary yellow + secondary white).
Reuse confirm dialogs for destructive actions.

### Toast (`.toast`)
🔧 Update to the figma idiom: black fill, white text, a **yellow** left accent
bar (radius matched to the system), bottom-right, brief. (Drop any blue accent.)

### Ticket copilot (the new `/work` chat — canonical)
- **Copilot card** (`.work-copilot`): a `.dash-card` with a mono title head
  underlined by `--dash-line`, a scrolling message area, and the composer pinned
  at the bottom.
- **Composer** (`.rc-composer`): grey rounded bar (radius 15) holding a
  borderless auto-grow textarea (`.rc-input`, Inter 14) flanked by `.rc-box`
  chrome buttons (mic, attach) and the yellow `.rc-send`.
- **Empty state** (`.rc-empty`): centered hint + a column of suggestion buttons
  (`.rc-suggest` — grey rounded, hover → black border) under a mono "try" line.
- **Messages:** assistant answers render markdown (`.md`) — links and blockquote
  accents use `--dash-link`; inline code on `--dash-bg`. User messages sit in a
  soft-blue bubble. Citations (`.cite`/`.wc-chip--blue`) are rounded mono chips
  that open the citation drawer; tool calls show as small rounded tool pills.
- **Context column** (`.work-context`): the `.wc-card` / `.panel` stack — unit &
  intake, parts-to-bring rows (`.wc-part` with `.wc-qty`), fault & tribal chips
  (`.wc-chip`). This is the reference for any ticket-detail surface.

> Use these `/work` patterns for all ticket/detail UI. Don't resurrect older
> ticket-screen styling.

### Empty / loading / placeholder states
Quiet and honest: mono `--dash-muted` text centered in the surface
(`.work-placeholder`), e.g. "No work orders." / "All locomotives are operating
normally." Where data isn't wired yet, say so plainly rather than faking numbers.

---

## 7. Motion
Short and functional. Transitions **0.1–0.18s** — color/border on hover,
`transform` on drawers, `brightness(0.94)` dim on CTA hover, grey-fill or
black-border on row/card hover. Live-state keyframes (`wv` mic wave, `dot` live
pulse, `field-pulse` SSE flash) are for real-time feedback only — reuse them,
don't add decorative motion.

---

## 8. Voice & tone
- **Plain, direct, field-ready.** "Open work orders," not "Active maintenance
  requests." Short sentences.
- **Sentence case** for everything human-facing. Uppercase only in tiny mono
  micro-labels.
- **Numbers & codes verbatim.** Fault codes, unit marks, part numbers, citation
  `source_label`s render exactly as stored — never paraphrased.
- **Honest empty states** (see §6). The time-aware greeting ("Good morning,
  {name}", serif) is the one warm touch; elsewhere the tone is utilitarian.

---

## 9. Accessibility
- Touch targets ≥ ~42–56px on interactive chrome (composer boxes are 56px).
- Inputs ≥16px on ≤760px to prevent iOS zoom.
- **Never encode meaning in color alone** — status pairs a dot *with* a label;
  severity chips carry the word.
- Bottom-fixed chrome adds `env(safe-area-inset-bottom)`.
- Decorative glyphs get `aria-hidden`; selects get `aria-label`.
- `--dash-muted` / `--dash-faint` are for secondary text on white only — never
  primary copy on the grey page.

---

## 10. Do / Don't
**Do**
- Pull tokens from `:root`; reuse the `dash-`/`work-`/`wc-`/`rc-`/`fig-` classes.
- Data in mono, interface in Inter, the one hero subline in serif.
- Yellow for one clear action per view; blue for links only; black for emphasis.
- Build grey page → white rounded card → hairline-divided content.
- For anything not yet designed, extrapolate in this idiom and mark it as an
  extension; keep new shared styles in `globals.css` next to their family.

**Don't**
- Don't use square corners, all-caps headings, or any color outside this palette.
- Don't add a second accent color or a fourth font family.
- Don't make headings 700+ uppercase — they're 500–600 sentence case.
- Don't `fetch` from components or hardcode a hex where a token exists.
- Don't fake data precision; show an honest placeholder.

---

*Source of truth: tokens + classes in [app/globals.css](app/globals.css);
reference composition in [app/dashboard/page.tsx](app/dashboard/page.tsx) and
[app/work/page.tsx](app/work/page.tsx). If this profile and the CSS disagree,
fix one to match the other in the same change.*
