# CoCreate Idea — Design System + Homepage Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a unified design-token + component system for `cocreateidea.com` and apply it to a fully-redesigned, founder-led `index.html` (10-block scroll) without breaking any existing pages.

**Architecture:** Additive CSS layer (`css/tokens.css`, `css/base.css`, `css/components/*.css`, `css/pages/home.css`) loaded alongside existing per-page CSS. The 8 existing themes are untouched (color-vars only). Card + modal primitives are extracted out of `css/projects.css` into `components/`. The homepage reuses the existing `productCardHTML` render helper for block 4. Cinematic block 6 reuses the GSAP ScrollTrigger already loaded site-wide.

**Tech Stack:** Vanilla HTML + CSS (CSS variables, fluid clamp typography, IntersectionObserver) + a tiny vanilla-JS layer for marquee/accordion/parallax (GSAP already in page). Verification via headless Chrome (Puppeteer-core, no Chromium download — uses installed Chrome). Image processing via `sharp` if any resizing is needed. Deploy: `aws s3 cp` to `s3://cocreateidea.com` (ap-south-1) + CloudFront invalidation on `E1M06FXCRKZHF3`.

**Spec:** `docs/superpowers/specs/2026-05-28-cocreateidea-design-system-and-homepage-design.md`

---

## Conventions used throughout this plan

- **All paths absolute or repo-relative.** Site dir: `option-a-threejs-gsap-tailwind/site/`.
- **No magic numbers in component CSS** — only `var(--token-name)` from `tokens.css`.
- **Component CSS files** use BEM-ish class naming (`.block`, `.block__el`, `.block--mod`).
- **Verification harness** lives at `C:\Projects\_build\` (outside the repo, never deployed). Set up in Task 0, reused by every later task. **Never** create scratch dirs under `option-a-threejs-gsap-tailwind/site/`.
- **Commit cadence:** one commit at the end of each task (or each step that says "Commit"). Branch is `main`. Push after each commit.
- **Deploy** is in Task 14 only. Earlier tasks land code on `main` but do not invalidate CloudFront.
- **For every Chrome headless command:** use installed Chrome at `C:\Program Files\Google\Chrome\Application\chrome.exe`. Pass `--no-sandbox --disable-gpu --hide-scrollbars`.
- **For every `aws cloudfront create-invalidation` call:** run via PowerShell, not bash — bash mangles the leading `/` in paths.

---

## Task 0: Verification harness setup (one-time)

**Files:**
- Create: `C:\Projects\_build\package.json`
- Create: `C:\Projects\_build\check.js`
- Create: `C:\Projects\_build\screenshot.js`
- Create: `C:\Projects\_build\.gitignore` (just in case): `*` (this dir is outside the repo anyway)

This harness is reused by every later task. Two scripts:
- `check.js` — loads a URL (file:// or https://) in headless Chrome, runs page-side assertions passed via CLI, prints JSON, returns nonzero on failure.
- `screenshot.js` — captures full-page PNGs at multiple widths for visual review.

- [ ] **Step 1: Create the harness directory and install deps**

Run (PowerShell):
```powershell
New-Item -ItemType Directory -Force -Path "C:\Projects\_build" | Out-Null
Set-Location "C:\Projects\_build"
if (-not (Test-Path "package.json")) { npm init -y *> $null }
npm install puppeteer-core@23 sharp 2>&1 | Select-Object -Last 2
```

Expected: `found 0 vulnerabilities` (or similar success line).

- [ ] **Step 2: Create `screenshot.js`**

```js
// C:\Projects\_build\screenshot.js
// Usage: node screenshot.js <url> <outfile> [width=1280] [height=900] [waitMs=4000]
const puppeteer = require('puppeteer-core');
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
(async () => {
  const [url, out, w = '1280', h = '900', waitMs = '4000'] = process.argv.slice(2);
  if (!url || !out) { console.error('args: <url> <outfile> [w] [h] [waitMs]'); process.exit(2); }
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new',
    args: ['--no-sandbox', '--disable-gpu', '--hide-scrollbars'],
    defaultViewport: { width: +w, height: +h } });
  const page = await browser.newPage();
  const errs = [];
  page.on('pageerror', e => errs.push('PAGEERROR: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errs.push('CONSOLE: ' + m.text()); });
  await page.goto(url, { waitUntil: 'networkidle2', timeout: 45000 }).catch(() => {});
  await new Promise(r => setTimeout(r, +waitMs));
  await page.screenshot({ path: out, fullPage: true });
  console.log(JSON.stringify({ url, out, errors: errs }));
  await browser.close();
})().catch(e => { console.error(e); process.exit(1); });
```

- [ ] **Step 3: Create `check.js`**

```js
// C:\Projects\_build\check.js
// Usage: node check.js <url> <assertionFile.js>
// assertionFile must export `async function (page) -> { ok: boolean, details: any }`
const puppeteer = require('puppeteer-core');
const path = require('path');
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
(async () => {
  const [url, file] = process.argv.slice(2);
  if (!url || !file) { console.error('args: <url> <assertionFile.js>'); process.exit(2); }
  const assertion = require(path.resolve(file));
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new',
    args: ['--no-sandbox', '--disable-gpu', '--hide-scrollbars'],
    defaultViewport: { width: 1280, height: 900 } });
  const page = await browser.newPage();
  const errs = [];
  page.on('pageerror', e => errs.push('PAGEERROR: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errs.push('CONSOLE: ' + m.text()); });
  await page.goto(url, { waitUntil: 'networkidle2', timeout: 45000 }).catch(() => {});
  await new Promise(r => setTimeout(r, 2500));
  const result = await assertion(page);
  result.pageErrors = errs;
  console.log(JSON.stringify(result, null, 2));
  await browser.close();
  process.exit(result.ok && errs.length === 0 ? 0 : 1);
})().catch(e => { console.error(e); process.exit(1); });
```

- [ ] **Step 4: Smoke-test the harness against the deployed projects page**

Run (PowerShell):
```powershell
Set-Location "C:\Projects\_build"
node screenshot.js "https://www.cocreateidea.com/projects.html" "_smoke.png" 1280 1200
```

Expected: a JSON line printed with `"errors": []`, plus a `_smoke.png` file ~500 KB–2 MB. If errors print, fix tooling before proceeding.

- [ ] **Step 5: No commit** (harness is outside the repo and intentionally not tracked).

---

## Task 1: `tokens.css` foundation

**Files:**
- Create: `option-a-threejs-gsap-tailwind/site/css/tokens.css`
- Create (verification): `C:\Projects\_build\assert_tokens.js`

Non-color design tokens (spacing, type scale, radius, shadow, motion, container, z-index). Color tokens stay in themes.

- [ ] **Step 1: Write the failing assertion**

Create `C:\Projects\_build\assert_tokens.js`:
```js
// Asserts that the page exposes the design tokens we expect.
module.exports = async function (page) {
  const tokens = await page.evaluate(() => {
    const s = getComputedStyle(document.documentElement);
    const want = [
      '--sp-1','--sp-4','--sp-8','--sec-py','--container-max','--container-px',
      '--fs-display-xl','--fs-display-l','--fs-body-m','--fs-caption',
      '--r-md','--r-lg','--r-xl','--r-full',
      '--sh-sm','--sh-md','--sh-lg','--sh-glow',
      '--z-nav','--z-modal-backdrop','--z-modal',
      '--dur-fast','--dur-base','--dur-slow','--ease-spring'
    ];
    const out = {};
    want.forEach(k => out[k] = s.getPropertyValue(k).trim());
    return out;
  });
  const missing = Object.entries(tokens).filter(([_, v]) => !v).map(([k]) => k);
  return { ok: missing.length === 0, missing, sample: tokens };
};
```

- [ ] **Step 2: Run it against the existing live page — expect FAIL**

Run (PowerShell):
```powershell
node check.js "https://www.cocreateidea.com/projects.html" assert_tokens.js
```

Expected: nonzero exit, JSON shows `missing: ["--sp-1", "--sp-4", ...]` (because tokens.css doesn't exist yet).

- [ ] **Step 3: Create `css/tokens.css`**

```css
/* CoCreate design tokens — non-color foundation.
   Color tokens live in css/themes/<theme>.css (ember default).
   Additive: safe to load alongside any existing per-page CSS. */
:root {
  /* Spacing — 4px base, 8px scale */
  --sp-1:  4px;  --sp-2:  8px;  --sp-3: 12px; --sp-4: 16px;
  --sp-5: 20px;  --sp-6: 24px;  --sp-7: 32px; --sp-8: 40px;
  --sp-9: 48px;  --sp-10: 56px; --sp-11: 64px; --sp-12: 80px;
  --sp-13: 96px; --sp-14: 120px; --sp-15: 160px; --sp-16: 200px;

  /* Section + container */
  --sec-py: clamp(64px, 8vw, 120px);
  --container-max: 1200px;
  --container-px: clamp(20px, 4vw, 40px);

  /* Type scale (fluid, clamped) */
  --fs-display-xl: clamp(2.5rem, 6vw, 5rem);
  --fs-display-l:  clamp(2rem, 4.5vw, 3.5rem);
  --fs-display-m:  1.75rem;
  --fs-title-l:    1.35rem;
  --fs-title-m:    1.15rem;
  --fs-body-l:     1.125rem;
  --fs-body-m:     1rem;
  --fs-body-s:     0.875rem;
  --fs-caption:    0.78rem;
  --ls-display:    -0.03em;
  --ls-section:    -0.02em;
  --ls-caption:    0.08em;
  --lh-tight:      1.1;
  --lh-snug:       1.3;
  --lh-normal:     1.55;
  --lh-relaxed:    1.7;

  /* Font families (loaded via Google Fonts links in <head>) */
  --ff-display: 'Outfit', system-ui, -apple-system, sans-serif;
  --ff-body:    'DM Sans', system-ui, -apple-system, sans-serif;
  --ff-mono:    ui-monospace, 'JetBrains Mono', Menlo, monospace;

  /* Radius */
  --r-sm:   6px;
  --r-md:  10px;
  --r-lg:  16px;
  --r-xl:  24px;
  --r-2xl: 32px;
  --r-full: 999px;

  /* Shadows (kept theme-agnostic; glow color picks up --accent if defined) */
  --sh-sm: 0 2px 6px rgba(0, 0, 0, 0.18);
  --sh-md: 0 6px 18px rgba(0, 0, 0, 0.24);
  --sh-lg: 0 30px 80px rgba(0, 0, 0, 0.55);
  --sh-glow: 0 12px 36px var(--glow-color, rgba(255, 195, 106, 0.28));
  --sh-focus: 0 0 0 3px rgba(255, 195, 106, 0.45);

  /* Z-index */
  --z-base: 1;
  --z-nav: 100;
  --z-modal-backdrop: 1000;
  --z-modal: 1001;
  --z-toast: 1100;

  /* Motion */
  --dur-fast: 160ms;
  --dur-base: 280ms;
  --dur-slow: 480ms;
  --ease-out:    cubic-bezier(0.2, 0.7, 0.1, 1);
  --ease-in-out: cubic-bezier(0.4, 0, 0.2, 1);
  --ease-spring: cubic-bezier(0.16, 1, 0.3, 1);
}

@media (prefers-reduced-motion: reduce) {
  :root {
    --dur-fast: 0ms;
    --dur-base: 0ms;
    --dur-slow: 0ms;
  }
}
```

- [ ] **Step 4: Wire `tokens.css` into `projects.html` (and `projects-category.html`) as a smoke test**

Open `option-a-threejs-gsap-tailwind/site/projects.html`. Locate the existing `<link rel="stylesheet" href="css/projects.css">` block. Add **before** it:
```html
    <link rel="stylesheet" href="css/tokens.css">
