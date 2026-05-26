# Lambda Modular Refactor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restructure the 4,652-line `option-a-threejs-gsap-tailwind/chat-backend/index.mjs` into a thin router + focused domain modules + a shared lib, as a single Lambda with the same deploy, **without changing any runtime behavior**.

**Architecture:** Keep ONE Lambda and the existing `deploy.sh` zip. `index.mjs` becomes a thin entry that parses the event, builds a merged action→handler registry from domain modules, and dispatches. Each `domains/*.mjs` module exports a `routes` map of `action → handler(body, event)`. Shared `lib/*.mjs` holds the S3 client singleton, config/env, HTTP response helper, id generators, and referral logic. `costs/`, `aws-costs/`, `email-templates.mjs`, `email-service.mjs` are already modular and stay as-is. Work is **incremental**: extract the shared lib first, then one domain at a time; a routing test + a live smoke test verify behavior is preserved after every step.

**Tech Stack:** Node.js 20 (ESM), AWS SDK v3, Anthropic SDK, AWS Lambda + API Gateway (`bx0ywfkona`), deployed via `bash deploy.sh`.

**Refactor convention (read first):** This plan MOVES existing, working code. For *new* files (lib, router, tests) the full code is given. For *moved* functions, the plan cites the exact function name and current line range in `index.mjs` — "move function X (index.mjs:A–B) into module Y verbatim, then export it." Do not rewrite moved code; cut-paste it and fix only its `import`s.

---

## Target File Structure

```
chat-backend/
  index.mjs                 # thin: parse event → registry[action](body, event); CORS preflight; error wrap
  lib/
    config.mjs              # env vars + constants (keys, models, buckets, regions, LLM_PRICING, REFERRAL_CODES, SYSTEM_PROMPT)
    aws.mjs                 # getS3() singleton (replaces ~30 `new S3Client(...)`)
    http.mjs                # CORS, respond(data, statusCode)
    ids.mjs                 # generateSessionId, generateClientId
    referral.mjs            # resolveReferral
  domains/
    chat.mjs                # chatWithClaude, chatWithOpenAI, extractContactInfoWithLLM, processAttachments, extractTextFromPDF/DOCX, sendEmail
    sessions.mjs            # saveChatSession, saveSessionLookup, lookupSessionByContact, linkSessionToApplication, listChatSessions
    clients.mjs             # getOrCreateClientProfile, updateClientProfile, listClientProfiles
    applications.mjs        # saveFormToS3, listApplications, updateApplicationStatus, checkDuplicateApplication, saveAbandonedForm, syncLocalStorageToS3, sendFormSubmissionEmail, sendApplicantConfirmationEmail, handleFormValidation
    builds.mjs              # createBuildJob, listBuildHistory, (build detail/status branches)
    users.mjs               # user-check/signup/login/dashboard, upload-avatar, save-theme, user-change-password, forgot/reset-password
    admin.mjs               # admin-login/list/update/progress/chats/clients/builds + *-detail + admin-delete-chats
    events.mjs              # currentWeekEventId, resolveWeeklyEvent, event-register, event-list-registrations
  costs/ aws-costs/ email-templates.mjs email-service.mjs   # UNCHANGED (already modular)
  test/
    actions.expected.mjs    # the canonical list of action strings (harvested from git baseline)
    routing.test.mjs        # asserts the merged registry covers exactly the expected actions
    smoke.mjs               # POSTs read-only actions to the live API; asserts 200 + shape
  deploy.sh                 # UNCHANGED
```

**Dependency direction (no cycles):** `lib/*` import nothing internal → `domains/*` import from `lib/*` and (carefully) sibling domains → `index.mjs` imports `domains/*`. If two domains need each other (sessions↔clients↔applications), keep the shared piece in the lower-level module (e.g. `clients.mjs` may import `sessions.mjs`, not vice-versa).

---

## Phase 0 — Safety net (do this before touching index.mjs)

### Task 0: Establish the routing baseline + live smoke test

