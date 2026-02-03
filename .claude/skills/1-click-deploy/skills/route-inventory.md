---
name: route-inventory
description: Verify all frontend navigation links have corresponding route definitions and page components. Prevents broken links and 404 errors.
---

# Frontend Route Inventory

## Overview

This skill ensures every navigation link in the frontend has a corresponding route definition and page component. Run this BEFORE every deployment to prevent broken links.

**Core principle:** Every link must lead somewhere.

## When to Use

- Before deploying to staging or production
- After adding new navigation links
- After creating new pages
- When debugging broken links in production

## The Verification Process

### Step 1: Find All Navigation Destinations

```bash
# Find Link components
grep -rn "to=['\"]" frontend/src/ | grep -oP "to=['\"][^'\"]+['\"]" > /tmp/link-targets.txt

# Find navigate() calls
grep -rn "navigate(['\"]" frontend/src/ | grep -oP "navigate\(['\"][^'\"]+['\"]" >> /tmp/link-targets.txt

# Find window.location assignments
grep -rn "window.location" frontend/src/ | grep -oP "=['\"][/][^'\"]+['\"]" >> /tmp/link-targets.txt

# Extract unique paths
cat /tmp/link-targets.txt | grep -oP "['\"][/][^'\"]+['\"]" | sort -u
```

### Step 2: Find All Route Definitions

```bash
# Find Route components in App.tsx or router config
grep -n "path=" frontend/src/App.tsx | grep -oP "path=['\"][^'\"]+['\"]"

# Or if using React Router config
grep -n "path:" frontend/src/router.tsx | grep -oP "path:['\"][^'\"]+['\"]"
```

### Step 3: Create Inventory Table

| Link Location | Target Path | Route Defined | Page Exists | Status |
|---------------|-------------|---------------|-------------|--------|
| Login.tsx:251 | `/forgot-password` | ❌ No | ❌ No | **FIX** |
| Register.tsx:256 | `/terms` | ❌ No | ❌ No | **FIX** |
| Register.tsx:258 | `/privacy` | ❌ No | ❌ No | **FIX** |
| Dashboard.tsx:49 | `/applications` | ❌ No | ❌ No | **FIX** |
| Dashboard.tsx:151 | `/chat` | ❌ No | ❌ No | **FIX** |
| Header.tsx:45 | `/jobs` | ✅ Yes | ✅ Yes | OK |
| Header.tsx:52 | `/dashboard` | ✅ Yes | ✅ Yes | OK |

### Step 4: Verify Page Components Exist

```bash
# For each route, verify the component exists
ls frontend/src/pages/

# Check for lazy-loaded components
grep -rn "lazy(" frontend/src/App.tsx
```

## Common Issues

### Issue 1: Missing Route Definition

```tsx
// ❌ Link exists but no route
<Link to="/forgot-password">Forgot password?</Link>

// App.tsx is missing:
// <Route path="/forgot-password" element={<ForgotPassword />} />

// ✅ FIX: Add route to App.tsx
import ForgotPassword from './pages/auth/ForgotPassword';

<Route path="/forgot-password" element={<ForgotPassword />} />
```

### Issue 2: Missing Page Component

```tsx
// Route defined but component doesn't exist
<Route path="/applications" element={<Applications />} />
// ERROR: Cannot find module './pages/Applications'

// ✅ FIX: Create the page component
// frontend/src/pages/Applications.tsx
export default function Applications() {
  return <div>Applications Page</div>;
}
```

### Issue 3: Legal Pages Missing

```tsx
// Registration requires legal links
<Link to="/terms">Terms of Service</Link>
<Link to="/privacy">Privacy Policy</Link>

// ✅ FIX: Create legal pages
// frontend/src/pages/legal/Terms.tsx
// frontend/src/pages/legal/Privacy.tsx
```

## Standard Routes Checklist

Every web app MUST have these routes:

### Authentication Routes
- [ ] `/login` - Login page
- [ ] `/register` - Registration page
- [ ] `/forgot-password` - Password reset request
- [ ] `/reset-password/:token` - Password reset form
- [ ] `/verify-email/:token` - Email verification

### Legal Routes
- [ ] `/terms` - Terms of Service
- [ ] `/privacy` - Privacy Policy
- [ ] `/cookies` - Cookie Policy (GDPR)

