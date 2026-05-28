# cocreateidea.com — Design System + Homepage Redesign (Sub-project 1)

**Status:** Design approved (sections 1–4). Ready to plan.
**Date:** 2026-05-28
**Owner:** CoCreate Idea (CEO)
**Repo:** `option-a-threejs-gsap-tailwind/site/`
**Deployed at:** `https://www.cocreateidea.com/`

---

## 1. Background and goals

The site has strong raw materials — distinctive Ember palette, cinematic figure-on-disc asset, Outfit + DM Sans typography, 8 CSS-var themes, 28 substantive pages, and a just-shipped Projects page (cards + screenshots + detail modal). It also has clear weaknesses revealed by the 2026-05-28 audit:

1. Heroes don't earn their height — `index.html` and `who-we-are.html` let the cinematic dominate ~2,000 px with nothing layered on top.
2. No social proof above the fold — no client logos, no founder metrics, no testimonials.
3. Heroes look identical across pages — same dark cinematic, no per-page narrative.
4. No unified design system file — tokens (spacing, type, radius, shadow, motion) live implicitly inside per-page CSS.
5. No interactive product showcase on home — the Projects page lives one click away.
6. Content density is uneven (index hero = 1 line + 2 paragraphs; investors.html = 67 KB).
7. No clear primary CTA on most pages — the cinematic is louder than the action.

**Sub-project 1 goal:** build a unified design system AND apply it to a fully-redesigned `index.html` as the reference template. Sub-projects 2 and 3 roll the system to the next tier of pages and the long tail respectively.

**Aesthetic direction:** Stripe-style polished density — keep Ember + cinematic identity, layer dense content (clear value props, mini product visuals, gradients, trust signals, tasteful micro-interactions) on top.

**Primary audience:** Founders / aspiring entrepreneurs. Hero leads with "2 weeks to launch / $0 upfront / 29 products shipped". Primary CTA → `calendly.com/cocreateceo/30min`.

**Cinematic role:** Moved out of the hero. Gets its own dedicated "Our Approach" section further down where it earns its dramatic scale.

---

## 2. Homepage section stack

A 10-block scroll, ordered for founder conversion (value → proof → mechanism → drama → action).

1. **Hero (content-led, no cinematic).** Left: eyebrow "AI-Powered Product Studio", H1 "Imagine. CoCreate. Done!", sub-tagline "Your AI Partner. Launch your business in 2 weeks.", dual CTA — primary `Let's CoCreate` → `calendly.com/cocreateceo/30min`, secondary `See what we've built` → `/projects.html`. Right: animated mosaic of 4–6 portfolio screenshots reusing the WebPs from `assets/projects/`. Bottom: a compact trust strip — `⚡ 2 weeks to launch · $0 upfront · {LIVE_COUNT} products shipped` where `LIVE_COUNT` = `PROJECTS_DATA` projects with `isLive=true` (currently 17).
2. **Portfolio wordmark marquee.** Horizontal scroll of shipped-product wordmarks (TradePredict, MediPulse, HomeMatch, CareerX, ResumeX, LearnAI, AyurVeda Living, Vedic Astro, TradeWell, SpeakWell, Trustwise, etc.). Pulled from `PROJECTS_DATA.projects[].name` filtered by `isLive`.
3. **Outcomes — three big stats.** `2 Weeks · to MVP` · `$0 Upfront · shared-risk co-founder model` · `{LIVE_COUNT} Products · shipped, live in market` (`isLive=true` only). Oversized Outfit numerals, ember-amber tone.
4. **Product showcase.** 6 featured cards from `PROJECTS_DATA` via the existing `productCardHTML` helper. Each opens the detail modal already shipped. Closes with `See all {TOTAL_COUNT} products →` → `/projects.html` (`TOTAL_COUNT` = all projects, currently 29).
5. **How it works (3 steps).** 1 *Share your idea*, 2 *CoCreate in 2 weeks*, 3 *Launch & grow*. Icon + one-line each, subtle progress line connecting them.
6. **Our Approach (cinematic earns its scale).** Full-bleed figure-on-disc image, GSAP parallax + scroll-pinned headline "Where ideas meet AI" + 2-sentence philosophy + CTA `Our way →` → `/who-we-are.html`. Only place the cinematic dominates.
7. **Founder voice (testimonial).** One pull-quote sourced from existing site content (`leadership.html` CEO statement if no testimonial exists yet), photo + name + role.
8. **The co-founder model.** Visual breakdown of `$0 upfront · shared upside · 2-week launch · ongoing partnership`. Differentiates from a typical dev shop.
9. **FAQ (5–7 Q&A).** Lightweight accordion. The only block with net-new copy — surfaced for CEO sign-off before deploy.
10. **Final CTA + footer.** Full-width "Ready to CoCreate?" band with calendly CTA. Reuses existing footer.

---

## 3. Design system architecture

### 3.1 File structure (additive, nothing breaks day-one)

