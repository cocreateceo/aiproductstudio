---
name: 1-click-deploy
description: Use when deploying a full-stack web application to AWS from requirements to production. Covers brainstorming, planning, implementation, testing, and deployment with all common pitfalls addressed.
---

# 1-Click Deploy: Full-Stack AWS Deployment

## Overview

Autonomous end-to-end deployment of full-stack applications from requirements to production. This skill orchestrates the entire SDLC: brainstorm → plan → implement → test → deploy → verify.

**Core principle:** Deploy once, deploy right. Address ALL common pitfalls upfront instead of discovering them post-deployment.

## When to Use

- Building and deploying a new full-stack web application
- User says "deploy this to AWS" or "make this production-ready"
- Taking a project from requirements/design to live production
- Need autonomous deployment with minimal user intervention

**When NOT to use:**
- Simple code changes (use standard dev workflow)
- Debugging existing deployments (use systematic-debugging)
- Just planning without execution (use brainstorming skill)

## The Deployment Pipeline

```
┌─────────────┐    ┌─────────────┐    ┌─────────────┐    ┌─────────────┐    ┌─────────────┐
│ BRAINSTORM  │───▶│    PLAN     │───▶│  IMPLEMENT  │───▶│    TEST     │───▶│   DEPLOY    │
└─────────────┘    └─────────────┘    └─────────────┘    └─────────────┘    └─────────────┘
      │                  │                  │                  │                  │
      ▼                  ▼                  ▼                  ▼                  ▼
  Requirements      Task list          Working code      Tests pass        Production
  + Decisions      + Dependencies      + All features    + E2E verified    + CloudFront
                                                                           + Clean URL
```

## Pre-Flight Checklist

**STOP AND VERIFY before starting:**

| Requirement | Check | Why |
|-------------|-------|-----|
| AWS credentials | `aws sts get-caller-identity` | Deployment will fail silently |
| Docker running | `docker ps` | Can't build images |
| AWS region set | Check profile or env var | Resources in wrong region |
| Domain DNS access | Verify ownership | SSL/CloudFront setup |
| API keys ready | Stripe, AI providers | 404s after deployment |

## Critical Pitfalls Checklist

**Address ALL of these during implementation, not after:**

### 1. OAuth Implementation (CRITICAL)
```
❌ WRONG: Create OAuthService class only
✅ RIGHT: Create OAuthService + API routes + frontend redirect logic
```

OAuth requires THREE components:
1. Backend service class (handles token exchange)
2. API routes registered in main.py (`/auth/oauth/{provider}`)
3. Frontend redirect (window.location.href, NOT fetch)

```typescript
// ❌ WRONG - OAuth via AJAX
const response = await api.post('/auth/oauth/google')

// ✅ RIGHT - OAuth via browser redirect
window.location.href = `${baseUrl}/auth/oauth/google`
```

### 2. CloudFront Setup (CRITICAL)
```
❌ WRONG: Give client ALB URL with port (http://alb:8080)
✅ RIGHT: Create CloudFront distribution for clean HTTPS URL
```

**Always create CloudFront as part of deployment, not after:**
- Users cannot see port numbers in production URLs
- ALB URLs are ugly and expose infrastructure
- HTTPS is non-negotiable for production

### 3. Build Verification (CRITICAL)
```
❌ WRONG: Push to CodeBuild and hope it works
✅ RIGHT: Run `npm run build` locally first
```

TypeScript errors only appear during build, not dev server:
- Missing interface fields (RegisterData missing `name`)
- Import path issues
- Type mismatches

### 4. Database Migrations
```
❌ WRONG: Deploy code, forget migrations
✅ RIGHT: Run migrations as part of deployment pipeline
```

### 5. Theme/UI Variables
```
❌ WRONG: Hardcode colors (#00d4aa)
✅ RIGHT: Use CSS variables (var(--color-accent))
```

### 6. Missing Static Assets
```
❌ WRONG: Reference favicon.svg without creating it
✅ RIGHT: Create all referenced static assets
```

## Implementation Phases

### Phase 0: Environment Setup
```bash
# Verify AWS
aws sts get-caller-identity --profile $PROFILE

# Create ECR repos
aws ecr create-repository --repository-name $PROJECT-backend
aws ecr create-repository --repository-name $PROJECT-frontend

# Create S3 for CodeBuild source
aws s3 mb s3://$PROJECT-codebuild-source-$ACCOUNT_ID
```