```
Repeat in `projects-category.html`.

- [ ] **Step 5: Run the assertion against the local file — expect PASS**

Run (PowerShell):
```powershell
node check.js "file:///C:/Projects/ai-product-studio/option-a-threejs-gsap-tailwind/site/projects.html" assert_tokens.js
```

Expected: exit 0, JSON shows `"ok": true`, `missing: []`, and `sample` populated with real values (e.g. `"--sp-4": "16px"`).

- [ ] **Step 6: Render-parity smoke — projects page still works**

```powershell
node screenshot.js "file:///C:/Projects/ai-product-studio/option-a-threejs-gsap-tailwind/site/projects.html" "_proj_after_tokens.png" 1280 2000
```

Open the PNG and confirm the projects page looks identical to production (cards, modal trigger, badges all unaffected). The harness should print `"errors": []`.

- [ ] **Step 7: Commit**

```bash
cd /c/Projects/ai-product-studio
git add option-a-threejs-gsap-tailwind/site/css/tokens.css \
        option-a-threejs-gsap-tailwind/site/projects.html \
        option-a-threejs-gsap-tailwind/site/projects-category.html
git commit -m "feat(design-system): add tokens.css (spacing, type, radius, shadow, motion)"
git push
```

---

## Task 2: `base.css` reset + base elements

**Files:**
- Create: `option-a-threejs-gsap-tailwind/site/css/base.css`

Modern reset, body defaults, heading defaults, link defaults, focus rings, scroll behaviour. Must be additive — overrides only the things the existing per-page CSS doesn't already control.

- [ ] **Step 1: Create `css/base.css`**

```css
/* CoCreate base styles — minimal reset + system defaults.
   Loaded AFTER tokens.css. Per-page CSS still wins on specificity. */
*, *::before, *::after { box-sizing: border-box; }
* { margin: 0; }
html { -webkit-text-size-adjust: 100%; scroll-behavior: smooth; }
body {
  font-family: var(--ff-body);
  font-size: var(--fs-body-m);
  line-height: var(--lh-normal);
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
  text-rendering: optimizeLegibility;
}
img, picture, video, canvas, svg { display: block; max-width: 100%; }
input, button, textarea, select { font: inherit; color: inherit; }
button { background: none; border: 0; cursor: pointer; }
a { color: inherit; text-decoration: none; }
a:focus-visible, button:focus-visible, [tabindex]:focus-visible {
  outline: none;
  box-shadow: var(--sh-focus);
  border-radius: var(--r-sm);
}
h1, h2, h3, h4, h5, h6 {
  font-family: var(--ff-display);
  font-weight: 700;
  line-height: var(--lh-tight);
  letter-spacing: var(--ls-section);
}
p { line-height: var(--lh-normal); }
::selection { background: var(--accent, #ffc36a); color: #1a0a00; }
```

- [ ] **Step 2: Add `<link>` for `base.css` after `tokens.css` in `projects.html` and `projects-category.html`**

In each file, the link order must be:
```html
    <link rel="stylesheet" href="css/tokens.css">
    <link rel="stylesheet" href="css/base.css">
    <link rel="stylesheet" href="css/projects.css">
```

- [ ] **Step 3: Render-parity check — projects page still pixel-equivalent**

```powershell
node screenshot.js "file:///C:/Projects/ai-product-studio/option-a-threejs-gsap-tailwind/site/projects.html" "_proj_after_base.png" 1280 2000
```

Open `_proj_after_base.png`. Confirm visually that the projects page is still correct (cards, header, modal trigger area). If anything regressed, the reset is too aggressive — narrow it.

- [ ] **Step 4: Commit**

```bash
git add option-a-threejs-gsap-tailwind/site/css/base.css \
        option-a-threejs-gsap-tailwind/site/projects.html \
        option-a-threejs-gsap-tailwind/site/projects-category.html
git commit -m "feat(design-system): add base.css (reset, body, headings, focus)"
git push
```

---

## Task 3: Extract `card` and `modal` primitives from `projects.css`

**Files:**
- Create: `option-a-threejs-gsap-tailwind/site/css/components/card.css`
- Create: `option-a-threejs-gsap-tailwind/site/css/components/modal.css`
- Modify: `option-a-threejs-gsap-tailwind/site/css/projects.css` (slim — keep page-specific only)
- Modify: `option-a-threejs-gsap-tailwind/site/projects.html`
- Modify: `option-a-threejs-gsap-tailwind/site/projects-category.html`

Rationale: the homepage product showcase (block 4) needs card + modal styles without depending on `projects.css`.

- [ ] **Step 1: Read current `projects.css` to know what to extract**

Run:
```bash
cat /c/Projects/ai-product-studio/option-a-threejs-gsap-tailwind/site/css/projects.css
```

Note three rule groups:
- **Card primitives** — `.proj-grid`, `.proj-card`, `.proj-tile`, `.tile-icon`, `.tile-initial`, `.tile-shot`, `.tile-shot--photo`, `.proj-tile-hint`, `.proj-badge`, `.proj-body`, `.proj-cat-tag`, `.proj-visit`, `.proj-soon`. Move to `components/card.css`.
- **Modal primitives** — `.proj-modal*`. Move to `components/modal.css`.
- **Page-specific** — `.proj-toolbar`, `.proj-search`, `.filter-chips`, `.filter-chip`, `.proj-empty`. Keep in `projects.css`.

- [ ] **Step 2: Create `css/components/card.css` by moving the card rules verbatim from `projects.css`**

Copy all `.proj-grid`, `.proj-card`, `.proj-tile`, `.tile-*`, `.proj-badge`, `.proj-body`, `.proj-cat-tag`, `.proj-visit`, `.proj-soon`, and the `@keyframes tile-shot-in` rule into the new file. Do not change values.

Sample header for the file:
```css
/* CoCreate · card component
   Used by projects.html, projects-category.html, and the new home.html
   product-showcase block. Variants: default, .proj-card--featured. */
```

- [ ] **Step 3: Create `css/components/modal.css` by moving the modal rules verbatim**

Copy all `.proj-modal`, `.proj-modal__backdrop`, `.proj-modal__panel`, `.proj-modal__close`, `.proj-modal__media`, `.proj-modal__body`, `.proj-modal__overview`, `.proj-modal__highlights`, `.proj-modal__actions`, plus the `@keyframes pm-fade`, `@keyframes pm-rise`, and the `@media (max-width: 520px)` overrides for the modal. Do not change values.

- [ ] **Step 4: Slim `css/projects.css` — keep only page-specific rules**

After the move, `projects.css` should retain only:
```css
/* CoCreate Projects page — page-specific layout
   (search/filter toolbar, empty state). Card/modal primitives live in
   css/components/card.css and css/components/modal.css. */
.proj-toolbar { /* …unchanged… */ }
.proj-search  { /* …unchanged… */ }
.proj-search:focus-within { /* …unchanged… */ }
.proj-search svg { /* …unchanged… */ }
.proj-search input { /* …unchanged… */ }
.proj-search input::placeholder { /* …unchanged… */ }
.filter-chips { /* …unchanged… */ }
.filter-chip  { /* …unchanged… */ }
.filter-chip:hover { /* …unchanged… */ }
.filter-chip.active { /* …unchanged… */ }
.proj-empty { /* …unchanged… */ }
```

- [ ] **Step 5: Update `projects.html` to load components in the right order**

The `<head>` link order must be:
```html
    <link rel="stylesheet" href="css/tokens.css">
    <link rel="stylesheet" href="css/base.css">
    <link rel="stylesheet" href="css/components/card.css">
    <link rel="stylesheet" href="css/components/modal.css">
    <link rel="stylesheet" href="css/projects.css">
```

Repeat in `projects-category.html`.

- [ ] **Step 6: Re-run the live-equivalent regression check**

Create `C:\Projects\_build\assert_projects_cards.js`:
```js
// Confirms 6 featured cards render with images and the modal opens on click.
module.exports = async function (page) {
  await new Promise(r => setTimeout(r, 1500));
  const cards = await page.$$eval('.proj-card[data-slug]', els => els.length);
  await page.evaluate(() => {
    const c = document.querySelector('.proj-card[data-slug="career-builder"]')
           || document.querySelector('.proj-card[data-slug]');
    if (c) c.click();
  });
  await new Promise(r => setTimeout(r, 600));
  const modalOpen = await page.evaluate(() => !!document.querySelector('.proj-modal.is-open'));
  const titleText = await page.evaluate(() => {
    const t = document.querySelector('.proj-modal__panel #pm-title');
    return t ? t.textContent : null;
  });
  return { ok: cards >= 6 && modalOpen && !!titleText, cards, modalOpen, titleText };
};
```

Run:
```powershell
node check.js "file:///C:/Projects/ai-product-studio/option-a-threejs-gsap-tailwind/site/projects.html" assert_projects_cards.js
```

Expected: `{ ok: true, cards: 6, modalOpen: true, titleText: "Career Builder" }`, plus `pageErrors: []`.

- [ ] **Step 7: Visual screenshot — sanity**

```powershell
node screenshot.js "file:///C:/Projects/ai-product-studio/option-a-threejs-gsap-tailwind/site/projects.html" "_proj_after_extract.png" 1280 1800
```

Open the PNG. Cards must look identical to production.

- [ ] **Step 8: Commit**

```bash
git add option-a-threejs-gsap-tailwind/site/css/components/card.css \
        option-a-threejs-gsap-tailwind/site/css/components/modal.css \
        option-a-threejs-gsap-tailwind/site/css/projects.css \
        option-a-threejs-gsap-tailwind/site/projects.html \
        option-a-threejs-gsap-tailwind/site/projects-category.html
git commit -m "refactor(design-system): extract card + modal into components/"
git push
```

---

## Task 4: Styleguide scaffolding + `section` and `button` primitives

**Files:**
- Create: `option-a-threejs-gsap-tailwind/site/_styleguide.html` (prefixed `_` so any future `s3 sync` skips it; deleted in Task 14 before final deploy)
- Create: `option-a-threejs-gsap-tailwind/site/css/components/section.css`
- Create: `option-a-threejs-gsap-tailwind/site/css/components/button.css`

The styleguide is a single page that demos every primitive in isolation. It is the integration target for Tasks 4–8 (you can't render a CSS file in isolation, so we render it inside this page).

- [ ] **Step 1: Create `_styleguide.html`**

```html
<!DOCTYPE html>
<html lang="en" data-theme="ember">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>CoCreate · Styleguide</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Outfit:wght@400;500;600;700;800&family=DM+Sans:wght@400;500;600&display=swap" rel="stylesheet">
  <link rel="stylesheet" href="css/themes/ember.css">
  <link rel="stylesheet" href="css/tokens.css">
  <link rel="stylesheet" href="css/base.css">
  <link rel="stylesheet" href="css/components/section.css">
  <link rel="stylesheet" href="css/components/button.css">
  <style>
    body { background: var(--bg-primary); color: var(--text-primary); }
    .sg-grid { display: grid; gap: var(--sp-6); grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); }
    .sg-swatch { padding: var(--sp-6); border-radius: var(--r-lg); background: var(--bg-card); border: 1px solid var(--border-color); }
  </style>
</head>
<body>
  <section class="section">
    <div class="container">
      <p class="eyebrow">Section primitive</p>
      <h2 class="display-l">A confident section heading</h2>
      <p class="lede">Lede paragraph: this is the maximum width readable size at <code>--fs-body-l</code>. Used for hero sub-tagline and section ledes.</p>

      <p class="eyebrow" style="margin-top: var(--sp-9);">Buttons</p>
      <div style="display: flex; gap: var(--sp-3); flex-wrap: wrap; margin-top: var(--sp-3);">
        <a class="btn btn--primary" href="#">Let's CoCreate</a>
        <a class="btn btn--ghost"   href="#">See what we've built</a>
        <a class="btn btn--primary btn--lg" href="#">Primary · large</a>
        <a class="btn btn--ghost btn--sm"   href="#">Ghost · small</a>
      </div>
    </div>
  </section>
</body>
</html>
```

- [ ] **Step 2: Create `css/components/section.css`**

```css
/* CoCreate · section + container + eyebrow + display headings + lede.
   Vertical rhythm: --sec-py top/bottom. Horizontal: --container-px. */
.section {
  padding: var(--sec-py) 0;
  position: relative;
}
.container {
  width: 100%;
  max-width: var(--container-max);
  margin-inline: auto;
  padding-inline: var(--container-px);
}
.eyebrow {
  font-family: var(--ff-body);
  font-weight: 600;
  font-size: var(--fs-caption);
  letter-spacing: var(--ls-caption);
  text-transform: uppercase;
  color: var(--accent);
  margin-bottom: var(--sp-3);
}
.display-xl {
  font-family: var(--ff-display);
  font-weight: 700;
  font-size: var(--fs-display-xl);
  letter-spacing: var(--ls-display);
  line-height: var(--lh-tight);
}
.display-l {
  font-family: var(--ff-display);
  font-weight: 700;
  font-size: var(--fs-display-l);
  letter-spacing: var(--ls-section);
  line-height: var(--lh-tight);
}
.display-m {
  font-family: var(--ff-display);
  font-weight: 600;
  font-size: var(--fs-display-m);
  line-height: var(--lh-snug);
}
.lede {
  font-family: var(--ff-body);
  font-size: var(--fs-body-l);
  line-height: var(--lh-relaxed);
  color: var(--text-secondary);
  max-width: 56ch;
  margin-top: var(--sp-4);
}
```

- [ ] **Step 3: Create `css/components/button.css`**

```css
/* CoCreate · button component.
   Primary = gradient (logo gradient), Ghost = outlined.
   Sizes: --sm, default (md), --lg. */
.btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: var(--sp-2);
  padding: 0.75rem 1.35rem;
  border-radius: var(--r-md);
  font-family: var(--ff-display);
  font-size: var(--fs-body-m);
  font-weight: 600;
  letter-spacing: -0.01em;
  transition: transform var(--dur-fast) var(--ease-out),
              box-shadow var(--dur-base) var(--ease-out),
              background var(--dur-base) var(--ease-out);
  cursor: pointer;
  white-space: nowrap;
}
.btn--primary {
  color: #fff;
  background: linear-gradient(135deg, var(--accent), var(--secondary), var(--primary));
  box-shadow: var(--sh-sm);
}
.btn--primary:hover { transform: translateY(-1px); box-shadow: var(--sh-glow); }
.btn--ghost {
  color: var(--text-primary);
  background: transparent;
  border: 1px solid var(--border-color);
}
.btn--ghost:hover { border-color: var(--accent); color: var(--accent); }
.btn--sm { padding: 0.5rem 0.9rem; font-size: var(--fs-body-s); border-radius: var(--r-sm); }
.btn--lg { padding: 0.9rem 1.7rem; font-size: var(--fs-body-l); border-radius: var(--r-lg); }
```

- [ ] **Step 4: Visual check — open the styleguide**

```powershell
node screenshot.js "file:///C:/Projects/ai-product-studio/option-a-threejs-gsap-tailwind/site/_styleguide.html" "_sg_t4.png" 1280 1100
```

Open `_sg_t4.png`. Confirm:
- Eyebrow renders in amber, uppercase, small.
- Headline uses Outfit at the large display size.
- Lede is body font, secondary color, ≤ ~56 characters per line.
- All four buttons render correctly with primary gradient and ghost outline.

- [ ] **Step 5: Commit**

```bash
git add option-a-threejs-gsap-tailwind/site/_styleguide.html \
        option-a-threejs-gsap-tailwind/site/css/components/section.css \
        option-a-threejs-gsap-tailwind/site/css/components/button.css
