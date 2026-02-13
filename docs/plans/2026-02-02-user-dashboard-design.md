# User Dashboard Implementation Plan

## Overview

Create a personal dashboard for each user where they can view their project details, build status, and interact with their CoCreate session after admin approval.

## URL Structure

```
/user.id={guid}          → Clean URL (primary)
/user.html?id={guid}     → Fallback URL
```

## User Flow

```
┌─────────────────────────────────────────────────────────────────┐
│                      ADMIN APPROVES                              │
└─────────────────────┬───────────────────────────────────────────┘
                      ↓
┌─────────────────────────────────────────────────────────────────┐
│  External Build API returns: { guid, link }                      │
│  Email sent to user with: cocreate-app.com/user.id={guid}       │
└─────────────────────┬───────────────────────────────────────────┘
                      ↓
┌─────────────────────────────────────────────────────────────────┐
│  USER CLICKS LINK (First Time)                                   │
│  → Check if user exists in S3                                    │
│  → Show SIGNUP form: username, password, confirm password        │
└─────────────────────┬───────────────────────────────────────────┘
                      ↓
┌─────────────────────────────────────────────────────────────────┐
│  USER SIGNS UP                                                   │
│  → Hash password with bcrypt                                     │
│  → Save to S3: users/{guid}/credentials.json                     │
│  → Create session cookie                                         │
│  → Email credentials to user                                     │
│  → Redirect to dashboard                                         │
└─────────────────────┬───────────────────────────────────────────┘
                      ↓
┌─────────────────────────────────────────────────────────────────┐
│  USER DASHBOARD                                                  │
│  ├── Project Overview (name, status, dates)                      │
│  ├── Build Session Link (clickable)                              │
│  ├── Project Details (idea, target customer, timeline)           │
│  ├── Build Progress (phases: architect, developer, deployer)     │
│  ├── Chat History (conversation with AI)                         │
│  ├── Documents/Files (if any)                                    │
│  └── Account Settings (change password)                          │
└─────────────────────────────────────────────────────────────────┘
```

## Returning User Flow

```
User visits /user.html?id={guid}
        ↓
Check session cookie
        ↓
┌───────┴───────┐
│ Valid Session │ → Show Dashboard
└───────┬───────┘
        │ No/Expired
        ↓
Show LOGIN form
        ↓
Validate credentials (bcrypt compare)
        ↓
Create session cookie
        ↓
Show Dashboard
```

---

## Technical Implementation

### 1. Frontend Files

#### `/user.html`
- Responsive design matching CoCreate theme
- Three states: Signup, Login, Dashboard
- Password visibility toggle
- Loading states
- Toast notifications

#### `/js/user-core.js`
- State management (signup/login/dashboard)
- API calls to Lambda
- Cookie handling
- Form validation
- Dashboard rendering

### 2. Lambda Endpoints (add to index.mjs)

| Action | Description | Request | Response |
|--------|-------------|---------|----------|
| `user-check` | Check if user exists | `{ guid }` | `{ exists, hasAccount }` |
| `user-signup` | Create account | `{ guid, username, password }` | `{ success, sessionToken }` |
| `user-login` | Authenticate | `{ guid, username, password }` | `{ success, sessionToken }` |
| `user-dashboard` | Get dashboard data | `{ guid, sessionToken }` | `{ success, data }` |
| `user-change-password` | Update password | `{ guid, sessionToken, oldPassword, newPassword }` | `{ success }` |

### 3. S3 Storage Structure

```
cocreate-applications-data/
├── users/
│   └── {guid}/
│       ├── credentials.json      # { username, passwordHash, createdAt }
│       ├── sessions.json         # { tokens: [{ token, createdAt, expiresAt }] }
│       └── profile.json          # { name, email, phone, preferences }
├── applications/
│   └── {email}/
│       └── {date}/
│           └── {timestamp}.json  # Application data (already exists)
```

### 4. Session Management

```javascript
// Session token structure
{
  token: "random-64-char-string",
  guid: "user-guid",
  createdAt: "2026-02-02T...",
  expiresAt: "2026-02-09T...",  // 7 days
  userAgent: "browser-info"
}

// Cookie settings
{
  name: "cocreate_session",
  value: "{token}",
  httpOnly: false,  // Need JS access
  secure: true,     // HTTPS only
  sameSite: "Lax",
  maxAge: 7 * 24 * 60 * 60  // 7 days
}
```

