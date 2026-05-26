// Read-only / idempotent smoke test against the DEPLOYED endpoint.
// Usage: CHAT_API_URL=... node test/smoke.mjs   (defaults to prod)
const API = process.env.CHAT_API_URL || 'https://mcndu8ynsa.execute-api.us-east-1.amazonaws.com/prod/';
const ADMIN_PW = process.env.ADMIN_PW || 'aiproductstudio2026';

const cases = [
  { action: 'admin-login', body: { password: ADMIN_PW }, expect: r => r.success === true },
  { action: 'admin-list', body: { password: ADMIN_PW }, expect: r => Array.isArray(r.applications) || r.success !== false },
  { action: 'event-list-registrations', body: { password: ADMIN_PW }, expect: r => r != null },
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