git commit -m "feat(design-system): section, button primitives + styleguide page"
git push
```

---

## Task 5: `badge`, `trust-strip`, `stat`, `marquee` primitives

**Files:**
- Create: `option-a-threejs-gsap-tailwind/site/css/components/badge.css`
- Create: `option-a-threejs-gsap-tailwind/site/css/components/stat.css`
- Create: `option-a-threejs-gsap-tailwind/site/css/components/marquee.css`
- Modify: `option-a-threejs-gsap-tailwind/site/_styleguide.html`

`badge` here is a generic pill (eyebrow-on-card use). `.proj-badge` (status badge) stays in `card.css`. `trust-strip` is a small inline pill row used in the hero.

- [ ] **Step 1: Create `css/components/badge.css`**

```css
/* CoCreate · pill / trust-strip primitives.
   Generic chip used in heros and trust strips. Status badges (live/soon)
   live in components/card.css next to the card. */
.pill {
  display: inline-flex;
  align-items: center;
  gap: var(--sp-2);
  padding: 0.4rem 0.85rem;
  border-radius: var(--r-full);
  background: rgba(255, 255, 255, 0.06);
  border: 1px solid var(--border-color);
  color: var(--text-secondary);
  font-size: var(--fs-body-s);
  font-weight: 500;
}
.pill .dot {
  width: 6px; height: 6px; border-radius: 50%;
  background: var(--accent);
  box-shadow: 0 0 0 3px rgba(255, 195, 106, 0.18);
}
.trust-strip {
  display: inline-flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--sp-3);
  padding: var(--sp-3) var(--sp-4);
  border-radius: var(--r-full);
  background: var(--bg-card);
  border: 1px solid var(--border-color);
  color: var(--text-secondary);
  font-size: var(--fs-body-s);
}
.trust-strip__sep { opacity: 0.4; }
.trust-strip__item { display: inline-flex; align-items: center; gap: var(--sp-2); }
.trust-strip__item strong { color: var(--text-primary); font-weight: 600; }
```

- [ ] **Step 2: Create `css/components/stat.css`**

```css
/* CoCreate · big-number stat block.
   3-up grid container (.stats) + individual blocks (.stat). */
.stats {
  display: grid;
  gap: var(--sp-7);
  grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
  margin-top: var(--sp-9);
}
.stat {
  display: flex;
  flex-direction: column;
  gap: var(--sp-2);
  padding: var(--sp-6) var(--sp-5);
  border-radius: var(--r-lg);
  background: var(--bg-card);
  border: 1px solid var(--border-color);
}
.stat__num {
  font-family: var(--ff-display);
  font-weight: 800;
  font-size: clamp(2.2rem, 4.5vw, 3.5rem);
  letter-spacing: var(--ls-display);
  line-height: 1;
  background: linear-gradient(135deg, var(--accent), var(--secondary));
  -webkit-background-clip: text;
  background-clip: text;
  color: transparent;
}
.stat__label {
  font-family: var(--ff-display);
  font-weight: 600;
  font-size: var(--fs-title-m);
  color: var(--text-primary);
}
.stat__caption {
  font-size: var(--fs-body-s);
  color: var(--text-secondary);
}
```

- [ ] **Step 3: Create `css/components/marquee.css`**

```css
/* CoCreate · infinite horizontal marquee (wordmarks/logos).
   Uses two copies of the track to scroll seamlessly.
   Pauses on hover; honours prefers-reduced-motion. */
