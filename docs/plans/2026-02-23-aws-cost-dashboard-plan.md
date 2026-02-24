# AWS Cost Dashboard Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a new `/awscost.html` page that tracks entire AWS account costs via the Cost Explorer API — completely separate from the existing per-user costs page.

**Architecture:** New backend module `chat-backend/aws-costs/index.mjs` with 3 Cost Explorer handlers routed through the existing Lambda. New frontend page with vanilla JS, Chart.js, Tailwind + glass-morphism, matching the existing site's theme system.

**Tech Stack:** Vanilla JS (IIFE), Tailwind CSS CDN, Chart.js 4.4.7, GSAP 3.12.2, `@aws-sdk/client-cost-explorer`, existing theme system (8 themes)

---

### Task 1: Backend — Create AWS Cost Explorer handlers

**Files:**
- Create: `option-a-threejs-gsap-tailwind/chat-backend/aws-costs/index.mjs`

**Step 1: Create the handler module**

Create `chat-backend/aws-costs/index.mjs` with three exported handler functions. This file uses `@aws-sdk/client-cost-explorer` to call AWS Cost Explorer API.

```javascript
/**
 * AWS Account-Wide Cost Handlers
 * Uses Cost Explorer API to fetch total AWS account spending.
 * Completely separate from the per-user/per-project costs in ../costs/
 */

import {
  CostExplorerClient,
  GetCostAndUsageCommand,
  GetCostForecastCommand
} from '@aws-sdk/client-cost-explorer';

const ceClient = new CostExplorerClient({ region: 'us-east-1' });

/**
 * Helper: Get first day of month N months ago
 */
function monthStart(monthsAgo = 0) {
  const d = new Date();
  d.setMonth(d.getMonth() - monthsAgo);
  d.setDate(1);
  return d.toISOString().slice(0, 10);
}

/**
 * Helper: Get today's date as YYYY-MM-DD
 */
function today() {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Helper: Get last day of previous month
 */
function previousMonthEnd() {
  const d = new Date();
  d.setDate(0); // last day of previous month
  return d.toISOString().slice(0, 10);
}

/**
 * aws-cost-summary: KPI cards + service breakdown
 * Groups costs by SERVICE for current and previous periods.
 */
export async function handleAwsCostSummary({ body, corsHeaders, ADMIN_PASSWORD }) {
  if (body.password !== ADMIN_PASSWORD) {
    return { statusCode: 401, headers: corsHeaders, body: JSON.stringify({ success: false, error: 'Unauthorized' }) };
  }

  try {
    const startDate = body.startDate || monthStart(0);
    const endDate = body.endDate || today();

    // Calculate previous period of same length
    const start = new Date(startDate);
    const end = new Date(endDate);
    const daySpan = Math.ceil((end - start) / (1000 * 60 * 60 * 24));
    const prevEnd = new Date(start);
    prevEnd.setDate(prevEnd.getDate() - 1);
    const prevStart = new Date(prevEnd);
    prevStart.setDate(prevStart.getDate() - daySpan + 1);

    // Current period by service
    const [currentResult, previousResult] = await Promise.all([
      ceClient.send(new GetCostAndUsageCommand({
        TimePeriod: { Start: startDate, End: endDate },
        Granularity: 'MONTHLY',
        Metrics: ['UnblendedCost'],
        GroupBy: [{ Type: 'DIMENSION', Key: 'SERVICE' }]
      })),
      ceClient.send(new GetCostAndUsageCommand({
        TimePeriod: { Start: prevStart.toISOString().slice(0, 10), End: prevEnd.toISOString().slice(0, 10) },
        Granularity: 'MONTHLY',
        Metrics: ['UnblendedCost'],
        GroupBy: [{ Type: 'DIMENSION', Key: 'SERVICE' }]
      }))
    ]);

    // Aggregate current costs by service
    const currentServices = {};
    let totalCost = 0;
    for (const period of currentResult.ResultsByTime || []) {
      for (const group of period.Groups || []) {
        const name = group.Keys[0];
        const cost = parseFloat(group.Metrics.UnblendedCost.Amount) || 0;
        currentServices[name] = (currentServices[name] || 0) + cost;
        totalCost += cost;
      }
    }

    // Aggregate previous costs by service
    const previousServices = {};
    let previousTotalCost = 0;
    for (const period of previousResult.ResultsByTime || []) {
      for (const group of period.Groups || []) {
        const name = group.Keys[0];
        const cost = parseFloat(group.Metrics.UnblendedCost.Amount) || 0;
        previousServices[name] = (previousServices[name] || 0) + cost;
        previousTotalCost += cost;
      }
    }

    // Build service list sorted by cost descending
    const services = Object.entries(currentServices)
      .map(([service, cost]) => {
        const previousCost = previousServices[service] || 0;
        const delta = previousCost > 0 ? ((cost - previousCost) / previousCost) * 100 : null;
        return {
          service,
          cost: Math.round(cost * 100) / 100,
          previousCost: Math.round(previousCost * 100) / 100,
          delta: delta !== null ? Math.round(delta * 10) / 10 : null,
          percentOfTotal: totalCost > 0 ? Math.round((cost / totalCost) * 1000) / 10 : 0
        };
      })
      .filter(s => s.cost > 0.001)
      .sort((a, b) => b.cost - a.cost);

    const momChange = previousTotalCost > 0
      ? Math.round(((totalCost - previousTotalCost) / previousTotalCost) * 1000) / 10
      : null;

    const topService = services.length > 0 ? { name: services[0].service, cost: services[0].cost } : null;

    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify({
        success: true,
        data: {
          totalCost: Math.round(totalCost * 100) / 100,
          previousPeriodCost: Math.round(previousTotalCost * 100) / 100,
          momChange,
          topService,
          activeServices: services.length,
          services,
          period: { start: startDate, end: endDate }
        }
      })
    };
  } catch (err) {
    console.error('[aws-cost-summary] Error:', err);
    return { statusCode: 500, headers: corsHeaders, body: JSON.stringify({ success: false, error: err.message }) };
  }
}

/**
 * aws-cost-daily: Daily cost trend for charts
 */
export async function handleAwsCostDaily({ body, corsHeaders, ADMIN_PASSWORD }) {
  if (body.password !== ADMIN_PASSWORD) {
    return { statusCode: 401, headers: corsHeaders, body: JSON.stringify({ success: false, error: 'Unauthorized' }) };
  }

  try {
    const startDate = body.startDate || monthStart(0);
    const endDate = body.endDate || today();

    const result = await ceClient.send(new GetCostAndUsageCommand({
      TimePeriod: { Start: startDate, End: endDate },
      Granularity: 'DAILY',
      Metrics: ['UnblendedCost']
    }));

    const dailyCosts = (result.ResultsByTime || []).map(period => ({
      date: period.TimePeriod.Start,
      cost: Math.round((parseFloat(period.Total.UnblendedCost.Amount) || 0) * 100) / 100
    }));

    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify({ success: true, data: { dailyCosts } })
    };
  } catch (err) {
    console.error('[aws-cost-daily] Error:', err);
    return { statusCode: 500, headers: corsHeaders, body: JSON.stringify({ success: false, error: err.message }) };
  }
}

/**
 * aws-cost-daily-by-service: Daily costs grouped by service (for top 5 trend chart)
 */
export async function handleAwsCostDailyByService({ body, corsHeaders, ADMIN_PASSWORD }) {
  if (body.password !== ADMIN_PASSWORD) {
    return { statusCode: 401, headers: corsHeaders, body: JSON.stringify({ success: false, error: 'Unauthorized' }) };
  }

  try {
    const startDate = body.startDate || monthStart(5);
    const endDate = body.endDate || today();

    const result = await ceClient.send(new GetCostAndUsageCommand({
      TimePeriod: { Start: startDate, End: endDate },
      Granularity: 'MONTHLY',
      Metrics: ['UnblendedCost'],
      GroupBy: [{ Type: 'DIMENSION', Key: 'SERVICE' }]
    }));

    // Collect monthly data per service
    const serviceMonthly = {};
    const months = [];

    for (const period of result.ResultsByTime || []) {
      const month = period.TimePeriod.Start.slice(0, 7); // YYYY-MM
      months.push(month);
      for (const group of period.Groups || []) {
        const name = group.Keys[0];
        const cost = parseFloat(group.Metrics.UnblendedCost.Amount) || 0;
        if (!serviceMonthly[name]) serviceMonthly[name] = {};
        serviceMonthly[name][month] = Math.round(cost * 100) / 100;
      }
    }

    // Get top 5 services by total cost
    const serviceTotals = Object.entries(serviceMonthly).map(([name, data]) => ({
      name,
      total: Object.values(data).reduce((s, v) => s + v, 0)
    })).sort((a, b) => b.total - a.total).slice(0, 5);

    const top5Data = serviceTotals.map(s => ({
      service: s.name,
      monthly: [...new Set(months)].sort().map(m => ({
        month: m,
        cost: serviceMonthly[s.name][m] || 0
      }))
    }));

    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify({ success: true, data: { months: [...new Set(months)].sort(), services: top5Data } })
    };
  } catch (err) {
    console.error('[aws-cost-daily-by-service] Error:', err);
    return { statusCode: 500, headers: corsHeaders, body: JSON.stringify({ success: false, error: err.message }) };
  }
}

/**
 * aws-cost-forecast: Forecasted month-end spend
 */
export async function handleAwsCostForecast({ body, corsHeaders, ADMIN_PASSWORD }) {
  if (body.password !== ADMIN_PASSWORD) {
    return { statusCode: 401, headers: corsHeaders, body: JSON.stringify({ success: false, error: 'Unauthorized' }) };
  }

  try {
    const todayStr = today();
    const d = new Date();
    const monthEnd = new Date(d.getFullYear(), d.getMonth() + 1, 1).toISOString().slice(0, 10);

    // Forecast only works if we're not on the last day of the month
    if (todayStr >= monthEnd) {
      return {
        statusCode: 200,
        headers: corsHeaders,
        body: JSON.stringify({ success: true, data: { forecastedTotal: null, message: 'Month has ended, no forecast available' } })
      };
    }

    const result = await ceClient.send(new GetCostForecastCommand({
      TimePeriod: { Start: todayStr, End: monthEnd },
      Metric: 'UNBLENDED_COST',
      Granularity: 'MONTHLY'
    }));

    const forecastedTotal = result.Total
      ? Math.round(parseFloat(result.Total.Amount) * 100) / 100
      : null;

    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify({
        success: true,
        data: {
          forecastedTotal,
          forecastPeriod: { start: todayStr, end: monthEnd }
        }
      })
    };
  } catch (err) {
    console.error('[aws-cost-forecast] Error:', err);
    // Forecast can fail if not enough data — return null gracefully
    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify({ success: true, data: { forecastedTotal: null, error: err.message } })
    };
  }
}
```

