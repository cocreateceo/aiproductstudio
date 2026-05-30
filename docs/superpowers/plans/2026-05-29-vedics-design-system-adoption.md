# Vedics Design System Adoption — Wave A Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Swap the foundation of cocreateidea.com (tokens, base, all 13 component CSS files) to the Vedics design system in place, add 4 new component primitives, rewrite `index.html` with the centered hero / fixed cinematic background / glass-morphism cards / status tabs / chat FAB, deploy to S3 + CloudFront, and verify all 8 themes + `projects.html` non-regression.

**Architecture:** Approach B (full swap, clean break). Same file paths kept so theme files and existing pages continue to function via the same `<link>` references; only the contents change. A compatibility alias layer in `tokens.css` translates the previous `--sp-*`, `--sh-*`, `--fs-*`, `--r-*`, `--dur-*`, `--ease-*`, `--ls-*`, `--lh-*`, `--ff-*` token names to the Vedics design's new names so component CSS files don't need bulk find-and-replace. New net-new components (`cc-bg`, `cc-tabs`, `cc-fab`, `partner-card`) ship as additional files. JS gets two tiny line-level edits: `projects-data.js` adds default-fill rule for the `status` field, `projects-render.js` emits `data-status` on cards.

**Tech Stack:** Vanilla CSS (CSS variables, fluid clamp typography, IntersectionObserver), vanilla JS (already in page) + GSAP+ScrollTrigger (already loaded for cinematic parallax). Verification harness: Puppeteer-core driving the installed Chrome at `C:\Program Files\Google\Chrome\Application\chrome.exe` from `C:\Projects\_build\`. Deploy: `aws s3 cp` to `s3://cocreateidea.com` (ap-south-1) + CloudFront invalidation on `E1M06FXCRKZHF3`.

**Spec:** `docs/superpowers/specs/2026-05-29-vedics-design-system-adoption.md`

---

## Conventions used throughout this plan

- **All paths absolute or repo-relative.** Site dir: `option-a-threejs-gsap-tailwind/site/`. Repo root: `C:\Projects\ai-product-studio\`.
- **No magic numbers in component CSS** — every size, color, radius, shadow uses `var(--token-name)` from `tokens.css`. The few exceptions are documented in the spec (e.g. `56px` chat FAB size, `0.18em` eyebrow tracking literal, the deliberate `rgba(26,10,0,…)` cinematic overlay).
- **Component CSS files** use BEM-ish class naming and keep the SAME selector names they currently have, so HTML/JS that references them keeps working.
- **Verification harness** lives at `C:\Projects\_build\` (outside the repo, never deployed). Reused by every task. Set up in Task 0.
- **Working directory:** `C:\Projects\ai-product-studio` for git ops; `C:\Projects\_build` for harness runs. Set explicitly each time.
- **Commit cadence:** one commit per task. Branch is `main`. Push after each commit. The user has confirmed "execute through" — do not pause for approval between tasks; only stop on BLOCKED.
- **Deploy is Task 17 only.** Earlier tasks land code on `main` but do not invalidate CloudFront.
- **PowerShell, not bash, for `aws cloudfront create-invalidation`** — bash mangles the leading `/` in paths. Other AWS commands work in either shell.
- **Pre-existing modified files in `git status` are not yours.** Leave `docs/superpowers/specs/2026-03-12-cocreateidea-email-system-design.md` and `projects/ai-chat-widget/backend/package-lock.json` untouched. Use targeted `git add <path>` per task, never `git add .` or `git add -A`.

---

## Task 0: Verification harness setup

**Files:**
- Create: `C:\Projects\_build\package.json`
- Create: `C:\Projects\_build\check.js`
- Create: `C:\Projects\_build\screenshot.js`

This harness is reused by every later task. The same harness pattern was used in the prior Wave 0 plan (it may still exist from earlier sessions — if so, skip the install step).

- [ ] **Step 1: Create the harness directory and install deps**

Run (PowerShell):
```powershell
New-Item -ItemType Directory -Force -Path "C:\Projects\_build" | Out-Null
Set-Location "C:\Projects\_build"
if (-not (Test-Path "package.json")) { npm init -y *> $null }
npm install puppeteer-core@23 sharp 2>&1 | Select-Object -Last 2
```

Expected: `found 0 vulnerabilities`.

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

- [ ] **Step 4: Smoke-test the harness**

```powershell
Set-Location "C:\Projects\_build"
node screenshot.js "https://www.cocreateidea.com/projects.html" "_smoke.png" 1280 1200
```

Expected: JSON line with `"errors": []` and `_smoke.png` ~500 KB – 2 MB.

- [ ] **Step 5: No commit** (harness is outside the repo).

---

## Task 1: Rewrite `tokens.css` with brand primitives + semantic tokens + alias shim

**Files:**
- Modify (rewrite): `option-a-threejs-gsap-tailwind/site/css/tokens.css`
- Create (verification): `C:\Projects\_build\assert_tokens_v2.js`

The shim must cover all 40 old token names enumerated at planning time: `--sp-2/3/4/5/6/7/8/9/12/14`, `--sh-sm/lg/glow`, `--fs-display-xl/l/m`, `--fs-title-l/m`, `--fs-body-l/m/s`, `--fs-caption`, `--ls-display/section/caption`, `--lh-tight/snug/relaxed`, `--ff-display/body`, `--r-sm/md/lg/xl/full`, `--dur-fast/base/slow`, `--ease-out/spring`.

- [ ] **Step 1: Write the failing assertion**

Create `C:\Projects\_build\assert_tokens_v2.js`:

```js
// Confirms the new design tokens AND every alias from the prior design system
// resolve to non-empty computed values.
module.exports = async function (page) {
  const tokens = await page.evaluate(() => {
    const s = getComputedStyle(document.documentElement);
    const want = [
      // New brand primitives
      '--cc-peach', '--cc-coral', '--cc-coral-red', '--cc-vermillion',
      '--cc-ink', '--cc-ink-deep', '--cc-ember-bg-2',
      '--cc-cream', '--cc-cream-mid', '--cc-cream-dim',
      // New semantic + gradients
      '--bg-primary', '--bg-card', '--text-primary', '--accent', '--primary', '--secondary',
      '--grad-brand', '--grad-cta', '--grad-mesh',
      // New spacing + radii + shadows + motion + type
      '--s-1', '--s-5', '--s-10', '--nav-height',
      '--r-pill', '--r-xs', '--r-2xl',
      '--shadow-md', '--shadow-lg', '--shadow-cta', '--shadow-cta-h',
      '--font-display', '--font-body', '--font-stat',
      '--track-display', '--track-eyebrow',
      '--transition-speed', '--ease-out', '--ease-smooth',
      // Aliases (must all resolve via the shim)
      '--sp-2', '--sp-3', '--sp-4', '--sp-5', '--sp-6', '--sp-7', '--sp-8', '--sp-9', '--sp-12', '--sp-14',
      '--sh-sm', '--sh-lg', '--sh-glow',
      '--fs-display-xl', '--fs-display-l', '--fs-display-m',
      '--fs-title-l', '--fs-title-m',
      '--fs-body-l', '--fs-body-m', '--fs-body-s', '--fs-caption',
      '--ls-display', '--ls-section', '--ls-caption',
      '--lh-tight', '--lh-snug', '--lh-relaxed',
      '--ff-display', '--ff-body',
      '--r-sm', '--r-md', '--r-lg', '--r-xl', '--r-full',
      '--dur-fast', '--dur-base', '--dur-slow',
      '--ease-spring',
      '--container-max', '--container-px', '--sec-py'
    ];
    const out = {};
    want.forEach(k => out[k] = s.getPropertyValue(k).trim());
    return out;
  });
  const missing = Object.entries(tokens).filter(([_, v]) => !v).map(([k]) => k);
  return { ok: missing.length === 0, missing, sample: { '--sp-4': tokens['--sp-4'], '--r-pill': tokens['--r-pill'], '--font-stat': tokens['--font-stat'] } };
};
```

- [ ] **Step 2: Run it against the live page — expect FAIL**

```powershell
Set-Location "C:\Projects\_build"
node check.js "https://www.cocreateidea.com/projects.html" assert_tokens_v2.js
```

Expected: nonzero exit; missing includes `--cc-peach`, `--cc-coral-red`, `--cc-vermillion`, `--cc-ink`, `--r-pill`, `--shadow-cta`, `--font-stat`, `--grad-brand`, `--track-eyebrow`, etc. (the new tokens don't exist yet on live).

- [ ] **Step 3: Rewrite `css/tokens.css`**

Replace the entire file content with:

```css
/* CoCreate design tokens — Vedics design system foundation.
   Source: design/Vedics Design System_FInal/colors_and_type.css.
   Color tokens are theme-aware (themes/<name>.css overrides).
   Brand primitives are constants. Aliases at the bottom keep
   prior component CSS files working without find-and-replace. */