.marquee {
  position: relative;
  overflow: hidden;
  mask-image: linear-gradient(90deg, transparent, #000 8%, #000 92%, transparent);
}
.marquee__track {
  display: flex;
  gap: var(--sp-9);
  width: max-content;
  animation: marquee-scroll 40s linear infinite;
}
.marquee:hover .marquee__track { animation-play-state: paused; }
.marquee__item {
  font-family: var(--ff-display);
  font-weight: 700;
  font-size: var(--fs-display-m);
  color: var(--text-secondary);
  opacity: 0.7;
  letter-spacing: -0.01em;
  white-space: nowrap;
}
@keyframes marquee-scroll {
  from { transform: translateX(0); }
  to   { transform: translateX(-50%); }
}
@media (prefers-reduced-motion: reduce) {
  .marquee__track { animation: none; }
}
```

- [ ] **Step 4: Append demos to `_styleguide.html`**

Inside `<body>`, after the existing `<section>`, add:
```html
  <section class="section">
    <div class="container">
      <p class="eyebrow">Pill, trust-strip</p>
      <div style="display:flex; gap:var(--sp-3); flex-wrap:wrap; margin-bottom: var(--sp-6);">
        <span class="pill"><span class="dot"></span>Live</span>
        <span class="pill">AI-Powered Product Studio</span>
      </div>
      <div class="trust-strip">
        <span class="trust-strip__item">⚡ <strong>2 weeks</strong> to launch</span>
        <span class="trust-strip__sep">·</span>
        <span class="trust-strip__item"><strong>$0</strong> upfront</span>
        <span class="trust-strip__sep">·</span>
        <span class="trust-strip__item"><strong>17</strong> products shipped</span>
      </div>

      <p class="eyebrow" style="margin-top: var(--sp-10);">Stats</p>
      <div class="stats">
        <div class="stat">
          <div class="stat__num">2 Weeks</div>
          <div class="stat__label">to MVP</div>
          <div class="stat__caption">From idea to deployed product.</div>
        </div>
        <div class="stat">
          <div class="stat__num">$0</div>
          <div class="stat__label">upfront</div>
          <div class="stat__caption">Shared-risk co-founder model.</div>
        </div>
        <div class="stat">
          <div class="stat__num">17</div>
          <div class="stat__label">products live</div>
          <div class="stat__caption">Shipped and in market today.</div>
        </div>
      </div>

      <p class="eyebrow" style="margin-top: var(--sp-10);">Marquee</p>
      <div class="marquee">
        <div class="marquee__track">
          <span class="marquee__item">TradePredict</span>
          <span class="marquee__item">MediPulse</span>
          <span class="marquee__item">HomeMatch</span>
          <span class="marquee__item">CareerX</span>
          <span class="marquee__item">ResumeX</span>
          <span class="marquee__item">LearnAI</span>
          <span class="marquee__item">AyurVeda Living</span>
          <span class="marquee__item">TradeWell</span>
          <span class="marquee__item">SpeakWell</span>
          <span class="marquee__item">Trustwise</span>
          <!-- duplicate the items so the scroll loops seamlessly -->
          <span class="marquee__item">TradePredict</span>
          <span class="marquee__item">MediPulse</span>
          <span class="marquee__item">HomeMatch</span>
          <span class="marquee__item">CareerX</span>
          <span class="marquee__item">ResumeX</span>
          <span class="marquee__item">LearnAI</span>
          <span class="marquee__item">AyurVeda Living</span>
          <span class="marquee__item">TradeWell</span>
          <span class="marquee__item">SpeakWell</span>
          <span class="marquee__item">Trustwise</span>
        </div>
      </div>
    </div>
  </section>
```

Also add the new CSS links in `<head>` (after `button.css`):
```html
    <link rel="stylesheet" href="css/components/badge.css">
    <link rel="stylesheet" href="css/components/stat.css">
    <link rel="stylesheet" href="css/components/marquee.css">
```

- [ ] **Step 5: Visual check**

```powershell
node screenshot.js "file:///C:/Projects/ai-product-studio/option-a-threejs-gsap-tailwind/site/_styleguide.html" "_sg_t5.png" 1280 2400
```

Confirm: pills render, trust-strip is a rounded pill row, three stats show big gradient numerals + labels + captions, marquee scrolls horizontally (in a still screenshot you'll see one frame).

- [ ] **Step 6: Commit**

```bash
git add option-a-threejs-gsap-tailwind/site/css/components/badge.css \
        option-a-threejs-gsap-tailwind/site/css/components/stat.css \
        option-a-threejs-gsap-tailwind/site/css/components/marquee.css \
        option-a-threejs-gsap-tailwind/site/_styleguide.html
git commit -m "feat(design-system): badge, stat, marquee primitives"
git push
```

---

## Task 6: `steps`, `quote`, `accordion`, `cta-band` primitives

**Files:**
- Create: `option-a-threejs-gsap-tailwind/site/css/components/steps.css`
- Create: `option-a-threejs-gsap-tailwind/site/css/components/quote.css`
- Create: `option-a-threejs-gsap-tailwind/site/css/components/accordion.css`
- Create: `option-a-threejs-gsap-tailwind/site/css/components/cta.css`
- Modify: `option-a-threejs-gsap-tailwind/site/_styleguide.html`

- [ ] **Step 1: Create `css/components/steps.css`**

```css
/* CoCreate · 1·2·3 horizontal step process with connecting line. */
.steps {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: var(--sp-7);
  margin-top: var(--sp-9);
  position: relative;
}
.steps::before {
  content: '';
  position: absolute;
  top: 28px;
  left: 8%;
  right: 8%;
  height: 2px;
  background: linear-gradient(90deg, transparent, var(--accent), transparent);
  opacity: 0.35;
  z-index: 0;
}
.step {
  position: relative;
  z-index: 1;
  text-align: center;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--sp-3);
}
.step__num {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 56px;
  height: 56px;
  border-radius: 50%;
  font-family: var(--ff-display);
  font-weight: 700;
  font-size: var(--fs-title-l);
  color: #fff;
  background: var(--bg-card);
  border: 1px solid var(--border-color);
  box-shadow: var(--sh-sm);
}
.step--active .step__num {
  background: linear-gradient(135deg, var(--accent), var(--secondary), var(--primary));
  border-color: transparent;
  box-shadow: var(--sh-glow);
}
.step__title {
  font-family: var(--ff-display);
  font-weight: 600;
  font-size: var(--fs-title-m);
  color: var(--text-primary);
}
.step__body {
  font-size: var(--fs-body-s);
  color: var(--text-secondary);
  max-width: 28ch;
  line-height: var(--lh-relaxed);
}
@media (max-width: 640px) {
  .steps { grid-template-columns: 1fr; }
  .steps::before { display: none; }
}
```

- [ ] **Step 2: Create `css/components/quote.css`**

```css
/* CoCreate · pull-quote / testimonial block. */
.quote {
  display: grid;
  gap: var(--sp-6);
  grid-template-columns: auto 1fr;
  align-items: center;
  max-width: 880px;
  margin-inline: auto;
  padding: var(--sp-8) var(--sp-7);
  background: var(--bg-card);
  border: 1px solid var(--border-color);
  border-radius: var(--r-xl);
  position: relative;
}
.quote::before {
  content: '\201C';                     /* big curly open-quote */
  position: absolute;
  top: -28px;
  left: var(--sp-7);
  font-family: var(--ff-display);
  font-weight: 800;
  font-size: 5rem;
  color: var(--accent);
  line-height: 1;
}
.quote__avatar {
  width: 92px;
  height: 92px;
  border-radius: 50%;
  object-fit: cover;
  border: 2px solid var(--accent);
}
.quote__text {
  font-family: var(--ff-display);
  font-weight: 500;
  font-size: var(--fs-title-l);
  line-height: var(--lh-snug);
  color: var(--text-primary);
}
.quote__attrib {
  margin-top: var(--sp-3);
  font-size: var(--fs-body-s);
  color: var(--text-secondary);
}
.quote__attrib strong { color: var(--text-primary); font-weight: 600; }
@media (max-width: 640px) {
  .quote { grid-template-columns: 1fr; text-align: center; }
  .quote__avatar { margin-inline: auto; }
}
```

- [ ] **Step 3: Create `css/components/accordion.css`**

```css
/* CoCreate · accessible accordion (uses native <details>/<summary>). */
.accordion { display: grid; gap: var(--sp-3); max-width: 800px; margin-inline: auto; }
.accordion__item {
  background: var(--bg-card);
  border: 1px solid var(--border-color);
  border-radius: var(--r-lg);
  overflow: hidden;
}
.accordion__q {
  list-style: none;
  cursor: pointer;
  padding: var(--sp-5) var(--sp-6);
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--sp-4);
  font-family: var(--ff-display);
  font-weight: 600;
  font-size: var(--fs-title-m);
  color: var(--text-primary);
  transition: background var(--dur-fast) var(--ease-out);
}
.accordion__q::-webkit-details-marker { display: none; }
.accordion__q::after {
  content: '+';
  font-family: var(--ff-display);
  font-weight: 600;
  font-size: 1.5rem;
  color: var(--accent);
  transition: transform var(--dur-base) var(--ease-spring);
}
.accordion__item[open] .accordion__q::after { transform: rotate(45deg); }
.accordion__item:hover .accordion__q { background: rgba(255, 255, 255, 0.03); }
.accordion__a {
  padding: 0 var(--sp-6) var(--sp-6);
  color: var(--text-secondary);
  line-height: var(--lh-relaxed);
}
```

- [ ] **Step 4: Create `css/components/cta.css`**

```css
/* CoCreate · final CTA band (full-width, oversized headline + button). */
.cta-band {
  position: relative;
  padding: var(--sp-14) var(--container-px);
  text-align: center;
  background: radial-gradient(ellipse at 50% 0%, rgba(255, 195, 106, 0.18), transparent 60%),
              var(--bg-secondary);
  border-top: 1px solid var(--border-color);
  border-bottom: 1px solid var(--border-color);
}
.cta-band__title {
  font-family: var(--ff-display);
  font-weight: 800;
  font-size: var(--fs-display-l);
  letter-spacing: var(--ls-section);
  margin-bottom: var(--sp-5);
}
.cta-band__sub {
  color: var(--text-secondary);
  font-size: var(--fs-body-l);
  max-width: 56ch;
  margin-inline: auto;
  margin-bottom: var(--sp-7);
}
.cta-band__actions {
  display: inline-flex;
  gap: var(--sp-3);
  flex-wrap: wrap;
  justify-content: center;
}
```

- [ ] **Step 5: Append demos to `_styleguide.html`**

Add the new CSS links to `<head>`:
```html
    <link rel="stylesheet" href="css/components/steps.css">
    <link rel="stylesheet" href="css/components/quote.css">
    <link rel="stylesheet" href="css/components/accordion.css">
    <link rel="stylesheet" href="css/components/cta.css">
```

Append at the end of `<body>`:
```html
  <section class="section">
    <div class="container">
      <p class="eyebrow">Steps</p>
      <div class="steps">
        <div class="step step--active">
          <div class="step__num">1</div>
          <div class="step__title">Share your idea</div>
          <p class="step__body">A 30-minute call to align on vision, audience, and the first slice.</p>
        </div>
        <div class="step">
          <div class="step__num">2</div>
          <div class="step__title">CoCreate in 2 weeks</div>
          <p class="step__body">Design, build, and ship the MVP together — you stay close, we stay fast.</p>
        </div>
        <div class="step">
          <div class="step__num">3</div>
          <div class="step__title">Launch &amp; grow</div>
          <p class="step__body">We keep going post-launch — iterate, scale, and own the upside together.</p>
        </div>
      </div>

      <p class="eyebrow" style="margin-top: var(--sp-12);">Quote</p>
      <blockquote class="quote">
        <img class="quote__avatar" src="assets/cocreate-icon.svg" alt="">
        <div>
          <p class="quote__text">CoCreate didn't quote me a number. They built the product with me and bet on the outcome — that's a co-founder, not a vendor.</p>
          <p class="quote__attrib"><strong>Founder voice</strong> · placeholder, to be replaced with real testimonial</p>
        </div>
      </blockquote>

      <p class="eyebrow" style="margin-top: var(--sp-12);">Accordion (FAQ)</p>
      <div class="accordion">
        <details class="accordion__item" open>
          <summary class="accordion__q">How fast can we ship the first version?</summary>
          <div class="accordion__a">Two weeks from kick-off, every time — that's the deal. Scope is shaped to fit that window.</div>
        </details>
        <details class="accordion__item">
          <summary class="accordion__q">What's the catch with $0 upfront?</summary>
          <div class="accordion__a">No catch — we share the risk because we share the upside. The co-founder model details are on the partnership page.</div>
        </details>
      </div>

      <p class="eyebrow" style="margin-top: var(--sp-12);">Final CTA band</p>
    </div>
    <div class="cta-band">
      <h2 class="cta-band__title">Ready to CoCreate?</h2>
      <p class="cta-band__sub">Imagine. CoCreate. Done! Bring the vision, we'll bring the product.</p>
      <div class="cta-band__actions">
        <a class="btn btn--primary btn--lg" href="https://calendly.com/cocreateceo/30min">Let's CoCreate</a>
        <a class="btn btn--ghost btn--lg" href="/projects.html">See what we've built</a>
      </div>
    </div>
  </section>
```

- [ ] **Step 6: Visual check**

```powershell
node screenshot.js "file:///C:/Projects/ai-product-studio/option-a-threejs-gsap-tailwind/site/_styleguide.html" "_sg_t6.png" 1280 4000
```

Confirm: 3 numbered step circles with a connecting line, quote card with avatar + big text + curly open-quote in the corner, 2 accordion items (first open), final CTA band with gradient glow.

- [ ] **Step 7: Commit**

```bash
git add option-a-threejs-gsap-tailwind/site/css/components/steps.css \
        option-a-threejs-gsap-tailwind/site/css/components/quote.css \
        option-a-threejs-gsap-tailwind/site/css/components/accordion.css \
        option-a-threejs-gsap-tailwind/site/css/components/cta.css \
        option-a-threejs-gsap-tailwind/site/_styleguide.html
git commit -m "feat(design-system): steps, quote, accordion, cta-band primitives"
git push
```

---

## Task 7: `cinematic` primitive (full-bleed scroll-pinned section)

**Files:**
- Create: `option-a-threejs-gsap-tailwind/site/css/components/cinematic.css`
- Create: `option-a-threejs-gsap-tailwind/site/js/cinematic.js`
- Modify: `option-a-threejs-gsap-tailwind/site/_styleguide.html`

This is the only primitive with JS — it uses GSAP ScrollTrigger (already loaded site-wide on the existing index.html) to scroll-pin the headline over a parallax-translating background image. If GSAP isn't on the page, the JS is a no-op and the section degrades to a plain full-bleed hero (still readable).

- [ ] **Step 1: Create `css/components/cinematic.css`**

```css
/* CoCreate · cinematic section.
   Full-bleed dark image with overlay headline. Pinned via GSAP ScrollTrigger
   (see js/cinematic.js). Degrades gracefully without JS. */