### Phase 1: Backend Implementation
1. Create FastAPI structure with ALL routes registered
2. Implement services (Auth, Profile, etc.)
3. **VERIFY OAuth routes exist and are registered**
4. Run `pytest` locally

### Phase 2: Frontend Implementation
1. Create React app with all pages
2. **Use CSS variables for theming from start**
3. Implement OAuth as browser redirects
4. **Run `npm run build` before pushing**

### Phase 3: Docker & CodeBuild
```bash
# Test Docker builds locally first
docker build -t test-backend ./backend
docker build -t test-frontend ./frontend

# Create source zip
zip -r source.zip backend frontend buildspec.yml

# Upload and trigger
aws s3 cp source.zip s3://$BUCKET/source.zip
aws codebuild start-build --project-name $PROJECT
```

### Phase 4: Infrastructure
1. Terraform apply (VPC, ECS, RDS, Redis)
2. **Create CloudFront distribution immediately**
3. Update Secrets Manager with real keys
4. Force ECS redeployment

### Phase 5: Verification
```bash
# Health checks
curl https://$CLOUDFRONT_URL/health
curl https://$CLOUDFRONT_URL/api/v1/health

# Test OAuth flow manually
# Open browser → Click "Sign in with Google" → Verify redirect

# Run E2E tests against production
npm run test:e2e -- --baseUrl=https://$CLOUDFRONT_URL
```

## Quick Reference: AWS Commands

| Task | Command |
|------|---------|
| Get account ID | `aws sts get-caller-identity --query Account --output text` |
| ECR login | `aws ecr get-login-password \| docker login --username AWS --password-stdin $ECR_URL` |
| Start CodeBuild | `aws codebuild start-build --project-name $PROJECT` |
| Force ECS redeploy | `aws ecs update-service --cluster $CLUSTER --service $SERVICE --force-new-deployment` |
| Check ECS status | `aws ecs describe-services --cluster $CLUSTER --services $SERVICE --query 'services[0].deployments'` |
| Get CloudFront status | `aws cloudfront get-distribution --id $DIST_ID --query 'Distribution.Status'` |

## Common Mistakes & Fixes

| Mistake | Symptom | Fix |
|---------|---------|-----|
| OAuth routes missing | 404 on `/api/v1/auth/oauth/google` | Register oauth_router in main.py |
| OAuth via fetch | Silent failure, no redirect | Use `window.location.href` |
| No CloudFront | Users see `:8080` in URL | Create CF distribution |
| TS build fails | CodeBuild FAILED status | Run `npm run build` locally first |
| Missing assets | 404 on favicon.svg | Create all referenced files |
| Hardcoded colors | Can't add themes later | Use CSS variables |
| No migrations | "Table does not exist" | Run alembic upgrade head |
| Wrong S3 bucket | "NoSuchBucket" error | Check account ID in bucket name |
| Missing logout | 404 on POST /auth/logout | Add logout endpoint to auth.py |
| Health mismatch | ALB unhealthy targets | Add /api/v1/health alias in main.py |
| Stub APIs | Empty arrays always | Implement actual DB queries in jobs.py |

## Deployment Verification Matrix

Before declaring deployment complete, verify ALL:

| Check | Command/Action | Expected |
|-------|----------------|----------|
| Frontend health | `curl $CF_URL/health` | 200 |
| Backend health | `curl $CF_URL/api/v1/health` | 200 JSON |
| OAuth providers | `curl $CF_URL/api/v1/auth/oauth/providers` | Provider list |
| Registration | Manual test | Creates user |
| Login | Manual test | Returns JWT |
| Theme switcher | Manual test | Themes change |
| CloudFront HTTPS | Browser | Green lock |

## Files to Create (Often Forgotten)

```
frontend/
├── public/
│   └── favicon.svg          # Required for browser tab
├── src/
│   ├── contexts/
│   │   └── ThemeContext.tsx  # Theme provider
│   └── components/
│       └── ThemeSwitcher.tsx # Theme dropdown
backend/
└── app/
    └── api/v1/
        └── oauth.py          # OAuth API routes
```

## The Final Test

**Before telling user deployment is complete:**

