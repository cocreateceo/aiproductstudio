# CoCreate Email System - Complete Design Spec

**Date:** 2026-03-12
**Project:** cocreateidea.com
**Scope:** 14 transactional + scheduled emails covering application flow, auth, project lifecycle, account management, and engagement.

---

## 1. Overview

Add a complete email system to cocreateidea.com using the existing AWS SES infrastructure. All email logic lives in the existing Lambda (`chat-backend/index.mjs`), with scheduled emails triggered via EventBridge.

### User Flow Context

```
Visitor → Apply (chat widget / apply.html)
       → Admin reviews (admin.html)
       → Approved → Gets GUID + Tmux URLs
       → Signs up at user.html?id={GUID}
       → Logs in → Dashboard
```

---

## 2. Email Inventory

### Application Flow
| # | Template ID | Subject | Trigger | Recipients |
|---|---|---|---|---|
| 1 | `admin-new-application` | "New Application: {name} - {industry}" | Form submitted | CEO, COO, CTO |
| 2 | `applicant-acknowledgment` | "We received your application - CoCreate" | Form submitted | Applicant |
| 3 | `applicant-approved` | "You're approved! Welcome to CoCreate" | Admin approves | Applicant |
| 4 | `applicant-rejected` | "Update on your CoCreate application" | Admin rejects | Applicant |

### Auth Flow
| # | Template ID | Subject | Trigger | Recipients |
|---|---|---|---|---|
| 5 | `user-welcome` | "Welcome to CoCreate, {name}!" | User signs up | User |
| 6 | `password-reset-link` | "Reset your password - CoCreate" | Forgot password | User |
| 7 | `password-changed` | "Your password has been changed - CoCreate" | Password reset/changed | User |
| 8 | `new-login-alert` | "New login to your CoCreate account" | Login from new IP | User |

### Project Flow
| # | Template ID | Subject | Trigger | Recipients |
|---|---|---|---|---|
| 9 | `project-deployed` | "Your project is live! - CoCreate" | Build completes | User |
| 10 | `build-failed` | "Deployment issue with your project - CoCreate" | Build fails | User + Admins |

### Account Management
| # | Template ID | Subject | Trigger | Recipients |
|---|---|---|---|---|
| 11 | `account-deactivated` | "Your CoCreate account has been deactivated" | Admin removes user | User |
| 12 | `session-expiry-reminder` | "Your CoCreate session expires tomorrow" | 6 days after login | User |

### Engagement
| # | Template ID | Subject | Trigger | Recipients |
|---|---|---|---|---|
| 13 | `weekly-project-digest` | "Your weekly project update - CoCreate" | Every Monday 10AM EST | Active users |
| 14 | `re-engagement` | "We miss you! Check your project status" | No login 30 days | Inactive users |

---

## 3. Configuration

### Sender Config
```javascript
const EMAIL_CONFIG = {
  from: 'noreply@cocreateidea.com',
  replyTo: 'hello@cocreateidea.com',
  logoUrl: 'https://www.cocreateidea.com/assets/logo.png',
  siteUrl: 'https://www.cocreateidea.com',
  supportEmail: 'hello@cocreateidea.com'
};

const ADMIN_EMAILS = [
  'CEO@cocreateidea.com',
  'COO@cocreateidea.com',
  'CTO@cocreateidea.com'
];
```

### SES Setup
- Region: `us-east-1`
- Verified senders: `noreply@cocreateidea.com`, `hello@cocreateidea.com`
- New addresses to verify as recipients (if in sandbox): `COO@cocreateidea.com`, `CTO@cocreateidea.com`

---

## 4. Email Template Structure

All emails use a shared HTML base layout:

```html
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="margin:0; padding:0; background:#1a0a00; font-family:'Helvetica Neue',Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#1a0a00; padding:40px 20px;">
    <tr>
      <td align="center">
        <table width="600" cellpadding="0" cellspacing="0" style="background:#2a1810; border-radius:12px; overflow:hidden;">

          <!-- HEADER: Logo + gradient -->
          <tr>
            <td style="background:linear-gradient(135deg,#c4671a,#8b4513); padding:30px; text-align:center;">
              <img src="https://www.cocreateidea.com/assets/logo.png" alt="CoCreate" width="180" style="max-width:180px;">
            </td>
          </tr>

          <!-- BODY: Content -->
          <tr>
            <td style="padding:40px 30px; color:#f5e6d3;">
              {{CONTENT}}
            </td>
          </tr>

          <!-- FOOTER -->
          <tr>
            <td style="padding:20px 30px; border-top:1px solid #3a2518; text-align:center; color:#8b7355; font-size:12px;">
              <p>&copy; 2026 CoCreate | <a href="https://www.cocreateidea.com" style="color:#c4671a;">cocreateidea.com</a></p>
              <p>Support: <a href="mailto:hello@cocreateidea.com" style="color:#c4671a;">hello@cocreateidea.com</a></p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>
```