:root {
  /* ────────────────────────────────────────────────────────────────────── */
  /* BRAND PRIMITIVES — theme-agnostic constants                            */
  /* ────────────────────────────────────────────────────────────────────── */
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

  /* ────────────────────────────────────────────────────────────────────── */
  /* SEMANTIC TOKENS — default (ember theme overrides these in themes/*)    */
  /* ────────────────────────────────────────────────────────────────────── */
  --bg-primary:      var(--cc-ink);
  --bg-secondary:    var(--cc-ember-bg-2);
  --bg-card:         var(--cc-ember-card);
  --bg-card-hover:   var(--cc-ember-card-h);

  --text-primary:    var(--cc-cream);
  --text-secondary:  var(--cc-cream-mid);
  --text-muted:      var(--cc-cream-dim);

  --primary:         var(--cc-vermillion);
  --secondary:       var(--cc-coral-red);
  --accent:          var(--cc-peach);

  --border-color:    rgba(252, 42, 13, 0.25);
  --nav-bg:          rgba(26, 10, 0, 0.9);
  --glow-color:      rgba(252, 42, 13, 0.35);

  /* ────────────────────────────────────────────────────────────────────── */
  /* SIGNATURE GRADIENTS                                                    */
  /* ────────────────────────────────────────────────────────────────────── */
  --grad-brand: linear-gradient(135deg, var(--accent) 0%, var(--primary) 50%, var(--secondary) 100%);
  --grad-cta:   linear-gradient(135deg, var(--primary) 0%, var(--secondary) 100%);
  --grad-mesh:
    radial-gradient(ellipse 80% 60% at 30% 20%, rgba(255, 195, 106, 0.4) 0%, transparent 50%),
    radial-gradient(ellipse 70% 80% at 70% 60%, rgba(252, 42, 13, 0.5) 0%, transparent 50%),
    radial-gradient(ellipse 90% 70% at 50% 90%, rgba(139, 37, 0, 0.6) 0%, transparent 60%),
    radial-gradient(ellipse 50% 50% at 80% 20%, rgba(253, 108, 113, 0.3) 0%, transparent 45%),
    linear-gradient(180deg, #1A0A00 0%, #0D0500 100%);

  /* ────────────────────────────────────────────────────────────────────── */
  /* SPACING — 4 px ladder                                                  */
  /* ────────────────────────────────────────────────────────────────────── */
  --s-1:  4px;
  --s-2:  8px;
  --s-3:  12px;
  --s-4:  16px;
  --s-5:  24px;
  --s-6:  32px;
  --s-7:  48px;
  --s-8:  64px;
  --s-9:  96px;
  --s-10: 128px;
  --nav-height: 80px;

  /* Section + container (carry over) */
  --sec-py: clamp(64px, 8vw, 120px);
  --container-max: 1200px;
  --container-px: clamp(20px, 4vw, 40px);

  /* Parallax variable for the cinematic background (driven by GSAP) */
  --cc-bg-y: 0px;

  /* ────────────────────────────────────────────────────────────────────── */
  /* RADII                                                                  */
  /* ────────────────────────────────────────────────────────────────────── */
  --r-xs:   4px;
  --r-sm:   8px;
  --r-md:   12px;
  --r-lg:   16px;
  --r-xl:   20px;
  --r-2xl:  24px;
  --r-pill: 9999px;
  --r-full: 999px;

  /* ────────────────────────────────────────────────────────────────────── */
  /* SHADOWS — warm-tinted                                                  */
  /* ────────────────────────────────────────────────────────────────────── */
  --shadow-sm:    0 4px 12px rgba(0, 0, 0, 0.25);
  --shadow-md:    0 8px 32px rgba(252, 42, 13, 0.15), inset 0 1px 0 rgba(255, 255, 255, 0.05);
  --shadow-lg:    0 12px 48px rgba(252, 42, 13, 0.25), inset 0 1px 0 rgba(255, 255, 255, 0.08);
  --shadow-glow:  0 0 20px var(--glow-color);
  --shadow-glow-strong: 0 0 40px var(--glow-color), 0 0 60px rgba(255, 195, 106, 0.2);
  --shadow-cta:   0 4px 20px rgba(252, 42, 13, 0.4);
  --shadow-cta-h: 0 8px 32px rgba(252, 42, 13, 0.6);
  --focus-color:  rgba(255, 195, 106, 0.45);

  /* ────────────────────────────────────────────────────────────────────── */
  /* Z-INDEX                                                                */
  /* ────────────────────────────────────────────────────────────────────── */
  --z-nav: 100;
  --z-modal-backdrop: 1000;
  --z-modal: 1001;
  --z-toast: 1100;

  /* ────────────────────────────────────────────────────────────────────── */
  /* TYPE                                                                   */
  /* ────────────────────────────────────────────────────────────────────── */
  --font-display:  'Outfit', 'DM Sans', system-ui, sans-serif;
  --font-body:     'DM Sans', system-ui, sans-serif;
  --font-stat:     'Space Grotesk', 'Outfit', system-ui, sans-serif;
  --font-mono:     ui-monospace, 'JetBrains Mono', Menlo, monospace;

  --track-display: -0.03em;
  --track-tight:   -0.02em;
  --track-eyebrow: 0.18em;
  --track-cta:     0.08em;

  /* ────────────────────────────────────────────────────────────────────── */
  /* MOTION                                                                 */
  /* ────────────────────────────────────────────────────────────────────── */
  --transition-speed: 0.4s;
  --ease-out:    cubic-bezier(0.22, 1, 0.36, 1);
  --ease-smooth: cubic-bezier(0.4, 0, 0.2, 1);

  /* ╔══════════════════════════════════════════════════════════════════╗ */
  /* ║ BACK-COMPAT ALIASES                                              ║ */
  /* ║ Bridges every prior Wave 0 token name to a current value, so     ║ */
  /* ║ surviving component CSS works without find-and-replace.          ║ */
  /* ╚══════════════════════════════════════════════════════════════════╝ */

  /* Spacing — old --sp-N → new --s-N (rounded to closest step) */
  --sp-1:  var(--s-1);
  --sp-2:  var(--s-2);
  --sp-3:  var(--s-3);
  --sp-4:  var(--s-4);
  --sp-5:  var(--s-5);
  --sp-6:  var(--s-5);
  --sp-7:  var(--s-6);
  --sp-8:  var(--s-6);
  --sp-9:  var(--s-7);
  --sp-10: var(--s-7);
  --sp-11: var(--s-8);
  --sp-12: var(--s-8);
  --sp-13: var(--s-9);
  --sp-14: var(--s-9);
  --sp-15: var(--s-10);
  --sp-16: var(--s-10);

  /* Shadows */
  --sh-sm:    var(--shadow-sm);
  --sh-md:    var(--shadow-md);
  --sh-lg:    var(--shadow-lg);
  --sh-glow:  var(--shadow-glow);
  --sh-focus: 0 0 0 3px var(--focus-color);

  /* Type scale */
  --fs-display-xl: clamp(2.25rem, 5vw, 4.5rem);
  --fs-display-l:  clamp(1.75rem, 3.5vw, 3rem);
  --fs-display-m:  1.75rem;
  --fs-title-l:    1.4rem;
  --fs-title-m:    1.25rem;
  --fs-body-l:     1.125rem;
  --fs-body-m:     1rem;
  --fs-body-s:     0.875rem;
  --fs-caption:    0.75rem;

  /* Letter-spacing + line-height */
  --ls-display: var(--track-display);
  --ls-section: var(--track-tight);
  --ls-caption: var(--track-eyebrow);
  --lh-tight:   1.1;
  --lh-snug:    1.3;
  --lh-normal:  1.55;
  --lh-relaxed: 1.7;

  /* Font-family */
  --ff-display: var(--font-display);
  --ff-body:    var(--font-body);
  --ff-mono:    var(--font-mono);

  /* Motion */
  --dur-fast:    160ms;
  --dur-base:    280ms;
  --dur-slow:    var(--transition-speed);
  --ease-in-out: var(--ease-smooth);
  --ease-spring: cubic-bezier(0.16, 1, 0.3, 1);
}

@media (prefers-reduced-motion: reduce) {
  :root {
    --transition-speed: 0ms;
    --dur-fast: 0ms;
    --dur-base: 0ms;
    --dur-slow: 0ms;
  }
}
```

- [ ] **Step 4: Run the assertion against the local file — expect PASS**

```powershell
node check.js "file:///C:/Projects/ai-product-studio/option-a-threejs-gsap-tailwind/site/projects.html" assert_tokens_v2.js
```

Expected: exit 0, `"ok": true`, `missing: []`, `sample: { "--sp-4": "16px", "--r-pill": "9999px", "--font-stat": "\"Space Grotesk\", \"Outfit\", system-ui, sans-serif" }`.

- [ ] **Step 5: Render-parity smoke — projects page still works**

```powershell
node screenshot.js "file:///C:/Projects/ai-product-studio/option-a-threejs-gsap-tailwind/site/projects.html" "_proj_after_tokens_v2.png" 1280 2000
```

Open the PNG. Cards may already look slightly different (font sizes shift via `--fs-*` aliases) — but layout must be intact. Confirm `"errors": []`.

- [ ] **Step 6: Commit**

```bash
cd /c/Projects/ai-product-studio
git add option-a-threejs-gsap-tailwind/site/css/tokens.css
git commit -m "feat(design-system): swap tokens.css to Vedics foundation + back-compat shim"
git push
```

---

## Task 2: Rewrite `base.css` (reset + body + headings + eyebrow + stat-number)

**Files:**
- Modify (rewrite): `option-a-threejs-gsap-tailwind/site/css/base.css`
- Create (verification): `C:\Projects\_build\assert_base.js`

- [ ] **Step 1: Write the failing assertion**

`C:\Projects\_build\assert_base.js`:

```js
module.exports = async function (page) {
  const result = await page.evaluate(() => {
    const body = getComputedStyle(document.body);
    return {
      bodyColor: body.color,
      bodyBg: body.backgroundColor,
      bodyFont: body.fontFamily,
      hasStatNumberRule: !!Array.from(document.styleSheets).flatMap(s => { try { return Array.from(s.cssRules); } catch (e) { return []; } }).find(r => r.selectorText && r.selectorText.includes('.stat-number')),
      hasEyebrowRule: !!Array.from(document.styleSheets).flatMap(s => { try { return Array.from(s.cssRules); } catch (e) { return []; } }).find(r => r.selectorText === '.eyebrow')
    };
  });
  // Ember default text is rgb(255, 248, 240); bg primary rgb(26, 10, 0)
  const colorOk = result.bodyColor === 'rgb(255, 248, 240)';
  const bgOk = result.bodyBg === 'rgb(26, 10, 0)';
  return { ok: colorOk && bgOk && result.hasStatNumberRule && result.hasEyebrowRule, ...result };
};
```

- [ ] **Step 2: Run against local — expect FAIL**

```powershell
node check.js "file:///C:/Projects/ai-product-studio/option-a-threejs-gsap-tailwind/site/projects.html" assert_base.js
```

Expected: `ok: false` — `hasStatNumberRule: false`, `hasEyebrowRule: false` (no such rules yet; the eyebrow rule lives in `components/section.css` currently, but the assertion specifically wants `.eyebrow` as a top-level rule, and `.stat-number` as a new addition).

- [ ] **Step 3: Rewrite `css/base.css`**

```css
/* CoCreate base — Vedics design system.
   Loaded AFTER tokens.css. Sets body color/bg + heading defaults +
   the .eyebrow and .stat-number utilities that the homepage uses. */

*, *::before, *::after { box-sizing: border-box; }
* { margin: 0; }

html { -webkit-text-size-adjust: 100%; scroll-behavior: smooth; }

body {
  font-family: var(--font-body);
  font-size: 16px;
  line-height: 1.6;
  color: var(--text-primary);
  background: var(--bg-primary);
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
  text-rendering: optimizeLegibility;
  overflow-x: hidden;
  transition: background var(--transition-speed) ease, color var(--transition-speed) ease;
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

h1, h2, h3, h4, h5, h6, .font-display {
  font-family: var(--font-display);
  font-weight: 600;
  letter-spacing: var(--track-tight);
}
h1, .h-1 {
  font-weight: 700;
  font-size: clamp(2.25rem, 5vw, 4.5rem);
  line-height: 1.05;
  letter-spacing: var(--track-display);
}
h2, .h-2 {
  font-size: clamp(1.75rem, 3.5vw, 3rem);
  line-height: 1.1;
}
h3, .h-3 {
  font-size: 1.4rem;
  line-height: 1.25;
}
h4, .h-4 {
  font-size: 1.05rem;
  font-weight: 500;
  letter-spacing: -0.01em;
}

p { line-height: var(--lh-normal); }

.eyebrow {
  display: inline-block;
  font-family: var(--font-display);
  font-weight: 600;
  font-size: var(--fs-caption);
  letter-spacing: var(--track-eyebrow);
  text-transform: uppercase;
  color: var(--accent);
}

.stat-number {
  font-family: var(--font-stat);
  font-weight: 700;
  background: var(--grad-brand);
  -webkit-background-clip: text;
  background-clip: text;
  color: transparent;
}

::selection { background: var(--accent); color: var(--cc-ink); }
```

- [ ] **Step 4: Run assertion against local — expect PASS**

```powershell
node check.js "file:///C:/Projects/ai-product-studio/option-a-threejs-gsap-tailwind/site/projects.html" assert_base.js
```

Expected: `ok: true`, `bodyColor: "rgb(255, 248, 240)"`, `bodyBg: "rgb(26, 10, 0)"`, `hasStatNumberRule: true`, `hasEyebrowRule: true`.

- [ ] **Step 5: Render-parity screenshot**

```powershell
node screenshot.js "file:///C:/Projects/ai-product-studio/option-a-threejs-gsap-tailwind/site/projects.html" "_proj_after_base.png" 1280 2000
```

Open `_proj_after_base.png`. Cards + modal area should still look right; text colour now correctly resolves through `var(--text-primary)`.

- [ ] **Step 6: Commit**

```bash
git add option-a-threejs-gsap-tailwind/site/css/base.css
git commit -m "feat(design-system): rewrite base.css with body color + .eyebrow + .stat-number"
git push
```

---

## Task 3: Rewrite `components/card.css` as glass-morphism

**Files:**
- Modify (rewrite): `option-a-threejs-gsap-tailwind/site/css/components/card.css`
- Create (verification): `C:\Projects\_build\assert_card_glass.js`

Selectors preserved end-to-end so `projects-render.js` is unaffected. Glass-morphism rules + warm-tinted shadows replace the prior generic-card visuals. Adds the canonical `.cc-card` primitive.

- [ ] **Step 1: Write the failing assertion**

`C:\Projects\_build\assert_card_glass.js`:

```js
module.exports = async function (page) {
  await new Promise(r => setTimeout(r, 1500));
  const result = await page.evaluate(() => {
    const c = document.querySelector('.proj-card');
    if (!c) return { error: 'no proj-card' };
    const s = getComputedStyle(c);
    return {
      backdropFilter: s.backdropFilter || s.webkitBackdropFilter,
      borderRadius: s.borderRadius,
      borderColor: s.borderColor,
      background: s.background.includes('linear-gradient') ? 'gradient' : s.backgroundColor,
      transition: s.transition
    };
  });
  // Glass = non-empty backdrop-filter with blur
  const ok = (result.backdropFilter || '').includes('blur');
  return { ok, ...result };
};
```

- [ ] **Step 2: Run against local — expect FAIL**

```powershell
node check.js "file:///C:/Projects/ai-product-studio/option-a-threejs-gsap-tailwind/site/projects.html" assert_card_glass.js
```

Expected: `ok: false`, `backdropFilter: "none"` (the current `card.css` doesn't apply backdrop-blur).

- [ ] **Step 3: Rewrite `css/components/card.css`**

```css
/* CoCreate · card component — Vedics glass-morphism.
   Selector names preserved so projects-render.js + index.html consumers
   are unaffected. .cc-card is the canonical primitive for net-new sections. */

/* Glass-card primitive (use for any new section) */
.cc-card {
  background: var(--bg-card);
  border: 1px solid var(--border-color);
  border-radius: var(--r-lg);
  backdrop-filter: blur(20px) saturate(120%);
  -webkit-backdrop-filter: blur(20px) saturate(120%);
  box-shadow: var(--shadow-md);
  transition: transform var(--transition-speed) var(--ease-smooth),
              border-color var(--transition-speed) var(--ease-smooth),
              background var(--transition-speed) var(--ease-smooth),
              box-shadow var(--transition-speed) var(--ease-smooth);
}
.cc-card:hover {
  transform: translateY(-4px);
  border-color: var(--accent);
  background: var(--bg-card-hover);
  box-shadow: var(--shadow-lg);
}

/* Projects grid (same name as before — used by projects.html + home) */
.proj-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
  gap: var(--s-5);
}

/* Project card (glass-morphism rewrite, same selectors) */
.proj-card {
  position: relative;
  display: flex;
  flex-direction: column;
  background: var(--bg-card);
  border: 1px solid var(--border-color);
  border-radius: var(--r-lg);
  backdrop-filter: blur(20px) saturate(120%);
  -webkit-backdrop-filter: blur(20px) saturate(120%);
  box-shadow: var(--shadow-md);
  overflow: hidden;
  cursor: pointer;
  transition: transform var(--transition-speed) var(--ease-smooth),
              border-color var(--transition-speed) var(--ease-smooth),
              background var(--transition-speed) var(--ease-smooth),
              box-shadow var(--transition-speed) var(--ease-smooth);
}
.proj-card:hover {
  transform: translateY(-8px) scale(1.01);
  border-color: var(--accent);
  background: var(--bg-card-hover);
  box-shadow: var(--shadow-lg);
}
.proj-card:focus-visible {
  outline: none;
  box-shadow: var(--sh-focus);
}

/* Tile (image area at top of card) */
.proj-tile {
  position: relative;
  aspect-ratio: 16 / 10;
  background: var(--grad-cta);
  overflow: hidden;
}
.proj-tile::after {
  content: '';
  position: absolute;
  inset: 0;
  background: linear-gradient(180deg, transparent 50%, rgba(0, 0, 0, 0.35) 100%);
  z-index: 1;
}
.tile-icon {
  position: absolute;
  top: 50%; left: 50%;
  width: 80px; height: 80px;
  transform: translate(-50%, -50%);
  fill: none;
  stroke: rgba(255, 255, 255, 0.5);
  stroke-width: 1.5;
  z-index: 0;
}
.tile-initial {
  position: absolute;
  bottom: 8px; right: 12px;
  font-family: var(--font-display);
  font-weight: 800;
  font-size: 96px;
  line-height: 1;
  color: rgba(255, 255, 255, 0.12);
  z-index: 0;
}
.tile-shot {
  position: absolute;
  inset: 0;
  width: 100%; height: 100%;
  object-fit: cover;
  object-position: top center;
  z-index: 0;
  animation: tile-shot-in var(--transition-speed) var(--ease-smooth);
}
.tile-shot--photo { object-position: center center; }

@keyframes tile-shot-in {
  from { opacity: 0; transform: scale(1.04); }
  to   { opacity: 1; transform: scale(1); }
}

/* "View details" hint on tile */
.proj-tile-hint {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 2;
  background: linear-gradient(180deg, transparent 50%, rgba(0, 0, 0, 0.55) 100%);
  color: #fff;
  font: 600 0.875rem var(--font-display);
  letter-spacing: var(--track-cta);
  text-transform: uppercase;
  opacity: 0;
  transition: opacity var(--transition-speed) var(--ease-smooth);
}
.proj-card:hover .proj-tile-hint,
.proj-card:focus-visible .proj-tile-hint { opacity: 1; }

/* Status badge (overlay top-right of tile) */
.proj-badge {
  position: absolute;
  top: var(--s-3);
  right: var(--s-3);
  display: inline-flex;
  align-items: center;
  gap: var(--s-2);
  padding: var(--s-2) var(--s-3);
  border-radius: var(--r-pill);
  background: rgba(0, 0, 0, 0.6);
  backdrop-filter: blur(12px);
  color: #fff;
  font: 600 0.7rem var(--font-display);
  letter-spacing: var(--track-cta);
  text-transform: uppercase;
  z-index: 3;
}
.proj-badge .dot {
  width: 6px; height: 6px; border-radius: 50%;
  background: currentColor;
  box-shadow: 0 0 0 3px rgba(255, 255, 255, 0.18);
}
.proj-badge.live { color: #22c55e; }
.proj-badge.soon { color: var(--cc-peach); }

/* Card body */
.proj-body {
  display: flex;
  flex-direction: column;
  flex: 1;
  padding: var(--s-5);
  gap: var(--s-2);
}
.proj-body h3 {
  font-family: var(--font-display);
  font-weight: 700;
  font-size: 1.15rem;
  color: var(--text-primary);
  letter-spacing: var(--track-tight);
}
.proj-body p {
  flex: 1;
  font-size: 0.9rem;
  line-height: 1.6;
  color: var(--text-secondary);
}
.proj-cat-tag {
  display: inline-block;
  font: 600 0.65rem var(--font-display);
  letter-spacing: var(--track-eyebrow);
  text-transform: uppercase;
  color: var(--text-muted);
}

/* Visit Live CTA + Coming Soon variants */
.proj-visit, .proj-soon {
  display: inline-flex;
  align-items: center;
  gap: var(--s-2);
  margin-top: var(--s-3);
  padding: var(--s-3) var(--s-4);
  border-radius: var(--r-pill);
  font: 600 0.85rem var(--font-display);
  letter-spacing: var(--track-cta);
  align-self: flex-start;
  transition: transform var(--transition-speed) var(--ease-smooth),
              box-shadow var(--transition-speed) var(--ease-smooth);
}
.proj-visit {
  background: var(--grad-cta);
  color: #fff;
  box-shadow: var(--shadow-cta);
}
.proj-visit:hover {
  transform: translateY(-2px);
  box-shadow: var(--shadow-cta-h);
}
.proj-soon {
  background: transparent;
  border: 1px solid var(--border-color);
  color: var(--text-secondary);
}
```

- [ ] **Step 4: Run assertion — expect PASS**

```powershell
node check.js "file:///C:/Projects/ai-product-studio/option-a-threejs-gsap-tailwind/site/projects.html" assert_card_glass.js
```

Expected: `ok: true`, `backdropFilter: "blur(20px) saturate(1.2)"`.

- [ ] **Step 5: Projects regression check (critical for Approach B)**

Reuse the existing card assertion if present, otherwise create `C:\Projects\_build\assert_projects_cards.js`:

```js
module.exports = async function (page) {
  await new Promise(r => setTimeout(r, 1500));
  const cards = await page.$$eval('.proj-card[data-slug]', els => els.length);
  await page.evaluate(() => {
    const c = document.querySelector('.proj-card[data-slug="career-builder"]')
           || document.querySelector('.proj-card[data-slug]');
    if (c) c.click();
  });
  await new Promise(r => setTimeout(r, 700));
  const modalOpen = await page.evaluate(() => !!document.querySelector('.proj-modal.is-open'));
  return { ok: cards >= 6 && modalOpen, cards, modalOpen };
};
```

Run:
```powershell
node check.js "file:///C:/Projects/ai-product-studio/option-a-threejs-gsap-tailwind/site/projects.html" assert_projects_cards.js
```

Expected: `ok: true`, `cards: 6`, `modalOpen: true`.

- [ ] **Step 6: Visual screenshot**

```powershell
node screenshot.js "file:///C:/Projects/ai-product-studio/option-a-threejs-gsap-tailwind/site/projects.html" "_proj_after_card_glass.png" 1280 1800
```

Open. Cards should now have visible backdrop blur + warm-tinted shadow.

- [ ] **Step 7: Commit**

```bash
git add option-a-threejs-gsap-tailwind/site/css/components/card.css
git commit -m "feat(design-system): rewrite card.css as glass-morphism (selectors preserved)"
git push
```

---

## Task 4: Rewrite `components/modal.css` as glass panel

**Files:**
- Modify (rewrite): `option-a-threejs-gsap-tailwind/site/css/components/modal.css`

Same selector names. Glass panel + warm-tinted shadow.

- [ ] **Step 1: Rewrite `css/components/modal.css`**

```css
/* CoCreate · detail modal — glass panel rewrite.
   Selectors preserved (.proj-modal*, body.proj-modal-open, @keyframes pm-*) */

.proj-modal {
  position: fixed;
  inset: 0;
  z-index: var(--z-modal);
  display: none;
  align-items: center;
  justify-content: center;
  padding: var(--s-5);
}
.proj-modal.is-open { display: flex; animation: pm-fade var(--transition-speed) var(--ease-smooth); }

body.proj-modal-open { overflow: hidden; }

.proj-modal__backdrop {
  position: absolute;
  inset: 0;
  z-index: var(--z-modal-backdrop);
  background: rgba(13, 5, 0, 0.78);
  backdrop-filter: blur(8px);
}

.proj-modal__panel {
  position: relative;
  z-index: calc(var(--z-modal) + 1);
  max-width: 720px;
  width: 100%;
  max-height: calc(100vh - 2 * var(--s-5));
  overflow-y: auto;
  background: var(--bg-card);
  border: 1px solid var(--border-color);
  border-radius: var(--r-lg);
  backdrop-filter: blur(24px) saturate(140%);
  -webkit-backdrop-filter: blur(24px) saturate(140%);
  box-shadow: var(--shadow-lg);
  animation: pm-rise var(--transition-speed) var(--ease-out);
}

.proj-modal__close {
  position: absolute;
  top: var(--s-4);
  right: var(--s-4);
  width: 36px;
  height: 36px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: var(--r-pill);
  background: rgba(0, 0, 0, 0.4);
  color: #fff;
  z-index: 2;
  transition: background var(--transition-speed) var(--ease-smooth);
}
.proj-modal__close:hover { background: var(--primary); }

.proj-modal__media {
  position: relative;
  aspect-ratio: 16 / 9;
  overflow: hidden;
  border-top-left-radius: var(--r-lg);
  border-top-right-radius: var(--r-lg);
}
.proj-modal__media .tile-shot,
.proj-modal__media .proj-tile { aspect-ratio: 16 / 9; }

.proj-modal__body {
  padding: var(--s-6);
}
.proj-modal__body h2 {
  font-family: var(--font-display);
  font-weight: 700;
  font-size: 1.75rem;
  letter-spacing: var(--track-tight);
  margin-top: var(--s-2);
}
.proj-modal__body .proj-cat-tag {
  display: inline-block;
}

.proj-modal__overview {
  margin-top: var(--s-4);
  color: var(--text-secondary);
  line-height: 1.6;
}

.proj-modal__highlights {
  margin-top: var(--s-5);
  display: grid;
  gap: var(--s-3);
  list-style: none;
  padding: 0;
}
.proj-modal__highlights li {
  display: flex;
  align-items: flex-start;
  gap: var(--s-3);
  color: var(--text-primary);
  font-size: 0.95rem;
}
.proj-modal__highlights svg {
  flex-shrink: 0;
  color: var(--accent);
}

.proj-modal__actions {
  margin-top: var(--s-6);
  display: flex;
  gap: var(--s-3);
  flex-wrap: wrap;
}

@keyframes pm-fade {
  from { opacity: 0; }
  to   { opacity: 1; }
}
@keyframes pm-rise {
  from { opacity: 0; transform: translateY(20px) scale(0.98); }
  to   { opacity: 1; transform: translateY(0) scale(1); }
}

@media (max-width: 520px) {
  .proj-modal { padding: 0; }
  .proj-modal__panel { max-height: 100vh; border-radius: 0; }
  .proj-modal__media { border-radius: 0; }
  .proj-modal__body { padding: var(--s-5); }
}
```

- [ ] **Step 2: Projects regression check**

```powershell
node check.js "file:///C:/Projects/ai-product-studio/option-a-threejs-gsap-tailwind/site/projects.html" assert_projects_cards.js
```

Expected: `ok: true`. Modal still opens, no console errors.

- [ ] **Step 3: Visual screenshot of opened modal**

Create `C:\Projects\_build\screenshot_modal_open.js`:

```js
const puppeteer = require('puppeteer-core');
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
(async () => {
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new',
    args: ['--no-sandbox', '--disable-gpu', '--hide-scrollbars'],
    defaultViewport: { width: 1280, height: 900 } });
  const page = await browser.newPage();
  await page.goto('file:///C:/Projects/ai-product-studio/option-a-threejs-gsap-tailwind/site/projects.html', { waitUntil: 'networkidle2' }).catch(()=>{});
  await new Promise(r => setTimeout(r, 1500));
  await page.evaluate(() => {
    const c = document.querySelector('.proj-card[data-slug]'); if (c) c.click();
  });
  await new Promise(r => setTimeout(r, 800));
  await page.screenshot({ path: '_modal_after_glass.png' });
  await browser.close();
})();
```

Run:
```powershell
node screenshot_modal_open.js
```

Open `_modal_after_glass.png`. Modal must show as a glass panel with backdrop blur visible.

- [ ] **Step 4: Commit**

```bash
git add option-a-threejs-gsap-tailwind/site/css/components/modal.css
git commit -m "feat(design-system): rewrite modal.css as glass panel"
git push
```

---

## Task 5: Rewrite `components/button.css` (pill + shimmer-sweep)

**Files:**
- Modify (rewrite): `option-a-threejs-gsap-tailwind/site/css/components/button.css`

- [ ] **Step 1: Rewrite `css/components/button.css`**

```css
/* CoCreate · button component — pill + gradient + shimmer sweep on .btn--primary. */

.btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: var(--s-2);
  padding: var(--s-3) var(--s-5);
  border-radius: var(--r-pill);
  font-family: var(--font-display);
  font-weight: 600;
  font-size: 0.95rem;
  letter-spacing: -0.005em;
  text-decoration: none;
  cursor: pointer;
  transition: transform var(--transition-speed) var(--ease-smooth),
              box-shadow var(--transition-speed) var(--ease-smooth),
              background var(--transition-speed) var(--ease-smooth);
  position: relative;
  overflow: hidden;
  white-space: nowrap;
}

.btn--primary {
  background: var(--grad-cta);
  color: #fff;
  box-shadow: var(--shadow-cta);
}
.btn--primary::before {
  content: '';
  position: absolute;
  top: 0;
  left: -100%;
  width: 100%;
  height: 100%;
  background: linear-gradient(90deg, transparent, rgba(255, 255, 255, 0.25), transparent);
  transition: left 0.6s var(--ease-smooth);
}
.btn--primary:hover {
  transform: translateY(-2px);
  box-shadow: var(--shadow-cta-h);
}
.btn--primary:hover::before { left: 100%; }

.btn--ghost {
  background: var(--bg-card);
  color: var(--text-primary);
  border: 1px solid var(--border-color);
  backdrop-filter: blur(20px);
  -webkit-backdrop-filter: blur(20px);
}
.btn--ghost:hover {
  border-color: var(--accent);
  background: var(--bg-card-hover);
  transform: translateY(-2px);
}

.btn--sm { padding: var(--s-2) var(--s-4); font-size: 0.85rem; }
.btn--lg { padding: var(--s-4) var(--s-6); font-size: 1.05rem; }
```

- [ ] **Step 2: Visual screenshot of projects page (has Visit Live buttons inside cards)**

```powershell
node screenshot.js "file:///C:/Projects/ai-product-studio/option-a-threejs-gsap-tailwind/site/projects.html" "_proj_after_button.png" 1280 1800
```

Confirm: buttons render. (Note: `.proj-visit` is styled in `card.css` — separate from `.btn`. This task only changes the `.btn*` classes.)

- [ ] **Step 3: Commit**

```bash
git add option-a-threejs-gsap-tailwind/site/css/components/button.css
git commit -m "feat(design-system): rewrite button.css as pill + shimmer-sweep"
git push
```

---

## Task 6: Rewrite `components/section.css` (eyebrow 0.18em, display headings, container)

**Files:**
- Modify (rewrite): `option-a-threejs-gsap-tailwind/site/css/components/section.css`

- [ ] **Step 1: Rewrite `css/components/section.css`**

```css
/* CoCreate · section primitives — container, headings, lede.
   .eyebrow now lives in base.css for cross-component reuse.
   Section vertical rhythm uses --sec-py. */

