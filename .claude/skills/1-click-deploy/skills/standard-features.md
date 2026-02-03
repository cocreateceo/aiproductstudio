---
name: standard-features
description: Verify all standard web application features are implemented. Prevents missing logout, forgot-password, legal pages, and other commonly forgotten features.
---

# Standard Features Checklist

## Overview

This skill ensures all standard web application features are implemented. These features are often assumed to exist but never explicitly planned, causing broken links and missing functionality.

**Core principle:** Explicit is better than implicit. Every feature must be planned.

## When to Use

- During planning phase to ensure completeness
- Before deployment to verify all features exist
- When reviewing implementation plan coverage
- After discovering broken standard features

## Standard Feature Categories

### 1. Authentication Features

| Feature | Backend Endpoint | Frontend Page | Status |
|---------|------------------|---------------|--------|
| Register | `POST /auth/register` | `/register` | ☐ |
| Login | `POST /auth/login` | `/login` | ☐ |
| Logout | `POST /auth/logout` | (action) | ☐ |
| Refresh Token | `POST /auth/refresh` | (automatic) | ☐ |
| Forgot Password | `POST /auth/forgot-password` | `/forgot-password` | ☐ |
| Reset Password | `POST /auth/reset-password` | `/reset-password/:token` | ☐ |
| Email Verification | `POST /auth/verify-email` | `/verify-email/:token` | ☐ |
| Change Password | `PUT /auth/change-password` | `/settings` | ☐ |
| OAuth Google | `GET /auth/oauth/google` | (redirect) | ☐ |
| OAuth Microsoft | `GET /auth/oauth/microsoft` | (redirect) | ☐ |
| OAuth LinkedIn | `GET /auth/oauth/linkedin` | (redirect) | ☐ |

**Commonly Missed:**
- ❌ Logout endpoint (JWT stateless assumption)
- ❌ Forgot password flow
- ❌ Email verification flow

### 2. Legal Pages

| Page | Route | Required By |
|------|-------|-------------|
| Terms of Service | `/terms` | All apps |
| Privacy Policy | `/privacy` | GDPR, CCPA |
| Cookie Policy | `/cookies` | GDPR |
| Acceptable Use | `/acceptable-use` | User-generated content apps |
| DMCA/Copyright | `/dmca` | Content platforms |