### CTA Button Style
```html
<a href="{{URL}}" style="display:inline-block; background:linear-gradient(135deg,#c4671a,#e8852a); color:#fff; padding:14px 32px; border-radius:8px; text-decoration:none; font-weight:600; font-size:16px;">
  {{BUTTON_TEXT}}
</a>
```

### Data Table Style (for application details)
```html
<table width="100%" style="border:1px solid #3a2518; border-radius:8px; overflow:hidden; margin:20px 0;">
  <tr style="background:#3a2518;">
    <td style="padding:10px 16px; color:#c4671a; font-weight:600; width:140px;">Field</td>
    <td style="padding:10px 16px; color:#f5e6d3;">Value</td>
  </tr>
</table>
```

---

## 5. Email Body Content (All 14)

### Email 1: admin-new-application
```
Hi Team,

A new partnership application has been submitted.

[Table: Name, Email, Phone, Industry, Business Stage, Product Idea, Timeline, Submitted Date]

[Review Application →] (links to admin.html)
```

### Email 2: applicant-acknowledgment
```
Hi {name},

Thank you for applying to CoCreate! We're excited about your {productIdea} idea.

What happens next:
  1. Our team will review your application (within 48 hours)
  2. If approved, you'll receive your project dashboard link
  3. We'll start building your MVP together

If you have questions, reply to this email or reach us at hello@cocreateidea.com.
```

### Email 3: applicant-approved
```
Hi {name},

Great news — your application has been approved!

Here are your project links:

[Table:
  Dashboard: https://cocreateidea.com/user.html?id={guid}
  Builder Session: {tmuxSessionUrl}
  Live Site: {cloudFrontUrl} (if deployed)
]

[Open Dashboard →]

Next steps:
  1. Click your dashboard link above
  2. Create your account (email + password)
  3. Start building with our AI-powered tools

Keep these links safe — you'll need your dashboard link to log in.
```

### Email 4: applicant-rejected
```
Hi {name},

Thank you for your interest in CoCreate. After careful review, we're unable to
move forward with your application at this time.

This doesn't reflect on the quality of your idea. We encourage you to:
  - Refine your concept and reapply in the future
  - Reach out to us at hello@cocreateidea.com for feedback

We wish you the best with your venture.
```

### Email 5: user-welcome
```
Hi {name},

Your account is set up and ready to go!

Your dashboard: {dashboardUrl}

From your dashboard you can:
  - Track your project progress
  - View build status and deployments
  - Monitor costs and usage
  - Update your profile and password

[Go to Dashboard →]
```

### Email 6: password-reset-link
```
Hi {name},

We received a request to reset your password. Click the button below to set a new one:

[Reset Password →] (links to user.html?id={guid}&reset={token})

This link expires in 1 hour.

If you didn't request this, you can safely ignore this email. Your password
will remain unchanged.
```

### Email 7: password-changed
```
Hi {name},

Your password has been successfully changed.

Date: {timestamp}

If you did not make this change, please contact us immediately at
hello@cocreateidea.com.
```

### Email 8: new-login-alert
```
Hi {name},

A new login to your CoCreate account was detected.

[Table:
  Date: {timestamp}
  IP Address: {ipAddress}
  Location: {approxLocation} (if available)
]

If this was you, no action is needed.

If you don't recognize this activity, please change your password immediately:
[Change Password →] (links to dashboard)
```

### Email 9: project-deployed
```
Hi {name},

Your project has been deployed successfully!

[Table:
  Project: {projectName}
  Live URL: {deploymentUrl}
  Deployed: {timestamp}
]

[View Live Site →]

Your site is now accessible worldwide via CloudFront CDN.
```

### Email 10: build-failed
```
TO USER:
Hi {name},

We encountered an issue deploying your project.

[Table:
  Project: {projectName}
  Error: {errorSummary}
  Time: {timestamp}
]

Our team has been notified and will look into this. No action needed from you.

---
TO ADMINS:
Subject: "Build Failed: {projectName} - {userName}"

[Table: Project, User, GUID, Error Details, Job ID, Timestamp]
```