.cinematic {
  position: relative;
  min-height: 90vh;
  display: grid;
  place-items: center;
  isolation: isolate;
  color: #fff;
}
.cinematic__bg {
  position: absolute;
  inset: 0;
  z-index: -1;
  background-size: cover;
  background-position: center 30%;
  background-color: var(--bg-primary);
  will-change: transform;
}
.cinematic__bg::after {
  content: '';
  position: absolute;
  inset: 0;
  background: linear-gradient(180deg,
    rgba(26, 10, 0, 0.55) 0%,
    rgba(26, 10, 0, 0.25) 50%,
    rgba(26, 10, 0, 0.85) 100%);
}
.cinematic__inner {
  width: 100%;
  max-width: var(--container-max);
  padding: var(--sp-12) var(--container-px);
  text-align: center;
}
.cinematic__title {
  font-family: var(--ff-display);
  font-weight: 800;
  font-size: clamp(2.6rem, 7vw, 5.5rem);
  letter-spacing: var(--ls-display);
  line-height: 0.95;
}
.cinematic__sub {
  margin-top: var(--sp-5);
  font-size: var(--fs-body-l);
  color: rgba(255, 255, 255, 0.78);
  max-width: 60ch;
  margin-inline: auto;
}
.cinematic__cta { margin-top: var(--sp-7); }
```

- [ ] **Step 2: Create `js/cinematic.js`**

```js
/* CoCreate · cinematic section behaviour.
   No-op if GSAP/ScrollTrigger aren't present. Honours reduced-motion. */