**Files:**
- Create: `chat-backend/test/actions.expected.mjs`
- Create: `chat-backend/test/routing.test.mjs`
- Create: `chat-backend/test/smoke.mjs`
- Modify: `chat-backend/index.mjs` (add one export, no logic change)

- [ ] **Step 1: Harvest the canonical action list from the current code**

Run from `chat-backend/`:
```bash
grep -oE "action === '[^']+'" index.mjs | sed -E "s/action === '([^']+)'/\1/" | sort -u > /tmp/actions.txt
wc -l /tmp/actions.txt   # expect 55
cat /tmp/actions.txt
```

- [ ] **Step 2: Write the expected-actions module**

Create `test/actions.expected.mjs` — paste the 55 strings from Step 1 (exact):
```js
// Canonical action list captured from index.mjs BEFORE the refactor (git baseline).
// The merged router registry must cover EXACTLY these. Do not edit during refactor.
export const EXPECTED_ACTIONS = [
  // paste every line from /tmp/actions.txt as a quoted string, e.g.:
  // 'admin-login', 'admin-list', 'user-login', ...
];
```

- [ ] **Step 3: Expose the registry from index.mjs (no behavior change)**

At the very end of `index.mjs`, the handler currently dispatches via a long `if (action === ...)` chain. For now, add a single exported constant that the test can grow into. Add at the end of the file:
```js
// Exposed for the routing test. During the refactor this becomes the real registry.
export const ROUTES = ROUTES_REGISTRY ?? {};
```
If `ROUTES_REGISTRY` does not exist yet (it won't in Phase 0), instead export an empty object and mark the test pending:
```js
export const ROUTES = {};
```

- [ ] **Step 4: Write the routing test**

Create `test/routing.test.mjs`:
```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EXPECTED_ACTIONS } from './actions.expected.mjs';
import { ROUTES } from '../index.mjs';

test('registry covers every expected action', () => {
  const have = new Set(Object.keys(ROUTES));
  const missing = EXPECTED_ACTIONS.filter(a => !have.has(a));
  assert.deepEqual(missing, [], `missing handlers: ${missing.join(', ')}`);
});

test('registry has no unexpected (orphan) actions', () => {
  const expected = new Set(EXPECTED_ACTIONS);
  const extra = Object.keys(ROUTES).filter(a => !expected.has(a));
  assert.deepEqual(extra, [], `unexpected handlers: ${extra.join(', ')}`);
});
```

- [ ] **Step 5: Run the routing test — expect it to FAIL (registry empty)**

Run: `cd chat-backend && node --test test/routing.test.mjs`
Expected: FAIL — "missing handlers: …" (the registry is still empty; the `if/else` chain has not been converted yet). This is the red baseline that goes green once Phase 9 finishes wiring the registry. It will stay red through Phases 1–8 (those preserve the `if/else` chain) — that is expected; rely on the live smoke test for those phases.

- [ ] **Step 6: Write the live smoke test (read-only actions only)**

Create `test/smoke.mjs`. Replace `API` with the deployed invoke URL (find it: `aws apigateway get-rest-apis` / it is the `bx0ywfkona` REST API stage URL the site uses in `site/js/config.js`).
```js
// Read-only / idempotent smoke test against the DEPLOYED endpoint.
// Usage: node test/smoke.mjs
const API = process.env.CHAT_API_URL; // e.g. https://bx0ywfkona.execute-api.ap-south-1.amazonaws.com/prod/chat
const ADMIN_PW = process.env.ADMIN_PW || 'aiproductstudio2026';

const cases = [
  { action: 'admin-login', body: { password: ADMIN_PW }, expect: r => r.success === true },
  { action: 'admin-list', body: { password: ADMIN_PW }, expect: r => Array.isArray(r.applications) },
  { action: 'event-list-registrations', body: { password: ADMIN_PW }, expect: r => r.success !== false },
  { action: 'aws-cost-summary', body: { password: ADMIN_PW }, expect: r => r != null },
  { action: 'user-check', body: { email: 'doesnotexist@example.com' }, expect: r => r != null },
];

let failed = 0;
for (const c of cases) {
  try {
    const res = await fetch(API, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: c.action, ...c.body }),
    });
    const json = await res.json();
    const ok = res.status === 200 && c.expect(json);
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${c.action}  [${res.status}]`);
    if (!ok) { failed++; console.log('   got:', JSON.stringify(json).slice(0, 200)); }
  } catch (e) { failed++; console.log(`FAIL  ${c.action}  ${e.message}`); }
}
console.log(failed ? `\n${failed} failed` : '\nall passed');
process.exit(failed ? 1 : 0);
```

- [ ] **Step 7: Capture the GREEN baseline against production**

Run: `cd chat-backend && CHAT_API_URL="<deployed url>" node test/smoke.mjs`
Expected: `all passed`. **If any case fails here, STOP** — fix the smoke test (wrong URL / payload) so the baseline is green before refactoring. Save this output; it is the behavior contract for Phases 1–8.

- [ ] **Step 8: Commit the safety net**

```bash
git add option-a-threejs-gsap-tailwind/chat-backend/test option-a-threejs-gsap-tailwind/chat-backend/index.mjs
git commit -m "test: add routing + live smoke harness for lambda refactor"
```

---

## Phase 1 — Shared lib (no behavior change)

### Task 1: Extract config + AWS singleton + http + ids + referral

**Files:**
- Create: `chat-backend/lib/config.mjs`, `lib/aws.mjs`, `lib/http.mjs`, `lib/ids.mjs`, `lib/referral.mjs`
- Modify: `chat-backend/index.mjs` (replace inline consts/helpers with imports)

- [ ] **Step 1: Create `lib/config.mjs`** — move the constant declarations from `index.mjs` verbatim and `export` each. Source lines: `ANTHROPIC_API_KEY` (22), `OPENAI_API_KEY` (23), `NOTIFICATION_EMAIL` (24), `CLAUDE_MODEL` (27), `OPENAI_MODEL` (28), `LLM_PRICING` (31), `S3_BUCKET` (37), `S3_REGION` (38), `REFERRAL_CODES` (42), `SYSTEM_PROMPT` (63). Example:
```js
export const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
export const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
export const NOTIFICATION_EMAIL = process.env.NOTIFICATION_EMAIL;
export const CLAUDE_MODEL = process.env.CLAUDE_MODEL || 'claude-sonnet-4-20250514';
export const OPENAI_MODEL = process.env.OPENAI_MODEL || 'gpt-4o-mini';
export const S3_BUCKET = process.env.S3_BUCKET || 'cocreate-applications-data';
export const S3_REGION = process.env.AWS_REGION || 'us-east-1';
export const LLM_PRICING = { /* …verbatim from index.mjs:31… */ };
export const REFERRAL_CODES = { /* …verbatim from index.mjs:42… */ };
export const SYSTEM_PROMPT = `/* …verbatim from index.mjs:63… */`;
```

- [ ] **Step 2: Create `lib/aws.mjs`** (S3 singleton — replaces the ~30 `const s3 = new S3Client({ region: S3_REGION })`):
```js
import { S3Client } from '@aws-sdk/client-s3';
import { S3_REGION } from './config.mjs';