### Email 11: account-deactivated
```
Hi {name},

Your CoCreate account has been deactivated.

If you believe this was done in error, please contact us at
hello@cocreateidea.com.

Your project data will be retained for 30 days. After that, it may be
permanently deleted.
```

### Email 12: session-expiry-reminder
```
Hi {name},

Your CoCreate session will expire tomorrow. Log in to keep your session active.

[Log In →] (links to user.html?id={guid})

If your session expires, you can always log in again with your email and password.
```

### Email 13: weekly-project-digest
```
Hi {name},

Here's your weekly project update for {weekRange}:

[Table:
  Project Status: {status}
  Last Activity: {lastActivity}
  Deployment Status: {deploymentStatus}
  Uptime: {uptime} (if deployed)
]

[View Dashboard →]
```

### Email 14: re-engagement
```
Hi {name},

It's been a while since you last visited CoCreate. Your project is still
here, waiting for you!

[Table:
  Last Login: {lastLogin}
  Project Status: {projectStatus}
]

[Return to Dashboard →]

If you need help getting started again, reply to this email.
```

---

## 6. Backend Implementation

### New Functions in `index.mjs`

```javascript
// 1. Base template renderer
function getEmailBaseHtml(content) { ... }

// 2. Individual template renderers
function renderAdminNewApplication(data) { ... }
function renderApplicantAcknowledgment(data) { ... }
function renderApplicantApproved(data) { ... }
function renderApplicantRejected(data) { ... }
function renderUserWelcome(data) { ... }
function renderPasswordResetLink(data) { ... }
function renderPasswordChanged(data) { ... }
function renderNewLoginAlert(data) { ... }
function renderProjectDeployed(data) { ... }
function renderBuildFailed(data) { ... }
function renderAccountDeactivated(data) { ... }
function renderSessionExpiryReminder(data) { ... }
function renderWeeklyDigest(data) { ... }
function renderReEngagement(data) { ... }

// 3. Send helper
async function sendTemplatedEmail(to, subject, htmlContent) { ... }

// 4. Password reset token management
function generateResetToken() { ... }
async function storeResetToken(guid, token, email) { ... }
async function validateResetToken(guid, token) { ... }
async function deleteResetToken(guid) { ... }

// 5. IP tracking for login alerts
async function getLastLoginIP(guid) { ... }
async function storeLoginIP(guid, ip) { ... }

// 6. User lookup by email (for forgot password)
async function findUserByEmail(email) { ... }
```

### Modified Action Handlers

```
user-signup       → + send welcome email (#5)
user-login        → + check IP, send new-login-alert (#8) if different IP
user-change-password → + send password-changed (#7)
admin-update (approve) → + send applicant-approved (#3)
admin-update (reject)  → + send applicant-rejected (#4)
form-submission   → + send applicant-acknowledgment (#2) + admin notification to all 3 (#1)
```

### New Action Handlers

```
forgot-password   → find user by email, generate token, store in S3, send reset email (#6)
reset-password    → validate token, update password hash, delete token, send confirmation (#7)
```

### New Scheduled Handlers (EventBridge → Lambda)

```
scheduled-session-expiry   → scan sessions expiring in 24h, send reminder (#12)
scheduled-weekly-digest    → every Monday 10AM EST, send to active users (#13)
scheduled-re-engagement    → daily check, send to users inactive 30+ days (#14)
```

---

## 7. Data Storage

### Reset Token (S3)
```
Key: users/{guid}/reset-token.json
{
  "token": "a1b2c3...64chars",
  "email": "user@email.com",
  "createdAt": "2026-03-12T10:00:00Z",
  "expiresAt": "2026-03-12T11:00:00Z"
}
```

### Login IP History (S3)
```
Key: users/{guid}/login-history.json
{
  "logins": [
    { "ip": "1.2.3.4", "timestamp": "2026-03-12T10:00:00Z", "userAgent": "..." },
    ...last 10 entries
  ]
}
```

### User Email Index (S3) - for forgot password lookup
```
Key: email-index/{email-hash}.json
{
  "guid": "abc123",
  "email": "user@email.com"
}
```
Created during signup to enable email→guid lookup without scanning all users.

---

## 8. Frontend Changes

### `user-core.js`
- Forgot password success screen: "Check your email for a reset link"
- Reset password screen: handle `?reset={token}` URL parameter
- Both screens already exist in HTML, just need proper success/error handling

### No other frontend changes needed
- All email sending is server-side
- Existing UI screens (signup, login, forgot, reset) already built

---

## 9. EventBridge Rules