### 5. Password Security

```javascript
// Signup
const bcrypt = await import('bcryptjs');
const saltRounds = 10;
const passwordHash = await bcrypt.hash(password, saltRounds);

// Login
const isValid = await bcrypt.compare(password, storedHash);
```

### 6. Email with Credentials

When user signs up, send email with:
- Username
- Password (one-time, recommend changing)
- Dashboard link
- Build session link

---

## Dashboard Features

### 1. Header
- CoCreate logo
- User name
- Logout button

### 2. Project Overview Card
```
┌─────────────────────────────────────────┐
│ 🚀 Your Project                         │
├─────────────────────────────────────────┤
│ Status: ● Building                      │
│ Started: Feb 2, 2026                    │
│ Estimated: 2 weeks                      │
└─────────────────────────────────────────┘
```

### 3. Build Session Card
```
┌─────────────────────────────────────────┐
│ 🔗 Build Session                        │
├─────────────────────────────────────────┤
│ Your live build environment:            │
│ [Access Build Session →]                │
│                                         │
│ Session ID: abc123...                   │
└─────────────────────────────────────────┘
```

### 4. Project Details Card
```
┌─────────────────────────────────────────┐
│ 📋 Project Details                      │
├─────────────────────────────────────────┤
│ Idea: AI-powered restaurant menu...     │
│ Target: Restaurant owners               │
│ Timeline: ASAP                          │
│ Industry: SaaS                          │
└─────────────────────────────────────────┘
```

### 5. Build Progress Card
```
┌─────────────────────────────────────────┐
│ 📊 Build Progress                       │
├─────────────────────────────────────────┤
│ [✓] Architect    - Complete             │
│ [●] Developer    - In Progress (65%)    │
│ [ ] Deployer     - Pending              │
└─────────────────────────────────────────┘
```

### 6. Chat History Card
```
┌─────────────────────────────────────────┐
│ 💬 Conversation History                 │
├─────────────────────────────────────────┤
│ [Expandable chat messages]              │
│ User: I want to build...                │
│ AI: Great idea! Let me...               │
└─────────────────────────────────────────┘
```

### 7. Account Settings
```
┌─────────────────────────────────────────┐
│ ⚙️ Account                              │
├─────────────────────────────────────────┤
│ Username: johndoe                       │
│ Email: john@example.com                 │
│ [Change Password]                       │
└─────────────────────────────────────────┘
```

---

## Implementation Steps

### Phase 1: Backend (Lambda)
1. Add bcryptjs to package.json
2. Add `user-check` endpoint
3. Add `user-signup` endpoint (with bcrypt + session + email)
4. Add `user-login` endpoint (with bcrypt + session)
5. Add `user-dashboard` endpoint (fetch all user data)
6. Add `user-change-password` endpoint
7. Deploy Lambda

### Phase 2: Frontend
1. Create `user.html` with three-state UI
2. Create `js/user-core.js` with all logic
3. Style matching CoCreate theme
4. Add password visibility toggle
5. Add form validation
6. Add toast notifications

### Phase 3: Integration
1. Update build approval email to use new /user.html link
2. Test full flow: approve → email → signup → login → dashboard
3. Sync to S3 and invalidate CloudFront

### Phase 4: Testing
1. Test signup flow
2. Test login flow
3. Test session expiry
4. Test password change
5. Test mobile responsiveness

---

## Files to Create/Modify

| File | Action |
|------|--------|
| `projects/ai-chat-widget/backend/index.mjs` | Add user endpoints |
| `projects/ai-chat-widget/backend/package.json` | Add bcryptjs |
| `option-a-threejs-gsap-tailwind/site/user.html` | Create new |
| `option-a-threejs-gsap-tailwind/site/js/user-core.js` | Create new |

---

## Security Considerations

1. **Password hashing**: bcrypt with salt rounds = 10
2. **Session tokens**: Cryptographically random, 64 chars
3. **HTTPS only**: Cookies with secure flag
4. **Rate limiting**: Consider adding for login attempts
5. **Input validation**: Sanitize all inputs
6. **No password in logs**: Never log passwords

---

## Estimated Effort

- Backend (Lambda endpoints): ~2 hours
- Frontend (HTML + JS): ~2 hours
- Testing & polish: ~1 hour
- **Total: ~5 hours**