### User Routes
- [ ] `/dashboard` - Main dashboard
- [ ] `/profile` - User profile/settings
- [ ] `/notifications` - Notifications center

### Error Routes
- [ ] `*` - 404 Not Found catch-all
- [ ] `/error` - Generic error page
- [ ] `/maintenance` - Maintenance page

## Directory Structure

```
frontend/src/pages/
├── auth/
│   ├── Login.tsx
│   ├── Register.tsx
│   ├── ForgotPassword.tsx      # Often missing!
│   └── ResetPassword.tsx       # Often missing!
├── legal/
│   ├── Terms.tsx               # Often missing!
│   ├── Privacy.tsx             # Often missing!
│   └── Cookies.tsx
├── Dashboard.tsx
├── Applications.tsx            # Often missing!
├── Jobs.tsx
├── Chat.tsx                    # Often missing!
├── NotFound.tsx                # Often missing!
└── Error.tsx
```

## Quick Fix Templates

### ForgotPassword.tsx
```tsx
import { useState } from 'react';
import { Link } from 'react-router-dom';

export default function ForgotPassword() {
  const [email, setEmail] = useState('');
  const [submitted, setSubmitted] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    // API call to request password reset
    setSubmitted(true);
  };

  if (submitted) {
    return (
      <div className="text-center">
        <h1>Check your email</h1>
        <p>We sent a password reset link to {email}</p>
        <Link to="/login">Back to login</Link>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit}>
      <h1>Forgot Password</h1>
      <input
        type="email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        placeholder="Enter your email"
        required
      />
      <button type="submit">Send Reset Link</button>
      <Link to="/login">Back to login</Link>
    </form>
  );
}
```

### Terms.tsx
```tsx
export default function Terms() {
  return (
    <div className="max-w-4xl mx-auto p-8">
      <h1>Terms of Service</h1>
      <p>Last updated: {new Date().toLocaleDateString()}</p>

      <h2>1. Acceptance of Terms</h2>
      <p>By accessing and using this service, you accept and agree to be bound by these terms.</p>

      <h2>2. Use of Service</h2>
      <p>You agree to use this service only for lawful purposes.</p>

      {/* Add more sections as needed */}
    </div>
  );
}
```

### NotFound.tsx
```tsx
import { Link } from 'react-router-dom';

export default function NotFound() {
  return (
    <div className="text-center py-20">
      <h1 className="text-6xl font-bold">404</h1>
      <p className="text-xl mt-4">Page not found</p>
      <Link to="/" className="mt-8 inline-block">
        Go back home
      </Link>
    </div>
  );
}
```

## Output Format

```
=== Frontend Route Inventory Report ===

✅ COMPLETE ROUTES (8 routes)
  - /login → Login.tsx ✓
  - /register → Register.tsx ✓
  - /dashboard → Dashboard.tsx ✓
  ...

❌ MISSING ROUTES (5 routes)
  - /forgot-password
    Link at: Login.tsx:251
    Action: Create ForgotPassword.tsx + add route

  - /terms
    Link at: Register.tsx:256
    Action: Create Terms.tsx + add route

  - /privacy
    Link at: Register.tsx:258
    Action: Create Privacy.tsx + add route

  - /applications
    Link at: Dashboard.tsx:49
    Action: Create Applications.tsx + add route

  - /chat
    Link at: Dashboard.tsx:151
    Action: Create Chat.tsx + add route

⚠️ NO 404 HANDLER
  Add: <Route path="*" element={<NotFound />} />

=== Files to Create ===
1. frontend/src/pages/auth/ForgotPassword.tsx
2. frontend/src/pages/legal/Terms.tsx
3. frontend/src/pages/legal/Privacy.tsx
4. frontend/src/pages/Applications.tsx
5. frontend/src/pages/Chat.tsx
6. frontend/src/pages/NotFound.tsx

=== Routes to Add (App.tsx) ===
<Route path="/forgot-password" element={<ForgotPassword />} />
<Route path="/terms" element={<Terms />} />
<Route path="/privacy" element={<Privacy />} />
<Route path="/applications" element={<ProtectedRoute><Applications /></ProtectedRoute>} />
<Route path="/chat" element={<ProtectedRoute><Chat /></ProtectedRoute>} />
<Route path="*" element={<NotFound />} />
```