```
Rule 1: cocreate-session-expiry-check
  Schedule: rate(1 day) - runs daily at 8AM EST
  Target: chat-backend Lambda
  Input: { "action": "scheduled-session-expiry" }

Rule 2: cocreate-weekly-digest
  Schedule: cron(0 15 ? * MON *) - Monday 10AM EST (15:00 UTC)
  Target: chat-backend Lambda
  Input: { "action": "scheduled-weekly-digest" }

Rule 3: cocreate-re-engagement
  Schedule: rate(1 day) - runs daily at 9AM EST
  Target: chat-backend Lambda
  Input: { "action": "scheduled-re-engagement" }
```

---

## 10. SES Requirements

### Verify New Recipient Addresses (if in sandbox)
- `COO@cocreateidea.com`
- `CTO@cocreateidea.com`

### Request Production Access (if not already done)
- Needed for sending to arbitrary applicant email addresses
- Without production access, can only send to verified addresses

---

## 11. Security

- Reset tokens: 64-char crypto-random hex, 1-hour expiry, single-use
- Forgot password always returns success (prevents email enumeration)
- Login IP tracking stores last 10 entries only
- Email index uses SHA256 hash of email as key
- All emails sent via TLS (SES default)
- No sensitive data (passwords) in any email

---

## 12. Files to Modify

| File | Changes |
|---|---|
| `chat-backend/index.mjs` | Add email templates, new handlers, modify existing handlers |
| `chat-backend/costs/email-reports.mjs` | Add weekly digest + re-engagement scheduled handlers |
| `site/js/user-core.js` | Minor: handle reset token URL param, success messages |
| `site/js/config.js` | No changes needed |

---

## 13. Migration of Existing Email Functions

The codebase has two existing email functions that must be migrated:

### `sendEmail()` (line 337)
- Currently sends chat lead notifications to admin
- Uses different HTML style (not branded)
- **Action:** Replace with `sendTemplatedEmail()` using `admin-new-application` template
- Update domain references from `cocreate-app.com` to `cocreateidea.com`

### `sendApplicantConfirmationEmail()` (line 557)
- Currently sends acknowledgment to applicants
- Uses purple/indigo gradient style (inconsistent with site theme)
- References old domain `cocreate-app.com`
- Says "24 hours" review time
- **Action:** Replace with `sendTemplatedEmail()` using `applicant-acknowledgment` template
- Standardize to "48 hours" review time across all templates

### `NOTIFICATION_EMAIL` env var
- Currently used as sender address
- **Action:** Replace all uses with `EMAIL_CONFIG.from` (`noreply@cocreateidea.com`)
- Keep env var as fallback for backward compatibility

---

## 14. Security Additions

### Rate Limiting on forgot-password
- Store `lastResetRequest` timestamp in `email-index/{email-hash}.json`
- Reject requests within 60 seconds of the last request
- Return success response regardless (prevent enumeration)
- Prevents SES quota exhaustion and user spam