**Step 2: Commit**

```bash
git add option-a-threejs-gsap-tailwind/chat-backend/aws-costs/index.mjs
git commit -m "feat: add AWS Cost Explorer backend handlers for account-wide cost tracking"
```

---

### Task 2: Backend — Wire handlers into Lambda router + add dependency

**Files:**
- Modify: `option-a-threejs-gsap-tailwind/chat-backend/index.mjs` (lines ~17-18 for imports, lines ~2575-2580 for routes)
- Modify: `option-a-threejs-gsap-tailwind/chat-backend/package.json` (add dependency)

**Step 1: Add import at top of index.mjs**

After line 18 (the existing costs imports), add:

```javascript
import { handleAwsCostSummary, handleAwsCostDaily, handleAwsCostDailyByService, handleAwsCostForecast } from './aws-costs/index.mjs';
```

**Step 2: Add route handlers in the action routing section**

After the `send-admin-report` block (around line 2577), add:

```javascript
    // ── AWS Account-Wide Cost Endpoints (see aws-costs/index.mjs) ──
    if (action === 'aws-cost-summary') {
      return handleAwsCostSummary({ body, corsHeaders, ADMIN_PASSWORD });
    }
    if (action === 'aws-cost-daily') {
      return handleAwsCostDaily({ body, corsHeaders, ADMIN_PASSWORD });
    }
    if (action === 'aws-cost-daily-by-service') {
      return handleAwsCostDailyByService({ body, corsHeaders, ADMIN_PASSWORD });
    }
    if (action === 'aws-cost-forecast') {
      return handleAwsCostForecast({ body, corsHeaders, ADMIN_PASSWORD });
    }
```