```
css/
  tokens.css          ← NEW · non-color design tokens
  base.css            ← NEW · reset, html/body, headings, focus, scroll
  themes/             ← existing · color vars only (ember default + 7 others)
  components/         ← NEW · one primitive per file, page-agnostic
    nav.css
    footer.css
    section.css       (container, eyebrow, headline, lede, vertical rhythm)
    button.css        (.btn primary/ghost · sm/md/lg)
    badge.css         (live, soon, beta)
    card.css          (extracted from projects.css)
    modal.css         (extracted from projects.css)
    stat.css          (big numerals + label + caption)
    marquee.css       (logo strip)
    steps.css         (1·2·3 process)
    quote.css         (testimonial)
    accordion.css     (FAQ)
    cta.css           (final CTA band)
  pages/
    home.css          ← NEW · homepage-unique layout only
    projects.css      ← existing, slimmed (card/modal extracted)
    ...               ← long tail unchanged; sub-projects 2/3
  responsive.css      ← keep · global breakpoint helpers
```

### 3.2 Tokens (`tokens.css`)

- **Spacing (8 px scale):** `--sp-1: 4px … --sp-16: 96px`; section-level `--sec-py: clamp(64px, 8vw, 120px)`; container `--container-max: 1200px`, `--container-px: clamp(20px, 4vw, 40px)`.
- **Type scale (fluid):**
  - `--fs-display-xl` (hero h1): `clamp(2.5rem, 6vw, 5rem)` · Outfit 700 · `--ls: -0.03em`
  - `--fs-display-l` (section h2): `clamp(2rem, 4.5vw, 3.5rem)` · Outfit 700 · `--ls: -0.02em`
  - `--fs-display-m`: `1.75rem` · Outfit 600
  - `--fs-title-l` / `--fs-title-m`: `1.35rem` / `1.15rem` · Outfit 600
  - `--fs-body-l` / `--fs-body-m` / `--fs-body-s`: `1.125rem` / `1rem` / `0.875rem` · DM Sans · `line-height: 1.55`
  - `--fs-caption`: `0.78rem` · DM Sans 600 · `letter-spacing: 0.08em` · uppercase (eyebrow)
- **Radius:** `--r-sm 6px`, `--r-md 10px`, `--r-lg 16px`, `--r-xl 24px`, `--r-full 999px`
- **Shadow:** `--sh-sm` (cards rest), `--sh-md` (hover), `--sh-lg` (modal), `--sh-glow` (ember amber halo), `--sh-focus`
- **Z-index:** `--z-nav: 100`, `--z-modal-backdrop: 1000`, `--z-modal: 1001`, `--z-toast: 1100`
- **Motion:** `--dur-fast: 160ms`, `--dur-base: 280ms`, `--dur-slow: 480ms`; easings `--ease-out`, `--ease-in-out`, `--ease-spring` (`cubic-bezier(0.16, 1, 0.3, 1)`)
- **A11y:** `@media (prefers-reduced-motion: reduce)` zeroes durations and disables marquee animation.

### 3.3 Component primitives needed for the homepage

Each is a small file, one purpose, BEM-ish naming, consumes only tokens (no magic numbers).

| Component | Used in homepage block |
|---|---|
| `.section` + `.container` + `.eyebrow` + `.lede` | every block |
| `.btn` (primary, ghost, sm/md/lg) | hero, final CTA |
| `.trust-strip` (pill row) | hero footer |
| `.marquee` | block 2 |
| `.stat` (numeral + label + caption) | block 3, block 8 |
| `.card` + `.proj-modal` (extracted) | block 4 |
| `.steps` (numbered horizontal w/ progress line) | block 5 |
| `.cinematic` (full-bleed bg + scroll-pinned overlay) | block 6 |
| `.quote` | block 7 |
| `.accordion` | block 9 |
| `.cta-band` | block 10 |

### 3.4 Motion philosophy (Stripe-polished, not Apple-spatial)

- Entrance: 280 ms fade + 12 px translateY, IntersectionObserver-triggered.
- Hover on cards: -2 px lift + amber-glow shadow.
- Marquee: continuous 40 s linear scroll, pause on hover.
- Cinematic section: GSAP scroll-pin headline over parallax image (re-use existing GSAP — no new libraries).
- All motion ≤ 480 ms; `prefers-reduced-motion` honoured.

### 3.5 Rules the system enforces

1. Sizes, colors, radii, shadows: **tokens only** — magic numbers in component CSS are a review red flag.
2. Headings always use type-scale tokens — no per-block font-size overrides.
3. Themes only ever touch color tokens — no theme file changes spacing/type/motion.
4. Components are layout-agnostic — they don't know what section they're in.
5. `home.css` ≤ ~250 LOC — most layout is composed from primitives.

---

## 4. Content strategy

### 4.1 Copy sources (no guessing)