### GUID Exposure in Reset URLs
- Reset URL format: `user.html?id={guid}&reset={token}`
- **Accepted risk:** GUID is already known to the user (it's their dashboard URL)
- The reset token provides the security layer (1-hour expiry, single-use)
- The GUID alone does not grant access without a valid session

### Password Reset Token Flow
- Token: 64-char crypto-random hex
- Stored: `users/{guid}/reset-token.json`
- Expiry: 1 hour
- Single-use: deleted immediately after successful reset
- Forgot-password always returns success (prevents email enumeration)

---

## 15. Plain-Text Email Fallback

All emails must include both HTML and plain-text bodies for deliverability and compatibility.

```javascript
async function sendTemplatedEmail(to, subject, htmlContent, textContent) {
  // ...
  Body: {
    Html: { Data: htmlContent },
    Text: { Data: textContent }
  }
}
```

Each template renderer returns `{ html, text }` object. The text version strips HTML and preserves structure with line breaks and dashes.

---

## 16. Unsubscribe Mechanism

Emails #13 (weekly digest) and #14 (re-engagement) are non-transactional and require CAN-SPAM compliance.

### Implementation
- Add `emailPreferences` field to `users/{guid}/profile.json`:
  ```json
  {
    "emailPreferences": {
      "weeklyDigest": true,
      "reEngagement": true
    }
  }
  ```
- Footer of emails #13 and #14 includes unsubscribe link:
  `https://www.cocreateidea.com/user.html?id={guid}&unsubscribe=digest`
- New action handler `update-email-preferences` to toggle preferences
- Frontend handles `?unsubscribe=` param and calls the API

---

## 17. Error Handling Strategy

### Email sending is fire-and-forget for all transactional emails
- Signup, login, approval actions succeed even if email fails
- Email errors are logged to console (CloudWatch) but do not block the action
- Pattern matches existing code (line 3744 does not await confirmation email)

### Scheduled emails fail gracefully per-user
- If one user's email fails, continue to next user
- Log failures for monitoring
- Do not retry automatically (next scheduled run will include them if still eligible)

---

## 18. Implementation Order

### Phase 1: Core Email Infrastructure
1. Create `getEmailBaseHtml()` template renderer
2. Create `sendTemplatedEmail()` with HTML + plain-text support
3. Migrate existing `sendEmail()` and `sendApplicantConfirmationEmail()` to new system
4. Update ADMIN_EMAILS config (add COO, CTO)

### Phase 2: Application Flow Emails (#1-4)
5. Admin notification to all 3 admins (#1)
6. Applicant acknowledgment (#2) — replacing existing function
7. Applicant approved with GUID + URLs (#3)
8. Applicant rejected (#4)

### Phase 3: Auth Flow Emails (#5-8)
9. Welcome email on signup (#5)
10. Forgot password handler + reset link email (#6)
11. Reset password handler + confirmation email (#7)
12. Login IP tracking + new-login-alert (#8)

### Phase 4: Project Flow Emails (#9-10)
13. Project deployed notification (#9)
14. Build failed notification — user + admin versions (#10)

### Phase 5: Account & Engagement Emails (#11-14)
15. Account deactivated (#11)
16. Session expiry reminder (#12) + EventBridge rule
17. Weekly digest (#13) + EventBridge rule + unsubscribe
18. Re-engagement (#14) + EventBridge rule + unsubscribe

### Dependencies
- Phase 3 step 12 (login IP tracking) must complete before Phase 5 step 18 (re-engagement uses lastLogin)
- Phase 1 must complete before all other phases

---

## 19. Lambda & EventBridge Configuration

### Lambda Timeout
- Current timeout may be too low for scheduled handlers that scan all users
- Set Lambda timeout to **60 seconds** for scheduled invocations
- For growing user base (>100 users), consider paginating the scan

### EventBridge Rules (use cron, not rate)
```
Rule 1: cocreate-session-expiry-check
  Schedule: cron(0 13 * * ? *)  — 8AM EST daily (13:00 UTC)
  Target: chat-backend Lambda
  Input: { "action": "scheduled-session-expiry" }

Rule 2: cocreate-weekly-digest
  Schedule: cron(0 15 ? * MON *)  — Monday 10AM EST (15:00 UTC)
  Target: chat-backend Lambda
  Input: { "action": "scheduled-weekly-digest" }

Rule 3: cocreate-re-engagement
  Schedule: cron(0 14 * * ? *)  — 9AM EST daily (14:00 UTC)
  Target: chat-backend Lambda
  Input: { "action": "scheduled-re-engagement" }
```

### IAM Permissions Needed
- EventBridge: `lambda:InvokeFunction` on the chat-backend Lambda
- Lambda already has: `ses:SendEmail`, `s3:GetObject`, `s3:PutObject`, `s3:ListObjectsV2`

---

## 20. Data Sources for Scheduled Emails

### Weekly Digest (#13)
| Variable | Source |
|---|---|
| `{status}` | Application status from S3 `applications/` |
| `{lastActivity}` | Last login timestamp from `users/{guid}/login-history.json` |
| `{deploymentStatus}` | Build progress from S3 `progress/{jobId}.json` |
| ~~`{uptime}`~~ | **Removed** — no monitoring infrastructure exists |

### Re-engagement (#14)
| Variable | Source |
|---|---|
| `{lastLogin}` | Latest entry from `users/{guid}/login-history.json` |
| `{projectStatus}` | Application status from S3 `applications/` |

### Session Expiry (#12)
- Scan: `s3.listObjectsV2({ Prefix: 'users/' })` → for each user, read `sessions.json`
- Check: any token with `expiresAt` within next 24 hours
- Send reminder if found

---

## 21. Build Failed Email Split

Use two separate template IDs for clarity:
- `build-failed-user` — sent to the user with simplified error message
- `build-failed-admin` — sent to CEO, COO, CTO with full error details, job ID, GUID

---

## 22. Deployment

1. Phase 1-5 code changes to `index.mjs`
2. Deploy Lambda via existing `deploy.sh`
3. Verify COO/CTO emails in SES (if sandbox) or request SES production access
4. Create 3 EventBridge rules via AWS CLI
5. Test all 14 email flows (manual triggers for scheduled ones)
6. Monitor CloudWatch logs for email delivery errors