**Step 3: Add dependency to package.json**

Add `"@aws-sdk/client-cost-explorer": "^3.962.0"` to the dependencies object in `chat-backend/package.json`.

**Step 4: Commit**

```bash
git add option-a-threejs-gsap-tailwind/chat-backend/index.mjs option-a-threejs-gsap-tailwind/chat-backend/package.json
git commit -m "feat: wire AWS cost endpoints into Lambda router and add cost-explorer SDK"
```

---

### Task 3: Frontend — Create awscost.css

**Files:**
- Create: `option-a-threejs-gsap-tailwind/site/css/awscost.css`

**Step 1: Create the CSS file**

Reuse patterns from the existing `costs.css` — skeleton loading, delta badges, KPI cards, glass-morphism chart wrappers. Add date-range picker styles, sortable table styles, and service-breakdown-specific styles.

Key classes to include:
- `.skeleton`, `.skeleton-text`, `.skeleton-lg`, `.skeleton-chart` (loading states)
- `.delta-badge` variants (increase, decrease, neutral)
- `.kpi-card`, `.kpi-icon`, `.kpi-value`, `.kpi-label`
- `.chart-wrapper` (glass card wrapper for charts)
- `.service-table` (sortable table with hover effects)
- `.date-range-bar` (quick buttons + custom date inputs)
- `.search-input` (filter bar for service table)
- Toast notification styles

