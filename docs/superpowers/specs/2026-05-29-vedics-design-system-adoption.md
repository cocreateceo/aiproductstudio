# Vedics Design System Adoption — Wave A (Foundation Swap + Homepage)

**Status:** Design approved (sections 1–4). Ready to plan.
**Date:** 2026-05-29
**Owner:** CoCreate Idea (CEO)
**Repo:** `option-a-threejs-gsap-tailwind/site/`
**Deployed at:** `https://www.cocreateidea.com/`
**Spec series:** Sub-project 1 of 3 (Wave A · Wave B · Wave C).
**Source of design:** `C:\Projects\ai-product-studio\design\Vedics Design System_FInal\` — a complete design system extracted from the same CoCreate production codebase. `README.md` and `SKILL.md` inside that folder are the canonical brand reference for everything below.

---

## 1. Background and goal

The site already runs the *cocreateidea-design-system* shipped earlier this same session (spec `2026-05-28-…-homepage-design.md`). It works — tokens, components, 10-block homepage, 8 themes, 17 live screenshots, click-to-open modal — but on a deeper look its design language is plainer than what the brand has been carrying internally. The Vedics design system (delivered as a complete folder of tokens, themes, preview HTML, component CSS, and 10 React page templates) refines what we have along a coherent product-brand direction:

- The signature **fixed cinematic background** (`assets/cocreate_bg.png` — figure on illuminated horizon) restored as the canvas via `body::before`.
- **Glass-morphism cards** — `rgba(45, 20, 8, 0.85)` + `backdrop-filter: blur(20px)` + 1px primary-tinted border + warm-tinted shadows.
- **Pill-shaped CTA buttons** with gradient fill and a `::before` shimmer-sweep on hover.
- **Space Grotesk** added for big stat numerals, always with the peach→vermillion gradient text treatment.
- **Lucide-style stroke icons** standardised.
- **`Eyebrow` uppercase tracked 0.18em** — the studio's signature voice marker (we currently use 0.08em).
- **Single-gradient-phrase per page** as a strict brand rule.
- **Chat FAB** bottom-right (visual re-skin of the existing chat widget, no backend change).

**Wave A goal:** swap the foundation (tokens + base + components) to the Vedics design system in place — same file paths, rewritten contents — then redesign `index.html` to match the new visual language, preserving every content block we shipped on 2026-05-28. Theme parity (8 themes) and `projects.html` non-regression are gates.

**Scope sequencing (decomposition of the full-site rebuild):**

| Wave | Scope |
|---|---|
| **A — this spec** | Foundation swap (tokens, base, components) + index.html rewrite. Projects pages auto-upgrade via shared components. |
| **B — queued** | Roll the system to `who-we-are`, `what-we-do`, `product`, `success-stories`, `leadership`, `contact`, `blogs`, `insights`, `apply`, `schedule`. |
| **C — queued** | App-flavored pages (`admin`, `user`, `awscost`, `costs`, `chat`, `ai`, `premium-demo`, `event`, `careers`, `partners`, `investors`, `culture`, `platforms`, `privacy`, `404`). |

**Approach chosen:** Approach B (full swap, clean break). Same file paths kept so theme files and existing pages continue to function via the same `<link>` references — only the contents change. A compatibility alias layer in `tokens.css` translates the previous spec's `--sp-*`, `--sh-*`, `--fs-*`, `--r-*`, `--dur-*`, `--ease-*` token names to the Vedics design's `--s-*`, `--shadow-*`, `--font-*`, `--r-*`, `--transition-speed`, `--ease-*` so component CSS files that consume old names (steps.css, quote.css, accordion.css, cta.css, section.css, etc.) keep compiling without per-file edits.

**Aesthetic direction:** Warm + dark + cinematic (Ember default). Stripe-style density preserved from the prior spec, layered onto the cinematic canvas and glass-morphism surfaces.

**Primary audience:** Founders / aspiring entrepreneurs. Hero copy and primary CTA unchanged from 2026-05-28.

---

## 2. Homepage block-by-block treatment

Content is preserved from 2026-05-28. Only the visual treatment and layout change. The block count stays at **12** (Hero, Marquee, Outcomes, The Challenge, Featured Products, How-it-works + 13-day timeline, Cinematic, Quote, Co-founder Model + equity split, Win-Win pillars, FAQ, Final CTA) plus a **Chat FAB** that floats over the page.

The page gains `class="cc-bg-fixed"` on `<body>` so the cinematic photo (`assets/cocreate_bg.png`) sits behind everything via `body::before`.

### Block 1 — Hero (significant change)
- Layout flips from 2-column (copy + mosaic) to **centered single-column** (max-width ~880 px).
- Eyebrow becomes a pill: green ● dot + `AI-POWERED PRODUCT STUDIO` uppercase tracked at `0.18em`.
- H1 stays "Imagine. CoCreate. Done!" verbatim; `<span class="gradient-word">CoCreate</span>` gets `--grad-brand` via `-webkit-background-clip: text`.
- Sub-tagline verbatim: "Your AI Partner. Launch your business in 2 weeks."
- CTAs become **pill buttons** with `::before` shimmer-sweep on hover. Primary `Let's CoCreate` (gradient), secondary `See what we've built` (ghost pill).
- Trust strip stays: `⚡ 2 weeks to launch · $0 upfront · {LIVE_COUNT} products shipped`.
- The portfolio mosaic moves out of the hero. The cinematic photo (now visible behind the centered hero via `body::before`) provides the atmospheric weight previously carried by the mosaic.

### Block 2 — Wordmark marquee (visual only)
Class names preserved (`.marquee`, `.marquee__track`, `.marquee__item`). Wordmarks in Outfit 700, `opacity: 0.7`, fade mask on edges. Animation unchanged (40 s linear).

### Block 3 — Outcomes stats (significant change)
- Numerals use `.stat-number` — Space Grotesk 700 with peach→vermillion gradient text.
- Stat cards become `.cc-card` glass — `rgba(45, 20, 8, 0.85)` + `backdrop-filter: blur(20px)` + 1px `var(--border-color)` + `--shadow-md`. Hover lifts `-8px` and intensifies to `--shadow-lg`.
- Section heading "Built for founders who want to ship — not just specs." stays. **Decision deferred to §10**: whether to apply the single-page-gradient rule strictly (gradient only on "CoCreate" in Block 1) or per-section (also gradient "ship" here and "CoCreate" in Block 10).

### Block 3.5 — The Challenge (visual only)
Dual-column cards (Tech Founders / Business Founders) become glass-morphism. H3 sub-headings get tighter `var(--track-tight)` tracking. Closing italic line uses `var(--text-muted)`.

### Block 4 — Featured Products (significant change — adds status tabs)
- New `.cc-tabs` above the grid: `Everything (N_total) · Live (N_live) · Building (N_building) · Launching (N_launching)`. Counts computed live from `PROJECTS_DATA`.
- Active tab gets `background: var(--grad-cta); color: #fff; box-shadow: var(--shadow-cta);`. Others muted.
- One new field on each `PROJECTS_DATA` record: `status: "live" | "building" | "launching"`. Default mapping at JS-init time: `liveUrl` present → `"live"`, else → `"building"`. CEO can later override per-project; no fabrication in this spec.
- `productCardHTML` emits one new attribute: `data-status="<value>"` on the outer card div.
- A tiny IIFE in `index.html`'s inline `<script>` listens for tab clicks and toggles `.is-hidden` on `.proj-card` records whose `data-status` doesn't match. `Everything` shows all.
- Cards themselves are the existing `.proj-card`, rewritten visually in `components/card.css` (Section 3).
- "See all N products →" link stays; becomes a ghost pill button.