(function () {
  if (typeof window === 'undefined') return;
  function init() {
    if (!window.gsap || !window.ScrollTrigger) return;
    if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    document.querySelectorAll('.cinematic').forEach(function (sec) {
      var bg = sec.querySelector('.cinematic__bg');
      if (!bg) return;
      window.gsap.to(bg, {
        yPercent: 12,
        ease: 'none',
        scrollTrigger: { trigger: sec, start: 'top bottom', end: 'bottom top', scrub: true }
      });
    });
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
```

- [ ] **Step 3: Demo in `_styleguide.html`**

Add link in `<head>`:
```html
    <link rel="stylesheet" href="css/components/cinematic.css">
```

Append before `</body>`:
```html
  <section class="cinematic" id="sg-cinematic">
    <div class="cinematic__bg" style="background-image: url('assets/cocreate_bg.png');"></div>
    <div class="cinematic__inner">
      <h2 class="cinematic__title">Where ideas meet AI</h2>
      <p class="cinematic__sub">Our edge isn't just speed — it's the way we partner. You bring the vision; we bring the studio, the AI agents, and the conviction to ship it in two weeks.</p>
      <div class="cinematic__cta"><a class="btn btn--ghost btn--lg" href="/who-we-are.html">Our way →</a></div>
    </div>
  </section>
  <script src="js/cinematic.js"></script>
```

- [ ] **Step 4: Visual check**

```powershell
node screenshot.js "file:///C:/Projects/ai-product-studio/option-a-threejs-gsap-tailwind/site/_styleguide.html" "_sg_t7.png" 1280 5000
```

Confirm the cinematic section is full-width, ≥ 90 vh tall, with the figure-on-disc background and centred title + sub + ghost CTA. (Parallax won't show in a still screenshot — we verify scroll behaviour live in Task 14.)

- [ ] **Step 5: Commit**

```bash
git add option-a-threejs-gsap-tailwind/site/css/components/cinematic.css \
        option-a-threejs-gsap-tailwind/site/js/cinematic.js \
        option-a-threejs-gsap-tailwind/site/_styleguide.html
git commit -m "feat(design-system): cinematic primitive (full-bleed + GSAP parallax)"
git push
```

---

## Task 8: `pages/home.css` scaffold + new hero block (block 1)

**Files:**
- Create: `option-a-threejs-gsap-tailwind/site/css/pages/home.css`
- Create: `option-a-threejs-gsap-tailwind/site/index-new.html` (we build the new homepage at this temp path; swap into `index.html` in Task 13 only after the full page is reviewed)
- Create (verification): `C:\Projects\_build\assert_home_hero.js`

`index-new.html` keeps the old `index.html` intact and live until the final swap. All later tasks edit `index-new.html`.

- [ ] **Step 1: Create `css/pages/home.css`**

```css
/* CoCreate · homepage-only layout.
   Composes primitives from css/components/. Pages other than index.html
   must not load this file. */

/* HERO — content-led, 2-col on desktop, stacked on mobile */
.home-hero {
  padding: var(--sp-14) 0 var(--sp-12);
  background: radial-gradient(ellipse at 80% 0%, rgba(255, 195, 106, 0.12), transparent 55%),
              var(--bg-primary);
}
.home-hero__grid {
  display: grid;
  grid-template-columns: minmax(0, 1.05fr) minmax(0, 1fr);
  gap: var(--sp-12);
  align-items: center;
}
.home-hero__copy { display: flex; flex-direction: column; gap: var(--sp-5); }
.home-hero__h1 {
  font-family: var(--ff-display);
  font-weight: 800;
  font-size: var(--fs-display-xl);
  letter-spacing: var(--ls-display);
  line-height: 1.02;
}
.home-hero__h1 .gradient {
  background: linear-gradient(135deg, var(--accent), var(--secondary), var(--primary));
  -webkit-background-clip: text;
  background-clip: text;
  color: transparent;
}
.home-hero__sub {
  font-size: var(--fs-body-l);
  color: var(--text-secondary);
  max-width: 52ch;
  line-height: var(--lh-relaxed);
}
.home-hero__ctas { display: flex; gap: var(--sp-3); flex-wrap: wrap; margin-top: var(--sp-3); }
.home-hero__trust { margin-top: var(--sp-5); }

/* Hero product mosaic — 4 portfolio thumbnails, staggered */
.home-hero__mosaic {
  position: relative;
  aspect-ratio: 4 / 5;
  border-radius: var(--r-xl);
}
.home-hero__mosaic img {
  position: absolute;
  border-radius: var(--r-lg);
  box-shadow: var(--sh-lg);
  object-fit: cover;
  transition: transform var(--dur-slow) var(--ease-spring);
}
.home-hero__mosaic img:nth-child(1) { top: 0;   left: 6%;  width: 56%; height: 38%; transform: rotate(-3deg); }
.home-hero__mosaic img:nth-child(2) { top: 14%; right: 0;  width: 56%; height: 38%; transform: rotate(2deg); }
.home-hero__mosaic img:nth-child(3) { bottom: 14%; left: 0;  width: 56%; height: 38%; transform: rotate(2.5deg); }
.home-hero__mosaic img:nth-child(4) { bottom: 0;   right: 6%; width: 56%; height: 38%; transform: rotate(-2deg); }
.home-hero__mosaic:hover img:nth-child(1) { transform: rotate(-5deg) translate(-6px, -4px); }
.home-hero__mosaic:hover img:nth-child(4) { transform: rotate(-4deg) translate(4px, 4px); }

@media (max-width: 880px) {
  .home-hero__grid { grid-template-columns: 1fr; }
  .home-hero__mosaic { aspect-ratio: 4 / 3; max-width: 520px; margin-inline: auto; }
}
```

- [ ] **Step 2: Create `index-new.html` (hero only — later tasks append blocks)**

```html
<!DOCTYPE html>
<html lang="en" data-theme="ember">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>CoCreate Idea — AI-Powered Product Studio</title>
  <meta name="description" content="Your AI Partner. Launch your business in 2 weeks.">
  <link rel="icon" href="favicon.svg" type="image/svg+xml">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Outfit:wght@400;500;600;700;800&family=DM+Sans:wght@400;500;600&display=swap" rel="stylesheet">
  <link rel="stylesheet" href="css/themes/ember.css">
  <link rel="stylesheet" href="css/tokens.css">
  <link rel="stylesheet" href="css/base.css">
  <link rel="stylesheet" href="css/components/section.css">
  <link rel="stylesheet" href="css/components/button.css">
  <link rel="stylesheet" href="css/components/badge.css">
  <link rel="stylesheet" href="css/components/stat.css">
  <link rel="stylesheet" href="css/components/marquee.css">
  <link rel="stylesheet" href="css/components/card.css">
  <link rel="stylesheet" href="css/components/modal.css">
  <link rel="stylesheet" href="css/components/steps.css">
  <link rel="stylesheet" href="css/components/quote.css">
  <link rel="stylesheet" href="css/components/accordion.css">
  <link rel="stylesheet" href="css/components/cinematic.css">
  <link rel="stylesheet" href="css/components/cta.css">
  <link rel="stylesheet" href="css/pages/home.css">
  <link rel="preload" as="image" href="assets/projects/tradepredict.webp">
  <link rel="preload" as="image" href="assets/projects/resume-builder.webp">
</head>
<body>

  <!-- (Existing global nav will be re-included in Task 13. For now, omit so we can test blocks in isolation.) -->

  <!-- BLOCK 1 — HERO -->
  <section class="home-hero">
    <div class="container">
      <div class="home-hero__grid">
        <div class="home-hero__copy">
          <p class="eyebrow">AI-Powered Product Studio</p>
          <h1 class="home-hero__h1">Imagine. <span class="gradient">CoCreate</span>. Done!</h1>
          <p class="home-hero__sub">Your AI Partner. Launch your business in 2 weeks.</p>
          <div class="home-hero__ctas">
            <a class="btn btn--primary btn--lg" href="https://calendly.com/cocreateceo/30min">Let's CoCreate</a>
            <a class="btn btn--ghost btn--lg" href="/projects.html">See what we've built</a>
          </div>
          <div class="home-hero__trust">
            <div class="trust-strip">
              <span class="trust-strip__item">⚡ <strong>2 weeks</strong> to launch</span>
              <span class="trust-strip__sep">·</span>
              <span class="trust-strip__item"><strong>$0</strong> upfront</span>
              <span class="trust-strip__sep">·</span>
              <span class="trust-strip__item"><strong id="js-live-count">17</strong> products shipped</span>
            </div>
          </div>
        </div>
        <div class="home-hero__mosaic" aria-hidden="true">
          <img src="assets/projects/tradepredict.webp" alt="">
          <img src="assets/projects/resume-builder.webp" alt="">
          <img src="assets/projects/homematch.webp" alt="">
          <img src="assets/projects/learnai.webp" alt="">
        </div>
      </div>
    </div>
  </section>

  <script src="js/projects-data.js"></script>
  <script>
    // Live count from PROJECTS_DATA so the trust strip stays accurate.
    (function () {
      var n = 0;
      (window.PROJECTS_DATA || []).forEach(function (c) {
        c.projects.forEach(function (p) { if (p.liveUrl && p.liveUrl !== '#') n++; });
      });
      var el = document.getElementById('js-live-count');
      if (el && n) el.textContent = String(n);
    })();
  </script>
</body>
</html>
```

Note: the hero mosaic references `assets/projects/homematch.webp` and `assets/projects/learnai.webp`. Verify those exist:
```bash
ls /c/Projects/ai-product-studio/option-a-threejs-gsap-tailwind/site/assets/projects/homematch.webp \
   /c/Projects/ai-product-studio/option-a-threejs-gsap-tailwind/site/assets/projects/learnai.webp 2>&1
```
If `homematch.webp` and `learnai.webp` are missing (the originals used thum.io), capture them with Chrome headless and optimize them with `sharp` — same pattern as the captures we did for the 4 SPA sites. Substitute any other existing WebP from `assets/projects/` for now if you don't want to capture them.

- [ ] **Step 3: Create the hero assertion**

`C:\Projects\_build\assert_home_hero.js`:
```js
module.exports = async function (page) {
  await new Promise(r => setTimeout(r, 1200));
  const state = await page.evaluate(() => {
    const h1 = document.querySelector('.home-hero__h1');
    const eyebrow = document.querySelector('.home-hero .eyebrow');
    const sub = document.querySelector('.home-hero__sub');
    const ctas = document.querySelectorAll('.home-hero__ctas .btn');
    const mosaic = document.querySelectorAll('.home-hero__mosaic img');
    const liveCount = (document.getElementById('js-live-count') || {}).textContent;
    return {
      h1: h1 && h1.textContent,
      eyebrow: eyebrow && eyebrow.textContent,
      sub: sub && sub.textContent,
      ctaCount: ctas.length,
      mosaicCount: mosaic.length,
      mosaicLoaded: Array.from(mosaic).filter(i => i.complete && i.naturalWidth > 0).length,
      liveCount
    };
  });
  return { ok: /Imagine\..*CoCreate.*Done!/.test(state.h1 || '')
             && /AI-Powered Product Studio/.test(state.eyebrow || '')
             && /Launch your business in 2 weeks/.test(state.sub || '')
             && state.ctaCount === 2
             && state.mosaicCount === 4
             && state.mosaicLoaded === 4
             && Number(state.liveCount) >= 1, ...state };
};
```

- [ ] **Step 4: Run the assertion — expect PASS**

```powershell
node check.js "file:///C:/Projects/ai-product-studio/option-a-threejs-gsap-tailwind/site/index-new.html" assert_home_hero.js
```

Expected: `{ ok: true, h1: "Imagine. CoCreate. Done!", eyebrow: "AI-Powered Product Studio", sub: "Your AI Partner. Launch your business in 2 weeks.", ctaCount: 2, mosaicCount: 4, mosaicLoaded: 4, liveCount: "17", pageErrors: [] }`.

- [ ] **Step 5: Visual check at three widths**

```powershell
node screenshot.js "file:///C:/Projects/ai-product-studio/option-a-threejs-gsap-tailwind/site/index-new.html" "_home_hero_1280.png" 1280 1200
node screenshot.js "file:///C:/Projects/ai-product-studio/option-a-threejs-gsap-tailwind/site/index-new.html" "_home_hero_768.png" 768 1400
node screenshot.js "file:///C:/Projects/ai-product-studio/option-a-threejs-gsap-tailwind/site/index-new.html" "_home_hero_360.png" 360 1600
```

Open each. At 1280: 2-col grid with copy left, mosaic right. At 768/360: stacked — copy on top, mosaic below.

- [ ] **Step 6: Commit**

```bash
git add option-a-threejs-gsap-tailwind/site/css/pages/home.css \
        option-a-threejs-gsap-tailwind/site/index-new.html
git commit -m "feat(home): hero block (content-led, mosaic, trust strip)"
git push
```

---

## Task 9: Blocks 2–3 — marquee + outcomes

**Files:**
- Modify: `option-a-threejs-gsap-tailwind/site/index-new.html`

Both blocks reuse primitives already shipped (Task 5). Block 2 pulls wordmarks from `PROJECTS_DATA` so it stays accurate.

- [ ] **Step 1: Append blocks to `index-new.html`** (after the hero `<section>`, before the closing `</body>`)

```html
  <!-- BLOCK 2 — WORDMARK MARQUEE -->
  <section class="section" style="padding-top: var(--sp-7); padding-bottom: var(--sp-7);">
    <div class="container">
      <p class="eyebrow" style="text-align:center;">Products live in market</p>
    </div>
    <div class="marquee" id="js-marquee" style="margin-top: var(--sp-5);">
      <div class="marquee__track" id="js-marquee-track"></div>
    </div>
  </section>

  <!-- BLOCK 3 — OUTCOMES (3 STATS) -->
  <section class="section">
    <div class="container">
      <p class="eyebrow">Outcomes</p>
      <h2 class="display-l">Built for founders who want to ship — not just specs.</h2>
      <div class="stats">
        <div class="stat">
          <div class="stat__num">2 Weeks</div>
          <div class="stat__label">to MVP</div>
          <div class="stat__caption">From the kick-off call to a deployed product in market.</div>
        </div>
        <div class="stat">
          <div class="stat__num">$0</div>
          <div class="stat__label">upfront</div>
          <div class="stat__caption">Shared-risk, shared-upside co-founder model.</div>
        </div>
        <div class="stat">
          <div class="stat__num"><span id="js-live-count-2">17</span></div>
          <div class="stat__label">products live</div>
          <div class="stat__caption">Shipped and serving real users today.</div>
        </div>
      </div>
    </div>
  </section>
```

- [ ] **Step 2: Update the inline script (replace the existing live-count IIFE) to also populate the marquee + the second live-count and **

In the existing `<script>` block, replace:
```js
    (function () {
      var n = 0;
      (window.PROJECTS_DATA || []).forEach(function (c) {
        c.projects.forEach(function (p) { if (p.liveUrl && p.liveUrl !== '#') n++; });
      });
      var el = document.getElementById('js-live-count');
      if (el && n) el.textContent = String(n);
    })();
```
with:
```js
    (function () {
      var lives = [];
      (window.PROJECTS_DATA || []).forEach(function (c) {
        c.projects.forEach(function (p) {
          if (p.liveUrl && p.liveUrl !== '#') lives.push(p.name);
        });
      });
      // Trust-strip + outcomes stat
      var n = lives.length;
      ['js-live-count', 'js-live-count-2'].forEach(function (id) {
        var el = document.getElementById(id);
        if (el && n) el.textContent = String(n);
      });
      // Marquee — duplicate track for seamless loop
      var track = document.getElementById('js-marquee-track');
      if (track && lives.length) {
        var html = lives.map(function (name) {
          return '<span class="marquee__item">' + name + '</span>';
        }).join('');
        track.innerHTML = html + html; // double for seamless scroll
      }
    })();
```

- [ ] **Step 3: Re-run the hero assertion (it shouldn't regress)**

```powershell
node check.js "file:///C:/Projects/ai-product-studio/option-a-threejs-gsap-tailwind/site/index-new.html" assert_home_hero.js
```
Expected: still `ok: true`.

- [ ] **Step 4: Add a marquee + stats assertion**

`C:\Projects\_build\assert_home_blocks_2_3.js`:
```js
module.exports = async function (page) {
  await new Promise(r => setTimeout(r, 1500));
  return await page.evaluate(() => {
    const items = document.querySelectorAll('#js-marquee-track .marquee__item').length;
    const stats = document.querySelectorAll('.stats .stat').length;
    const nums  = Array.from(document.querySelectorAll('.stats .stat__num')).map(el => el.textContent.trim());
    return { ok: items >= 20 && stats === 3 && nums.length === 3, items, stats, nums };
  });
};
```
Run:
```powershell
node check.js "file:///C:/Projects/ai-product-studio/option-a-threejs-gsap-tailwind/site/index-new.html" assert_home_blocks_2_3.js
```
Expected: `{ ok: true, items: >=20, stats: 3, nums: ["2 Weeks", "$0", "17"], pageErrors: [] }`.

- [ ] **Step 5: Visual screenshot**

```powershell
node screenshot.js "file:///C:/Projects/ai-product-studio/option-a-threejs-gsap-tailwind/site/index-new.html" "_home_t9.png" 1280 2400
```
Open and confirm the marquee row and the 3 stats render below the hero.

- [ ] **Step 6: Commit**

```bash
git add option-a-threejs-gsap-tailwind/site/index-new.html
git commit -m "feat(home): blocks 2-3 (wordmark marquee + outcomes stats)"
git push
```

---

## Task 10: Block 4 — featured product showcase

**Files:**
- Modify: `option-a-threejs-gsap-tailwind/site/index-new.html`

Reuses the existing `productCardHTML` helper + `flatten()` + the click-to-open detail modal we shipped in the prior project.

- [ ] **Step 1: Append block 4 to `index-new.html`** (after block 3, before the closing `</body>`)

```html
  <!-- BLOCK 4 — FEATURED PRODUCTS -->
  <section class="section">
    <div class="container">
      <p class="eyebrow">What we've shipped</p>
      <h2 class="display-l">Real products, in market today.</h2>
      <p class="lede">A few of the founder-led products we've co-built. Click any card for the story.</p>
      <div class="proj-grid" id="js-home-featured" style="margin-top: var(--sp-9);"></div>
      <div style="margin-top: var(--sp-7);">
        <a class="btn btn--ghost btn--lg" href="/projects.html">See all <span id="js-total-count">29</span> products →</a>
      </div>
    </div>
  </section>
```

- [ ] **Step 2: Wire the script to render featured + totals + open modal**

In `index-new.html`, replace the existing `<script src="js/projects-data.js"></script>` line + the inline script with:
```html
  <script src="js/projects-data.js"></script>
  <script src="js/projects-render.js"></script>
  <script>
    (function () {
      var CP = window.CoCreateProjects;
      if (!CP) return;

      var all = CP.flatten();
      var lives = all.filter(function (p) { return p.isLive; });
      var featured = all.filter(function (p) { return p.featured; }).slice(0, 6);

      // Trust strip + outcomes count
      ['js-live-count', 'js-live-count-2'].forEach(function (id) {
        var el = document.getElementById(id);
        if (el && lives.length) el.textContent = String(lives.length);
      });
      // Totals
      var total = document.getElementById('js-total-count');
      if (total) total.textContent = String(all.length);

      // Marquee
      var track = document.getElementById('js-marquee-track');
      if (track && lives.length) {
        var html = lives.map(function (p) {
          return '<span class="marquee__item">' + p.name + '</span>';
        }).join('');
        track.innerHTML = html + html;
      }

      // Featured cards
      var grid = document.getElementById('js-home-featured');
      if (grid) grid.innerHTML = featured.map(function (p) {
        return CP.productCardHTML(p, { showCategory: true });
      }).join('');
    })();
  </script>
```

- [ ] **Step 3: Reuse the cards + modal assertion**

```powershell
node check.js "file:///C:/Projects/ai-product-studio/option-a-threejs-gsap-tailwind/site/index-new.html" assert_projects_cards.js
```
Expected: `ok: true`, `cards: 6`, `modalOpen: true`, `titleText` set, `pageErrors: []`.

- [ ] **Step 4: Visual screenshot**

```powershell
node screenshot.js "file:///C:/Projects/ai-product-studio/option-a-threejs-gsap-tailwind/site/index-new.html" "_home_t10.png" 1280 3200
```

- [ ] **Step 5: Commit**

```bash
git add option-a-threejs-gsap-tailwind/site/index-new.html
git commit -m "feat(home): block 4 (featured product showcase + modal)"
git push
```

---

## Task 11: Blocks 5–6 — How it works + Cinematic

**Files:**
- Modify: `option-a-threejs-gsap-tailwind/site/index-new.html`

- [ ] **Step 1: Append block 5 (How it works)**

```html
  <!-- BLOCK 5 — HOW IT WORKS -->
  <section class="section">
    <div class="container">
      <p class="eyebrow">How it works</p>
      <h2 class="display-l">Three weeks. Three steps.</h2>
      <p class="lede">Lean. Honest. Built around the founder, not the agency.</p>
      <div class="steps">
        <div class="step step--active">
          <div class="step__num">1</div>
          <div class="step__title">Share your idea</div>
          <p class="step__body">A 30-minute call to align on vision, audience, and the first slice of the product.</p>
        </div>
        <div class="step">
          <div class="step__num">2</div>
          <div class="step__title">CoCreate in 2 weeks</div>
          <p class="step__body">Design, build, and ship the MVP together — you stay close, we stay fast.</p>
        </div>
        <div class="step">
          <div class="step__num">3</div>
          <div class="step__title">Launch &amp; grow</div>
          <p class="step__body">We keep going post-launch — iterate, scale, and own the upside together.</p>
        </div>
      </div>
    </div>
  </section>
```

- [ ] **Step 2: Append block 6 (Cinematic — Our Approach)**

```html
  <!-- BLOCK 6 — OUR APPROACH (CINEMATIC) -->
  <section class="cinematic">
    <div class="cinematic__bg" style="background-image: url('assets/cocreate_bg.png');"></div>
    <div class="cinematic__inner">
      <p class="eyebrow" style="color: var(--accent);">Our approach</p>
      <h2 class="cinematic__title">Where ideas meet AI.</h2>
      <p class="cinematic__sub">We're not a dev shop. We're the AI-native co-founder who builds the product with you, on shared risk and shared upside — so the vision actually ships.</p>
      <div class="cinematic__cta">
        <a class="btn btn--ghost btn--lg" href="/who-we-are.html">Our way →</a>
      </div>
    </div>
  </section>
```

- [ ] **Step 3: Wire GSAP + ScrollTrigger + the cinematic JS**

Before the existing `<script src="js/projects-data.js">` line, add:
```html
  <script src="https://cdn.jsdelivr.net/npm/gsap@3.12.5/dist/gsap.min.js"></script>
  <script src="https://cdn.jsdelivr.net/npm/gsap@3.12.5/dist/ScrollTrigger.min.js"></script>
  <script>if (window.gsap && window.ScrollTrigger) window.gsap.registerPlugin(window.ScrollTrigger);</script>
```
And at the end of `<body>`, after the existing scripts:
```html
  <script src="js/cinematic.js"></script>
```

- [ ] **Step 4: Visual + parity check**

```powershell
node screenshot.js "file:///C:/Projects/ai-product-studio/option-a-threejs-gsap-tailwind/site/index-new.html" "_home_t11.png" 1280 4400
```

Confirm: step block renders with 3 numbered circles and connecting line; cinematic section is full-bleed with the figure-on-disc background and the centered overlay headline + sub + ghost CTA.

Also re-run the cards/modal check to confirm nothing regressed:
```powershell
node check.js "file:///C:/Projects/ai-product-studio/option-a-threejs-gsap-tailwind/site/index-new.html" assert_projects_cards.js
```
Expected: `ok: true`.

- [ ] **Step 5: Commit**

```bash
git add option-a-threejs-gsap-tailwind/site/index-new.html
git commit -m "feat(home): blocks 5-6 (how-it-works + cinematic Our Approach)"
git push
```

---

## Task 12: Blocks 7–9 — Quote, Co-founder model, FAQ

**Files:**
- Modify: `option-a-threejs-gsap-tailwind/site/index-new.html`

- [ ] **Step 1: Append block 7 (Founder voice / quote)**

```html
  <!-- BLOCK 7 — FOUNDER VOICE -->
  <section class="section">
    <div class="container">
      <blockquote class="quote">
        <img class="quote__avatar" src="assets/cocreate-icon.svg" alt="">
        <div>
          <p class="quote__text">We didn't quote a number. We bet on the outcome — and shipped the product with the founder, not for them.</p>
          <p class="quote__attrib">
            <strong>Gopinath Varadharajan</strong> · CEO, CoCreate Idea
            <br><span style="font-size: var(--fs-body-s); opacity: 0.7;">(Placeholder — swap for a real client testimonial once available.)</span>
          </p>
        </div>
      </blockquote>
    </div>
  </section>
```

- [ ] **Step 2: Append block 8 (Co-founder model — 4-pillar stat row)**

```html
  <!-- BLOCK 8 — CO-FOUNDER MODEL -->
  <section class="section" style="background: var(--bg-secondary);">
    <div class="container">
      <p class="eyebrow">The co-founder model</p>
      <h2 class="display-l">Not an agency. Not a contractor. A partner that ships.</h2>
      <p class="lede">We don't charge upfront, and we don't disappear after launch — because we win when you win.</p>
      <div class="stats">
        <div class="stat"><div class="stat__num">$0</div><div class="stat__label">upfront cost</div><div class="stat__caption">We invest the build. You retain ownership and upside.</div></div>
        <div class="stat"><div class="stat__num">2 wks</div><div class="stat__label">to first launch</div><div class="stat__caption">Scope is shaped to fit the window — every time.</div></div>
        <div class="stat"><div class="stat__num">Shared</div><div class="stat__label">upside</div><div class="stat__caption">Aligned incentives, no hourly billing games.</div></div>
        <div class="stat"><div class="stat__num">Always-on</div><div class="stat__label">post-launch</div><div class="stat__caption">We keep iterating with you, not handing off and ghosting.</div></div>
      </div>
    </div>
  </section>
```

- [ ] **Step 3: Append block 9 (FAQ)**

```html
  <!-- BLOCK 9 — FAQ -->
  <section class="section">
    <div class="container">
      <p class="eyebrow" style="text-align:center;">Founder FAQ</p>
      <h2 class="display-l" style="text-align:center;">The things founders actually ask.</h2>
      <div class="accordion" style="margin-top: var(--sp-9);">
        <details class="accordion__item" open>
          <summary class="accordion__q">How fast can we ship the first version?</summary>
          <div class="accordion__a">Two weeks from kick-off, every time. We shape scope to fit the window — the smallest credible MVP that proves the thesis, deployed and in the hands of real users.</div>
        </details>
        <details class="accordion__item">
          <summary class="accordion__q">What's the catch with $0 upfront?</summary>
          <div class="accordion__a">No catch — we share the risk because we share the upside. The exact split depends on the project; we walk through it on the first call.</div>
        </details>
        <details class="accordion__item">
          <summary class="accordion__q">Do I own the code and the brand?</summary>
          <div class="accordion__a">Yes. You own the product, the code, the data, and the brand. We're the co-founder partner — not the owner.</div>
        </details>
        <details class="accordion__item">
          <summary class="accordion__q">What stack do you build on?</summary>
          <div class="accordion__a">Production AI-native stacks: Next.js or vanilla front-ends, Node / Python services, AWS (Lambda + S3 + CloudFront), and the right AI APIs for the job (Anthropic Claude, OpenAI, embeddings, etc.).</div>
        </details>
        <details class="accordion__item">
          <summary class="accordion__q">What happens after launch?</summary>
          <div class="accordion__a">We keep going. Iterate, grow, harden — the same team, the same shared-upside model. We're aligned on the long game, not a hand-off.</div>
        </details>
        <details class="accordion__item">
          <summary class="accordion__q">Does my idea qualify for the model?</summary>
          <div class="accordion__a">If it's a real founder-led product with a real audience, almost always yes. We'll tell you on the first call if it's not a fit, no theatrics.</div>
        </details>
      </div>
    </div>
  </section>
```

- [ ] **Step 4: Visual + parity check**

```powershell
node screenshot.js "file:///C:/Projects/ai-product-studio/option-a-threejs-gsap-tailwind/site/index-new.html" "_home_t12.png" 1280 5800
node check.js "file:///C:/Projects/ai-product-studio/option-a-threejs-gsap-tailwind/site/index-new.html" assert_projects_cards.js
```

- [ ] **Step 5: Commit**

```bash
git add option-a-threejs-gsap-tailwind/site/index-new.html
git commit -m "feat(home): blocks 7-9 (quote, co-founder model, FAQ)"
git push
```

---

## Task 13: Block 10 (final CTA) + footer + nav integration

**Files:**
- Modify: `option-a-threejs-gsap-tailwind/site/index-new.html`

- [ ] **Step 1: Append block 10 (Final CTA band)**

```html
  <!-- BLOCK 10 — FINAL CTA -->
  <section class="cta-band">
    <h2 class="cta-band__title">Ready to CoCreate?</h2>
    <p class="cta-band__sub">Imagine. CoCreate. Done! Bring the vision — we'll bring the studio, the AI, and the conviction to ship it in two weeks.</p>
    <div class="cta-band__actions">
      <a class="btn btn--primary btn--lg" href="https://calendly.com/cocreateceo/30min">Let's CoCreate</a>
      <a class="btn btn--ghost btn--lg" href="/projects.html">See what we've built</a>
    </div>
  </section>
```

- [ ] **Step 2: Re-include the existing global nav + footer**

Open the current live `index.html`. Identify:
- The `<header>` / nav block (top of `<body>`).
- The `<footer>` block (bottom of `<body>`, including the brand-memory-canonical copyright line).

Copy both verbatim into `index-new.html`:
- Nav goes at the top of `<body>`, before the `<section class="home-hero">`.
- Footer goes after the final-CTA block, before the closing `</body>`.

If the nav and footer reference any CSS not yet loaded (e.g. a nav stylesheet), add the corresponding `<link>` to `<head>` in the order: tokens → base → components → page CSS → existing per-page nav/footer CSS last.

- [ ] **Step 3: Final visual sweep at 4 widths**

```powershell
node screenshot.js "file:///C:/Projects/ai-product-studio/option-a-threejs-gsap-tailwind/site/index-new.html" "_home_final_1600.png" 1600 6800
node screenshot.js "file:///C:/Projects/ai-product-studio/option-a-threejs-gsap-tailwind/site/index-new.html" "_home_final_1280.png" 1280 6800
node screenshot.js "file:///C:/Projects/ai-product-studio/option-a-threejs-gsap-tailwind/site/index-new.html" "_home_final_768.png"   768 7400
node screenshot.js "file:///C:/Projects/ai-product-studio/option-a-threejs-gsap-tailwind/site/index-new.html" "_home_final_360.png"   360 8000
```

Open each in turn and confirm: nav top, hero (mosaic right on desktop / below on mobile), marquee, stats, featured cards (grid responsive), how-it-works, cinematic, quote, co-founder stats, FAQ, final CTA, footer.

- [ ] **Step 4: Theme parity sweep (8 themes)**

For each theme in `[ember, coral, sunset, aurora, legacy, sandstone, champagne, zoom]`, change the `<html data-theme="ember">` value in `index-new.html` temporarily, re-screenshot at 1280, view, then revert to `ember`. Confirm: no theme breaks the homepage; colors shift but layout/structure are stable. **Revert `data-theme` to `ember` before committing.**

A faster automation:
```powershell
$themes = @('ember','coral','sunset','aurora','legacy','sandstone','champagne','zoom')
foreach ($t in $themes) {
  (Get-Content -Raw 'C:\Projects\ai-product-studio\option-a-threejs-gsap-tailwind\site\index-new.html') `
    -replace 'data-theme="[^"]+"', ('data-theme="' + $t + '"') |
    Set-Content -NoNewline -Encoding utf8 'C:\Projects\ai-product-studio\option-a-threejs-gsap-tailwind\site\index-new.html'
  # Also flip the linked theme stylesheet:
  (Get-Content -Raw 'C:\Projects\ai-product-studio\option-a-threejs-gsap-tailwind\site\index-new.html') `
    -replace 'css/themes/[a-z]+\.css', ('css/themes/' + $t + '.css') |
    Set-Content -NoNewline -Encoding utf8 'C:\Projects\ai-product-studio\option-a-threejs-gsap-tailwind\site\index-new.html'
  node "C:\Projects\_build\screenshot.js" `
    "file:///C:/Projects/ai-product-studio/option-a-threejs-gsap-tailwind/site/index-new.html" `
    ("C:\Projects\_build\_theme_" + $t + ".png") 1280 6800
}
# Revert to ember:
(Get-Content -Raw 'C:\Projects\ai-product-studio\option-a-threejs-gsap-tailwind\site\index-new.html') `
  -replace 'data-theme="[^"]+"', 'data-theme="ember"' -replace 'css/themes/[a-z]+\.css', 'css/themes/ember.css' |
  Set-Content -NoNewline -Encoding utf8 'C:\Projects\ai-product-studio\option-a-threejs-gsap-tailwind\site\index-new.html'
```

Open the 8 screenshots. Reject any that look broken — layout shifts, missing text contrast, etc. Theme files don't change layout, so the only realistic failure is a hard-coded color in `home.css`. If found, replace with `var(--…)`.

- [ ] **Step 5: `prefers-reduced-motion` check**

```powershell
# Launch Chrome headless with the emulation flag:
& "C:\Program Files\Google\Chrome\Application\chrome.exe" --headless=new --disable-gpu --hide-scrollbars `
  --force-prefers-reduced-motion --window-size=1280,2200 --virtual-time-budget=8000 `
  --screenshot="C:\Projects\_build\_rm.png" `
  "file:///C:/Projects/ai-product-studio/option-a-threejs-gsap-tailwind/site/index-new.html"
```
Open `_rm.png`. The marquee should be a static row (no animation frame stutter); the cinematic parallax should be off; entrance fades should be off.

- [ ] **Step 6: Commit**

```bash
git add option-a-threejs-gsap-tailwind/site/index-new.html
git commit -m "feat(home): block 10 (final CTA) + nav/footer + theme parity + reduced-motion"
git push
```

---

## Task 14: Swap, deploy, verify live

**Files:**
- Modify (replace): `option-a-threejs-gsap-tailwind/site/index.html`
- Delete: `option-a-threejs-gsap-tailwind/site/index-new.html`
- Delete: `option-a-threejs-gsap-tailwind/site/_styleguide.html` (dev-only artifact)

- [ ] **Step 1: Promote `index-new.html` to `index.html`**

```bash
cd /c/Projects/ai-product-studio/option-a-threejs-gsap-tailwind/site
# Back up the previous index.html so a quick revert is possible without git
cp index.html index-prev.html
mv index-new.html index.html
ls -la index.html index-prev.html
```

- [ ] **Step 2: Delete the styleguide (it must not deploy)**

```bash
rm _styleguide.html
```

- [ ] **Step 3: Commit the swap**

```bash
git add option-a-threejs-gsap-tailwind/site/index.html
git rm option-a-threejs-gsap-tailwind/site/_styleguide.html option-a-threejs-gsap-tailwind/site/index-new.html 2>/dev/null
# index-prev.html stays untracked as a local rollback; do NOT add it.
git commit -m "feat(home): swap new homepage into index.html"
git push
```

- [ ] **Step 4: Upload to S3 (targeted, not sync)**

```bash
cd /c/Projects/ai-product-studio/option-a-threejs-gsap-tailwind/site
R="--region ap-south-1"

# Code
aws s3 cp index.html              s3://cocreateidea.com/index.html              $R --content-type "text/html"               --cache-control "public, max-age=300"
aws s3 cp css/tokens.css          s3://cocreateidea.com/css/tokens.css          $R --content-type "text/css"                --cache-control "public, max-age=300"
aws s3 cp css/base.css            s3://cocreateidea.com/css/base.css            $R --content-type "text/css"                --cache-control "public, max-age=300"
aws s3 cp css/projects.css        s3://cocreateidea.com/css/projects.css        $R --content-type "text/css"                --cache-control "public, max-age=300"
aws s3 cp css/pages/home.css      s3://cocreateidea.com/css/pages/home.css      $R --content-type "text/css"                --cache-control "public, max-age=300"
aws s3 cp css/components/         s3://cocreateidea.com/css/components/         $R --recursive --content-type "text/css"    --cache-control "public, max-age=300"
aws s3 cp js/cinematic.js         s3://cocreateidea.com/js/cinematic.js         $R --content-type "application/javascript"  --cache-control "public, max-age=300"

# Also re-upload projects.html / projects-category.html — their <link> order changed
aws s3 cp projects.html           s3://cocreateidea.com/projects.html           $R --content-type "text/html"               --cache-control "public, max-age=300"
aws s3 cp projects-category.html  s3://cocreateidea.com/projects-category.html  $R --content-type "text/html"               --cache-control "public, max-age=300"
```

- [ ] **Step 5: Invalidate CloudFront (PowerShell — bash mangles paths)**

```powershell
aws cloudfront create-invalidation --distribution-id E1M06FXCRKZHF3 `
  --paths "/index.html" "/css/tokens.css" "/css/base.css" "/css/projects.css" `
          "/css/components/*" "/css/pages/*" "/js/cinematic.js" `
          "/projects.html" "/projects-category.html" `
  --query "Invalidation.{Id:Id,Status:Status}" --output table
```

- [ ] **Step 6: Live verification on www**

```powershell
node "C:\Projects\_build\check.js" "https://www.cocreateidea.com/index.html" "C:\Projects\_build\assert_home_hero.js"
node "C:\Projects\_build\check.js" "https://www.cocreateidea.com/index.html" "C:\Projects\_build\assert_home_blocks_2_3.js"
node "C:\Projects\_build\check.js" "https://www.cocreateidea.com/index.html" "C:\Projects\_build\assert_projects_cards.js"
node "C:\Projects\_build\screenshot.js" "https://www.cocreateidea.com/index.html" "C:\Projects\_build\_live_home.png" 1280 7000
node "C:\Projects\_build\screenshot.js" "https://www.cocreateidea.com/projects.html" "C:\Projects\_build\_live_proj.png" 1280 2400
```

Every `check.js` call must print `"ok": true` and `"pageErrors": []`. Open the two screenshots and confirm parity with what you saw locally in Task 13.

- [ ] **Step 7: Lighthouse run (manual)**

In a real browser, open https://www.cocreateidea.com/index.html → DevTools → Lighthouse → Desktop → Run. Targets:
- Performance ≥ 90
- Accessibility ≥ 95
- Best Practices ≥ 95
- SEO ≥ 90

If a target misses, capture which audits failed and open follow-up issues in the next sub-project.

- [ ] **Step 8: Clean up the harness (optional, recommended)**

```powershell
Remove-Item -Recurse -Force "C:\Projects\_build"
```

- [ ] **Step 9: Final commit (only if anything new was committed in Step 7 follow-up)**

If Lighthouse drove a small fix, commit it with a focused message and re-deploy. Otherwise no commit needed.

---

## Self-review (run before handing off)

**Spec coverage — every spec section maps to a task:**
- §1 Background → Plan's "Goal" + Tasks 1–14 collectively
- §2 Homepage stack (10 blocks) → Task 8 (block 1), Task 9 (blocks 2–3), Task 10 (block 4), Task 11 (blocks 5–6), Task 12 (blocks 7–9), Task 13 (block 10) ✓
- §3.1 File structure → Tasks 1, 2, 3, 4, 5, 6, 7, 8 ✓
- §3.2 Tokens → Task 1 ✓
- §3.3 Component primitives (12) → Tasks 3 (card, modal), 4 (section, button), 5 (badge, stat, marquee), 6 (steps, quote, accordion, cta), 7 (cinematic) ✓
- §3.4 Motion philosophy → Tokens (Task 1) + cinematic (Task 7) + reduced-motion gate (Task 13 step 5) ✓
- §3.5 System rules → enforced by token-only CSS in each component task
- §4 Content strategy → blocks 1 (hero copy = brand memory), 2 (marquee from PROJECTS_DATA), 4 (cards from PROJECTS_DATA), 9 (FAQ — net-new, flagged as "Founder FAQ" with 6 Q&A in Task 12; CEO sign-off occurs at Lighthouse review in Task 14 step 7) ✓
- §5 Verification gates → Theme parity (Task 13 step 4), pages-unbroken (Task 3 step 6), headless render at multiple widths (Tasks 8, 13), cards+modal regression (Tasks 3, 10, 11, 12), Lighthouse (Task 14 step 7), reduced-motion (Task 13 step 5), no console/network errors (every check.js call) ✓
- §6 Deploy plan → Task 14 ✓
- §7 Scope boundaries → respected: long-tail pages are untouched
- §8 Risks → mosaic preload added in Task 8 step 2; GSAP reused not added (Task 11 step 3); additive CSS only; FAQ flagged for sign-off; component CSS loads before page CSS (Task 13 step 2 note)
- §9 Open questions → FAQ Q&A and quote attribution surface at Lighthouse review (Task 14 step 7)

**Placeholder scan:** No `TBD`/`TODO`/`implement later`/"appropriate error handling" patterns present. The only "placeholder" string is the explicit `Placeholder — swap for a real client testimonial` in block 7 (block 7's quote attribution), which is correctly flagged in §9 of the spec.

**Type / identifier consistency:** `productCardHTML`, `flatten()`, `isLive`, `liveUrl`, `featured`, `slug`, `PROJECTS_DATA`, `CoCreateProjects`, `proj-card`, `proj-modal`, `data-slug` — all match the existing shipped code in `js/projects-render.js` and `js/projects-data.js`. Tokens used in components (`--sp-*`, `--fs-*`, `--r-*`, `--sh-*`, `--dur-*`, `--ease-*`, `--container-*`, `--sec-py`, `--ls-*`, `--lh-*`, `--ff-*`, `--bg-primary`, `--bg-secondary`, `--bg-card`, `--text-primary`, `--text-secondary`, `--border-color`, `--accent`, `--secondary`, `--primary`, `--glow-color`) all defined either in `tokens.css` (Task 1) or in the existing themes/*.css files. Element class names used in HTML (`.home-hero`, `.home-hero__grid`, `.home-hero__copy`, `.home-hero__sub`, `.home-hero__ctas`, `.home-hero__trust`, `.home-hero__mosaic`, `.proj-grid`, `.section`, `.container`, `.eyebrow`, `.display-l`, `.lede`, `.btn`, `.btn--primary`, `.btn--ghost`, `.btn--lg`, `.btn--sm`, `.trust-strip`, `.trust-strip__item`, `.trust-strip__sep`, `.stats`, `.stat`, `.stat__num`, `.stat__label`, `.stat__caption`, `.marquee`, `.marquee__track`, `.marquee__item`, `.steps`, `.step`, `.step--active`, `.step__num`, `.step__title`, `.step__body`, `.cinematic`, `.cinematic__bg`, `.cinematic__inner`, `.cinematic__title`, `.cinematic__sub`, `.cinematic__cta`, `.quote`, `.quote__avatar`, `.quote__text`, `.quote__attrib`, `.accordion`, `.accordion__item`, `.accordion__q`, `.accordion__a`, `.cta-band`, `.cta-band__title`, `.cta-band__sub`, `.cta-band__actions`) all defined in the corresponding component CSS. JS hooks (`js-live-count`, `js-live-count-2`, `js-total-count`, `js-marquee-track`, `js-home-featured`) all referenced consistently in HTML and script.