.section {
  position: relative;
  padding-top: var(--sec-py);
  padding-bottom: var(--sec-py);
}

.container {
  width: 100%;
  max-width: var(--container-max);
  margin-inline: auto;
  padding-inline: var(--container-px);
  position: relative;
  z-index: 1;
}

.display-xl {
  font-family: var(--font-display);
  font-weight: 700;
  font-size: clamp(2.5rem, 6vw, 5rem);
  letter-spacing: var(--track-display);
  line-height: 1.02;
}

.display-l {
  font-family: var(--font-display);
  font-weight: 700;
  font-size: clamp(1.75rem, 3.5vw, 3rem);
  letter-spacing: var(--track-tight);
  line-height: 1.1;
}

.display-m {
  font-family: var(--font-display);
  font-weight: 600;
  font-size: 1.75rem;
  letter-spacing: var(--track-tight);
  line-height: 1.2;
}

.lede {
  font-family: var(--font-body);
  font-size: 1.125rem;
  line-height: 1.7;
  color: var(--text-secondary);
  max-width: 60ch;
}

/* Gradient phrase utility — applied to a single <span> per page */
.gradient-word {
  background: var(--grad-brand);
  -webkit-background-clip: text;
  background-clip: text;
  color: transparent;
  display: inline-block;
}
```

- [ ] **Step 2: Render check (no specific assertion — visual confirmation)**

```powershell
node screenshot.js "file:///C:/Projects/ai-product-studio/option-a-threejs-gsap-tailwind/site/projects.html" "_proj_after_section.png" 1280 1800
```

Open. Page should still look correct. Eyebrows (if any on projects page) now appear with 0.18em tracking.

- [ ] **Step 3: Commit**

```bash
git add option-a-threejs-gsap-tailwind/site/css/components/section.css
git commit -m "feat(design-system): rewrite section.css with 0.18em eyebrows + .gradient-word"
git push
```

---

## Task 7: Rewrite `components/badge.css` + `components/stat.css`

**Files:**
- Modify (rewrite): `option-a-threejs-gsap-tailwind/site/css/components/badge.css`
- Modify (rewrite): `option-a-threejs-gsap-tailwind/site/css/components/stat.css`

- [ ] **Step 1: Rewrite `css/components/badge.css`**

```css
/* CoCreate · pills + trust strip — glass-pill row in the hero. */

.pill {
  display: inline-flex;
  align-items: center;
  gap: var(--s-2);
  padding: var(--s-2) var(--s-4);
  border-radius: var(--r-pill);
  background: var(--bg-card);
  border: 1px solid var(--border-color);
  backdrop-filter: blur(20px);
  -webkit-backdrop-filter: blur(20px);
  font: 600 0.7rem var(--font-display);
  letter-spacing: var(--track-eyebrow);
  text-transform: uppercase;
  color: var(--text-secondary);
}
.pill .dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: #22c55e;
  box-shadow: 0 0 0 3px rgba(34, 197, 94, 0.2);
}

.trust-strip {
  display: inline-flex;
  align-items: center;
  gap: var(--s-4);
  padding: var(--s-3) var(--s-5);
  border-radius: var(--r-pill);
  background: var(--bg-card);
  border: 1px solid var(--border-color);
  backdrop-filter: blur(20px);
  -webkit-backdrop-filter: blur(20px);
  color: var(--text-secondary);
  font-size: 0.9rem;
  flex-wrap: wrap;
  justify-content: center;
}
.trust-strip__item {
  display: inline-flex;
  align-items: center;
  gap: var(--s-2);
}
.trust-strip__item strong {
  color: var(--text-primary);
  font-weight: 700;
}
.trust-strip__sep {
  color: var(--text-muted);
  opacity: 0.5;
}
```

- [ ] **Step 2: Rewrite `css/components/stat.css`**

```css
/* CoCreate · stat block — Space Grotesk gradient numerals on glass cards. */

.stats {
  display: grid;
  gap: var(--s-5);
  grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
  margin-top: var(--s-7);
}

.stat {
  padding: var(--s-6);
  background: var(--bg-card);
  border: 1px solid var(--border-color);
  border-radius: var(--r-lg);
  backdrop-filter: blur(20px);
  -webkit-backdrop-filter: blur(20px);
  box-shadow: var(--shadow-md);
  transition: transform var(--transition-speed) var(--ease-smooth),
              border-color var(--transition-speed) var(--ease-smooth),
              box-shadow var(--transition-speed) var(--ease-smooth);
}
.stat:hover {
  transform: translateY(-4px);
  border-color: var(--accent);
  box-shadow: var(--shadow-lg);
}

.stat__num {
  font-family: var(--font-stat);
  font-weight: 700;
  font-size: clamp(2.5rem, 5vw, 3.5rem);
  line-height: 1;
  letter-spacing: var(--track-tight);
  background: var(--grad-brand);
  -webkit-background-clip: text;
  background-clip: text;
  color: transparent;
}

.stat__label {
  margin-top: var(--s-2);
  font-family: var(--font-display);
  font-weight: 600;
  font-size: 1rem;
  color: var(--text-primary);
}

.stat__caption {
  margin-top: var(--s-2);
  font-size: 0.9rem;
  line-height: 1.6;
  color: var(--text-secondary);
}
```

- [ ] **Step 3: Visual confirm + commit**

```powershell
node screenshot.js "file:///C:/Projects/ai-product-studio/option-a-threejs-gsap-tailwind/site/projects.html" "_proj_after_badge_stat.png" 1280 1800
```

Projects page still renders (it has no stats but should be unaffected). Commit:

```bash
git add option-a-threejs-gsap-tailwind/site/css/components/badge.css \
        option-a-threejs-gsap-tailwind/site/css/components/stat.css