### Block 5 — How it works + 13-day timeline (visual only)
- Step circles become glass; the active step's circle gains a 2px peach ring (`box-shadow: 0 0 0 2px var(--accent)` inset or outer).
- Day-by-day timeline cards (`Day 1-4`, `Day 5-6`, `Day 7-13`) become glass with `--accent` Day labels in Outfit 700.
- Connecting line uses a subtle peach gradient fade.

### Block 6 — Cinematic "Our Approach" (mostly absorbed by `body::before`)
- `<section class="cinematic">` no longer paints its own background image (would duplicate `body::before`).
- Becomes a **content overlay** — eyebrow `Our approach`, H2 `Where ideas meet AI.`, sub paragraph, ghost-pill CTA `Our way → /who-we-are.html`.
- Section gets transparent background but reserves vertical space (`min-height: 70vh`) so the cinematic photo is the focus.
- `cinematic.js` GSAP parallax now parallaxes `body::before` instead of a duplicate `.cinematic__bg`. Falls back to no-op if GSAP/ScrollTrigger absent (already gated).

### Block 7 — Founder quote (visual only)
`.quote` card becomes glass. Open-quote glyph (currently `\201C`) gets the peach→vermillion gradient. Avatar gets a 2px `var(--accent)` ring.

### Block 8 — Co-founder Model + You/Us/Operations equity split (visual only)
- 4 stat cards become glass with `.stat-number` gradient numerals: `$0`, `2 wks`, `Shared`, `Always-on`.
- The You/Us/Operations equity split below becomes **3 glass mini-cards** in an auto-fit grid; each has a small Lucide `CheckCircle2` icon in a peach circle + `<strong>You</strong>` Outfit heading + secondary-text description.

### Block 6.5 — Win-Win pillars (visual only)
4 glass cards. Pillar titles in Outfit 700, body in DM Sans. Hover lift `-4px`.

### Block 9 — Founder FAQ (visual only)
`<details>` items become glass cards. `+/×` toggle becomes a peach Lucide `Plus` icon (currently a typographic `+`) that rotates 45° on `[open]` (existing rule, new icon source).

