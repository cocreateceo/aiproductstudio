---
name: post-deploy-test
description: Comprehensive E2E testing after deployment. Tests all critical user flows and catches issues before users do.
---

# Post-Deployment Testing

## Overview

This skill provides a comprehensive testing checklist for after deployment. Run these tests BEFORE announcing deployment is complete.

**Core principle:** Click every link, test every flow, catch every bug before users do.

## When to Use

- Immediately after deploying to staging
- Immediately after deploying to production
- After any hotfix deployment
- During deployment verification

## The Testing Process

### Phase 1: Infrastructure Verification

```bash
# 1. Health checks
curl -s https://$DOMAIN/health | jq
curl -s https://$DOMAIN/api/v1/health | jq

# 2. SSL certificate
echo | openssl s_client -servername $DOMAIN -connect $DOMAIN:443 2>/dev/null | openssl x509 -noout -dates

# 3. CloudFront distribution
aws cloudfront get-distribution --id $CF_DIST_ID --query 'Distribution.Status'

# 4. ECS service status
aws ecs describe-services --cluster $CLUSTER --services $SERVICE \
  --query 'services[0].{status:status,running:runningCount,desired:desiredCount}'
```

### Phase 2: Authentication Flows

**Test in incognito browser:**

| Test | Steps | Expected | Status |
|------|-------|----------|--------|
| Register | Fill form, submit | Account created, redirect | ☐ |
| Email verification | Click email link | Account verified | ☐ |
| Login | Enter credentials | JWT returned, dashboard shown | ☐ |
| Logout | Click logout | Session ended, redirect to login | ☐ |
| Forgot password | Enter email | Reset email sent | ☐ |
| Reset password | Click link, enter new | Password changed | ☐ |
| OAuth Google | Click button | Redirect to Google, back | ☐ |
| OAuth Microsoft | Click button | Redirect to Microsoft, back | ☐ |
| OAuth LinkedIn | Click button | Redirect to LinkedIn, back | ☐ |
| Invalid login | Wrong password | Error message shown | ☐ |
| Protected route | Access /dashboard unauthenticated | Redirect to login | ☐ |

### Phase 3: Navigation Testing

**Click every link in the UI:**

| Page | Link | Target | Status |
|------|------|--------|--------|
| Header | Logo | / | ☐ |
| Header | Dashboard | /dashboard | ☐ |
| Header | Jobs | /jobs | ☐ |
| Header | Resume | /resume | ☐ |
| Header | Logout | (action) | ☐ |
| Login | Forgot password | /forgot-password | ☐ |
| Login | Register | /register | ☐ |
| Register | Terms | /terms | ☐ |
| Register | Privacy | /privacy | ☐ |
| Register | Login | /login | ☐ |
| Dashboard | Applications | /applications | ☐ |
| Dashboard | AI Coach | /chat | ☐ |
| Footer | Terms | /terms | ☐ |
| Footer | Privacy | /privacy | ☐ |

### Phase 4: Core Feature Testing

#### 4.1 Resume Upload Flow
```
1. Navigate to /resume
2. Click "Upload Resume"
3. Select PDF file (< 5MB)
4. Verify upload progress
5. Wait for parsing (< 30 seconds)
6. Verify parsed data displays
```

Expected: Resume parsed, skills/experience extracted

#### 4.2 Job Search Flow
```
1. Navigate to /jobs
2. Enter search query
3. Verify results load (< 5 seconds)
4. Apply filters (location, salary)
5. Sort results
6. Click job card
7. Verify job details modal
```

Expected: Jobs displayed, filters work, details show

#### 4.3 Job Application Flow
```
1. From job details, click "Apply"
2. Fill application form
3. Attach customized resume
4. Submit application
5. Verify success message
6. Check /applications page
7. Verify application appears
```

Expected: Application created, appears in list

#### 4.4 AI Chatbot Flow
```
1. Open chat widget or /chat
2. Send "Hello"
3. Wait for response (< 5 seconds)
4. Verify AI responds
5. Ask about job matches
6. Verify contextual response
```

Expected: AI responds, maintains context

#### 4.5 Save Job Flow
```
1. From job card, click "Save"
2. Verify save confirmation
3. Navigate to saved jobs
4. Verify job appears
5. Click "Unsave"
6. Verify removal
```

Expected: Save/unsave works, persists

### Phase 5: API Endpoint Testing

```bash
# Get auth token first
TOKEN=$(curl -s -X POST https://$DOMAIN/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"test@example.com","password":"Test123!"}' | jq -r '.access_token')

# Test authenticated endpoints
curl -s https://$DOMAIN/api/v1/users/me -H "Authorization: Bearer $TOKEN" | jq
curl -s https://$DOMAIN/api/v1/applications -H "Authorization: Bearer $TOKEN" | jq
curl -s https://$DOMAIN/api/v1/applications/stats -H "Authorization: Bearer $TOKEN" | jq
curl -s https://$DOMAIN/api/v1/jobs -H "Authorization: Bearer $TOKEN" | jq
curl -s https://$DOMAIN/api/v1/jobs/matched -H "Authorization: Bearer $TOKEN" | jq
curl -s https://$DOMAIN/api/v1/jobs/saved -H "Authorization: Bearer $TOKEN" | jq

# Test chatbot
curl -s -X POST https://$DOMAIN/api/v1/chatbot/message \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"message":"Hello"}' | jq

curl -s https://$DOMAIN/api/v1/chatbot/briefing -H "Authorization: Bearer $TOKEN" | jq
```