**Step 2: Commit**

```bash
git add option-a-threejs-gsap-tailwind/site/css/awscost.css
git commit -m "feat: add awscost.css with dashboard-specific styles"
```

---

### Task 4: Frontend — Create awscost.html

**Files:**
- Create: `option-a-threejs-gsap-tailwind/site/awscost.html`

**Step 1: Create the HTML page**

Structure matches the existing `costs.html` pattern:

1. **Head**: Tailwind CDN config, Google Fonts, all 8 theme CSS files, theme.js, config.js, Chart.js CDN, GSAP CDN, awscost.css
2. **Body background**: Same `body::before` (cocreate_bg.png) + `body::after` gradient overlay
3. **Login screen** (`#login-screen`): Password input + login button, same as costs.html
4. **Dashboard** (`#dashboard`, hidden initially):
   - **Header**: Title "AWS Cost Dashboard" + date range bar + refresh + theme selector
   - **KPI row**: 6 glass cards with skeleton placeholders (Total Spend, Previous Period, MoM Change, Top Service, Active Services, Forecast)
   - **Charts row 1**: 2-col grid — Daily Cost Trend canvas + Cost by Service canvas
   - **Charts row 2**: 2-col grid — Monthly Cost Trend canvas + Top 5 Services Trend canvas
   - **Service table section**: Search input + sortable table
   - **Footer**: Last updated + back to admin link
5. **Toast container** (`#toast-container`)
6. **Script tag**: `<script src="js/awscost-core.js"></script>`

**Step 2: Commit**

```bash
git add option-a-threejs-gsap-tailwind/site/awscost.html
git commit -m "feat: add awscost.html dashboard page structure"
```

---

### Task 5: Frontend — Create awscost-core.js

**Files:**
- Create: `option-a-threejs-gsap-tailwind/site/js/awscost-core.js`

**Step 1: Create the JavaScript file**

IIFE pattern matching `costs-core.js`. Sections:

1. **Config**: `API_URL` from `AppConfig.api.chat`, state vars (`adminPassword`, `summaryData`, `dailyData`, `forecastData`, chart instances, sort state)
2. **Helpers**: `$`, `$$`, `fmt`, `fmtPct`, `deltaBadgeHtml`, `pctChange`, `toast`
3. **Auth**: `login()`, `logout()` — same pattern as costs-core.js, validates against `aws-cost-summary` action
4. **Data fetching**: `loadDashboard()` — parallel fetch of all 4 endpoints:
   - `aws-cost-summary` (with startDate/endDate from date picker)
   - `aws-cost-daily` (with startDate/endDate)
   - `aws-cost-daily-by-service` (last 6 months, for trend chart)
   - `aws-cost-forecast`
5. **KPI rendering**: `renderKPIs(summary, forecast)` — populate 6 KPI cards
6. **Chart rendering**:
   - `renderDailyTrendChart(dailyData)` — line chart with gradient fill
   - `renderServiceDonutChart(services)` — donut chart, top 10 services
   - `renderMonthlyBarChart(dailyByService)` — bar chart from monthly totals
   - `renderTop5TrendChart(dailyByService)` — stacked line chart, top 5 services over 6 months
7. **Service table**: `renderServiceTable(services)` — sortable table with search/filter
8. **Date range**: Quick buttons (This Month, Last Month, Last 3 Mo, Last 6 Mo) + custom date inputs, calls `loadDashboard()` on change
9. **Event binding**: Login form submit, refresh button, date range buttons, sort headers, search input, theme change listener
10. **Init**: Check `sessionStorage.adminPassword`, auto-login if present, else show login screen. GSAP stagger animation on dashboard elements.

Chart color palette (10 colors for services):
```javascript
const CHART_COLORS = [
  '#f59e0b', '#8b5cf6', '#06b6d4', '#ec4899', '#10b981',
  '#f97316', '#6366f1', '#14b8a6', '#e11d48', '#84cc16'
];
```

Chart.js global config: dark theme (grid lines rgba(255,255,255,0.06), tick colors from CSS var `--text-muted`).

**Step 2: Commit**

```bash
git add option-a-threejs-gsap-tailwind/site/js/awscost-core.js
git commit -m "feat: add awscost-core.js with full dashboard logic, charts, and API integration"
```

---

### Task 6: Deploy backend and add IAM permissions

**Files:** None (manual AWS operations)

**Step 1: Install dependencies and build**

```bash
cd option-a-threejs-gsap-tailwind/chat-backend
npm install
```

**Step 2: Deploy Lambda**

Follow the existing deployment process (zip + upload or `npm run deploy`).

**Step 3: Add IAM permissions**

Add to the Lambda execution role:
```json
{
  "Effect": "Allow",
  "Action": ["ce:GetCostAndUsage", "ce:GetCostForecast"],
  "Resource": "*"
}
```

**Step 4: Test the endpoints**

```bash
curl -X POST https://mcndu8ynsa.execute-api.us-east-1.amazonaws.com/prod/ \
  -H "Content-Type: application/json" \
  -d '{"action":"aws-cost-summary","password":"<admin-password>"}'
```

Verify response contains `success: true` with service cost data.

---

### Task 7: End-to-end test

**Step 1: Open awscost.html in browser**

Navigate to the deployed site `/awscost.html` (or local file).

**Step 2: Verify login**

Enter admin password → should transition to dashboard.

**Step 3: Verify KPI cards**

All 6 cards should show real values (or `--` for unavailable forecast).

**Step 4: Verify charts**

- Daily trend line populates
- Service donut shows top 10
- Monthly bar chart shows last 6 months
- Top 5 services trend populates

**Step 5: Verify table**

- Services listed with costs, deltas, percentages
- Search/filter works
- Column sorting works

**Step 6: Verify date range**

Click "Last 3 Months" — all data should refresh. Try custom date range.

**Step 7: Verify themes**

Switch between themes — all elements should re-color properly.

**Step 8: Final commit**

```bash
git add -A
git commit -m "feat: complete AWS Cost Dashboard - full account cost tracking via Cost Explorer API"
```