### Block 10 — Final CTA (visual only)
- `.cta-band` background becomes transparent; the cinematic photo shows through.
- Inside `.cta-band__title`, "CoCreate" gets the gradient (subject to §10 open question).
- Primary button gets shimmer-sweep `::before`.
- "We review every application personally." trust line stays verbatim.

### Additional — Chat FAB (net-new visual element)
- Net-new `.cc-fab` element appears bottom-right on every viewport ≥ 560 px.
- Pill button (`var(--r-pill)` `56px` square), gradient fill `var(--grad-cta)`, `var(--shadow-cta)`. Hover lifts `-2px` and scales `1.06` with `var(--shadow-cta-h)`.
- Re-skins the existing chat widget's trigger; binds its open API. No backend change. If `chat-widget.js` emits its own button, that button is hidden via CSS (audit during implementation).

---

## 3. File structure changes

### 3.1 Files replaced in place (paths unchanged, contents rewritten)

| Path | What it becomes |
|---|---|
| `css/tokens.css` | Adapted from `Vedics Design System_FInal/colors_and_type.css`. Brand primitives, semantic tokens, signature gradients, 4 px spacing ladder, 7-step radii incl. `--r-pill`, warm-tinted shadow tokens, Space Grotesk font addition. **Also contains the back-compat alias shim** (§4). |
| `css/base.css` | Reset + body + headings + `.eyebrow` + `.stat-number` from the Vedics base section. Sets `body { background: var(--bg-primary); color: var(--text-primary); }` (fixes the body-color bug that bit us on the 2026-05-28 deploy). |
| `css/components/card.css` | Rewritten as glass-morphism. Class names preserved (`.proj-card`, `.proj-tile`, `.tile-icon`, `.tile-initial`, `.tile-shot`, `.tile-shot--photo`, `.proj-tile-hint`, `.proj-badge`, `.proj-body`, `.proj-cat-tag`, `.proj-visit`, `.proj-soon`, `@keyframes tile-shot-in`) so `projects-render.js` selectors and existing modal behaviour are unaffected. (`projects-render.js` does receive one small line-level edit — see §6.2 — to emit the new `data-status` attribute. The CSS-side stays selector-compatible.) **New utility `.cc-card`** added as the canonical glass-card primitive for net-new sections. **New utility `.proj-card.is-hidden { display: none }`** is added in `cc-tabs.css`, not `card.css`, to keep the card primitive theme-pure. |
| `css/components/modal.css` | Same class names (`.proj-modal*`, `body.proj-modal-open`, `@keyframes pm-fade`, `@keyframes pm-rise`, the 520-px media rule) — re-styled glass panel with new tokens. |
| `css/components/section.css` | `.section`, `.container`, `.eyebrow`, `.display-xl/l/m`, `.lede` rewritten. Eyebrow tracking moves to `0.18em` from `0.08em`. |
| `css/components/button.css` | `.btn`, `.btn--primary`, `.btn--ghost`, `.btn--lg/sm` rewritten to pill-shaped. `.btn--primary` gets `::before` shimmer sweep. |
| `css/components/badge.css` | `.pill`, `.trust-strip`, `.trust-strip__sep`, `.trust-strip__item` — visual updates, pill-shaped with glass background. |
| `css/components/stat.css` | `.stats`, `.stat`, `.stat__num`, `.stat__label`, `.stat__caption` rewritten. `.stat__num` now uses `.stat-number` styling internally (Space Grotesk + peach→vermillion gradient). |
| `css/components/marquee.css` | `.marquee`, `.marquee__track`, `.marquee__item`, `@keyframes marquee-scroll`, reduced-motion override — minor visual tweaks. |
| `css/components/steps.css` | Step circles become glass; active step gets the peach ring; mobile breakpoint preserved. |
| `css/components/quote.css` | Glass card + gradient open-quote glyph + accent avatar ring. |
| `css/components/accordion.css` | Glass items; Lucide `Plus` toggle replacing the typographic `+`. |
| `css/components/cinematic.css` | No longer paints its own `background-image`. Reserves vertical space; centers content over the body's cinematic bg. |
| `css/components/cta.css` | Transparent band; shimmer-sweep primary button. |
| `css/pages/home.css` | Rewritten: centered hero, status-tabs layout, glass everywhere. |
| `css/themes/*.css` (all 8) | Values preserved; token *names* aligned with new semantic names where the Vedics design renames. Light themes (`coral`, `aurora`, `sandstone`, `champagne`) override `body::after` to a cream gradient so text stays legible on the fixed cinematic photo. `zoom.css` aligned the same way (we keep all 8 themes; the Vedics design ships 7). |
| `js/projects-data.js` | Adds `status: "live" \| "building" \| "launching"` field to each project record. Default-fill rule documented inline. |
| `js/projects-render.js` | One added line: emit `data-status="<value>"` on the outer card `<div>`. No other change. |

### 3.2 Files added net-new