1. Open CloudFront URL in incognito browser
2. Click "Sign in with Google" → Must redirect to Google
3. Register new account with email
4. Change theme → Must persist
5. Check browser console → No 404 errors

**Only then declare success.**

## CRITICAL: Missed Implementation Prevention

**These checks were added after discovering 12 critical and 8 moderate issues post-deployment.**

### 7. API Contract Verification (CRITICAL)
```
❌ WRONG: Develop frontend and backend separately
✅ RIGHT: Define API contract first, verify alignment before deploy
```

**Frontend expects these endpoints - VERIFY ALL EXIST:**

| Endpoint | Method | Frontend Location | Backend File |
|----------|--------|-------------------|--------------|
| `/auth/logout` | POST | useAuth.ts | auth.py |
| `/chatbot/message` | POST | useChat.ts | chatbot.py |
| `/chatbot/briefing` | GET | useChat.ts | chatbot.py |
| `/jobs/search` | GET | useJobs.ts | jobs.py |
| `/jobs/saved` | GET | useJobs.ts | jobs.py |
| `/jobs/{id}/save` | POST | useJobs.ts | jobs.py |
| `/applications` | POST | useJobs.ts | applications.py |
| `/applications/stats` | GET | useDashboard.ts | applications.py |

**Run this verification:**
```bash
# List all frontend API calls
grep -r "api\.(get\|post\|put\|delete)" frontend/src/hooks/ | grep -oP "['\"]/[^'\"]+['\"]"

# List all backend routes
grep -r "@router\.(get\|post\|put\|delete)" backend/app/api/v1/ | grep -oP "['\"][^'\"]+['\"]"

# Compare and find mismatches
```

### 8. Frontend Route Inventory (CRITICAL)
```
❌ WRONG: Create Link components, forget to create pages
✅ RIGHT: Every Link/navigate() must have a corresponding route in App.tsx
```

**Common missing routes:**

| Link Location | Expected Route | Page Component |
|---------------|----------------|----------------|
| Login.tsx "Forgot password?" | `/forgot-password` | ForgotPassword.tsx |
| Register.tsx "Terms" | `/terms` | Terms.tsx |
| Register.tsx "Privacy" | `/privacy` | Privacy.tsx |
| Dashboard "Applications" | `/applications` | Applications.tsx |
| Dashboard "AI Coach" | `/chat` | Chat.tsx |

**Run this verification:**
```bash
# Find all Link/navigate destinations
grep -rE "(to=['\"]|navigate\(['\"])" frontend/src/ | grep -oP "(to|navigate\()['\"][^'\"]+['\"]"

# List all Route paths
grep -E "<Route.*path=" frontend/src/App.tsx | grep -oP "path=['\"][^'\"]+['\"]"

# Compare and find missing routes
```

### 9. Standard Features Checklist (CRITICAL)
```
❌ WRONG: Assume standard features exist
✅ RIGHT: Explicitly verify ALL standard web app features
```

**Every web app MUST have:**

- [ ] Logout endpoint (server-side token invalidation)
- [ ] Forgot password flow (email reset)
- [ ] Terms of Service page
- [ ] Privacy Policy page
- [ ] 404 Not Found page
- [ ] Error boundary/page
- [ ] Cookie consent (GDPR)
- [ ] Mobile responsive design

### 10. Schema Alignment Verification (CRITICAL)
```
❌ WRONG: Frontend team assumes response shape
✅ RIGHT: Shared TypeScript/Pydantic schemas, verified at build time
```

**Common schema mismatches:**

| Frontend Expects | Backend Returns | Fix |
|------------------|-----------------|-----|
| `total_applications` | `total` | Align field names |
| `by_status: {}` | `pending, interviewing...` | Structure response |
| `interview_rate: float` | Not returned | Add computed field |
| `this_week: int` | Not returned | Add query |

**Run this verification:**
```bash
# Compare TypeScript interfaces with Pydantic schemas
# frontend/src/types/*.ts vs backend/app/schemas/*.py
```

### 11. E2E Testing Before Deployment (CRITICAL)
```
❌ WRONG: Deploy, then discover broken flows
✅ RIGHT: Run E2E tests against staging before production
```

**Critical user flows to test:**

1. **Registration → Login → Dashboard**
   - Register with email
   - Verify email (if required)
   - Login with credentials
   - See dashboard with user data