git commit -m "feat(design-system): rewrite badge.css + stat.css (glass pills, gradient numerals)"
git push
```

---

## Task 8: Rewrite the small components — marquee, steps, quote, accordion, cinematic, cta

**Files (all rewritten):**
- `option-a-threejs-gsap-tailwind/site/css/components/marquee.css`
- `option-a-threejs-gsap-tailwind/site/css/components/steps.css`
- `option-a-threejs-gsap-tailwind/site/css/components/quote.css`
- `option-a-threejs-gsap-tailwind/site/css/components/accordion.css`
- `option-a-threejs-gsap-tailwind/site/css/components/cinematic.css`
- `option-a-threejs-gsap-tailwind/site/css/components/cta.css`

- [ ] **Step 1: Rewrite `css/components/marquee.css`**

```css
/* CoCreate · wordmark marquee — slower opacity, fade mask. */
.marquee {
  overflow: hidden;
  position: relative;
  mask-image: linear-gradient(90deg, transparent, #000 12%, #000 88%, transparent);
  -webkit-mask-image: linear-gradient(90deg, transparent, #000 12%, #000 88%, transparent);
}
.marquee__track {
  display: flex;
  gap: var(--s-7);
  width: max-content;
  animation: marquee-scroll 40s linear infinite;
}
.marquee__item {
  font-family: var(--font-display);
  font-weight: 700;
  font-size: 1.25rem;
  letter-spacing: var(--track-tight);
  color: var(--text-secondary);
  opacity: 0.7;
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

- [ ] **Step 2: Rewrite `css/components/steps.css`**

```css
/* CoCreate · How-it-works steps — glass circles, active step rings in accent. */
.steps {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
  gap: var(--s-6);
  margin-top: var(--s-7);
  position: relative;
}
.step {
  position: relative;
  text-align: center;
  padding: var(--s-5);
}
.step__num {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 64px;
  height: 64px;
  border-radius: var(--r-pill);
  background: var(--bg-card);
  border: 1px solid var(--border-color);
  backdrop-filter: blur(20px);
  -webkit-backdrop-filter: blur(20px);
  font-family: var(--font-stat);
  font-weight: 700;
  font-size: 1.5rem;
  color: var(--text-primary);
  margin-bottom: var(--s-4);
  transition: all var(--transition-speed) var(--ease-smooth);
}
.step--active .step__num {
  background: var(--grad-cta);
  border-color: transparent;
  color: #fff;
  box-shadow: 0 0 0 4px rgba(255, 195, 106, 0.25), var(--shadow-cta);
}
.step__title {
  font-family: var(--font-display);
  font-weight: 700;
  font-size: 1.25rem;
  letter-spacing: var(--track-tight);
  margin-bottom: var(--s-3);
}
.step__body {
  color: var(--text-secondary);
  line-height: 1.7;
}
```

- [ ] **Step 3: Rewrite `css/components/quote.css`**

```css
/* CoCreate · founder quote — glass card, gradient open-quote, accent avatar ring. */
.quote {
  display: flex;
  align-items: flex-start;
  gap: var(--s-5);
  padding: var(--s-6);
  background: var(--bg-card);
  border: 1px solid var(--border-color);
  border-radius: var(--r-lg);
  backdrop-filter: blur(20px);
  -webkit-backdrop-filter: blur(20px);
  position: relative;
  max-width: 880px;
  margin-inline: auto;
}
.quote::before {
  content: '"';
  position: absolute;
  top: -32px;
  left: var(--s-5);
  font-family: var(--font-display);
  font-weight: 800;
  font-size: 6rem;
  line-height: 1;
  background: var(--grad-brand);
  -webkit-background-clip: text;
  background-clip: text;
  color: transparent;
}
.quote__avatar {
  width: 64px;
  height: 64px;
  border-radius: var(--r-pill);
  border: 2px solid var(--accent);
  padding: 4px;
  background: var(--bg-card);
  flex-shrink: 0;
}
.quote__text {
  font-family: var(--font-display);
  font-weight: 500;
  font-size: 1.15rem;
  line-height: 1.6;
  color: var(--text-primary);
}
.quote__attrib {
  margin-top: var(--s-4);
  color: var(--text-muted);
  font-size: 0.95rem;
}
.quote__attrib strong { color: var(--text-primary); font-weight: 600; }
@media (max-width: 640px) {
  .quote { flex-direction: column; align-items: center; text-align: center; }
}
```

- [ ] **Step 4: Rewrite `css/components/accordion.css`**

```css
/* CoCreate · FAQ accordion — glass cards, peach + toggle that rotates 45deg open. */
.accordion {
  display: grid;
  gap: var(--s-3);
  max-width: 800px;
  margin-inline: auto;
}
.accordion__item {
  background: var(--bg-card);
  border: 1px solid var(--border-color);
  border-radius: var(--r-md);
  backdrop-filter: blur(20px);
  -webkit-backdrop-filter: blur(20px);
  overflow: hidden;
  transition: border-color var(--transition-speed) var(--ease-smooth);
}
.accordion__item[open] { border-color: var(--accent); }
.accordion__item:hover { border-color: var(--accent); }

.accordion__q {
  list-style: none;
  cursor: pointer;
  padding: var(--s-4) var(--s-5);
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--s-3);
  font-family: var(--font-display);
  font-weight: 600;
  font-size: 1.05rem;
  color: var(--text-primary);
}
.accordion__q::-webkit-details-marker { display: none; }
.accordion__q::after {
  content: '+';
  font-family: var(--font-display);
  font-weight: 300;
  font-size: 1.5rem;
  line-height: 1;
  color: var(--accent);
  transition: transform var(--transition-speed) var(--ease-smooth);
}
.accordion__item[open] .accordion__q::after { transform: rotate(45deg); }

.accordion__a {
  padding: 0 var(--s-5) var(--s-5);
  color: var(--text-secondary);
  line-height: 1.7;
}
```

- [ ] **Step 5: Rewrite `css/components/cinematic.css`**

```css
/* CoCreate · cinematic section overlay — no longer paints its own background.
   The body's .cc-bg-fixed::before already shows the photo. This section just
   reserves vertical space and overlays content. */

.cinematic {
  position: relative;
  min-height: 70vh;
  display: flex;
  align-items: center;
  padding-top: var(--sec-py);
  padding-bottom: var(--sec-py);
}
.cinematic__inner {
  width: 100%;
  max-width: var(--container-max);
  margin-inline: auto;
  padding-inline: var(--container-px);
  text-align: center;
  position: relative;
  z-index: 1;
}
.cinematic__title {
  font-family: var(--font-display);
  font-weight: 700;
  font-size: clamp(2rem, 4.5vw, 3.5rem);
  letter-spacing: var(--track-display);
  line-height: 1.05;
}
.cinematic__sub {
  margin: var(--s-4) auto 0;
  max-width: 56ch;
  color: var(--text-secondary);
  font-size: 1.05rem;
  line-height: 1.7;
}
.cinematic__cta {
  margin-top: var(--s-5);
  display: inline-flex;
  gap: var(--s-3);
  flex-wrap: wrap;
  justify-content: center;
}
```

- [ ] **Step 6: Rewrite `css/components/cta.css`**

```css
/* CoCreate · final CTA band — transparent so cinematic photo shows through. */
.cta-band {
  position: relative;
  padding-top: var(--sec-py);
  padding-bottom: var(--sec-py);
  text-align: center;
  background: transparent;
}
.cta-band__title {
  font-family: var(--font-display);
  font-weight: 700;
  font-size: clamp(2rem, 4vw, 3rem);
  letter-spacing: var(--track-display);
  line-height: 1.05;
}
.cta-band__sub {
  margin: var(--s-4) auto 0;
  max-width: 56ch;
  color: var(--text-secondary);
  font-size: 1.05rem;
  line-height: 1.7;
}
.cta-band__actions {
  margin-top: var(--s-6);
  display: inline-flex;
  gap: var(--s-3);
  flex-wrap: wrap;
  justify-content: center;
}
```

- [ ] **Step 7: Projects regression check + commit**

```powershell
node check.js "file:///C:/Projects/ai-product-studio/option-a-threejs-gsap-tailwind/site/projects.html" assert_projects_cards.js
```
Expected: `ok: true`.

```bash
git add option-a-threejs-gsap-tailwind/site/css/components/marquee.css \
        option-a-threejs-gsap-tailwind/site/css/components/steps.css \
        option-a-threejs-gsap-tailwind/site/css/components/quote.css \
        option-a-threejs-gsap-tailwind/site/css/components/accordion.css \
        option-a-threejs-gsap-tailwind/site/css/components/cinematic.css \
        option-a-threejs-gsap-tailwind/site/css/components/cta.css
git commit -m "feat(design-system): rewrite marquee/steps/quote/accordion/cinematic/cta components"
git push
```

---

## Task 9: Create 4 net-new component primitives

**Files (all created):**
- Create: `option-a-threejs-gsap-tailwind/site/css/components/cc-bg.css`
- Create: `option-a-threejs-gsap-tailwind/site/css/components/cc-tabs.css`
- Create: `option-a-threejs-gsap-tailwind/site/css/components/cc-fab.css`
- Create: `option-a-threejs-gsap-tailwind/site/css/components/partner-card.css`

- [ ] **Step 1: Create `css/components/cc-bg.css`**

```css
/* CoCreate · signature fixed cinematic background.
   Apply by adding class="cc-bg-fixed" to <body>.
   Light themes override body.cc-bg-fixed::after with a cream gradient. */

.cc-bg-fixed::before {
  content: '';
  position: fixed;
  inset: 0;
  background: url('assets/cocreate_bg.png') center calc(100% + var(--cc-bg-y, 0px)) / cover no-repeat;
  z-index: -2;
  pointer-events: none;
  will-change: background-position;
}
.cc-bg-fixed::after {
  content: '';
  position: fixed;
  inset: 0;
  z-index: -1;
  pointer-events: none;
  background:
    radial-gradient(ellipse 120% 100% at 50% 100%, transparent 30%, rgba(26, 10, 0, 0.6) 100%),
    linear-gradient(90deg, rgba(26, 10, 0, 0.65) 0%, rgba(26, 10, 0, 0.3) 40%, transparent 60%),
    linear-gradient(180deg, rgba(26, 10, 0, 0.5) 0%, transparent 40%);
}
```

- [ ] **Step 2: Create `css/components/cc-tabs.css`**

```css
/* CoCreate · status tabs (pill rail, active state = gradient pill). */

.cc-tabs {
  display: inline-flex;
  align-items: center;
  gap: var(--s-2);
  padding: var(--s-2);
  background: var(--bg-card);
  border: 1px solid var(--border-color);
  border-radius: var(--r-pill);
  backdrop-filter: blur(20px);
  -webkit-backdrop-filter: blur(20px);
  flex-wrap: wrap;
}
.cc-tab {
  padding: var(--s-2) var(--s-5);
  border-radius: var(--r-pill);
  font-family: var(--font-display);
  font-weight: 500;
  font-size: 0.875rem;
  letter-spacing: var(--track-cta);
  text-transform: uppercase;
  color: var(--text-secondary);
  cursor: pointer;
  transition: all var(--transition-speed) var(--ease-smooth);
}
.cc-tab:hover { color: var(--text-primary); }
.cc-tab.is-active {
  background: var(--grad-cta);
  color: #fff;
  box-shadow: var(--shadow-cta);
}
.cc-tab__count {
  margin-left: var(--s-2);
  opacity: 0.7;
  font-size: 0.75em;
}

/* Cards hidden by the tabs filter */
.proj-card.is-hidden { display: none; }
```

- [ ] **Step 3: Create `css/components/cc-fab.css`**

```css
/* CoCreate · chat FAB (visual re-skin of the existing chat-widget trigger). */

.cc-fab {
  position: fixed;
  right: var(--s-5);
  bottom: var(--s-5);
  z-index: 90;
  width: 56px;
  height: 56px;
  border-radius: var(--r-pill);
  background: var(--grad-cta);
  color: #fff;
  box-shadow: var(--shadow-cta);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition: transform var(--transition-speed) var(--ease-smooth),
              box-shadow var(--transition-speed);
  border: 0;
}
.cc-fab:hover {
  transform: translateY(-2px) scale(1.06);
  box-shadow: var(--shadow-cta-h);
}
.cc-fab svg {
  width: 24px;
  height: 24px;
  stroke: currentColor;
  stroke-width: 2;
  stroke-linecap: round;
  stroke-linejoin: round;
  fill: none;
}
@media (max-width: 560px) { .cc-fab { display: none; } }
```

- [ ] **Step 4: Create `css/components/partner-card.css`**

```css
/* CoCreate · partner-card — larger glass-morphism card variant for hero callouts. */

.partner-card {
  padding: var(--s-6);
  background: var(--bg-card);
  border: 1px solid var(--border-color);
  border-radius: var(--r-lg);
  backdrop-filter: blur(20px);
  -webkit-backdrop-filter: blur(20px);
  transition: transform var(--transition-speed) var(--ease-smooth),
              border-color var(--transition-speed) var(--ease-smooth),
              box-shadow var(--transition-speed) var(--ease-smooth);
}
.partner-card:hover {
  transform: translateY(-8px) scale(1.02);
  border-color: var(--accent);
  box-shadow: var(--shadow-lg);
}
```

- [ ] **Step 5: Commit**

```bash
git add option-a-threejs-gsap-tailwind/site/css/components/cc-bg.css \
        option-a-threejs-gsap-tailwind/site/css/components/cc-tabs.css \
        option-a-threejs-gsap-tailwind/site/css/components/cc-fab.css \
        option-a-threejs-gsap-tailwind/site/css/components/partner-card.css
git commit -m "feat(design-system): add cc-bg, cc-tabs, cc-fab, partner-card primitives"
git push
```

---

## Task 10: JS edits — projects-data.js + projects-render.js + cinematic.js

**Files:**
- Modify: `option-a-threejs-gsap-tailwind/site/js/projects-data.js` — adds default-fill rule for `status`
- Modify: `option-a-threejs-gsap-tailwind/site/js/projects-render.js` — emits `data-status` attribute
- Modify: `option-a-threejs-gsap-tailwind/site/js/cinematic.js` — parallax via CSS variable

- [ ] **Step 1: Modify `js/projects-data.js`**

At the END of the file, AFTER the closing `;` of the `window.PROJECTS_DATA = [...]` assignment, append:

```js
/* Wave A — default-fill status field per project.
   "live" if liveUrl set (and not '#'), else "building".
   CEO can override per project by setting status: 'launching' on a record. */
(function () {
  (window.PROJECTS_DATA || []).forEach(function (cat) {
    (cat.projects || []).forEach(function (p) {
      if (!p.status) {
        p.status = (p.liveUrl && p.liveUrl !== '#') ? 'live' : 'building';
      }
    });
  });
})();
```

- [ ] **Step 2: Modify `js/projects-render.js`**

Find the `productCardHTML` function. Locate the line that opens the outer card div, currently:

```js
'<div class="proj-card" data-slug="' + esc(p.slug || '') + '" role="button" tabindex="0" aria-label="View details for ' + esc(p.name) + '">' +
```

Replace it with:

```js
'<div class="proj-card" data-slug="' + esc(p.slug || '') + '" data-status="' + esc(p.status || (p.liveUrl && p.liveUrl !== '#' ? 'live' : 'building')) + '" role="button" tabindex="0" aria-label="View details for ' + esc(p.name) + '">' +
```

- [ ] **Step 3: Modify `js/cinematic.js`**

Replace the entire file content with:

```js
/* CoCreate · cinematic parallax — drives the --cc-bg-y CSS variable
   on <html> so body.cc-bg-fixed::before moves on scroll.
   No-op if GSAP/ScrollTrigger absent. Honours reduced-motion. */
(function () {
  function init() {
    if (typeof window === 'undefined') return;
    if (!window.gsap || !window.ScrollTrigger) return;
    if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    var cinematic = document.querySelector('.cinematic');
    if (!cinematic) return;
    // Drive --cc-bg-y on <html> from 0px to 40px as the cinematic section scrolls.
    // background-position: center calc(100% + var(--cc-bg-y)) is in cc-bg.css.
    var html = document.documentElement;
    window.gsap.to(html, {
      '--cc-bg-y': '40px',
      ease: 'none',
      scrollTrigger: {
        trigger: cinematic,
        start: 'top bottom',
        end: 'bottom top',
        scrub: true
      }
    });
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
```

- [ ] **Step 4: Confirm projects-render still produces valid card HTML**

Create `C:\Projects\_build\assert_card_data_status.js`:

```js
module.exports = async function (page) {
  await new Promise(r => setTimeout(r, 1500));
  const result = await page.evaluate(() => {
    const cards = Array.from(document.querySelectorAll('.proj-card[data-slug]'));
    if (!cards.length) return { error: 'no cards' };
    const statuses = cards.map(c => c.getAttribute('data-status'));
    const allValid = statuses.every(s => s === 'live' || s === 'building' || s === 'launching');
    const liveCount = statuses.filter(s => s === 'live').length;
    return { cardCount: cards.length, statuses, allValid, liveCount };
  });
  return { ok: !result.error && result.allValid && result.cardCount >= 6, ...result };
};
```

Run:
```powershell
node check.js "file:///C:/Projects/ai-product-studio/option-a-threejs-gsap-tailwind/site/projects.html" assert_card_data_status.js
```

Expected: `ok: true`, `cardCount: 6`, `allValid: true`.

- [ ] **Step 5: Commit**

```bash
git add option-a-threejs-gsap-tailwind/site/js/projects-data.js \
        option-a-threejs-gsap-tailwind/site/js/projects-render.js \
        option-a-threejs-gsap-tailwind/site/js/cinematic.js
git commit -m "feat(home): add status field + data-status emit + parallax via CSS var"
git push
```

---

## Task 11: Rewrite `index.html` — Hero (Block 1) + head + cc-bg-fixed body

**Files:**
- Modify: `option-a-threejs-gsap-tailwind/site/index.html`
- Create (verification): `C:\Projects\_build\assert_home_hero_v2.js`

This task replaces ONLY the `<head>` and Block 1 of `index.html`. Subsequent tasks (12–15) replace the remaining blocks. Keep the existing nav and footer untouched.

- [ ] **Step 1: Read current `<head>` to understand the link order**

```bash
sed -n '1,80p' /c/Projects/ai-product-studio/option-a-threejs-gsap-tailwind/site/index.html
```

- [ ] **Step 2: Update `<head>` — add Space Grotesk + load all new component CSS in order**

Locate the Google Fonts `<link>` and replace with:

```html
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=DM+Sans:ital,opsz,wght@0,9..40,400;0,9..40,500;0,9..40,600;0,9..40,700;1,9..40,400&family=Outfit:wght@400;500;600;700;800&family=Space+Grotesk:wght@500;600;700&display=swap" rel="stylesheet">
```

Then locate the existing component CSS `<link>` block and replace with this exact order:

```html
  <link rel="stylesheet" href="css/themes/ember.css">
  <link rel="stylesheet" href="css/tokens.css">
  <link rel="stylesheet" href="css/base.css">
  <link rel="stylesheet" href="css/components/cc-bg.css">
  <link rel="stylesheet" href="css/components/section.css">
  <link rel="stylesheet" href="css/components/button.css">
  <link rel="stylesheet" href="css/components/badge.css">
  <link rel="stylesheet" href="css/components/stat.css">
  <link rel="stylesheet" href="css/components/marquee.css">
  <link rel="stylesheet" href="css/components/card.css">
  <link rel="stylesheet" href="css/components/modal.css">
  <link rel="stylesheet" href="css/components/cc-tabs.css">
  <link rel="stylesheet" href="css/components/steps.css">
  <link rel="stylesheet" href="css/components/quote.css">
  <link rel="stylesheet" href="css/components/accordion.css">
  <link rel="stylesheet" href="css/components/cinematic.css">
  <link rel="stylesheet" href="css/components/cta.css">
  <link rel="stylesheet" href="css/components/partner-card.css">
  <link rel="stylesheet" href="css/components/cc-fab.css">
  <link rel="stylesheet" href="css/pages/home.css">
```

- [ ] **Step 3: Add `class="cc-bg-fixed"` to `<body>`**

Locate the `<body>` opening tag. If it has existing classes, append `cc-bg-fixed`. If it has no class attribute, add `class="cc-bg-fixed"`.

- [ ] **Step 4: Replace Block 1 (Hero)**

Find the existing hero `<section class="home-hero">` block (typically opens with `<section class="home-hero">` and closes with the matching `</section>` before Block 2 marquee). Replace with:

```html
  <!-- BLOCK 1 — HERO (centered, single-gradient phrase on CoCreate) -->
  <section class="home-hero">
    <div class="container">
      <div class="home-hero__inner">
        <span class="pill home-hero__eyebrow"><span class="dot"></span>AI-Powered Product Studio</span>
        <h1 class="home-hero__h1">Imagine. <span class="gradient-word">CoCreate</span>. Done!</h1>
        <p class="home-hero__sub">Your AI Partner. Launch your business in 2 weeks.</p>
        <div class="home-hero__ctas">
          <a class="btn btn--primary btn--lg" href="https://calendly.com/cocreateceo/30min">Let's CoCreate</a>
          <a class="btn btn--ghost btn--lg" href="/projects.html">See what we've built</a>
        </div>
        <div class="trust-strip home-hero__trust">
          <span class="trust-strip__item">⚡ <strong>2 weeks</strong> to launch</span>
          <span class="trust-strip__sep">·</span>
          <span class="trust-strip__item"><strong>$0</strong> upfront</span>
          <span class="trust-strip__sep">·</span>
          <span class="trust-strip__item"><strong id="js-live-count">17</strong> products shipped</span>
        </div>
      </div>
    </div>
  </section>
```

- [ ] **Step 5: Rewrite `css/pages/home.css` — hero rules first (other block rules append in later tasks)**

```css
/* CoCreate · homepage layout — Wave A. */

.home-hero {
  position: relative;
  padding-top: calc(var(--nav-height) + var(--s-9));
  padding-bottom: var(--s-9);
  min-height: 90vh;
  display: flex;
  align-items: center;
}
.home-hero__inner {
  text-align: center;
  max-width: 880px;
  margin-inline: auto;
}
.home-hero__eyebrow {
  margin-bottom: var(--s-5);
}
.home-hero__h1 {
  font-family: var(--font-display);
  font-weight: 800;
  font-size: clamp(2.5rem, 6vw, 5rem);
  letter-spacing: var(--track-display);
  line-height: 1.02;
  margin-bottom: var(--s-5);
}
.home-hero__sub {
  font-size: clamp(1.05rem, 2vw, 1.25rem);
  color: var(--text-secondary);
  max-width: 56ch;
  margin: 0 auto var(--s-6);
  line-height: 1.6;
}
.home-hero__ctas {
  display: inline-flex;
  gap: var(--s-3);
  flex-wrap: wrap;
  justify-content: center;
  margin-bottom: var(--s-7);
}
.home-hero__trust {
  display: inline-flex;
}
```

- [ ] **Step 6: Write the hero v2 assertion**

`C:\Projects\_build\assert_home_hero_v2.js`:

```js
module.exports = async function (page) {
  await new Promise(r => setTimeout(r, 1500));
  const state = await page.evaluate(() => {
    const body = document.body;
    const eyebrow = document.querySelector('.home-hero__eyebrow');
    const h1 = document.querySelector('.home-hero__h1');
    const gradient = document.querySelector('.home-hero__h1 .gradient-word');
    const sub = document.querySelector('.home-hero__sub');
    const ctas = document.querySelectorAll('.home-hero__ctas .btn');
    const trustItems = document.querySelectorAll('.home-hero__trust .trust-strip__item');
    return {
      bodyHasBgFixed: body.classList.contains('cc-bg-fixed'),
      eyebrowText: eyebrow ? eyebrow.textContent.trim() : null,
      h1Text: h1 ? h1.textContent.trim() : null,
      gradientCount: document.querySelectorAll('.home-hero__h1 .gradient-word').length,
      gradientWord: gradient ? gradient.textContent.trim() : null,
      subText: sub ? sub.textContent.trim() : null,
      ctaCount: ctas.length,
      trustCount: trustItems.length
    };
  });
  return { ok: state.bodyHasBgFixed
              && /AI-Powered Product Studio/i.test(state.eyebrowText || '')
              && /Imagine\..*CoCreate.*Done!/.test(state.h1Text || '')
              && state.gradientCount === 1
              && state.gradientWord === 'CoCreate'
              && /Launch your business in 2 weeks/.test(state.subText || '')
              && state.ctaCount === 2
              && state.trustCount === 3, ...state };
};
```

- [ ] **Step 7: Run assertion — expect PASS**

```powershell
node check.js "file:///C:/Projects/ai-product-studio/option-a-threejs-gsap-tailwind/site/index.html" assert_home_hero_v2.js
```

Expected: `ok: true`, `bodyHasBgFixed: true`, `gradientCount: 1`, `gradientWord: "CoCreate"`, `ctaCount: 2`, `trustCount: 3`.

- [ ] **Step 8: Visual screenshot**

```powershell
node screenshot.js "file:///C:/Projects/ai-product-studio/option-a-threejs-gsap-tailwind/site/index.html" "_home_after_hero.png" 1280 1200
```

Open. Hero must be centred with the cinematic photo visible behind it. Eyebrow pill + h1 (single gradient on "CoCreate") + sub + 2 pill CTAs + trust pill row.

- [ ] **Step 9: Commit**

```bash
git add option-a-threejs-gsap-tailwind/site/index.html \
        option-a-threejs-gsap-tailwind/site/css/pages/home.css
git commit -m "feat(home): hero (centered) + cc-bg-fixed body + Space Grotesk + new CSS link order"
git push
```

---

## Task 12: Rewrite `index.html` Blocks 2–3 (Marquee + Outcomes) + extend `home.css`

**Files:**
- Modify: `option-a-threejs-gsap-tailwind/site/index.html`
- Modify (append): `option-a-threejs-gsap-tailwind/site/css/pages/home.css`

- [ ] **Step 1: Replace Block 2 (Marquee) in `index.html`**

Find the existing `<!-- BLOCK 2 — WORDMARK MARQUEE -->` section. Replace with:

```html
  <!-- BLOCK 2 — WORDMARK MARQUEE -->
  <section class="home-marquee">
    <div class="marquee">
      <div class="marquee__track" id="js-marquee-track">
        <!-- populated by IIFE in Task 15 -->
      </div>
    </div>
  </section>
```

- [ ] **Step 2: Replace Block 3 (Outcomes)**

Find the existing `<!-- BLOCK 3 — OUTCOMES (3 STATS) -->` section. Replace with:

```html
  <!-- BLOCK 3 — OUTCOMES (3 STATS) -->
  <section class="section">
    <div class="container">
      <p class="eyebrow home-outcomes__eyebrow">Outcomes</p>
      <h2 class="display-l home-outcomes__h2">Built for founders who want to <span class="gradient-word">ship</span> &mdash; not just specs.</h2>
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
          <div class="stat__num" id="js-live-count-2">17</div>
          <div class="stat__label">products live</div>
          <div class="stat__caption">Shipped and serving real users today.</div>
        </div>
      </div>
    </div>
  </section>
```

- [ ] **Step 3: Append marquee + outcomes styles to `css/pages/home.css`**

Append at the END of the file:

```css

/* BLOCK 2 — marquee */
.home-marquee {
  padding-block: var(--s-6);
}

/* BLOCK 3 — outcomes */
.home-outcomes__eyebrow {
  text-align: center;
  display: block;
}
.home-outcomes__h2 {
  text-align: center;
  margin-top: var(--s-3);
  max-width: 22ch;
  margin-inline: auto;
}
```

- [ ] **Step 4: Visual confirm**

```powershell
node screenshot.js "file:///C:/Projects/ai-product-studio/option-a-threejs-gsap-tailwind/site/index.html" "_home_blocks_2_3.png" 1280 2400
```

Open. Marquee + outcomes stats should render (marquee items appear empty until the IIFE wires them in Task 15 — that's expected here).

- [ ] **Step 5: Commit**

```bash
git add option-a-threejs-gsap-tailwind/site/index.html \
        option-a-threejs-gsap-tailwind/site/css/pages/home.css
git commit -m "feat(home): blocks 2-3 (marquee + outcomes with gradient ship)"
git push
```

---

## Task 13: Rewrite Blocks 3.5–4 (Challenge + Featured Products with status tabs)

**Files:**
- Modify: `option-a-threejs-gsap-tailwind/site/index.html`
- Modify (append): `option-a-threejs-gsap-tailwind/site/css/pages/home.css`

- [ ] **Step 1: Replace Block 3.5 (The Challenge)**

Find the existing `<!-- BLOCK 3.5 — THE CHALLENGE -->` (or whatever existing comment marks it) and the dual-column cards beneath. Replace with:

```html
  <!-- BLOCK 3.5 — THE CHALLENGE (dual founder pain) -->
  <section class="section">
    <div class="container">
      <p class="eyebrow home-outcomes__eyebrow">The challenge</p>
      <h2 class="display-l home-outcomes__h2">Great ideas remain ideas.</h2>
      <div class="home-challenge__grid">
        <article class="cc-card home-challenge__card">
          <h3 class="display-m">Tech founders</h3>
          <p>Lack distribution and sales. Build amazing products but struggle with go-to-market. The product sits unused while competitors capture the market.</p>
        </article>
        <article class="cc-card home-challenge__card">
          <h3 class="display-m">Business founders</h3>
          <p>Have vision and market. Don't have a technical team. Months turn into years waiting for the right co-founder &mdash; and the window closes.</p>
        </article>
      </div>
      <p class="home-challenge__close"><em>Traditional agencies get paid whether you succeed or fail. Incentives are completely misaligned.</em></p>
    </div>
  </section>
```

- [ ] **Step 2: Replace Block 4 (Featured Products) with status tabs**

Find `<!-- BLOCK 4 — FEATURED PRODUCTS -->`. Replace with:

```html
  <!-- BLOCK 4 — FEATURED PRODUCTS (status tabs) -->
  <section class="section">
    <div class="container">
      <p class="eyebrow home-outcomes__eyebrow">Our work</p>
      <h2 class="display-l home-outcomes__h2">Real products. Real users. <span class="gradient-word">Shipped</span>.</h2>
      <div class="home-featured__tabs-wrap">
        <div class="cc-tabs" id="js-cc-tabs">
          <button class="cc-tab is-active" data-filter="all">Everything <span class="cc-tab__count" id="js-tab-count-all">0</span></button>
          <button class="cc-tab" data-filter="live">Live <span class="cc-tab__count" id="js-tab-count-live">0</span></button>
          <button class="cc-tab" data-filter="building">Building <span class="cc-tab__count" id="js-tab-count-building">0</span></button>
          <button class="cc-tab" data-filter="launching">Launching <span class="cc-tab__count" id="js-tab-count-launching">0</span></button>
        </div>
      </div>
      <div class="proj-grid" id="js-home-featured"></div>
      <p class="home-featured__cta-row">
        <a class="btn btn--ghost btn--lg" href="/projects.html">See all <span id="js-total-count">29</span> products</a>
      </p>
    </div>
  </section>
```

- [ ] **Step 3: Append challenge + featured styles to `css/pages/home.css`**

Append at the END:

```css

/* BLOCK 3.5 — challenge */
.home-challenge__grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(320px, 1fr));
  gap: var(--s-5);
  margin-top: var(--s-7);
}
.home-challenge__card {
  padding: var(--s-6);
}
.home-challenge__card h3 {
  margin-bottom: var(--s-3);
  letter-spacing: var(--track-tight);
}
.home-challenge__card p {
  color: var(--text-secondary);
  line-height: 1.7;
}
.home-challenge__close {
  margin-top: var(--s-6);
  text-align: center;
  color: var(--text-muted);
  font-size: 1.05rem;
}

/* BLOCK 4 — featured + tabs */
.home-featured__tabs-wrap {
  margin-top: var(--s-6);
  margin-bottom: var(--s-7);
  text-align: center;
}
.home-featured__cta-row {
  margin-top: var(--s-7);
  text-align: center;
}
```

- [ ] **Step 4: Visual confirm**

```powershell
node screenshot.js "file:///C:/Projects/ai-product-studio/option-a-threejs-gsap-tailwind/site/index.html" "_home_blocks_3_5_4.png" 1280 3200
```

Open. Challenge cards + status tabs rail should render (tab counts show `0` until the IIFE wires them in Task 15 — expected; cards grid empty for now — expected).

- [ ] **Step 5: Commit**

```bash
git add option-a-threejs-gsap-tailwind/site/index.html \
        option-a-threejs-gsap-tailwind/site/css/pages/home.css
git commit -m "feat(home): blocks 3.5 + 4 (challenge cards + status tabs above featured grid)"
git push
```

---

## Task 14: Rewrite Blocks 5–7 (How it works + Cinematic + Quote)

**Files:**
- Modify: `option-a-threejs-gsap-tailwind/site/index.html`
- Modify (append): `option-a-threejs-gsap-tailwind/site/css/pages/home.css`

- [ ] **Step 1: Replace Block 5 (How it works + day-by-day)**

Find `<!-- BLOCK 5 — HOW IT WORKS -->`. Replace with:

```html
  <!-- BLOCK 5 — HOW IT WORKS + DAY-BY-DAY TIMELINE -->
  <section class="section">
    <div class="container">
      <p class="eyebrow home-outcomes__eyebrow">How it works</p>
      <h2 class="display-l home-outcomes__h2">Three weeks. Three steps.</h2>
      <div class="steps">
        <div class="step step--active">
          <div class="step__num">1</div>
          <div class="step__title">Share your idea</div>
          <p class="step__body">A 30-minute call to align on vision, audience, and the first slice of the product.</p>
        </div>
        <div class="step">
          <div class="step__num">2</div>
          <div class="step__title">CoCreate in 2 weeks</div>
          <p class="step__body">Design, build, and ship the MVP together &mdash; you stay close, we stay fast.</p>
        </div>
        <div class="step">
          <div class="step__num">3</div>
          <div class="step__title">Launch &amp; grow</div>
          <p class="step__body">We keep going post-launch &mdash; iterate, scale, and own the upside together.</p>
        </div>
      </div>

      <p class="eyebrow home-timeline__eyebrow">Day-by-day timeline</p>
      <div class="home-timeline__grid">
        <div class="cc-card home-timeline__card">
          <div class="home-timeline__day">Day 1–4</div>
          <ul class="home-timeline__list">
            <li>Company Name &amp; Logo</li>
            <li>Branding</li>
            <li>Market Strategy</li>
            <li>Product Features</li>
            <li>Wireframes</li>
          </ul>
        </div>
        <div class="cc-card home-timeline__card">
          <div class="home-timeline__day">Day 5–6</div>
          <ul class="home-timeline__list">
            <li>Show &amp; Tell</li>
            <li>Sign Off</li>
            <li>Web &amp; Mobile Views</li>
            <li>Soft Launch</li>
          </ul>
        </div>
        <div class="cc-card home-timeline__card">
          <div class="home-timeline__day">Day 7–13</div>
          <ul class="home-timeline__list">
            <li>Sales &amp; Marketing</li>
            <li>Social Media</li>
            <li>Demos to Customers</li>
            <li>Iteration</li>
          </ul>
        </div>
      </div>
    </div>
  </section>
```

- [ ] **Step 2: Replace Block 6 (Cinematic)**

Find `<!-- BLOCK 6 — CINEMATIC -->`. Replace with:

```html
  <!-- BLOCK 6 — CINEMATIC OUR APPROACH (no own bg — body::before paints it) -->
  <section class="cinematic">
    <div class="cinematic__inner">
      <p class="eyebrow">Our approach</p>
      <h2 class="cinematic__title">Where ideas meet AI.</h2>
      <p class="cinematic__sub">We're not a dev shop. We're the AI-native co-founder who builds the product with you, on shared risk and shared upside &mdash; so the vision actually ships.</p>
      <div class="cinematic__cta">
        <a class="btn btn--ghost btn--lg" href="/who-we-are.html">Our way</a>
      </div>
    </div>
  </section>
```

- [ ] **Step 3: Replace Block 7 (Quote)**

Find `<!-- BLOCK 7 — FOUNDER VOICE -->`. Replace with:

```html
  <!-- BLOCK 7 — FOUNDER VOICE -->
  <section class="section">
    <div class="container">
      <blockquote class="quote">
        <img class="quote__avatar" src="assets/cocreate-icon.svg" alt="CoCreate icon">
        <div>
          <p class="quote__text">We didn't quote a number. We bet on the outcome &mdash; and shipped the product with the founder, not for them.</p>
          <p class="quote__attrib"><strong>Gopinath Varadharajan</strong> &middot; CEO, CoCreate Idea</p>
        </div>
      </blockquote>
    </div>
  </section>
```

- [ ] **Step 4: Append timeline styles to `css/pages/home.css`**

Append at the END:

```css

/* BLOCK 5 — day-by-day timeline */
.home-timeline__eyebrow {
  margin-top: var(--s-9);
  text-align: center;
  display: block;
}
.home-timeline__grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
  gap: var(--s-5);
  margin-top: var(--s-6);
}
.home-timeline__card {
  padding: var(--s-5);
}
.home-timeline__day {
  font-family: var(--font-display);
  font-weight: 700;
  font-size: 1.25rem;
  color: var(--accent);
  margin-bottom: var(--s-3);
}
.home-timeline__list {
  list-style: none;
  padding: 0;
  display: grid;
  gap: var(--s-2);
  color: var(--text-secondary);
}
.home-timeline__list li::before {
  content: '✓  ';
  color: var(--accent);
  font-weight: 700;
}
```

- [ ] **Step 5: Visual confirm + commit**

```powershell
node screenshot.js "file:///C:/Projects/ai-product-studio/option-a-threejs-gsap-tailwind/site/index.html" "_home_blocks_5_7.png" 1280 4400
```

Open. Steps + timeline cards + cinematic overlay + quote should render.

```bash
git add option-a-threejs-gsap-tailwind/site/index.html \
        option-a-threejs-gsap-tailwind/site/css/pages/home.css
git commit -m "feat(home): blocks 5-7 (steps + day timeline + cinematic + quote)"
git push
```

---

## Task 15: Rewrite Blocks 8–10 + add Chat FAB + the page IIFE

**Files:**
- Modify: `option-a-threejs-gsap-tailwind/site/index.html`
- Modify (append): `option-a-threejs-gsap-tailwind/site/css/pages/home.css`

- [ ] **Step 1: Replace Block 8 (Co-Founder Model + You/Us/Operations)**

Find `<!-- BLOCK 8 — CO-FOUNDER MODEL -->`. Replace with:

```html
  <!-- BLOCK 8 — CO-FOUNDER MODEL + EQUITY SPLIT -->
  <section class="section home-cofounder">
    <div class="container">
      <p class="eyebrow home-outcomes__eyebrow">The co-founder model</p>
      <h2 class="display-l home-outcomes__h2">Equity-aligned. Not transactional.</h2>
      <div class="stats">
        <div class="stat"><div class="stat__num">$0</div><div class="stat__label">upfront cost</div><div class="stat__caption">We invest the build. You retain ownership and upside.</div></div>
        <div class="stat"><div class="stat__num">2 wks</div><div class="stat__label">to first launch</div><div class="stat__caption">Scope is shaped to fit the window &mdash; every time.</div></div>
        <div class="stat"><div class="stat__num">Shared</div><div class="stat__label">upside</div><div class="stat__caption">Aligned incentives, no hourly billing games.</div></div>
        <div class="stat"><div class="stat__num">Always-on</div><div class="stat__label">post-launch</div><div class="stat__caption">We keep iterating with you, not handing off and ghosting.</div></div>
      </div>

      <p class="eyebrow home-equity__eyebrow">Equity split</p>
      <div class="home-equity__grid">
        <div class="cc-card home-equity__card">
          <div class="home-equity__role">You</div>
          <p>Market expertise, sales, and customer relationships.</p>
        </div>
        <div class="cc-card home-equity__card">
          <div class="home-equity__role">Us</div>
          <p>Technology, AI, development, and infrastructure.</p>
        </div>
        <div class="cc-card home-equity__card">
          <div class="home-equity__role">Operations</div>
          <p>Reserved for future team members and operations.</p>
        </div>
      </div>
    </div>
  </section>
```

- [ ] **Step 2: Replace Block 6.5 (Win-Win pillars)**

Find `<!-- BLOCK 6.5 — WHY THIS IS A WIN-WIN -->` (it may be located between 6 and 7 currently). Replace with:

```html
  <!-- BLOCK 6.5 — WIN-WIN PILLARS -->
  <section class="section">
    <div class="container">
      <p class="eyebrow home-outcomes__eyebrow">Why it works</p>
      <h2 class="display-l home-outcomes__h2">A win-win, by design.</h2>
      <div class="home-winwin__grid">
        <div class="cc-card home-winwin__card">
          <h3 class="display-m">AI reduces build cycles</h3>
          <p>What used to take months now takes weeks. Our 3 Claude agents handle architecture, development, and deployment in parallel.</p>
        </div>
        <div class="cc-card home-winwin__card">
          <h3 class="display-m">Marginal cost to scale</h3>
          <p>Each new product is a fraction of the cost of the last. We share that compression with you.</p>
        </div>
        <div class="cc-card home-winwin__card">
          <h3 class="display-m">Perfect incentive alignment</h3>
          <p>We own equity in what we build. Your win is our win &mdash; no hourly billing games.</p>
        </div>
        <div class="cc-card home-winwin__card">
          <h3 class="display-m">Scale as equals</h3>
          <p>You stay the founder. We stay the co-founder. No hand-off, no ghosting, no agency-vs-client friction.</p>
        </div>
      </div>
    </div>
  </section>
```

- [ ] **Step 3: Replace Block 9 (FAQ)**

Find `<!-- BLOCK 9 — FAQ -->`. Replace with:

```html
  <!-- BLOCK 9 — FAQ -->
  <section class="section">
    <div class="container">
      <p class="eyebrow home-outcomes__eyebrow">FAQ</p>
      <h2 class="display-l home-outcomes__h2">Founder questions, answered.</h2>
      <div class="accordion">
        <details class="accordion__item" open>
          <summary class="accordion__q">How does the $0 upfront model actually work?</summary>
          <div class="accordion__a">We take equity in the product we build with you. Typical split is 15-30% depending on scope and existing traction. We do the design, build, and launch; you own the brand, the customer relationships, and the majority of the cap table.</div>
        </details>
        <details class="accordion__item">
          <summary class="accordion__q">Can you really ship a real product in 2 weeks?</summary>
          <div class="accordion__a">Yes. 42 products and counting. The day-by-day timeline above is real &mdash; not aspirational. Day 13 we hand you a live URL, a deployed AWS stack, and the metrics dashboard.</div>
        </details>
        <details class="accordion__item">
          <summary class="accordion__q">What if my idea isn't fully baked?</summary>
          <div class="accordion__a">Even better. We help shape the MVP scope on Day 1. Most founders walk in with a problem and walk out of the kick-off with a 14-day plan.</div>
        </details>
        <details class="accordion__item">
          <summary class="accordion__q">Do you sign NDAs?</summary>
          <div class="accordion__a">Yes, mutual NDAs available before the kick-off call. We won't build anything until we've signed.</div>
        </details>
        <details class="accordion__item">
          <summary class="accordion__q">What stack do you build on?</summary>
          <div class="accordion__a">Production-grade only: AWS (Lambda + S3 + CloudFront + DynamoDB via SST), Next.js or vanilla TS front-ends, Claude + GPT for AI surfaces, Stripe for billing. We never ship a side-project stack.</div>
        </details>
      </div>
    </div>
  </section>
```

- [ ] **Step 4: Replace Block 10 (Final CTA)**

Find `<!-- BLOCK 10 — FINAL CTA -->`. Replace with:

```html
  <!-- BLOCK 10 — FINAL CTA -->
  <section class="cta-band">
    <h2 class="cta-band__title">Let's <span class="gradient-word">CoCreate</span>.</h2>
    <p class="cta-band__sub">14 days from now you could be live in market with a real product and real users. We review every application personally.</p>
    <div class="cta-band__actions">
      <a class="btn btn--primary btn--lg" href="https://calendly.com/cocreateceo/30min">Let's CoCreate in 24 Hrs</a>
      <a class="btn btn--ghost btn--lg" href="/projects.html">See what we've built</a>
    </div>
  </section>
```

- [ ] **Step 5: Add Chat FAB + the page IIFE before `</body>`**

Find the closing `</body>` tag. Immediately BEFORE it, add:

```html
  <button class="cc-fab" id="js-cc-fab" aria-label="Chat with us">
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />
    </svg>
  </button>

  <script src="js/projects-data.js"></script>
  <script src="js/projects-render.js"></script>
  <script src="js/cinematic.js"></script>
  <script>
    /* Homepage IIFE — populate live-count, marquee, status tabs, featured cards. */
    (function () {
      var CP = window.CoCreateProjects;
      if (!CP) return;

      var all = CP.flatten();
      var lives = all.filter(function (p) { return p.status === 'live'; });
      var building = all.filter(function (p) { return p.status === 'building'; });
      var launching = all.filter(function (p) { return p.status === 'launching'; });
      var featured = all.filter(function (p) { return p.featured; }).slice(0, 6);

      // Trust strip + outcomes count
      ['js-live-count', 'js-live-count-2'].forEach(function (id) {
        var el = document.getElementById(id);
        if (el && lives.length) el.textContent = String(lives.length);
      });

      // Totals
      var total = document.getElementById('js-total-count');
      if (total) total.textContent = String(all.length);

      // Status-tab counts
      var setCount = function (id, n) {
        var el = document.getElementById(id);
        if (el) el.textContent = String(n);
      };
      setCount('js-tab-count-all', all.length);
      setCount('js-tab-count-live', lives.length);
      setCount('js-tab-count-building', building.length);
      setCount('js-tab-count-launching', launching.length);

      // Marquee — repeat track for seamless scroll
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

      // Status-tab filter
      var tabs = document.querySelectorAll('#js-cc-tabs .cc-tab');
      tabs.forEach(function (t) {
        t.addEventListener('click', function () {
          var filter = t.getAttribute('data-filter');
          tabs.forEach(function (x) { x.classList.toggle('is-active', x === t); });
          var cards = document.querySelectorAll('#js-home-featured .proj-card');
          cards.forEach(function (c) {
            var s = c.getAttribute('data-status');
            c.classList.toggle('is-hidden', filter !== 'all' && s !== filter);
          });
        });
      });

      // Chat FAB — visual trigger for the existing chat widget if present.
      var fab = document.getElementById('js-cc-fab');
      if (fab) {
        fab.addEventListener('click', function () {
          var w = window.CoCreateChat || window.cocreateChat;
          if (w && typeof w.open === 'function') { w.open(); return; }
          // Fallback: click the legacy widget toggle if it exists.
          var legacy = document.querySelector('.chat-widget-toggle, .chat-toggle, [data-chat-toggle]');
          if (legacy) { legacy.click(); return; }
          // Last-resort: open the dedicated chat page.
          window.location.href = '/chat.html';
        });
      }
    })();
  </script>
```

- [ ] **Step 6: Append Block 8/6.5/9/10 styles to `css/pages/home.css`**

Append at the END:

```css

/* BLOCK 8 — cofounder + equity */
.home-cofounder { background: rgba(45, 20, 8, 0.4); }
.home-equity__eyebrow {
  margin-top: var(--s-9);
  text-align: center;
  display: block;
}
.home-equity__grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
  gap: var(--s-5);
  margin-top: var(--s-5);
}
.home-equity__card {
  padding: var(--s-5);
  text-align: center;
}
.home-equity__role {
  font-family: var(--font-display);
  font-weight: 700;
  font-size: 1.5rem;
  background: var(--grad-brand);
  -webkit-background-clip: text;
  background-clip: text;
  color: transparent;
  margin-bottom: var(--s-3);
}
.home-equity__card p { color: var(--text-secondary); line-height: 1.7; }

/* BLOCK 6.5 — winwin */
.home-winwin__grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
  gap: var(--s-5);
  margin-top: var(--s-7);
}
.home-winwin__card { padding: var(--s-5); }
.home-winwin__card h3 { margin-bottom: var(--s-3); }
.home-winwin__card p { color: var(--text-secondary); line-height: 1.7; }
```

- [ ] **Step 7: Final-page hero assertion still passes**

```powershell
node check.js "file:///C:/Projects/ai-product-studio/option-a-threejs-gsap-tailwind/site/index.html" assert_home_hero_v2.js
```
Expected: `ok: true`.

- [ ] **Step 8: Full-page screenshot**

```powershell
node screenshot.js "file:///C:/Projects/ai-product-studio/option-a-threejs-gsap-tailwind/site/index.html" "_home_final.png" 1280 7400
```

Open. All 12 blocks + Chat FAB visible. Cards populate via IIFE.

- [ ] **Step 9: Commit**

```bash
git add option-a-threejs-gsap-tailwind/site/index.html \
        option-a-threejs-gsap-tailwind/site/css/pages/home.css
git commit -m "feat(home): blocks 8-10 + chat fab + tabs IIFE wiring"
git push
```

---

## Task 16: Align all 8 theme files + light-theme cc-bg-fixed::after override

**Files:**
- Modify: `option-a-threejs-gsap-tailwind/site/css/themes/ember.css`
- Modify: `option-a-threejs-gsap-tailwind/site/css/themes/coral.css`
- Modify: `option-a-threejs-gsap-tailwind/site/css/themes/sunset.css`
- Modify: `option-a-threejs-gsap-tailwind/site/css/themes/aurora.css`
- Modify: `option-a-threejs-gsap-tailwind/site/css/themes/legacy.css`
- Modify: `option-a-threejs-gsap-tailwind/site/css/themes/sandstone.css`
- Modify: `option-a-threejs-gsap-tailwind/site/css/themes/champagne.css`
- Modify: `option-a-threejs-gsap-tailwind/site/css/themes/zoom.css`

Each theme already defines the semantic tokens (`--bg-primary`, `--text-primary`, `--accent`, etc.) — those are kept. The change is to ensure each theme: (a) uses the new alias-shim-compatible variable names where it currently overrides, and (b) light themes add a `body.cc-bg-fixed::after` override.

- [ ] **Step 1: Inspect each theme file for tokens it overrides**

```bash
for f in /c/Projects/ai-product-studio/option-a-threejs-gsap-tailwind/site/css/themes/*.css; do
  echo "=== $f ==="
  grep -nE '^\s*--' "$f" | head -20
done
```

- [ ] **Step 2: For each LIGHT theme (coral, aurora, sandstone, champagne, zoom), append the cream-overlay override**

Append at the END of each light theme file (`coral.css`, `aurora.css`, `sandstone.css`, `champagne.css`, `zoom.css`):

```css

/* Light theme — cream gradient overlay on top of the fixed cinematic bg
   so text on the homepage stays legible. */
body.cc-bg-fixed::after {
  background:
    radial-gradient(ellipse 120% 100% at 50% 100%, transparent 30%, rgba(255, 248, 240, 0.6) 100%),
    linear-gradient(90deg, rgba(255, 248, 240, 0.65) 0%, rgba(255, 248, 240, 0.3) 40%, transparent 60%),
    linear-gradient(180deg, rgba(255, 248, 240, 0.5) 0%, transparent 40%);
}
```

For DARK themes (`ember.css`, `sunset.css`, `legacy.css`) — no change needed; they use the dark default from `cc-bg.css`.

- [ ] **Step 3: Theme parity sweep**

Run a small PowerShell loop that flips the `<html data-theme="...">` attribute (NOT the `<link>` href — themes are imported individually and the active one is selected via the `data-theme` attribute on `<html>`) and screenshots each:

```powershell
Set-Location "C:\Projects\_build"
$themes = @('ember','coral','sunset','aurora','legacy','sandstone','champagne','zoom')
foreach ($t in $themes) {
  # Use Chrome --headless directly with a small JS that flips data-theme then waits + screenshots
  $tmpFile = "C:\Projects\_build\_tt.js"
@"
const puppeteer = require('puppeteer-core');
const CHROME = 'C:\\\\Program Files\\\\Google\\\\Chrome\\\\Application\\\\chrome.exe';
(async () => {
  const b = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox','--disable-gpu','--hide-scrollbars'], defaultViewport: { width: 1280, height: 900 } });
  const p = await b.newPage();
  await p.goto('file:///C:/Projects/ai-product-studio/option-a-threejs-gsap-tailwind/site/index.html', { waitUntil: 'networkidle2' });
  await p.evaluate((t) => {
    document.documentElement.setAttribute('data-theme', t);
    // Swap the <link> if any inline default ember link is loaded
    var link = document.querySelector('link[href*="themes/"]');
    if (link) link.href = 'css/themes/' + t + '.css';
  }, '$t');
  await new Promise(r => setTimeout(r, 2500));
  await p.screenshot({ path: '_theme_${t}.png', fullPage: true });
  await b.close();
})();
"@ | Set-Content -NoNewline -Encoding utf8 $tmpFile
  node $tmpFile
}
```

Open each `_theme_<name>.png`. Confirm:
- Layout stable (no broken sections).
- Text legible on every theme (no black-on-dark or white-on-white).
- Cinematic photo visible behind the hero on every theme, with dark or cream overlay matching theme polarity.

- [ ] **Step 4: Commit**

```bash
git add option-a-threejs-gsap-tailwind/site/css/themes/
git commit -m "feat(themes): light-theme cream overlay on cc-bg-fixed::after"
git push
```

---

## Task 17: Final verification + deploy + live verify

**Files:**
- No code changes; verification + AWS deploy.

- [ ] **Step 1: Full local verification battery**

```powershell
Set-Location "C:\Projects\_build"
node check.js "file:///C:/Projects/ai-product-studio/option-a-threejs-gsap-tailwind/site/index.html" assert_tokens_v2.js
node check.js "file:///C:/Projects/ai-product-studio/option-a-threejs-gsap-tailwind/site/index.html" assert_base.js
node check.js "file:///C:/Projects/ai-product-studio/option-a-threejs-gsap-tailwind/site/index.html" assert_home_hero_v2.js
node check.js "file:///C:/Projects/ai-product-studio/option-a-threejs-gsap-tailwind/site/projects.html" assert_projects_cards.js
```

All four must return `ok: true` with `pageErrors: []`.

- [ ] **Step 2: Status-tab interaction test**

Create `C:\Projects\_build\assert_tabs_filter.js`:

```js
module.exports = async function (page) {
  await new Promise(r => setTimeout(r, 2000));
  const initial = await page.$$eval('#js-home-featured .proj-card:not(.is-hidden)', els => els.length);
  // Click the "Live" tab
  await page.click('#js-cc-tabs .cc-tab[data-filter="live"]');
  await new Promise(r => setTimeout(r, 500));
  const afterLive = await page.evaluate(() => ({
    visible: document.querySelectorAll('#js-home-featured .proj-card:not(.is-hidden)').length,
    statuses: Array.from(document.querySelectorAll('#js-home-featured .proj-card:not(.is-hidden)')).map(c => c.getAttribute('data-status'))
  }));
  // Click back to "Everything"
  await page.click('#js-cc-tabs .cc-tab[data-filter="all"]');
  await new Promise(r => setTimeout(r, 500));
  const afterAll = await page.$$eval('#js-home-featured .proj-card:not(.is-hidden)', els => els.length);
  return {
    ok: initial > 0 && afterAll === initial && afterLive.statuses.every(s => s === 'live'),
    initial, afterLive, afterAll
  };
};
```

```powershell
node check.js "file:///C:/Projects/ai-product-studio/option-a-threejs-gsap-tailwind/site/index.html" assert_tabs_filter.js
```
Expected: `ok: true`.

- [ ] **Step 3: Multi-width visual check**

```powershell
node screenshot.js "file:///C:/Projects/ai-product-studio/option-a-threejs-gsap-tailwind/site/index.html" "_home_1280.png" 1280 7400
node screenshot.js "file:///C:/Projects/ai-product-studio/option-a-threejs-gsap-tailwind/site/index.html" "_home_768.png"   768 8200
node screenshot.js "file:///C:/Projects/ai-product-studio/option-a-threejs-gsap-tailwind/site/index.html" "_home_375.png"   375 9000
```

Open each. No horizontal scroll, no overlapping elements, hero centered at all widths.

- [ ] **Step 4: Upload to S3**

```bash
cd /c/Projects/ai-product-studio/option-a-threejs-gsap-tailwind/site
R="--region ap-south-1"

aws s3 cp index.html              s3://cocreateidea.com/index.html              $R --content-type "text/html"               --cache-control "public, max-age=300"
aws s3 cp css/tokens.css          s3://cocreateidea.com/css/tokens.css          $R --content-type "text/css"                --cache-control "public, max-age=300"
aws s3 cp css/base.css            s3://cocreateidea.com/css/base.css            $R --content-type "text/css"                --cache-control "public, max-age=300"
aws s3 cp css/pages/home.css      s3://cocreateidea.com/css/pages/home.css      $R --content-type "text/css"                --cache-control "public, max-age=300"
aws s3 cp css/components/         s3://cocreateidea.com/css/components/         $R --recursive --content-type "text/css"    --cache-control "public, max-age=300"
aws s3 cp css/themes/             s3://cocreateidea.com/css/themes/             $R --recursive --content-type "text/css"    --cache-control "public, max-age=300"
aws s3 cp js/projects-data.js     s3://cocreateidea.com/js/projects-data.js     $R --content-type "application/javascript"  --cache-control "public, max-age=300"
aws s3 cp js/projects-render.js   s3://cocreateidea.com/js/projects-render.js   $R --content-type "application/javascript"  --cache-control "public, max-age=300"
aws s3 cp js/cinematic.js         s3://cocreateidea.com/js/cinematic.js         $R --content-type "application/javascript"  --cache-control "public, max-age=300"
aws s3 cp projects.html           s3://cocreateidea.com/projects.html           $R --content-type "text/html"               --cache-control "public, max-age=300"
aws s3 cp projects-category.html  s3://cocreateidea.com/projects-category.html  $R --content-type "text/html"               --cache-control "public, max-age=300"
```

- [ ] **Step 5: CloudFront invalidation (PowerShell — bash mangles leading slashes)**

```powershell
aws cloudfront create-invalidation --distribution-id E1M06FXCRKZHF3 `
  --paths "/index.html" "/css/tokens.css" "/css/base.css" "/css/pages/*" "/css/components/*" "/css/themes/*" "/js/projects-data.js" "/js/projects-render.js" "/js/cinematic.js" "/projects.html" "/projects-category.html" `
  --query "Invalidation.{Id:Id,Status:Status}" --output table
```

- [ ] **Step 6: Live verification**

Wait ~20 seconds for CloudFront propagation, then:

```powershell
node check.js "https://www.cocreateidea.com/index.html" assert_home_hero_v2.js
node check.js "https://www.cocreateidea.com/index.html" assert_tabs_filter.js
node check.js "https://www.cocreateidea.com/projects.html" assert_projects_cards.js
node screenshot.js "https://www.cocreateidea.com/index.html" "_live_home_after_v2.png" 1280 7400
```

All three checks must print `ok: true` and `pageErrors: []`. Open the screenshot — confirm parity with `_home_1280.png` from Step 3.

- [ ] **Step 7: Final commit (only if step 6 surfaced any small fix)**

If everything passed: no commit needed. If a tiny touch-up was required to align live with local, commit it and re-run Step 6.

---

## Self-review (run before handing off)

### Spec coverage
Every section of `docs/superpowers/specs/2026-05-29-vedics-design-system-adoption.md` is implemented:

- §1 Background / scope sequencing → Plan goal + Task 17 only (Waves B and C out of scope) ✓
- §2 Block-by-block treatment (12 blocks + Chat FAB) → Tasks 11–15 ✓
- §3.1 Files replaced in place (16 paths) → Tasks 1–8 + 10 + 11 ✓
- §3.2 Files added net-new (4 paths) → Task 9 ✓
- §3.3 Files unchanged → respected by targeted `git add` in every task ✓
- §3.4 Asset additions → `cocreate_bg.png` already present; logo files unchanged (verified at planning) ✓
- §4 Token migration map + alias shim → Task 1 ✓
- §5 New component primitives → Task 9 ✓
- §6.1 `projects-data.js` status field → Task 10 ✓
- §6.2 `projects-render.js` data-status emit → Task 10 ✓
- §6.3 Inline IIFE → Task 15 ✓
- §6.4 `cinematic.js` parallax via CSS variable → Task 10 ✓
- §7 Theme parity → Task 16 ✓
- §8 Verification gates (token-shim, homepage, status-tabs interaction, projects regression, theme parity, reduced-motion, console errors) → Tasks 1, 2, 3, 4, 10, 11, 16, 17 ✓
- §9 Deploy plan → Task 17 ✓
- §10 Open questions surfaced → answered or documented in task code (status default fill rule in Task 10; chat-widget binding fallback in Task 15 IIFE; gradient phrase: hero "CoCreate" Task 11, outcomes "ship" Task 12, featured "Shipped" Task 13, final-cta "CoCreate" Task 15 — four gradient phrases per the latest spec) ✓
- §11 Scope boundaries → Wave A only, respected in every task ✓
- §12 Risks + mitigations → each addressed in the corresponding task's verification step ✓

### Placeholder scan
No `TBD` / `TODO` / `implement later` / `fill in details` strings. All code blocks are complete. The Wave A spec explicitly defers Per-Project pricing (out of scope) and tech-stack chips (deferred polish), neither of which appears in this plan.

### Identifier consistency
- `productCardHTML`, `flatten`, `CoCreateProjects`, `PROJECTS_DATA`, `proj-card`, `proj-modal`, `data-slug`, `is-hidden`, `cc-bg-fixed`, `cc-card`, `cc-tab`, `cc-tab__count`, `cc-fab`, `gradient-word`, `home-hero__h1` — used consistently across all tasks.
- Token names: every `var(--…)` reference in the plan resolves to either a new token in Task 1 §3 or an alias in Task 1 §3 (alias section). Verified by enumeration at planning time (40 old tokens grep'd; all aliased).
- File paths: every `git add <path>` matches a `Modify` or `Create` line in the same task.
- JS hook IDs: `js-live-count`, `js-live-count-2`, `js-total-count`, `js-marquee-track`, `js-home-featured`, `js-cc-tabs`, `js-tab-count-{all,live,building,launching}`, `js-cc-fab` — all referenced consistently between Tasks 11–15 (HTML markup) and Task 15 (IIFE).

No issues. Plan ready for execution.
