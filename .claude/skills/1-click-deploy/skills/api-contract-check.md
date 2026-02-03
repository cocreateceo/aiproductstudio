---
name: api-contract-check
description: Verify frontend API calls match backend endpoints before deployment. Prevents 404 errors from endpoint mismatches.
---

# API Contract Verification

## Overview

This skill verifies that every API call made by the frontend has a corresponding endpoint in the backend. Run this BEFORE every deployment to prevent 404 errors.

**Core principle:** Frontend and backend must speak the same language.

## When to Use

- Before deploying to staging or production
- After adding new API calls to frontend
- After adding new endpoints to backend
- When debugging 404 errors in production

## The Verification Process

### Step 1: Extract Frontend API Calls

```bash
# Find all API calls in hooks
grep -rn "api\.\(get\|post\|put\|delete\|patch\)" frontend/src/hooks/ > /tmp/frontend-apis.txt

# Find all API calls in services
grep -rn "api\.\(get\|post\|put\|delete\|patch\)" frontend/src/services/ >> /tmp/frontend-apis.txt

# Extract just the endpoints
grep -oP "['\"][/][^'\"]+['\"]" /tmp/frontend-apis.txt | sort -u > /tmp/frontend-endpoints.txt

cat /tmp/frontend-endpoints.txt
```

### Step 2: Extract Backend Routes

```bash
# Find all registered routes
grep -rn "@router\.\(get\|post\|put\|delete\|patch\)" backend/app/api/v1/ > /tmp/backend-routes.txt

# Extract route paths
grep -oP "['\"][^'\"]*['\"]" /tmp/backend-routes.txt | head -1 | sort -u > /tmp/backend-endpoints.txt

# Check router prefixes in main.py
grep "include_router" backend/app/main.py
```

### Step 3: Compare and Find Mismatches

Create a comparison table:

| Frontend Expects | Backend Has | Status |
|------------------|-------------|--------|
| `/api/v1/auth/logout` | ❌ Missing | **FIX** |
| `/api/v1/auth/login` | ✅ Present | OK |
| `/api/v1/chatbot/message` | ❌ Missing | **FIX** |
| `/api/v1/jobs/search` | `/api/v1/jobs` | **PATH MISMATCH** |

### Step 4: Verify Schema Alignment

For each endpoint that exists, verify request/response schemas match:

```bash
# Compare TypeScript interfaces
cat frontend/src/types/api.ts | grep -A 10 "interface ApplicationStats"

# With Pydantic schemas
cat backend/app/schemas/application.py | grep -A 10 "class ApplicationStats"
```

## Common Issues

### Issue 1: Missing Router Registration

```python
# ❌ WRONG: Router created but not registered
# backend/app/api/v1/chatbot.py exists but...
# backend/app/main.py missing:
# app.include_router(chatbot_router, prefix="/api/v1")

# ✅ FIX: Add to main.py
from app.api.v1.chatbot import router as chatbot_router
app.include_router(chatbot_router, prefix="/api/v1")
```

### Issue 2: Path Mismatch

```python
# Frontend calls: /api/v1/jobs/search
# Backend has: /api/v1/jobs (with query params)

# ✅ FIX Option 1: Add alias route
@router.get("/search")
async def search_jobs_alias(...):
    return await search_jobs(...)

# ✅ FIX Option 2: Update frontend
api.get('/jobs', { params: { q: query } })  # Instead of /jobs/search
```

### Issue 3: Method Mismatch

```python
# Frontend: POST /api/v1/applications
# Backend: Only GET /api/v1/applications

# ✅ FIX: Add POST endpoint
@router.post("", response_model=ApplicationResponse, status_code=201)
async def create_application(...):
    pass
```

## Verification Checklist

Before deployment, verify:

- [ ] All frontend API calls have backend endpoints
- [ ] All routes are registered in main.py
- [ ] HTTP methods match (GET/POST/PUT/DELETE)
- [ ] Path parameters match (`{job_id}` vs `{id}`)
- [ ] Query parameters are expected by backend
- [ ] Request body schemas match
- [ ] Response schemas match

## Quick Reference: Essential Endpoints

Every full-stack app needs these:

| Category | Endpoint | Method | Purpose |
|----------|----------|--------|---------|
| Auth | `/auth/register` | POST | Create account |
| Auth | `/auth/login` | POST | Get JWT |
| Auth | `/auth/logout` | POST | Invalidate session |
| Auth | `/auth/refresh` | POST | Refresh JWT |
| Auth | `/auth/forgot-password` | POST | Request reset |
| Auth | `/auth/reset-password` | POST | Set new password |
| Profile | `/users/me` | GET | Get current user |
| Profile | `/users/me` | PUT | Update profile |

## Output Format

After running verification, report:

```
=== API Contract Verification Report ===

✅ MATCHING (15 endpoints)
  - POST /auth/register
  - POST /auth/login
  ...

❌ MISSING IN BACKEND (3 endpoints)
  - POST /auth/logout (frontend: useAuth.ts:69)
  - POST /chatbot/message (frontend: useChat.ts:29)
  - GET /chatbot/briefing (frontend: useChat.ts:54)

⚠️ PATH MISMATCH (1 endpoint)
  - Frontend: /jobs/search → Backend: /jobs

⚠️ SCHEMA MISMATCH (1 endpoint)
  - /applications/stats: Frontend expects 'total_applications', backend returns 'total'

=== Action Required ===
1. Create backend/app/api/v1/chatbot.py with message and briefing endpoints
2. Add logout endpoint to auth.py
3. Either add /jobs/search alias OR update frontend to use /jobs
4. Align ApplicationStats schema between frontend and backend
```