2. **Job Search → Apply Flow**
   - Search for jobs
   - View job details
   - Click Apply
   - Confirm application created

3. **Resume Upload → Parse → View**
   - Upload PDF/DOCX
   - Wait for parsing
   - View parsed data

4. **All Navigation Links**
   - Click EVERY link in the UI
   - Verify no 404 errors

## Pre-Deployment Verification Script

**Run this BEFORE every deployment:**

```bash
#!/bin/bash
# pre-deploy-verify.sh

echo "=== 1. API Contract Check ==="
# Find frontend API calls not in backend
FRONTEND_APIS=$(grep -rhoP "api\.(get|post)\(['\"][^'\"]+['\"]" frontend/src/ | sort -u)
BACKEND_ROUTES=$(grep -rhoP "@router\.(get|post)\(['\"][^'\"]+['\"]" backend/app/api/ | sort -u)
echo "Frontend expects: $FRONTEND_APIS"
echo "Backend provides: $BACKEND_ROUTES"

echo "=== 2. Route Check ==="
# Find Link destinations not in App.tsx routes
LINK_TARGETS=$(grep -rhoP "to=['\"][^'\"]+['\"]" frontend/src/ | sort -u)
DEFINED_ROUTES=$(grep -oP "path=['\"][^'\"]+['\"]" frontend/src/App.tsx | sort -u)
echo "Links point to: $LINK_TARGETS"
echo "Routes defined: $DEFINED_ROUTES"

echo "=== 3. Standard Features ==="
grep -q "logout" backend/app/api/v1/auth.py && echo "✅ Logout endpoint" || echo "❌ Logout endpoint MISSING"
grep -q "/api/v1/health" backend/app/main.py && echo "✅ API health endpoint" || echo "❌ API health endpoint MISSING (ALB needs /api/v1/health)"
test -f frontend/src/pages/auth/ForgotPassword.tsx && echo "✅ Forgot password page" || echo "❌ Forgot password page MISSING"
test -f frontend/src/pages/legal/Terms.tsx && echo "✅ Terms page" || echo "❌ Terms page MISSING"
test -f frontend/src/pages/legal/Privacy.tsx && echo "✅ Privacy page" || echo "❌ Privacy page MISSING"

echo "=== 3.1 Jobs API Implementation ==="
grep -q "select(Job)" backend/app/api/v1/jobs.py && echo "✅ Jobs search has DB query" || echo "❌ Jobs search is STUB (no DB query)"

echo "=== 4. Build Verification ==="
cd frontend && npm run build && cd ..
cd backend && python -m pytest tests/ -x && cd ..

echo "=== 5. E2E Tests ==="
npm run test:e2e
```

## Extended Deployment Verification Matrix

| Check | Command/Action | Expected |
|-------|----------------|----------|
| Logout works | Click logout, verify redirect | Token invalidated |
| Forgot password | Click link, submit email | No 404 |
| Terms page | Click link | Content displays |
| Privacy page | Click link | Content displays |
| Applications page | Navigate | No 404 |
| Chatbot | Send message | Response returned |
| Job search | Search query | Results or empty array |
| Apply for job | Click apply | Application created |
| Save job | Click save | Job saved |
| Application stats | View dashboard | Numbers display |

## Post-Deployment Monitoring

**Monitor for 24 hours after deployment:**

```bash
# Check for 404 errors
aws logs filter-log-events --log-group-name /ecs/$PROJECT \
  --filter-pattern "404" --start-time $(date -d '24 hours ago' +%s000)

# Check for 500 errors
aws logs filter-log-events --log-group-name /ecs/$PROJECT \
  --filter-pattern "500" --start-time $(date -d '24 hours ago' +%s000)

# Check endpoint hit counts
aws logs filter-log-events --log-group-name /ecs/$PROJECT \
  --filter-pattern "POST /api/v1/auth/logout" --start-time $(date -d '24 hours ago' +%s000)
```

## Related Skills

- `superpowers:brainstorming` - For requirements gathering
- `superpowers:writing-plans` - For detailed task planning
- `superpowers:executing-plans` - For task-by-task implementation
- `superpowers:verification-before-completion` - For final verification
- `1-click-deploy:api-contract-check` - Verify frontend/backend API alignment
- `1-click-deploy:route-inventory` - Verify all frontend routes exist
- `1-click-deploy:post-deploy-test` - E2E testing after deployment