| Path | Purpose |
|---|---|
| `css/components/cc-bg.css` | `.cc-bg-fixed::before` (fixed cinematic image) + `.cc-bg-fixed::after` (readability gradients). |
| `css/components/cc-tabs.css` | `.cc-tabs`, `.cc-tab`, `.cc-tab.is-active`, `.cc-tab__count`. |
| `css/components/cc-fab.css` | `.cc-fab` chat trigger. |
| `css/components/partner-card.css` | Larger portfolio card variant used for hero portfolio callouts and any feature spotlight callouts. |

### 3.3 Files unchanged

`css/projects.css` (slimmed page-specific styles from the prior project), `css/responsive.css`, `css/awscost.css`, `css/costs.css`, `css/chat-widget.css`, `css/scheduler.css`, every other HTML page in the site, all JS apart from the two noted in §3.1.

### 3.4 Asset additions / replacements

`assets/cocreate_bg.png` already exists at the expected path. `assets/cocreate-logo.svg` and `assets/cocreate-icon.svg` will be compared against the Vedics-folder versions and replaced if cleaner/newer.

---

## 4. Token migration map

### 4.1 New brand primitives (theme-agnostic, top of `tokens.css`)

```css
:root {
  --cc-peach:        #FFC36A;
  --cc-coral:        #FE9F7D;
  --cc-coral-red:    #FD6C71;
  --cc-vermillion:   #FC2A0D;
  --cc-ink:          #1A0A00;
  --cc-ink-deep:     #0D0500;
  --cc-ember-bg-2:   #2D1408;
  --cc-ember-card:   rgba(45, 20, 8, 0.85);
  --cc-ember-card-h: rgba(60, 28, 12, 0.9);
  --cc-cream:        #FFF8F0;
  --cc-cream-mid:    #FFCBA4;
  --cc-cream-dim:    #C4916C;
}
```

### 4.2 Semantic tokens (token names kept; values aligned)

`--bg-primary`, `--bg-secondary`, `--bg-card`, `--bg-card-hover`, `--text-primary`, `--text-secondary`, `--text-muted`, `--primary`, `--secondary`, `--accent`, `--border-color`, `--nav-bg`, `--glow-color` — all retained with their existing names; values updated to the Vedics palette (which is the same ember palette but more precisely tokenised).

### 4.3 New gradient tokens

```css
--grad-brand: linear-gradient(135deg, var(--accent) 0%, var(--primary) 50%, var(--secondary) 100%);
--grad-cta:   linear-gradient(135deg, var(--primary) 0%, var(--secondary) 100%);
--grad-mesh:
  radial-gradient(ellipse 80% 60% at 30% 20%, rgba(255, 195, 106, 0.4) 0%, transparent 50%),
  radial-gradient(ellipse 70% 80% at 70% 60%, rgba(252, 42, 13, 0.5) 0%, transparent 50%),
  radial-gradient(ellipse 90% 70% at 50% 90%, rgba(139, 37, 0, 0.6) 0%, transparent 60%),
  radial-gradient(ellipse 50% 50% at 80% 20%, rgba(253, 108, 113, 0.3) 0%, transparent 45%),
  linear-gradient(180deg, #1A0A00 0%, #0D0500 100%);
```

### 4.4 Spacing scale (renamed) + alias shim

New: `--s-1: 4px` through `--s-10: 128px` plus `--nav-height: 80px`. Old `--sp-1` through `--sp-16` already used by `home.css`, `steps.css`, `quote.css`, `accordion.css`, `section.css`, `cta.css`, etc. **Alias shim** in `tokens.css` keeps them all working:

```css
:root {
  --sp-1: var(--s-1);  --sp-2: var(--s-2);  --sp-3: var(--s-3);  --sp-4: var(--s-4);
  --sp-5: var(--s-5);  --sp-6: var(--s-5);  --sp-7: var(--s-6);  --sp-8: var(--s-6);
  --sp-9: var(--s-7);  --sp-10: var(--s-7); --sp-11: var(--s-8); --sp-12: var(--s-8);
  --sp-13: var(--s-9); --sp-14: var(--s-9); --sp-15: var(--s-10); --sp-16: var(--s-10);
  --sec-py: clamp(64px, 8vw, 120px);
  --container-max: 1200px;
  --container-px: clamp(20px, 4vw, 40px);
}
```

### 4.5 Radii — adds `--r-pill`, renames

```css
--r-xs:   4px;    /* nav contact CTA */
--r-sm:   8px;    /* was 6 px */
--r-md:   12px;   /* was 10 px */
--r-lg:   16px;   /* unchanged */
--r-xl:   20px;   /* was 24 px */
--r-2xl:  24px;   /* was 32 px */
--r-pill: 9999px; /* NEW — used by all pill buttons + status tabs + chat fab */
--r-full: 999px;  /* alias retained for back-compat */
```

### 4.6 Shadows (renamed, warm-tinted)