| Block | Source | Status |
|---|---|---|
| Hero H1 | Brand memory verbatim ("Imagine. CoCreate. Done!") | Sourced |
| Sub-tagline | Brand memory verbatim ("Your AI Partner. Launch your business in 2 weeks.") | Sourced |
| Eyebrow ("AI-Powered Product Studio") | Brand memory verbatim | Sourced |
| CTA labels | Brand memory ("Let's CoCreate", "See what we've built") | Sourced |
| Trust strip & outcome stats | Brand memory + computed `PROJECTS_DATA` count | Sourced |
| Portfolio wordmarks (marquee) | `PROJECTS_DATA.projects[].name`, `isLive` filter | Sourced |
| Featured cards block | Existing `productCardHTML` + `flatten()` | Sourced |
| How-it-works (3 steps) | Condensed from `what-we-do.html` existing copy | Sourced |
| Cinematic section copy | Adapted from `who-we-are.html` mission block | Sourced |
| Founder quote | Pulled from `leadership.html` CEO content | Sourced |
| Co-founder model section | Adapted from `who-we-are.html` "$0 Upfront" mission block | Sourced |
| **FAQ (5–7 Q&A)** | **Written fresh** | Net-new — CEO sign-off before deploy |

Rule: no copy without a source. Anything new lives in FAQ only and is surfaced for sign-off.

### 4.2 FAQ drafts (subject to CEO sign-off)

Anchored on real founder objections: speed ("How fast can we ship?"), economics ("What's the catch with $0 upfront?"), ownership ("Do I own the code?"), stack ("What technologies do you use?"), post-launch ("What happens after launch?"), eligibility ("Does my idea qualify?"), and partnership ("How does the co-founder model work in practice?").

---

## 5. Verification gates

Each must pass before deploy:

1. **Theme parity** — switching `data-theme` to each of the 8 themes still renders the new homepage correctly (no hard-coded ember colors in `home.css`).
2. **Existing pages unbroken** — `projects.html`, `who-we-are.html`, `event.html` still render — `tokens.css` and `base.css` are additive only.
3. **Headless render check** — Chrome headless screenshot at 360 / 768 / 1280 / 1600 widths; visual review.
4. **Cards + modal regression** — re-run the live check: 17/17 images, modal opens, no JS errors.
5. **Lighthouse** — Performance ≥ 90, Accessibility ≥ 95, Best Practices ≥ 95 on desktop, then mobile.
6. **`prefers-reduced-motion`** — manual toggle, all motion neutralized.
7. **No console errors or network 404s** on the live page after deploy.

---

## 6. Deploy plan (re-uses proven pipeline)

1. Commit code changes (new CSS, updated `index.html`, slimmed `projects.css`) on `main`.
2. `aws s3 cp` the touched files (targeted, not sync) to `s3://cocreateidea.com/` (ap-south-1) with correct content types.
3. `aws cloudfront create-invalidation --distribution-id E1M06FXCRKZHF3 --paths "/index.html" "/css/tokens.css" "/css/base.css" "/css/components/*" "/css/pages/home.css" "/css/projects.css"` via PowerShell.
4. Verify on `www.cocreateidea.com` (not apex) per the site-deploy-topology memory.
5. Rollback = `git revert` + same upload + invalidate.

---

## 7. Scope boundaries

### In scope (sub-project 1)
- `tokens.css`, `base.css`, `components/*` (12 primitives in §3.3)
- New `pages/home.css`
- Rewritten `index.html` (10 blocks per §2)
- Card/modal extraction out of `projects.css` into `components/card.css` and `components/modal.css`. `projects.css` keeps only page-specific bits.

### Out of scope (sub-project 2 picks up)
- Migrating `who-we-are.html`, `what-we-do.html`, `product.html`, `success-stories.html`, `contact.html`, `leadership.html`
- Migrating `awscost.css`, `costs.css`, `scheduler.css`, `chat-widget.css`
- Long-tail pages (`careers.html`, `partners.html`, `investors.html`, `blogs.html`, `insights.html`, `apply.html`, `event.html`, `culture.html`, `platforms.html`, `premium-demo.html`, `admin.html`, `user.html`)
- New themes
- CMS / blog-from-markdown plumbing
- A/B testing harness

---

## 8. Risks & mitigations

- **Hero portfolio mosaic weight.** WebPs are 9–52 KB; preload only the first two; rest lazy-load.
- **Cinematic scroll-pin.** GSAP is already loaded site-wide; reuse `ScrollTrigger`; no new libraries.
- **Theme regression in other pages.** Token + base CSS are additive only; verification gate #2 catches breakage on existing pages.
- **Copy churn.** Only FAQ is net-new; everything else is sourced and traceable.
- **CSS specificity collisions** with `projects.css` after extraction. Mitigation: components/*.css load before page CSS; per-page CSS keeps the same selector specificity as today.

---

## 9. Open questions surfaced for CEO

- **FAQ block — 5–7 net-new Q&A.** Final wording on each before deploy.
- **Founder quote.** If no real client testimonial exists, the design falls back to a CEO statement from `leadership.html`. Confirm acceptable, or supply a real testimonial.
- **Marquee wordmark style.** Plain text in Outfit, or each product as a small color-tinted pill? (Default: plain text; pills are an easy upgrade.)

These are deferred to the implementation-plan review or the first preview build.