### Phase 6: Error Handling Testing

| Test | Action | Expected |
|------|--------|----------|
| 404 page | Navigate to /nonexistent | Custom 404 page |
| Invalid JSON | POST malformed JSON | 400 Bad Request |
| Expired token | Use old JWT | 401 Unauthorized |
| Rate limiting | Spam requests | 429 Too Many Requests |
| Large file | Upload 100MB file | Size limit error |
| Invalid file | Upload .exe file | Type error |

### Phase 7: Browser Console Check

```javascript
// Open browser console and verify NO errors
// Check for:
// - 404 errors (missing resources)
// - 500 errors (server issues)
// - CORS errors (configuration)
// - JavaScript errors (bugs)
// - Console warnings (deprecations)
```

### Phase 8: Mobile Responsiveness

Test on mobile viewport (375px width):

| Check | Status |
|-------|--------|
| Header collapses to hamburger | ☐ |
| Forms are full-width | ☐ |
| Text is readable | ☐ |
| Buttons are tappable | ☐ |
| No horizontal scroll | ☐ |
| Modals fit screen | ☐ |

### Phase 9: Performance Checks

```bash
# Lighthouse audit
npx lighthouse https://$DOMAIN --output=json --output-path=./lighthouse.json

# Key metrics to verify:
# - First Contentful Paint < 2s
# - Time to Interactive < 4s
# - Largest Contentful Paint < 3s
# - Cumulative Layout Shift < 0.1
```

### Phase 10: Security Checks

| Check | Method | Expected |
|-------|--------|----------|
| HTTPS only | `curl -I http://$DOMAIN` | Redirect to HTTPS |
| Security headers | Check response | X-Frame-Options, CSP |
| No sensitive data in URL | Check auth flow | No tokens in URL |
| Rate limiting | Spam login | 429 after threshold |
| XSS protection | Test input fields | Input sanitized |

## Post-Deployment Monitoring Setup

```bash
# Set up CloudWatch alarms
aws cloudwatch put-metric-alarm \
  --alarm-name "$PROJECT-5xx-errors" \
  --metric-name "HTTPCode_Target_5XX_Count" \
  --namespace "AWS/ApplicationELB" \
  --statistic Sum \
  --period 300 \
  --threshold 10 \
  --comparison-operator GreaterThanThreshold \
  --evaluation-periods 1

# Monitor error logs
aws logs tail /ecs/$PROJECT --follow --filter-pattern "ERROR"
```

## Test Automation Script

```bash
#!/bin/bash
# post-deploy-test.sh

DOMAIN="$1"
if [ -z "$DOMAIN" ]; then
  echo "Usage: ./post-deploy-test.sh <domain>"
  exit 1
fi

echo "=== Post-Deployment Testing: $DOMAIN ==="

echo -e "\n=== Phase 1: Health Checks ==="
curl -sf "$DOMAIN/health" && echo "✅ Frontend health" || echo "❌ Frontend health"
curl -sf "$DOMAIN/api/v1/health" && echo "✅ Backend health" || echo "❌ Backend health"

echo -e "\n=== Phase 2: Auth Endpoints ==="
curl -sf -X POST "$DOMAIN/api/v1/auth/login" -H "Content-Type: application/json" \
  -d '{"email":"invalid","password":"invalid"}' | grep -q "error" && \
  echo "✅ Login endpoint (rejects invalid)" || echo "❌ Login endpoint"

echo -e "\n=== Phase 3: Navigation Links ==="
for path in "/" "/login" "/register" "/terms" "/privacy" "/forgot-password"; do
  curl -sf "$DOMAIN$path" > /dev/null && echo "✅ $path" || echo "❌ $path (404)"
done

echo -e "\n=== Phase 4: Protected Routes ==="
curl -sf "$DOMAIN/dashboard" -o /dev/null -w "%{http_code}" | grep -q "302\|401" && \
  echo "✅ Dashboard protected" || echo "⚠️ Dashboard not protected"

echo -e "\n=== Phase 5: Console Error Check ==="
echo "Open browser DevTools and verify no red errors in console"

echo -e "\n=== Testing Complete ==="
echo "Manual verification required for:"
echo "- OAuth flows (requires browser)"
echo "- File uploads"
echo "- AI chatbot responses"
echo "- Mobile responsiveness"
```

## Output Format

```
=== Post-Deployment Test Report ===
Domain: https://careers.cocreateideas.com
Date: 2026-02-02 14:30 UTC

✅ PASSING (25 tests)
  - Frontend health check
  - Backend health check
  - User registration
  - User login
  - Protected routes
  ...

❌ FAILING (3 tests)
  - Logout endpoint (404)
  - Forgot password page (404)
  - Chatbot message endpoint (404)

⚠️ WARNINGS (2 tests)
  - Rate limiting not configured
  - CSP header missing

=== Action Required ===
1. Add logout endpoint to auth.py
2. Create ForgotPassword.tsx page
3. Create chatbot.py router and register in main.py
4. Configure rate limiting middleware
5. Add Content-Security-Policy header

=== Next Steps ===
After fixing issues, re-run: ./post-deploy-test.sh https://careers.cocreateideas.com
```