```css
--shadow-sm:    0 4px 12px rgba(0, 0, 0, 0.25);
--shadow-md:    0 8px 32px rgba(252, 42, 13, 0.15), inset 0 1px 0 rgba(255, 255, 255, 0.05);
--shadow-lg:    0 12px 48px rgba(252, 42, 13, 0.25), inset 0 1px 0 rgba(255, 255, 255, 0.08);
--shadow-glow:  0 0 20px var(--glow-color);
--shadow-glow-strong: 0 0 40px var(--glow-color), 0 0 60px rgba(255, 195, 106, 0.2);
--shadow-cta:   0 4px 20px rgba(252, 42, 13, 0.4);
--shadow-cta-h: 0 8px 32px rgba(252, 42, 13, 0.6);
/* Aliases for back-compat */
--sh-sm: var(--shadow-sm); --sh-md: var(--shadow-md); --sh-lg: var(--shadow-lg);
--sh-glow: var(--shadow-glow); --sh-focus: 0 0 0 3px var(--focus-color, rgba(255, 195, 106, 0.45));
```

### 4.7 Type — additions + scale aliases

```css
--font-display:  'Outfit', 'DM Sans', system-ui, sans-serif;
--font-body:     'DM Sans', system-ui, sans-serif;
--font-stat:     'Space Grotesk', 'Outfit', system-ui, sans-serif;
--track-display: -0.03em;
--track-tight:   -0.02em;
--track-eyebrow: 0.18em;
--track-cta:     0.08em;
/* Aliases */
--ff-display: var(--font-display); --ff-body: var(--font-body); --ff-mono: ui-monospace, Menlo, monospace;
--ls-display: var(--track-display); --ls-section: var(--track-tight); --ls-caption: var(--track-eyebrow);
--lh-tight: 1.1; --lh-snug: 1.3; --lh-normal: 1.55; --lh-relaxed: 1.7;
--fs-display-xl: clamp(2.25rem, 5vw, 4.5rem);
--fs-display-l:  clamp(1.75rem, 3.5vw, 3rem);
--fs-display-m:  1.75rem;
--fs-title-l:    1.4rem;
--fs-title-m:    1.25rem;
--fs-body-l:     1.125rem;
--fs-body-m:     1rem;
--fs-body-s:     0.875rem;
--fs-caption:    0.75rem;
```

Add Space Grotesk to the Google Fonts request in `<head>`:
```html
<link href="https://fonts.googleapis.com/css2?family=DM+Sans:ital,opsz,wght@0,9..40,400;0,9..40,500;0,9..40,600;0,9..40,700;1,9..40,400&family=Outfit:wght@400;500;600;700;800&family=Space+Grotesk:wght@500;600;700&display=swap" rel="stylesheet">
```

### 4.8 Motion (renamed, aliased)

```css
--transition-speed: 0.4s;
--ease-out:    cubic-bezier(0.22, 1, 0.36, 1);
--ease-smooth: cubic-bezier(0.4, 0, 0.2, 1);
/* Aliases */
--dur-fast: 160ms; --dur-base: 280ms; --dur-slow: var(--transition-speed);
--ease-in-out: var(--ease-smooth); --ease-spring: cubic-bezier(0.16, 1, 0.3, 1);
```

### 4.9 Coverage of the alias shim

The shim must cover every token name the surviving component CSS files reference. Token names used by current component CSS (enumerated at write time): `--sp-2/3/4/5/6/7/9/11/12/14`, `--sh-sm/md/lg/glow/focus`, `--fs-display-xl/l/m`, `--fs-title-l/m`, `--fs-body-l/m/s`, `--fs-caption`, `--ls-display/section/caption`, `--lh-tight/snug/normal/relaxed`, `--ff-display/body`, `--r-sm/md/lg/xl/full`, `--container-max`, `--container-px`, `--sec-py`, `--dur-fast/base/slow`, `--ease-out/in-out/spring`. **All of these are aliased** in §4.4–4.8 above.

---

## 5. New component primitives — exact CSS contracts

### 5.1 `components/cc-bg.css` — signature fixed cinematic background

```css
.cc-bg-fixed::before {
  content: ''; position: fixed; inset: 0;
  background: url('assets/cocreate_bg.png') center bottom / cover no-repeat;
  z-index: -2; pointer-events: none;
}
.cc-bg-fixed::after {
  content: ''; position: fixed; inset: 0; z-index: -1; pointer-events: none;
  background:
    radial-gradient(ellipse 120% 100% at 50% 100%, transparent 30%, rgba(26, 10, 0, 0.6) 100%),
    linear-gradient(90deg, rgba(26, 10, 0, 0.65) 0%, rgba(26, 10, 0, 0.3) 40%, transparent 60%),
    linear-gradient(180deg, rgba(26, 10, 0, 0.5) 0%, transparent 40%);
}
```

Each **light** theme file (`coral`, `aurora`, `sandstone`, `champagne`) overrides `body.cc-bg-fixed::after` with a cream-tinted overlay so text on top stays legible:

```css
/* in css/themes/coral.css (light) */
body.cc-bg-fixed::after {
  background:
    radial-gradient(ellipse 120% 100% at 50% 100%, transparent 30%, rgba(255, 248, 240, 0.6) 100%),
    linear-gradient(90deg, rgba(255, 248, 240, 0.65) 0%, rgba(255, 248, 240, 0.3) 40%, transparent 60%),
    linear-gradient(180deg, rgba(255, 248, 240, 0.5) 0%, transparent 40%);
}
```

### 5.2 `components/cc-tabs.css` — status tabs for Featured Products

```css
.cc-tabs {
  display: inline-flex; gap: var(--s-2); padding: var(--s-2);
  background: var(--bg-card); border: 1px solid var(--border-color);
  border-radius: var(--r-pill); backdrop-filter: blur(20px);
}
.cc-tab {
  padding: var(--s-2) var(--s-5); border-radius: var(--r-pill);
  font: 500 0.875rem var(--font-display); letter-spacing: var(--track-cta);
  text-transform: uppercase; color: var(--text-secondary);
  cursor: pointer;
  transition: all var(--transition-speed) var(--ease-smooth);
}
.cc-tab:hover { color: var(--text-primary); }
.cc-tab.is-active { background: var(--grad-cta); color: #fff; box-shadow: var(--shadow-cta); }
.cc-tab__count { margin-left: var(--s-2); opacity: 0.7; font-size: 0.75em; }
.proj-card.is-hidden { display: none; }
```

### 5.3 `components/cc-fab.css` — chat FAB

```css
.cc-fab {
  position: fixed; right: var(--s-5); bottom: var(--s-5); z-index: 90;
  width: 56px; height: 56px; border-radius: var(--r-pill);
  background: var(--grad-cta); color: #fff;
  box-shadow: var(--shadow-cta);
  display: inline-flex; align-items: center; justify-content: center;
  cursor: pointer;
  transition: transform var(--transition-speed) var(--ease-smooth),
              box-shadow var(--transition-speed);
}
.cc-fab:hover { transform: translateY(-2px) scale(1.06); box-shadow: var(--shadow-cta-h); }
.cc-fab svg { width: 24px; height: 24px; stroke: currentColor; stroke-width: 2; fill: none; }
@media (max-width: 560px) { .cc-fab { display: none; } }
```

### 5.4 `components/partner-card.css` — large portfolio card

```css
.partner-card {
  padding: var(--s-6); background: var(--bg-card);
  border: 1px solid var(--border-color); border-radius: var(--r-lg);
  backdrop-filter: blur(20px);
  transition: all var(--transition-speed) var(--ease-smooth);
}
.partner-card:hover {
  transform: translateY(-8px) scale(1.02);
  border-color: var(--accent);
  box-shadow: var(--shadow-lg);
}
```

---

## 6. JS changes

