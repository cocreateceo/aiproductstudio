# AWS Cost Dashboard Design

**Date**: 2026-02-23
**Status**: Approved

## Overview

New standalone page at `/awscost.html` that tracks entire AWS account costs using the AWS Cost Explorer API. Completely separate from the existing per-user/per-project costs page — no existing code is modified.

## Frontend: `/awscost.html` + `js/awscost-core.js` + `css/awscost.css`

### Tech Stack (matching existing patterns)
- Vanilla JavaScript (IIFE pattern)
- Tailwind CSS via CDN + custom CSS with glass-morphism
- Chart.js 4.4.7 for all charts
- GSAP for entry animations
- All 8 themes supported via CSS variables
- Same admin password auth as costs.html

### Page Layout

```
[Login Screen] → password auth (sessionStorage.adminPassword)
    ↓
[Dashboard]
    ├── Header: "AWS Cost Dashboard" + date range picker + refresh + theme selector
    ├── KPI Row (6 glass cards):
    │   ├── Total Spend (current period)
    │   ├── Previous Period Spend
    │   ├── MoM Change (% delta badge)
    │   ├── Top Service (name + amount)
    │   ├── Active Services Count
    │   └── Forecasted Month-End Spend
    ├── Charts Row 1 (2-col grid):
    │   ├── Daily Cost Trend (line chart, last 30 days)
    │   └── Cost by Service (donut chart, top 10 services)
    ├── Charts Row 2 (2-col grid):
    │   ├── Monthly Cost Trend (bar chart, last 6 months)
    │   └── Top 5 Services Trend (stacked line, last 6 months)
    ├── Service Breakdown Table:
    │   ├── Columns: Service | Current Month | Previous Month | Delta | % of Total
    │   ├── Sortable columns
    │   └── Search/filter input
    └── Footer: Last updated timestamp + back links
```

### Date Range Controls
- Quick buttons: "This Month", "Last Month", "Last 3 Months", "Last 6 Months"
- Custom date range: two date inputs (from/to)
- Default view: current month

## Backend: `chat-backend/aws-costs/index.mjs`

### New Endpoints (routed from index.mjs)

| Action | Purpose | Params |
|--------|---------|--------|
| `aws-cost-summary` | KPI cards + service breakdown | `password, startDate, endDate` |
| `aws-cost-daily` | Daily cost trend | `password, startDate, endDate` |
| `aws-cost-forecast` | Forecasted month-end spend | `password` |

### AWS SDK Usage
- `@aws-sdk/client-cost-explorer`
- `GetCostAndUsageCommand` — grouped by SERVICE for breakdown
- `GetCostAndUsageCommand` — DAILY granularity for trend
- `GetCostForecastCommand` — MONTHLY forecast

### IAM Permissions Required
```json
{
  "Effect": "Allow",
  "Action": ["ce:GetCostAndUsage", "ce:GetCostForecast"],
  "Resource": "*"
}
```

### Response Shapes

**aws-cost-summary**:
```json
{
  "success": true,
  "data": {
    "totalCost": 142.57,
    "previousPeriodCost": 128.33,
    "momChange": 11.09,
    "topService": { "name": "Amazon EC2", "cost": 68.42 },
    "activeServices": 12,
    "services": [
      { "service": "Amazon EC2", "cost": 68.42, "previousCost": 62.10, "delta": 10.18, "percentOfTotal": 48.0 }
    ]
  }
}
```

**aws-cost-daily**:
```json
{
  "success": true,
  "data": {
    "dailyCosts": [
      { "date": "2026-02-01", "cost": 4.82 },
      { "date": "2026-02-02", "cost": 5.11 }
    ]
  }
}
```

**aws-cost-forecast**:
```json
{
  "success": true,
  "data": {
    "forecastedTotal": 158.30,
    "forecastPeriod": { "start": "2026-02-23", "end": "2026-02-28" }
  }
}
```

## Files to Create (no existing files modified)

| File | Purpose |
|------|---------|
| `site/awscost.html` | Dashboard page |
| `site/js/awscost-core.js` | Frontend logic, charts, API calls |
| `site/css/awscost.css` | Page-specific styles |
| `chat-backend/aws-costs/index.mjs` | Backend Cost Explorer handlers |

## Files to Modify

| File | Change |
|------|--------|
| `chat-backend/index.mjs` | Import + route 3 new actions |
| `chat-backend/package.json` | Add `@aws-sdk/client-cost-explorer` dependency |