let _s3;
/** Lazy, reused S3 client (one per warm container). */
export function getS3() {
  if (!_s3) _s3 = new S3Client({ region: S3_REGION });
  return _s3;
}
```

- [ ] **Step 3: Create `lib/http.mjs`** — move the CORS object (`index.mjs:362–366`) and add a `respond` helper:
```js
export const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

/** Wrap a payload as an API Gateway proxy response. */
export function respond(data, statusCode = 200) {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json', ...CORS },
    body: typeof data === 'string' ? data : JSON.stringify(data),
  };
}
```

- [ ] **Step 4: Create `lib/ids.mjs`** — move `generateSessionId` (444–450) and `generateClientId` (451–464) verbatim; add `import crypto from 'crypto';` at top; `export` both.

- [ ] **Step 5: Create `lib/referral.mjs`** — move `resolveReferral` (50–57) verbatim; add `import { REFERRAL_CODES } from './config.mjs';`; `export function resolveReferral(...)`.

- [ ] **Step 6: Rewire `index.mjs`** — delete the moved const/function declarations and add imports at the top:
```js
import { ANTHROPIC_API_KEY, OPENAI_API_KEY, NOTIFICATION_EMAIL, CLAUDE_MODEL, OPENAI_MODEL, LLM_PRICING, S3_BUCKET, S3_REGION, REFERRAL_CODES, SYSTEM_PROMPT } from './lib/config.mjs';
import { getS3 } from './lib/aws.mjs';
import { CORS, respond } from './lib/http.mjs';
import { generateSessionId, generateClientId } from './lib/ids.mjs';
import { resolveReferral } from './lib/referral.mjs';
```
Then replace every `const s3 = new S3Client({ region: S3_REGION });` with `const s3 = getS3();` (≈30 sites). Leave all other code identical.

- [ ] **Step 7: Verify it still loads (no missing refs)**

Run: `cd chat-backend && node --check index.mjs && node -e "import('./index.mjs').then(()=>console.log('loads ok'))"`
Expected: `loads ok` (no `ReferenceError`/`SyntaxError`). Fix any unresolved reference (a const/function still used but now imported).

- [ ] **Step 8: Deploy + live smoke**

Run:
```bash
cd chat-backend && bash deploy.sh
CHAT_API_URL="<deployed url>" node test/smoke.mjs
```
Expected: `all passed` (identical to the Phase 0 baseline).

- [ ] **Step 9: Commit**

```bash
git add option-a-threejs-gsap-tailwind/chat-backend/lib option-a-threejs-gsap-tailwind/chat-backend/index.mjs
git commit -m "refactor(lambda): extract shared lib (config, aws singleton, http, ids, referral)"
```

---

## Phases 2–8 — Extract one domain per task

Every domain task follows the **same 6 steps**. The per-domain table below gives the module name, the functions to move (with line refs), and the actions it owns. Do them in this order (lowest-coupling first): **chat → sessions → clients → applications → builds → events → users → admin.**

**Per-domain steps (repeat for each task):**

- [ ] **Step A: Create `domains/<name>.mjs`.** Cut the listed functions out of `index.mjs` verbatim into the new module. Add imports it needs from `lib/*` (`getS3`, `S3_BUCKET`, `respond`, etc.) and from sibling domains already extracted. `export` every function that `index.mjs` (or another module) still calls.
- [ ] **Step B: In `index.mjs`, import the moved functions** from `./domains/<name>.mjs` and delete their old definitions.
- [ ] **Step C: Load check** — `node --check index.mjs && node -e "import('./index.mjs').then(()=>console.log('ok'))"`. Resolve any missing reference.
- [ ] **Step D: Deploy** — `bash deploy.sh`.
- [ ] **Step E: Live smoke** — `CHAT_API_URL="<url>" node test/smoke.mjs` → `all passed`. Plus manually exercise one action from this domain (see "verify" column) via curl and confirm a 200 + sane body.
- [ ] **Step F: Commit** — `git commit -m "refactor(lambda): extract <name> domain"`.

| Task | Module | Move (function @ line) | Owns actions | Manual verify (curl) |
|------|--------|------------------------|--------------|----------------------|
| 2 | `domains/chat.mjs` | `sendEmail`@369, `extractContactInfoWithLLM`@1609, `extractTextFromPDF`@1658, `extractTextFromDOCX`@1706, `processAttachments`@1752, `chatWithClaude`@1852, `chatWithOpenAI`@1991 | the default chat handler (no `action`, or `action==='chat'`) | POST a 1-message chat, expect a reply |
| 3 | `domains/sessions.mjs` | `saveChatSession`@465, `saveSessionLookup`@539, `lookupSessionByContact`@597, `linkSessionToApplication`@668, `listChatSessions`@801 | `lookup-session` | `lookup-session` with a known phone/email |
| 4 | `domains/clients.mjs` | `getOrCreateClientProfile`@700, `updateClientProfile`@745, `listClientProfiles`@847 | (used by admin/sessions; no own public action) | covered via admin-clients |
| 5 | `domains/applications.mjs` | `sendFormSubmissionEmail`@389, `sendApplicantConfirmationEmail`@421, `checkDuplicateApplication`@1079, `saveAbandonedForm`@1152, `syncLocalStorageToS3`@1225, `saveFormToS3`@1284, `listApplications`@1366, `updateApplicationStatus`@1419, `handleFormValidation`@2128 | `check-duplicate`, `save-abandoned-form`, `validate-form` (+ form submit) | `check-duplicate` with a test email |
| 6 | `domains/builds.mjs` | `createBuildJob`@1499, `listBuildHistory`@959 | `update-build-status`, `admin-build-detail` | `admin-build-detail` for a known build id |
| 7 | `domains/events.mjs` | `currentWeekEventId`@2289, `resolveWeeklyEvent`@2310 | `event-register`, `event-list-registrations` | `event-list-registrations` (admin pw) |
| 8 | `domains/users.mjs` | (the user-* handler bodies, currently inline in the dispatch 2909–3610) | `user-check`, `user-signup`, `user-login`, `user-dashboard`, `upload-avatar`, `save-theme`, `user-change-password`, `forgot-password`, `reset-password` | `user-check` with unknown email |
| 9 | `domains/admin.mjs` | (the admin-* handler bodies, inline 2373–2560 + 3611–3970) | `admin-login`, `admin-list`, `admin-update`, `admin-progress`, `admin-chats`, `admin-clients`, `admin-builds`, `admin-chat-detail`, `admin-client-detail`, `admin-delete-chats` | `admin-list` (admin pw) |

> For Tasks 8 & 9 the logic currently lives **inside** the dispatch `if (action===...)` blocks, not as named functions. Extract each block into a named handler `function handle<Action>(body, event)` inside the domain module, returning `respond(...)`, and have the dispatch call it. This is the step that begins converting the `if/else` chain into handlers — keep the `if (action===...) return handle…()` lines in `index.mjs` for now (Phase 9 turns them into the registry).

(`aws-cost-*`, `*-cost-report*`, `admin-costs-summary`, `user-costs`, `get-tmux-projects` already delegate to the imported `costs/`, `aws-costs/` modules — leave those dispatch lines untouched.)

---

## Phase 9 — Registry router + thin index.mjs

### Task 10: Replace the if/else chain with a registry and make routing.test green

**Files:**
- Modify: every `domains/*.mjs` (add a `routes` export), `chat-backend/index.mjs`

- [ ] **Step 1: In each domain module, export a `routes` map.** Example for `domains/users.mjs`:
```js
export const routes = {
  'user-check': handleUserCheck,
  'user-signup': handleUserSignup,
  'user-login': handleUserLogin,
  'user-dashboard': handleUserDashboard,
  'upload-avatar': handleUploadAvatar,
  'save-theme': handleSaveTheme,
  'user-change-password': handleUserChangePassword,
  'forgot-password': handleForgotPassword,
  'reset-password': handleResetPassword,
};
```
Each handler has the signature `(body, event) => respond(...)`. Do the same for admin, applications, builds, events, sessions, and a chat fallback.

- [ ] **Step 2: Build the merged registry in `index.mjs`** (including the already-modular cost handlers):
```js
import { routes as chatRoutes } from './domains/chat.mjs';
import { routes as sessionRoutes } from './domains/sessions.mjs';
import { routes as applicationRoutes } from './domains/applications.mjs';
import { routes as buildRoutes } from './domains/builds.mjs';
import { routes as eventRoutes } from './domains/events.mjs';
import { routes as userRoutes } from './domains/users.mjs';
import { routes as adminRoutes } from './domains/admin.mjs';
// cost handlers already imported individually:
const costRoutes = {
  'admin-costs-summary': (b) => handleAdminCostsSummary(b),
  'user-costs': (b) => handleUserCosts(b),
  'aws-cost-summary': (b) => handleAwsCostSummary(b),
  // …map the remaining aws-cost-* / *-report actions to their imported handlers, 1:1 with the current dispatch…
};

const ROUTES_REGISTRY = {
  ...chatRoutes, ...sessionRoutes, ...applicationRoutes, ...buildRoutes,
  ...eventRoutes, ...userRoutes, ...adminRoutes, ...costRoutes,
};
export const ROUTES = ROUTES_REGISTRY;
```

- [ ] **Step 3: Replace the dispatch body** of `handler` (the `if (action === ...)` chain, ~2373–4061) with:
```js
export const handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return respond('', 200);
  let body;
  try { body = JSON.parse(event.body || '{}'); }
  catch { return respond({ error: 'invalid JSON body' }, 400); }

  const action = body.action;
  const fn = ROUTES_REGISTRY[action];
  if (!fn) return respond({ error: `unknown action: ${action}` }, 400);

  try {
    return await fn(body, event);
  } catch (err) {
    console.error(`[${action}]`, err);
    return respond({ error: err.message || 'internal error' }, 500);
  }
};
```
Preserve any pre-dispatch logic that existed before the `if` chain (e.g. the default "no action = chat" path → register it under the chat fallback or handle `!action` explicitly before the registry lookup, matching current behavior exactly).

- [ ] **Step 4: Run the routing test — now GREEN**

Run: `cd chat-backend && node --test test/routing.test.mjs`
Expected: PASS both tests (registry keys === EXPECTED_ACTIONS). If "missing"/"extra" — a handler wasn't registered or a stray action remained; fix the relevant `routes` map.

- [ ] **Step 5: Load check + full deploy + smoke**

```bash
node --check index.mjs && node -e "import('./index.mjs').then(()=>console.log('ok'))"
bash deploy.sh
CHAT_API_URL="<url>" node test/smoke.mjs
```
Expected: `loads ok` + `all passed`.

- [ ] **Step 6: Manual regression pass on the live site** — exercise the real flows once: submit `apply.html`, open `admin.html` (login, Applications/Chats/Clients/Builds tabs), the AWS Cost dashboard, a user login on `user.html`, and `event.html` register. All must behave as before.

- [ ] **Step 7: Commit**

```bash
git add option-a-threejs-gsap-tailwind/chat-backend
git commit -m "refactor(lambda): registry router + thin handler; index.mjs now ~150 lines"
```

---

## Phase 10 — Cleanup

### Task 11: Remove dead code and confirm size win

- [ ] **Step 1:** Delete any now-unused imports/vars in `index.mjs` (`node --check` + ESLint if configured). 
- [ ] **Step 2:** Confirm the win: `wc -l index.mjs` (target: a few hundred lines) and `wc -l domains/*.mjs lib/*.mjs`.
- [ ] **Step 3:** Update `option-a-threejs-gsap-tailwind/docs/README.md` "Folder Structure" to document `lib/` + `domains/`.
- [ ] **Step 4:** Final deploy + smoke + commit `chore(lambda): remove dead code, document module layout`.

---

## Rollback

Each phase is one commit and one deploy. If a deploy's smoke test fails and the cause isn't obvious in a few minutes: `git revert <commit>` then `bash deploy.sh` to restore the previous behavior, and re-investigate locally. Never leave `main` deployed in a failing state.

## Notes / Risks

- **No unit tests exist** for this code; the safety net is the routing test (structure) + live smoke (behavior) + the Phase 9 manual regression pass. Treat the smoke test's green baseline as the contract.
- **Behavior must not change.** This is a pure move/rewire. If you find a bug while moving code, note it but do NOT fix it in the same commit — fix separately so a smoke regression always points at the refactor.
- **Circular imports:** if `node -e import(...)` hangs or errors on a cycle, move the shared function down into `lib/` or the lower domain.
- **`deploy.sh` and the deploy zip are unchanged** — new files under `lib/` and `domains/` are included automatically because the zip packages the whole directory.