### 6.1 `js/projects-data.js`
- New optional field `status` on each project: `"live" | "building" | "launching"`.
- Default-fill rule applied at flatten time (so existing data files don't all need editing immediately): if `status` absent → `(p.liveUrl && p.liveUrl !== '#') ? "live" : "building"`.

### 6.2 `js/projects-render.js`
- `productCardHTML(p, opts)` emits one new attribute: `data-status="<value>"` on the outer `.proj-card` div.
- `flatten()` adds the default-fill rule above.
- No other changes.

### 6.3 `index.html` inline IIFE
After the existing live-count + featured-render IIFE, append a tabs IIFE:

```js
(function () {
  var tabs = document.querySelectorAll('.cc-tabs .cc-tab');
  if (!tabs.length) return;
  function apply(filter) {
    document.querySelectorAll('#js-home-featured .proj-card').forEach(function (c) {
      var s = c.getAttribute('data-status');
      c.classList.toggle('is-hidden', filter !== 'all' && s !== filter);
    });
  }
  tabs.forEach(function (t) {
    t.addEventListener('click', function () {
      tabs.forEach(function (x) { x.classList.toggle('is-active', x === t); });
      apply(t.getAttribute('data-filter'));
    });
  });
})();
```

### 6.4 `js/cinematic.js`

GSAP can't directly target a pseudo-element. The new technique:
1. `tokens.css` defines `--cc-bg-y: 0px` on `:root`.
2. `components/cc-bg.css` `body.cc-bg-fixed::before` uses `background-position: center calc(100% + var(--cc-bg-y));` so its position is driven by the CSS variable.
3. `cinematic.js` animates the CSS variable on `<html>` via `gsap.to(document.documentElement, { '--cc-bg-y': '40px', ease: 'none', scrollTrigger: { trigger: '.cinematic', start: 'top bottom', end: 'bottom top', scrub: true } })` — register a custom CSS-variable plugin or use `--cc-bg-y` as a property via `CSS.registerProperty`.

Reduced-motion + library-missing guards unchanged. If GSAP/ScrollTrigger absent, the variable stays at `0px` and the photo simply doesn't parallax.

---

## 7. Theme parity (8 themes)

Each theme file in `css/themes/`:
- Sets its own values on the **semantic tokens** (`--bg-primary`, `--text-primary`, `--accent`, `--primary`, `--secondary`, `--border-color`, `--nav-bg`, `--glow-color`, `--bg-card`, `--bg-card-hover`).
- Does **not** touch the brand primitives (`--cc-*`) — those are constants.
- Light themes (`coral`, `aurora`, `sandstone`, `champagne`) additionally override `body.cc-bg-fixed::after` to a cream-tinted overlay (see §5.1).
- Dark themes (`ember`, `sunset`, `legacy`) leave `body.cc-bg-fixed::after` at its default dark overlay.
- `zoom.css` aligned the same way (kept; we ship 8 themes).

---

## 8. Verification gates

Each must pass before deploy.

1. **Token-shim assertion.** A node `check.js` (extends `assert_tokens.js`) confirms every aliased token resolves to a non-empty computed value at runtime. Enumerates: `--sp-1..16`, `--sh-sm/md/lg/glow/focus`, `--fs-*`, `--ls-*`, `--lh-*`, `--ff-*`, `--r-sm/md/lg/xl/full`, `--container-max/px`, `--sec-py`, `--dur-fast/base/slow`, `--ease-out/in-out/spring`. Plus the new tokens.
2. **Homepage assertion (extends `assert_home_hero.js`).** Verifies:
   - H1 contains "Imagine. CoCreate. Done!" with exactly one `.gradient-word` span wrapping "CoCreate".
   - `<body>` has `class` containing `cc-bg-fixed`.
   - Eyebrow pill renders with the green dot.
   - Trust strip live-count is a positive integer.
   - `.cc-tabs` exists with 4 tabs and counts that sum to the featured-grid card count.
   - `.cc-fab` exists in the DOM.
3. **Status-tabs interaction test.** Programmatically click each tab; assert `.proj-card:not(.is-hidden)` count matches the expected per-status count.
4. **Projects-page non-regression** (critical for Approach B). Re-run `assert_projects_cards.js` against `file://projects.html`: 6 cards, modal opens to a known title, no JS errors. Same for `projects-category.html`.
5. **Theme parity sweep.** PowerShell loop swaps `data-theme` and `themes/<x>.css` link for each of `ember, coral, sunset, aurora, legacy, sandstone, champagne, zoom`, screenshots at 1280 × 7000, then reverts to `ember`. Assemble into a contact sheet for review. Layout stable, text legible on each — light themes verified for cream `::after` overlay.
6. **`prefers-reduced-motion`.** Chrome `--force-prefers-reduced-motion`; full-page screenshot. Marquee static; cinematic parallax off; entrance fades off.
7. **Lighthouse on live URL** (post-deploy). Performance ≥ 90, Accessibility ≥ 95, Best Practices ≥ 95, SEO ≥ 90.
8. **Zero console errors + zero 404s** on live `www.cocreateidea.com` after CloudFront invalidation.

---

## 9. Deploy plan

```bash
# code
aws s3 cp index.html              s3://cocreateidea.com/index.html              --region ap-south-1 --content-type "text/html"               --cache-control "public, max-age=300"
aws s3 cp css/tokens.css          s3://cocreateidea.com/css/tokens.css          --region ap-south-1 --content-type "text/css"                --cache-control "public, max-age=300"
aws s3 cp css/base.css            s3://cocreateidea.com/css/base.css            --region ap-south-1 --content-type "text/css"                --cache-control "public, max-age=300"
aws s3 cp css/pages/home.css      s3://cocreateidea.com/css/pages/home.css      --region ap-south-1 --content-type "text/css"                --cache-control "public, max-age=300"
aws s3 cp css/components/         s3://cocreateidea.com/css/components/         --region ap-south-1 --recursive --content-type "text/css"    --cache-control "public, max-age=300"
aws s3 cp css/themes/             s3://cocreateidea.com/css/themes/             --region ap-south-1 --recursive --content-type "text/css"    --cache-control "public, max-age=300"
aws s3 cp js/projects-data.js     s3://cocreateidea.com/js/projects-data.js     --region ap-south-1 --content-type "application/javascript"  --cache-control "public, max-age=300"
aws s3 cp js/projects-render.js   s3://cocreateidea.com/js/projects-render.js   --region ap-south-1 --content-type "application/javascript"  --cache-control "public, max-age=300"

# re-upload pages that consume the rewritten card/modal components
aws s3 cp projects.html           s3://cocreateidea.com/projects.html           --region ap-south-1 --content-type "text/html"
aws s3 cp projects-category.html  s3://cocreateidea.com/projects-category.html  --region ap-south-1 --content-type "text/html"
```

CloudFront invalidation (PowerShell — bash mangles leading slashes):
```powershell
aws cloudfront create-invalidation --distribution-id E1M06FXCRKZHF3 `
  --paths "/index.html" "/css/tokens.css" "/css/base.css" "/css/pages/*" "/css/components/*" "/css/themes/*" "/js/projects-data.js" "/js/projects-render.js" "/projects.html" "/projects-category.html"
```

Verify on `www.cocreateidea.com` (not apex) per the site-deploy-topology memory. Rollback = `git revert` the swap commit + same upload + invalidate.

---

## 10. Open questions surfaced for CEO

- **Status per project (3-valued field).** Default fill rule documented in §6.1 covers all 29 records with no fabrication. CEO should manually upgrade any project from `"building"` to `"launching"` when it nears deploy.
- **Chat-widget integration.** Implementation will audit `chat-widget.js` to determine whether `.cc-fab` binds to the widget's open API or replaces its trigger button. CEO sign-off not required; will be reported pre-deploy.
- **Gradient phrase policy.** The Vedics brand rule is "one gradient phrase per page." The current spec proposes three (hero "CoCreate", outcomes "ship", final CTA "CoCreate"). **CEO to choose**: strict one (drop the other two; pick which), or per-major-section. Default if not specified: keep the three, since each lives in a distinct narrative beat.

---

## 11. Scope boundaries

### In scope (Wave A)
- All file changes listed in §3.
- 8 theme files aligned per §7.
- Index.html rewrite per §2.
- One field added + one render line added per §6.
- Verification harness extensions per §8.
- Deploy + invalidation per §9.

### Explicitly out of scope (queued for Waves B and C)
- `who-we-are.html`, `what-we-do.html`, `product.html`, `success-stories.html`, `contact.html`, `leadership.html`, `blogs.html`, `insights.html`, `apply.html`, `schedule.html`.
- `admin.html`, `user.html`, `awscost.html`, `costs.html`, `chat.html`, `ai.html`, `premium-demo.html`, `event.html`, `careers.html`, `partners.html`, `investors.html`, `culture.html`, `platforms.html`, `privacy.html`, `404.html`.
- Porting the Vedics `ui_kits/*.jsx` page templates to HTML — those become source references for Wave B but aren't ported in this wave.
- Chat backend changes.
- A net-new `zoom` theme rebuild (we keep the existing as-is and just align tokens).

---

## 12. Risks & mitigations

| Risk | Mitigation |
|---|---|
| `projects.html` regression from rewritten `card.css` / `modal.css` | Verification gate #4 — automated assertion of card count + modal open + image load, run pre-deploy. Class names preserved end-to-end. |
| Light-theme text illegibility on the fixed cinematic photo | Per-theme override on `body.cc-bg-fixed::after` (§5.1). Verified in gate #5. |
| Status-tabs filter interfering with the modal open delegation | Tabs only toggle `is-hidden` on `.proj-card`; modal listener lives at document level on `[data-slug]`. Independently tested in gate #3. |
| Chat FAB clashing with the existing chat-widget's own button | Audit `chat-widget.js` during implementation; if it emits its own button, hide via CSS and rebind. Reported pre-deploy. |
| Space Grotesk failing to load → fallback to Outfit makes gradient stats look slightly off | Stack `--font-stat: 'Space Grotesk', 'Outfit', system-ui, sans-serif` — degrades gracefully. |
| Token alias-shim missing a variable used by some component | Token-shim assertion (gate #1) enumerates every token name in current component CSS at write time. |
| Body color regression on light themes (the 2026-05-28 black-hero bug recurring) | New base.css explicitly sets `body { color: var(--text-primary) }` (§3.1). Verification gate #2 + theme parity gate #5 both cover it. |
| Old `index-prev.html` rollback artifact polluting working tree | Removed during implementation. Roll back via git only. |

---

## 13. Source materials referenced

- `C:\Projects\ai-product-studio\design\Vedics Design System_FInal\README.md`
- `C:\Projects\ai-product-studio\design\Vedics Design System_FInal\SKILL.md`
- `C:\Projects\ai-product-studio\design\Vedics Design System_FInal\colors_and_type.css`
- `C:\Projects\ai-product-studio\design\Vedics Design System_FInal\themes\*.css`
- `C:\Projects\ai-product-studio\design\Vedics Design System_FInal\preview\*.html` (23 specimen cards)
- `C:\Projects\ai-product-studio\design\Vedics Design System_FInal\ui_kits\cocreate-landing\styles.css`
- `C:\Projects\ai-product-studio\design\Vedics Design System_FInal\ui_kits\cocreate-site\` (10 page templates, used as Wave B references)
- `C:\Projects\ai-product-studio\design\Vedics Design System_FInal\screenshots\01-redesign.png`, `02-redesign.png`, `01-pages.png`, `03-pages.png` (visual reference)

Prior spec: `docs/superpowers/specs/2026-05-28-cocreateidea-design-system-and-homepage-design.md` (Wave 0 — the design system this spec replaces).