**Commonly Missed:**
- ❌ Terms (linked from registration but page doesn't exist)
- ❌ Privacy (linked from registration but page doesn't exist)

### 3. Error Pages

| Page | Route | Trigger |
|------|-------|---------|
| 404 Not Found | `*` (catch-all) | Invalid URL |
| 500 Server Error | `/error` | API failure |
| 403 Forbidden | `/forbidden` | Access denied |
| Maintenance | `/maintenance` | Planned downtime |

**Commonly Missed:**
- ❌ 404 page (shows blank page or framework error)
- ❌ Error boundary (crashes whole app on error)

### 4. User Profile Features

| Feature | Backend | Frontend | Status |
|---------|---------|----------|--------|
| View Profile | `GET /users/me` | `/profile` | ☐ |
| Edit Profile | `PUT /users/me` | `/profile/edit` | ☐ |
| Delete Account | `DELETE /users/me` | `/settings` | ☐ |
| Download Data | `GET /users/me/export` | `/settings` | ☐ |
| Notification Settings | `PUT /users/me/notifications` | `/settings` | ☐ |

**Commonly Missed:**
- ❌ Delete account (GDPR requirement)
- ❌ Data export (GDPR requirement)

### 5. Navigation Features

| Feature | Implementation | Status |
|---------|----------------|--------|
| Header | Global component | ☐ |
| Footer | Global component | ☐ |
| Mobile Menu | Hamburger + drawer | ☐ |
| Breadcrumbs | Navigation trail | ☐ |
| Back Button | History navigation | ☐ |
| Skip to Content | Accessibility | ☐ |

### 6. Session Management

| Feature | Implementation | Status |
|---------|----------------|--------|
| Auto-logout | Token expiry + redirect | ☐ |
| Session timeout warning | Modal before expiry | ☐ |
| Remember me | Persistent token | ☐ |
| Single session | Server-side tracking | ☐ |
| Device management | List active sessions | ☐ |

**Commonly Missed:**
- ❌ Auto-logout on token expiry
- ❌ Session timeout warning

### 7. Loading & Feedback States

| State | Implementation | Status |
|-------|----------------|--------|
| Page loading | Skeleton/spinner | ☐ |
| Button loading | Disable + spinner | ☐ |
| Form submitting | Loading state | ☐ |
| Success toast | Notification | ☐ |
| Error toast | Notification | ☐ |
| Empty state | "No data" message | ☐ |

### 8. Accessibility Features

| Feature | Implementation | Status |
|---------|----------------|--------|
| Focus management | Focus trap in modals | ☐ |
| Keyboard navigation | Tab order, shortcuts | ☐ |
| Screen reader labels | aria-label, alt text | ☐ |
| Color contrast | WCAG AA minimum | ☐ |
| Skip links | Skip to main content | ☐ |
| Focus visible | Outline on focus | ☐ |

## Implementation Checklist

### Backend Checklist

```python
# auth.py - Essential endpoints
@router.post("/register")      # ✓ Create account
@router.post("/login")         # ✓ Get JWT
@router.post("/logout")        # ❌ Often missing!
@router.post("/refresh")       # ✓ Refresh JWT
@router.post("/forgot-password")  # ❌ Often missing!
@router.post("/reset-password")   # ❌ Often missing!
@router.post("/verify-email")     # ❌ Often missing!

# users.py - Profile endpoints
@router.get("/users/me")       # ✓ Get profile
@router.put("/users/me")       # ✓ Update profile
@router.delete("/users/me")    # ❌ GDPR - Often missing!
@router.get("/users/me/export") # ❌ GDPR - Often missing!
```

### Frontend Checklist

```
src/pages/
├── auth/
│   ├── Login.tsx           ✓
│   ├── Register.tsx        ✓
│   ├── ForgotPassword.tsx  ❌ Often missing!
│   ├── ResetPassword.tsx   ❌ Often missing!
│   └── VerifyEmail.tsx     ❌ Often missing!
├── legal/
│   ├── Terms.tsx           ❌ Often missing!
│   ├── Privacy.tsx         ❌ Often missing!
│   └── Cookies.tsx         ❌ Often missing!
├── errors/
│   ├── NotFound.tsx        ❌ Often missing!
│   └── Error.tsx           ❌ Often missing!
└── settings/
    └── Settings.tsx        ✓
```

### App.tsx Routes Checklist

```tsx
// Essential routes often missing
<Route path="/forgot-password" element={<ForgotPassword />} />
<Route path="/reset-password/:token" element={<ResetPassword />} />
<Route path="/verify-email/:token" element={<VerifyEmail />} />
<Route path="/terms" element={<Terms />} />
<Route path="/privacy" element={<Privacy />} />
<Route path="*" element={<NotFound />} />
```

## Verification Script

```bash
#!/bin/bash
# standard-features-check.sh

echo "=== Standard Features Verification ==="

echo -e "\n=== Backend Auth Endpoints ==="
grep -q "logout" backend/app/api/v1/auth.py && echo "✅ Logout" || echo "❌ Logout MISSING"
grep -q "forgot.password\|forgot_password" backend/app/api/v1/auth.py && echo "✅ Forgot password" || echo "❌ Forgot password MISSING"
grep -q "reset.password\|reset_password" backend/app/api/v1/auth.py && echo "✅ Reset password" || echo "❌ Reset password MISSING"
grep -q "verify.email\|verify_email" backend/app/api/v1/auth.py && echo "✅ Verify email" || echo "❌ Verify email MISSING"

echo -e "\n=== GDPR Endpoints ==="
grep -rq "DELETE.*users/me\|delete_user\|delete_account" backend/app/api/ && echo "✅ Delete account" || echo "❌ Delete account MISSING"
grep -rq "export\|download.*data" backend/app/api/ && echo "✅ Data export" || echo "❌ Data export MISSING"

echo -e "\n=== Frontend Pages ==="
test -f frontend/src/pages/auth/ForgotPassword.tsx && echo "✅ Forgot password page" || echo "❌ Forgot password page MISSING"
test -f frontend/src/pages/auth/ResetPassword.tsx && echo "✅ Reset password page" || echo "❌ Reset password page MISSING"
test -f frontend/src/pages/legal/Terms.tsx && echo "✅ Terms page" || echo "❌ Terms page MISSING"
test -f frontend/src/pages/legal/Privacy.tsx && echo "✅ Privacy page" || echo "❌ Privacy page MISSING"

echo -e "\n=== Error Pages ==="
grep -q 'path="\*"' frontend/src/App.tsx && echo "✅ 404 route" || echo "❌ 404 route MISSING"
test -f frontend/src/pages/NotFound.tsx && echo "✅ NotFound component" || echo "❌ NotFound component MISSING"
grep -q "ErrorBoundary" frontend/src/App.tsx && echo "✅ Error boundary" || echo "❌ Error boundary MISSING"

echo -e "\n=== Legal Links ==="
grep -q 'to="/terms"' frontend/src/pages/auth/Register.tsx && echo "✅ Terms link exists" || echo "⚠️ No terms link"
grep -q 'to="/privacy"' frontend/src/pages/auth/Register.tsx && echo "✅ Privacy link exists" || echo "⚠️ No privacy link"
```

## Output Format

```
=== Standard Features Report ===

✅ IMPLEMENTED (15 features)
  - User registration
  - User login
  - JWT refresh
  - Profile view/edit
  ...

❌ MISSING (8 features)
  Backend:
    - POST /auth/logout
    - POST /auth/forgot-password
    - POST /auth/reset-password
    - DELETE /users/me (GDPR)

  Frontend:
    - /forgot-password page
    - /terms page
    - /privacy page
    - 404 handler

⚠️ PARTIAL (2 features)
  - Email verification (endpoint exists, page missing)
  - Error handling (toast exists, error page missing)

=== Compliance Issues ===
- GDPR: Missing delete account feature
- GDPR: Missing data export feature
- Legal: Missing terms page (linked from register)
- Legal: Missing privacy page (linked from register)

=== Priority Fixes ===
1. Create logout endpoint
2. Create forgot/reset password flow
3. Create terms and privacy pages
4. Add 404 handler
5. Add delete account for GDPR
```
