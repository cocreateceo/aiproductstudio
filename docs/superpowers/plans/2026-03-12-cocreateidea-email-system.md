# CoCreate Email System Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a complete 14-email system to cocreateidea.com covering application flow, auth, project lifecycle, account management, and engagement.

**Architecture:** All email logic added to the existing Lambda (`chat-backend/index.mjs`) using AWS SES already in place. A new `email-templates.mjs` module handles all HTML/text template generation with CoCreate branding. Scheduled emails triggered via EventBridge rules. Cost reports updated to send to all admins.

**Tech Stack:** AWS SES, AWS Lambda (Node.js ESM), S3 (data storage), EventBridge (scheduling), bcryptjs (password hashing)

**Spec:** `docs/superpowers/specs/2026-03-12-cocreateidea-email-system-design.md`

---

## File Structure

| File | Action | Responsibility |
|---|---|---|
| `chat-backend/email-templates.mjs` | **Create** | All 14 HTML+text email templates, base layout, shared styles, CTA button helper |
| `chat-backend/email-service.mjs` | **Create** | `sendTemplatedEmail()`, `sendToAdmins()`, rate limiting, SES client singleton |
| `chat-backend/index.mjs` | **Modify** | Wire email calls into existing handlers, add forgot/reset-password handlers, add scheduled handlers |
| `chat-backend/costs/email-reports.mjs` | **Modify** | Update admin recipients to all 3 admins |
| `site/js/user-core.js` | **Modify** | Handle reset token from URL, success messages for forgot/reset |

---

## Chunk 1: Email Infrastructure (Templates + Service)

### Task 1: Create email base template and shared helpers

**Files:**
- Create: `chat-backend/email-templates.mjs`

- [ ] **Step 1: Create email-templates.mjs with base layout and config**

```javascript
// chat-backend/email-templates.mjs

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

export { EMAIL_CONFIG, ADMIN_EMAILS };

/**
 * Wraps content in the branded CoCreate email layout.
 * All emails share: logo header, content area, footer.
 */
export function getEmailBaseHtml(content) {
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="margin:0; padding:0; background:#1a0a00; font-family:'Helvetica Neue',Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#1a0a00; padding:40px 20px;">
    <tr>
      <td align="center">
        <table width="600" cellpadding="0" cellspacing="0" style="background:#2a1810; border-radius:12px; overflow:hidden; max-width:600px; width:100%;">
          <tr>
            <td style="background:linear-gradient(135deg,#c4671a,#8b4513); padding:30px; text-align:center;">
              <img src="${EMAIL_CONFIG.logoUrl}" alt="CoCreate" width="180" style="max-width:180px; height:auto;">
            </td>
          </tr>
          <tr>
            <td style="padding:40px 30px; color:#f5e6d3; font-size:15px; line-height:1.6;">
              ${content}
            </td>
          </tr>
          <tr>
            <td style="padding:20px 30px; border-top:1px solid #3a2518; text-align:center; color:#8b7355; font-size:12px;">
              <p style="margin:0 0 8px 0;">&copy; ${new Date().getFullYear()} CoCreate | <a href="${EMAIL_CONFIG.siteUrl}" style="color:#c4671a; text-decoration:none;">cocreateidea.com</a></p>
              <p style="margin:0;">Support: <a href="mailto:${EMAIL_CONFIG.supportEmail}" style="color:#c4671a; text-decoration:none;">${EMAIL_CONFIG.supportEmail}</a></p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

/** Orange CTA button */
export function ctaButton(url, text) {
  return `<div style="text-align:center; margin:30px 0;">
  <a href="${url}" style="display:inline-block; background:linear-gradient(135deg,#c4671a,#e8852a); color:#fff; padding:14px 32px; border-radius:8px; text-decoration:none; font-weight:600; font-size:16px;">${text}</a>
</div>`;
}

/** Data table row */
export function tableRow(label, value, isHeader = false) {
  const bg = isHeader ? 'background:#3a2518;' : '';
  const labelColor = isHeader ? 'color:#e8852a;' : 'color:#c4671a;';
  return `<tr style="${bg}">
    <td style="padding:10px 16px; ${labelColor} font-weight:600; width:160px; border-bottom:1px solid #3a2518;">${label}</td>
    <td style="padding:10px 16px; color:#f5e6d3; border-bottom:1px solid #3a2518;">${value}</td>
  </tr>`;
}

/** Wrap rows in a table */
export function dataTable(rows) {
  return `<table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #3a2518; border-radius:8px; overflow:hidden; margin:20px 0;">
  ${rows}
</table>`;
}

/** Format date for emails */
export function formatDate(date) {
  return new Date(date).toLocaleString('en-US', {
    timeZone: 'America/New_York',
    month: 'short', day: 'numeric', year: 'numeric',
    hour: 'numeric', minute: '2-digit', hour12: true
  }) + ' EST';
}
```

- [ ] **Step 2: Verify the file is valid ESM**

Run: `cd C:/Projects/ai-product-studio/option-a-threejs-gsap-tailwind/chat-backend && node -e "import('./email-templates.mjs').then(m => console.log('OK, exports:', Object.keys(m)))"`
Expected: `OK, exports: [ 'EMAIL_CONFIG', 'ADMIN_EMAILS', 'getEmailBaseHtml', 'ctaButton', 'tableRow', 'dataTable', 'formatDate' ]`

- [ ] **Step 3: Commit**

```bash
git add chat-backend/email-templates.mjs
git commit -m "feat: add email base template and helpers for CoCreate branding"
```

---

### Task 2: Add all 14 email template renderers

**Files:**
- Modify: `chat-backend/email-templates.mjs`

- [ ] **Step 1: Add application flow templates (#1-4)**

Append to `email-templates.mjs`:

```javascript
// ============================================
// EMAIL 1: Admin - New Application Notification
// ============================================
export function renderAdminNewApplication(data) {
  const { name, email, phone, industry, businessStage, productIdea, timeline } = data;
  const html = getEmailBaseHtml(`
    <h2 style="color:#e8852a; margin:0 0 20px 0;">New Partnership Application</h2>
    <p>Hi Team,</p>
    <p>A new partnership application has been submitted.</p>
    ${dataTable(
      tableRow('Name', name || 'Not provided') +
      tableRow('Email', email || 'Not provided') +
      tableRow('Phone', phone || 'Not provided') +
      tableRow('Industry', industry || 'Not provided') +
      tableRow('Business Stage', businessStage || 'Not provided') +
      tableRow('Product Idea', productIdea || 'Not provided') +
      tableRow('Timeline', timeline || 'Not provided') +
      tableRow('Submitted', formatDate(new Date()))
    )}
    ${ctaButton(EMAIL_CONFIG.siteUrl + '/admin.html', 'Review Application')}
  `);
  const text = `Hi Team,\n\nA new partnership application has been submitted.\n\nName: ${name || 'Not provided'}\nEmail: ${email || 'Not provided'}\nPhone: ${phone || 'Not provided'}\nIndustry: ${industry || 'Not provided'}\nBusiness Stage: ${businessStage || 'Not provided'}\nProduct Idea: ${productIdea || 'Not provided'}\nTimeline: ${timeline || 'Not provided'}\nSubmitted: ${formatDate(new Date())}\n\nReview at: ${EMAIL_CONFIG.siteUrl}/admin.html\n\n— CoCreate AI`;
  return { html, text, subject: `New Application: ${name || 'New Applicant'} - ${industry || 'General'}` };
}

// ============================================
// EMAIL 2: Applicant - Acknowledgment
// ============================================
export function renderApplicantAcknowledgment(data) {
  const { name, productIdea } = data;
  const displayName = name || 'there';
  const html = getEmailBaseHtml(`
    <h2 style="color:#e8852a; margin:0 0 20px 0;">Application Received</h2>
    <p>Hi ${displayName},</p>
    <p>Thank you for applying to CoCreate! We're excited about your <strong>${productIdea || 'product'}</strong> idea.</p>
    <div style="background:#3a2518; padding:20px; border-radius:8px; margin:20px 0;">
      <h3 style="color:#e8852a; margin:0 0 12px 0;">What happens next:</h3>
      <p style="margin:8px 0;">1. Our team will review your application (within 48 hours)</p>
      <p style="margin:8px 0;">2. If approved, you'll receive your project dashboard link</p>
      <p style="margin:8px 0;">3. We'll start building your MVP together</p>
    </div>
    <p>If you have questions, reply to this email or reach us at <a href="mailto:${EMAIL_CONFIG.supportEmail}" style="color:#c4671a;">${EMAIL_CONFIG.supportEmail}</a>.</p>
    <p>We'll be in touch soon!</p>
    <p><strong>— The CoCreate Team</strong></p>
  `);
  const text = `Hi ${displayName},\n\nThank you for applying to CoCreate! We're excited about your ${productIdea || 'product'} idea.\n\nWhat happens next:\n1. Our team will review your application (within 48 hours)\n2. If approved, you'll receive your project dashboard link\n3. We'll start building your MVP together\n\nIf you have questions, reply to this email or reach us at ${EMAIL_CONFIG.supportEmail}.\n\nWe'll be in touch soon!\n\n— The CoCreate Team`;
  return { html, text, subject: 'We received your application - CoCreate' };
}

// ============================================
// EMAIL 3: Applicant - Approved
// ============================================
export function renderApplicantApproved(data) {
  const { name, guid, sessionUrl, deploymentUrl } = data;
  const dashboardUrl = `${EMAIL_CONFIG.siteUrl}/user.html?id=${guid}`;
  const displayName = name || 'there';
  const linksHtml = tableRow('Your Dashboard', `<a href="${dashboardUrl}" style="color:#c4671a;">${dashboardUrl}</a>`) +
    (sessionUrl ? tableRow('Builder Session', `<a href="${sessionUrl}" style="color:#c4671a;">${sessionUrl}</a>`) : '') +
    (deploymentUrl ? tableRow('Your Live Site', `<a href="${deploymentUrl}" style="color:#c4671a;">${deploymentUrl}</a>`) : '');

  const html = getEmailBaseHtml(`
    <h2 style="color:#e8852a; margin:0 0 20px 0;">You're Approved!</h2>
    <p>Hi ${displayName},</p>
    <p>Great news — your application has been approved! We're ready to bring your idea to life.</p>
    <h3 style="color:#e8852a;">Your Project Links</h3>
    ${dataTable(linksHtml)}
    ${ctaButton(dashboardUrl, 'Open Dashboard')}
    <div style="background:#3a2518; padding:20px; border-radius:8px; margin:20px 0;">
      <h3 style="color:#e8852a; margin:0 0 12px 0;">Next steps:</h3>
      <p style="margin:8px 0;">1. Click your dashboard link above</p>
      <p style="margin:8px 0;">2. Create your account (email + password)</p>
      <p style="margin:8px 0;">3. Start building with our AI-powered tools</p>
    </div>
    <p>Keep these links safe — you'll need your dashboard link to log in.</p>
    <p><strong>— The CoCreate Team</strong></p>
  `);
  const text = `Hi ${displayName},\n\nGreat news — your application has been approved!\n\nYour Dashboard: ${dashboardUrl}\n${sessionUrl ? 'Builder Session: ' + sessionUrl + '\n' : ''}${deploymentUrl ? 'Your Live Site: ' + deploymentUrl + '\n' : ''}\n\nNext steps:\n1. Click your dashboard link above\n2. Create your account (email + password)\n3. Start building with our AI-powered tools\n\nKeep these links safe.\n\n— The CoCreate Team`;
  return { html, text, subject: "You're approved! Welcome to CoCreate" };
}

// ============================================
// EMAIL 4: Applicant - Rejected
// ============================================
export function renderApplicantRejected(data) {
  const { name } = data;
  const displayName = name || 'there';
  const html = getEmailBaseHtml(`
    <h2 style="color:#e8852a; margin:0 0 20px 0;">Application Update</h2>
    <p>Hi ${displayName},</p>
    <p>Thank you for your interest in CoCreate. After careful review, we're unable to move forward with your application at this time.</p>
    <p>This doesn't reflect on the quality of your idea. We encourage you to:</p>
    <ul style="color:#f5e6d3; padding-left:20px;">
      <li style="margin:8px 0;">Refine your concept and reapply in the future</li>
      <li style="margin:8px 0;">Reach out to us at <a href="mailto:${EMAIL_CONFIG.supportEmail}" style="color:#c4671a;">${EMAIL_CONFIG.supportEmail}</a> for feedback</li>
    </ul>
    <p>We wish you the best with your venture.</p>
    <p><strong>— The CoCreate Team</strong></p>
  `);
  const text = `Hi ${displayName},\n\nThank you for your interest in CoCreate. After careful review, we're unable to move forward with your application at this time.\n\nThis doesn't reflect on the quality of your idea. We encourage you to:\n- Refine your concept and reapply in the future\n- Reach out to us at ${EMAIL_CONFIG.supportEmail} for feedback\n\nWe wish you the best with your venture.\n\n— The CoCreate Team`;
  return { html, text, subject: 'Update on your CoCreate application' };
}
```

- [ ] **Step 2: Add auth flow templates (#5-8)**

Append to `email-templates.mjs`:

```javascript
// ============================================
// EMAIL 5: User - Welcome (after signup)
// ============================================
export function renderUserWelcome(data) {
  const { name, guid } = data;
  const dashboardUrl = `${EMAIL_CONFIG.siteUrl}/user.html?id=${guid}`;
  const displayName = name || 'there';
  const html = getEmailBaseHtml(`
    <h2 style="color:#e8852a; margin:0 0 20px 0;">Welcome to CoCreate!</h2>
    <p>Hi ${displayName},</p>
    <p>Your account is set up and ready to go!</p>
    ${ctaButton(dashboardUrl, 'Go to Dashboard')}
    <div style="background:#3a2518; padding:20px; border-radius:8px; margin:20px 0;">
      <p style="margin:8px 0;">From your dashboard you can:</p>
      <ul style="color:#f5e6d3; padding-left:20px;">
        <li style="margin:6px 0;">Track your project progress</li>
        <li style="margin:6px 0;">View build status and deployments</li>
        <li style="margin:6px 0;">Monitor costs and usage</li>
        <li style="margin:6px 0;">Update your profile and password</li>
      </ul>
    </div>
    <p>If you ever need help, reach us at <a href="mailto:${EMAIL_CONFIG.supportEmail}" style="color:#c4671a;">${EMAIL_CONFIG.supportEmail}</a>.</p>
    <p>Let's build something great together!</p>
    <p><strong>— The CoCreate Team</strong></p>
  `);
  const text = `Hi ${displayName},\n\nYour account is set up and ready to go!\n\nYour dashboard: ${dashboardUrl}\n\nFrom your dashboard you can:\n- Track your project progress\n- View build status and deployments\n- Monitor costs and usage\n- Update your profile and password\n\nIf you ever need help, reach us at ${EMAIL_CONFIG.supportEmail}.\n\nLet's build something great together!\n\n— The CoCreate Team`;
  return { html, text, subject: `Welcome to CoCreate, ${displayName}!` };
}

// ============================================
// EMAIL 6: Password Reset Link
// ============================================
export function renderPasswordResetLink(data) {
  const { name, guid, resetToken } = data;
  const resetUrl = `${EMAIL_CONFIG.siteUrl}/user.html?id=${guid}&reset=${resetToken}`;
  const displayName = name || 'there';
  const html = getEmailBaseHtml(`
    <h2 style="color:#e8852a; margin:0 0 20px 0;">Reset Your Password</h2>
    <p>Hi ${displayName},</p>
    <p>We received a request to reset your password. Click the button below to set a new one:</p>
    ${ctaButton(resetUrl, 'Reset Password')}
    <p style="color:#8b7355; font-size:13px;">This link expires in 1 hour.</p>
    <p>If you didn't request this, you can safely ignore this email. Your password will remain unchanged.</p>
    <p><strong>— The CoCreate Team</strong></p>
  `);
  const text = `Hi ${displayName},\n\nWe received a request to reset your password.\n\nReset your password: ${resetUrl}\n\nThis link expires in 1 hour.\n\nIf you didn't request this, you can safely ignore this email.\n\n— The CoCreate Team`;
  return { html, text, subject: 'Reset your password - CoCreate' };
}

// ============================================
// EMAIL 7: Password Changed Confirmation
// ============================================
export function renderPasswordChanged(data) {
  const { name } = data;
  const displayName = name || 'there';
  const html = getEmailBaseHtml(`
    <h2 style="color:#e8852a; margin:0 0 20px 0;">Password Changed</h2>
    <p>Hi ${displayName},</p>
    <p>Your password has been successfully changed.</p>
    ${dataTable(tableRow('Date', formatDate(new Date())))}
    <p>If you did not make this change, please contact us immediately at <a href="mailto:${EMAIL_CONFIG.supportEmail}" style="color:#c4671a;">${EMAIL_CONFIG.supportEmail}</a>.</p>
    <p><strong>— The CoCreate Team</strong></p>
  `);
  const text = `Hi ${displayName},\n\nYour password has been successfully changed.\n\nDate: ${formatDate(new Date())}\n\nIf you did not make this change, please contact us immediately at ${EMAIL_CONFIG.supportEmail}.\n\n— The CoCreate Team`;
  return { html, text, subject: 'Your password has been changed - CoCreate' };
}

// ============================================
// EMAIL 8: New Login Alert
// ============================================
export function renderNewLoginAlert(data) {
  const { name, guid, ip, timestamp } = data;
  const dashboardUrl = `${EMAIL_CONFIG.siteUrl}/user.html?id=${guid}`;
  const displayName = name || 'there';
  const html = getEmailBaseHtml(`
    <h2 style="color:#e8852a; margin:0 0 20px 0;">New Login Detected</h2>
    <p>Hi ${displayName},</p>
    <p>A new login to your CoCreate account was detected.</p>
    ${dataTable(
      tableRow('Date', formatDate(timestamp || new Date())) +
      tableRow('IP Address', ip || 'Unknown')
    )}
    <p>If this was you, no action is needed.</p>
    <p>If you don't recognize this activity, please change your password immediately:</p>
    ${ctaButton(dashboardUrl, 'Go to Dashboard')}
    <p><strong>— The CoCreate Team</strong></p>
  `);
  const text = `Hi ${displayName},\n\nA new login to your CoCreate account was detected.\n\nDate: ${formatDate(timestamp || new Date())}\nIP Address: ${ip || 'Unknown'}\n\nIf this was you, no action is needed.\n\nIf you don't recognize this activity, change your password at: ${dashboardUrl}\n\n— The CoCreate Team`;
  return { html, text, subject: 'New login to your CoCreate account' };
}
```

- [ ] **Step 3: Add project flow templates (#9-10)**

Append to `email-templates.mjs`:

```javascript
// ============================================
// EMAIL 9: Project Deployed Successfully
// ============================================
export function renderProjectDeployed(data) {
  const { name, projectName, deploymentUrl, guid } = data;
  const dashboardUrl = `${EMAIL_CONFIG.siteUrl}/user.html?id=${guid}`;
  const displayName = name || 'there';
  const html = getEmailBaseHtml(`
    <h2 style="color:#e8852a; margin:0 0 20px 0;">Your Project is Live!</h2>
    <p>Hi ${displayName},</p>
    <p>Your project has been deployed successfully!</p>
    ${dataTable(
      tableRow('Project', projectName || 'Your Project') +
      tableRow('Live URL', `<a href="${deploymentUrl}" style="color:#c4671a;">${deploymentUrl}</a>`) +
      tableRow('Deployed', formatDate(new Date()))
    )}
    ${ctaButton(deploymentUrl, 'View Live Site')}
    <p>Your site is now accessible worldwide via CloudFront CDN.</p>
    <p><strong>— The CoCreate Team</strong></p>
  `);
  const text = `Hi ${displayName},\n\nYour project has been deployed successfully!\n\nProject: ${projectName || 'Your Project'}\nLive URL: ${deploymentUrl}\nDeployed: ${formatDate(new Date())}\n\nYour site is now accessible worldwide via CloudFront CDN.\n\n— The CoCreate Team`;
  return { html, text, subject: 'Your project is live! - CoCreate' };
}

// ============================================
// EMAIL 10a: Build Failed - User Version
// ============================================
export function renderBuildFailedUser(data) {
  const { name, projectName, errorSummary } = data;
  const displayName = name || 'there';
  const html = getEmailBaseHtml(`
    <h2 style="color:#e8852a; margin:0 0 20px 0;">Deployment Issue</h2>
    <p>Hi ${displayName},</p>
    <p>We encountered an issue deploying your project.</p>
    ${dataTable(
      tableRow('Project', projectName || 'Your Project') +
      tableRow('Issue', errorSummary || 'Build failed') +
      tableRow('Time', formatDate(new Date()))
    )}
    <p>Our team has been notified and will look into this. No action needed from you.</p>
    <p><strong>— The CoCreate Team</strong></p>
  `);
  const text = `Hi ${displayName},\n\nWe encountered an issue deploying your project.\n\nProject: ${projectName || 'Your Project'}\nIssue: ${errorSummary || 'Build failed'}\nTime: ${formatDate(new Date())}\n\nOur team has been notified and will look into this.\n\n— The CoCreate Team`;
  return { html, text, subject: 'Deployment issue with your project - CoCreate' };
}

// ============================================
// EMAIL 10b: Build Failed - Admin Version
// ============================================
export function renderBuildFailedAdmin(data) {
  const { userName, userEmail, guid, projectName, jobId, errorDetails } = data;
  const html = getEmailBaseHtml(`
    <h2 style="color:#e8852a; margin:0 0 20px 0;">Build Failed</h2>
    <p>Hi Team,</p>
    <p>A build has failed and needs attention.</p>
    ${dataTable(
      tableRow('User', userName || 'Unknown') +
      tableRow('Email', userEmail || 'Unknown') +
      tableRow('GUID', guid || 'Unknown') +
      tableRow('Project', projectName || 'Unknown') +
      tableRow('Job ID', jobId || 'Unknown') +
      tableRow('Error', errorDetails || 'Unknown error') +
      tableRow('Time', formatDate(new Date()))
    )}
    ${ctaButton(EMAIL_CONFIG.siteUrl + '/admin.html', 'Open Admin Panel')}
  `);
  const text = `Build Failed\n\nUser: ${userName}\nEmail: ${userEmail}\nGUID: ${guid}\nProject: ${projectName}\nJob ID: ${jobId}\nError: ${errorDetails}\nTime: ${formatDate(new Date())}\n\nCheck admin panel: ${EMAIL_CONFIG.siteUrl}/admin.html`;
  return { html, text, subject: `Build Failed: ${projectName || 'Unknown'} - ${userName || 'Unknown'}` };
}
```

- [ ] **Step 4: Add account management & engagement templates (#11-14)**

Append to `email-templates.mjs`:

```javascript
// ============================================
// EMAIL 11: Account Deactivated
// ============================================
export function renderAccountDeactivated(data) {
  const { name } = data;
  const displayName = name || 'there';
  const html = getEmailBaseHtml(`
    <h2 style="color:#e8852a; margin:0 0 20px 0;">Account Deactivated</h2>
    <p>Hi ${displayName},</p>
    <p>Your CoCreate account has been deactivated.</p>
    <p>If you believe this was done in error, please contact us at <a href="mailto:${EMAIL_CONFIG.supportEmail}" style="color:#c4671a;">${EMAIL_CONFIG.supportEmail}</a>.</p>
    <p>Your project data will be retained for 30 days. After that, it may be permanently deleted.</p>
    <p><strong>— The CoCreate Team</strong></p>
  `);
  const text = `Hi ${displayName},\n\nYour CoCreate account has been deactivated.\n\nIf you believe this was done in error, contact us at ${EMAIL_CONFIG.supportEmail}.\n\nYour project data will be retained for 30 days.\n\n— The CoCreate Team`;
  return { html, text, subject: 'Your CoCreate account has been deactivated' };
}

// ============================================
// EMAIL 12: Session Expiry Reminder
// ============================================
export function renderSessionExpiryReminder(data) {
  const { name, guid } = data;
  const dashboardUrl = `${EMAIL_CONFIG.siteUrl}/user.html?id=${guid}`;
  const displayName = name || 'there';
  const html = getEmailBaseHtml(`
    <h2 style="color:#e8852a; margin:0 0 20px 0;">Session Expiring Soon</h2>
    <p>Hi ${displayName},</p>
    <p>Your CoCreate session will expire tomorrow. Log in to keep your session active.</p>
    ${ctaButton(dashboardUrl, 'Log In Now')}
    <p>If your session expires, you can always log in again with your email and password.</p>
    <p><strong>— The CoCreate Team</strong></p>
  `);
  const text = `Hi ${displayName},\n\nYour CoCreate session will expire tomorrow.\n\nLog in: ${dashboardUrl}\n\nIf your session expires, you can always log in again with your email and password.\n\n— The CoCreate Team`;
  return { html, text, subject: 'Your CoCreate session expires tomorrow' };
}

// ============================================
// EMAIL 13: Weekly Project Digest
// ============================================
export function renderWeeklyDigest(data) {
  const { name, guid, projectStatus, lastActivity, deploymentStatus, weekRange } = data;
  const dashboardUrl = `${EMAIL_CONFIG.siteUrl}/user.html?id=${guid}`;
  const displayName = name || 'there';
  const html = getEmailBaseHtml(`
    <h2 style="color:#e8852a; margin:0 0 20px 0;">Weekly Project Update</h2>
    <p>Hi ${displayName},</p>
    <p>Here's your weekly project update for ${weekRange || 'this week'}:</p>
    ${dataTable(
      tableRow('Project Status', projectStatus || 'Active') +
      tableRow('Last Activity', lastActivity || 'N/A') +
      tableRow('Deployment', deploymentStatus || 'N/A')
    )}
    ${ctaButton(dashboardUrl, 'View Dashboard')}
    <p><strong>— The CoCreate Team</strong></p>
    <p style="color:#8b7355; font-size:12px; margin-top:30px;">Don't want these emails? <a href="${EMAIL_CONFIG.siteUrl}/user.html?id=${guid}&unsubscribe=weeklyDigest" style="color:#c4671a;">Unsubscribe</a></p>
  `);
  const text = `Hi ${displayName},\n\nWeekly project update for ${weekRange || 'this week'}:\n\nProject Status: ${projectStatus || 'Active'}\nLast Activity: ${lastActivity || 'N/A'}\nDeployment: ${deploymentStatus || 'N/A'}\n\nView dashboard: ${dashboardUrl}\n\n— The CoCreate Team\n\nUnsubscribe: ${EMAIL_CONFIG.siteUrl}/user.html?id=${guid}&unsubscribe=weeklyDigest`;
  return { html, text, subject: 'Your weekly project update - CoCreate' };
}

// ============================================
// EMAIL 14: Re-engagement
// ============================================
export function renderReEngagement(data) {
  const { name, guid, lastLogin, projectStatus } = data;
  const dashboardUrl = `${EMAIL_CONFIG.siteUrl}/user.html?id=${guid}`;
  const displayName = name || 'there';
  const html = getEmailBaseHtml(`
    <h2 style="color:#e8852a; margin:0 0 20px 0;">We Miss You!</h2>
    <p>Hi ${displayName},</p>
    <p>It's been a while since you last visited CoCreate. Your project is still here, waiting for you!</p>
    ${dataTable(
      tableRow('Last Login', lastLogin ? formatDate(lastLogin) : 'Over 30 days ago') +
      tableRow('Project Status', projectStatus || 'Active')
    )}
    ${ctaButton(dashboardUrl, 'Return to Dashboard')}
    <p>If you need help getting started again, reply to this email.</p>
    <p><strong>— The CoCreate Team</strong></p>
    <p style="color:#8b7355; font-size:12px; margin-top:30px;">Don't want these emails? <a href="${EMAIL_CONFIG.siteUrl}/user.html?id=${guid}&unsubscribe=reEngagement" style="color:#c4671a;">Unsubscribe</a></p>
  `);
  const text = `Hi ${displayName},\n\nIt's been a while since you last visited CoCreate. Your project is still here!\n\nLast Login: ${lastLogin ? formatDate(lastLogin) : 'Over 30 days ago'}\nProject Status: ${projectStatus || 'Active'}\n\nReturn to dashboard: ${dashboardUrl}\n\n— The CoCreate Team\n\nUnsubscribe: ${EMAIL_CONFIG.siteUrl}/user.html?id=${guid}&unsubscribe=reEngagement`;
  return { html, text, subject: 'We miss you! Check your project status' };
}
```

- [ ] **Step 5: Verify all template exports**

Run: `cd C:/Projects/ai-product-studio/option-a-threejs-gsap-tailwind/chat-backend && node -e "import('./email-templates.mjs').then(m => console.log('Exports:', Object.keys(m).length, Object.keys(m)))"`
Expected: 21 exports (7 helpers + 14 template renderers)

- [ ] **Step 6: Commit**

```bash
git add chat-backend/email-templates.mjs
git commit -m "feat: add all 14 email template renderers with CoCreate branding"
```

---

### Task 3: Create email service module

**Files:**
- Create: `chat-backend/email-service.mjs`

- [ ] **Step 1: Create email-service.mjs with SES send helpers**

```javascript
// chat-backend/email-service.mjs
import { EMAIL_CONFIG, ADMIN_EMAILS } from './email-templates.mjs';

let _sesClient = null;
let _SendEmailCommand = null;

/** Lazy-init SES client singleton */
async function getSES() {
  if (!_sesClient) {
    const { SESClient, SendEmailCommand } = await import('@aws-sdk/client-ses');
    _sesClient = new SESClient({ region: 'us-east-1' });
    _SendEmailCommand = SendEmailCommand;
  }
  return { ses: _sesClient, SendEmailCommand: _SendEmailCommand };
}

/**
 * Send a templated email. Fire-and-forget safe.
 * @param {string|string[]} to - recipient(s)
 * @param {string} subject
 * @param {string} html
 * @param {string} text
 * @param {object} options - { cc, replyTo, from }
 */
export async function sendTemplatedEmail(to, subject, html, text, options = {}) {
  const { ses, SendEmailCommand } = await getSES();
  const toAddresses = Array.isArray(to) ? to : [to];
  const from = options.from || EMAIL_CONFIG.from;
  const replyTo = options.replyTo || EMAIL_CONFIG.replyTo;

  try {
    const params = {
      Source: from,
      Destination: {
        ToAddresses: toAddresses,
      },
      ReplyToAddresses: [replyTo],
      Message: {
        Subject: { Data: subject, Charset: 'UTF-8' },
        Body: {
          Html: { Data: html, Charset: 'UTF-8' },
          Text: { Data: text, Charset: 'UTF-8' }
        }
      }
    };
    if (options.cc) {
      params.Destination.CcAddresses = Array.isArray(options.cc) ? options.cc : [options.cc];
    }
    const result = await ses.send(new SendEmailCommand(params));
    console.log(`[Email] Sent "${subject}" to ${toAddresses.join(', ')} MessageId: ${result.MessageId}`);
    return { success: true, messageId: result.MessageId };
  } catch (error) {
    console.error(`[Email] Failed to send "${subject}" to ${toAddresses.join(', ')}:`, error.message);
    return { success: false, error: error.message };
  }
}

/**
 * Send email to all admin addresses.
 */
export async function sendToAdmins(subject, html, text, options = {}) {
  return sendTemplatedEmail(ADMIN_EMAILS, subject, html, text, {
    cc: options.cc || 'info@cocreateidea.com',
    ...options
  });
}

/**
 * Send email using a template renderer function.
 * Convenience wrapper: calls renderer, then sends.
 * @param {string|string[]} to
 * @param {Function} renderer - from email-templates.mjs, returns { html, text, subject }
 * @param {object} data - passed to renderer
 */
export async function sendTemplate(to, renderer, data) {
  const { html, text, subject } = renderer(data);
  return sendTemplatedEmail(to, subject, html, text);
}

/**
 * Send template to all admins.
 */
export async function sendTemplateToAdmins(renderer, data) {
  const { html, text, subject } = renderer(data);
  return sendToAdmins(subject, html, text);
}

// ============================================
// Rate limiting for forgot-password
// ============================================
const resetRequestCache = new Map(); // In-memory cache for Lambda warm starts

/**
 * Check if a forgot-password request is rate-limited.
 * Returns true if the request should be blocked.
 */
export function isResetRateLimited(email) {
  const key = email.toLowerCase().trim();
  const lastRequest = resetRequestCache.get(key);
  if (lastRequest && (Date.now() - lastRequest) < 60000) { // 60 seconds
    return true;
  }
  resetRequestCache.set(key, Date.now());
  // Clean old entries (keep cache small)
  if (resetRequestCache.size > 1000) {
    const cutoff = Date.now() - 60000;
    for (const [k, v] of resetRequestCache) {
      if (v < cutoff) resetRequestCache.delete(k);
    }
  }
  return false;
}
```

- [ ] **Step 2: Verify email-service.mjs**

Run: `cd C:/Projects/ai-product-studio/option-a-threejs-gsap-tailwind/chat-backend && node -e "import('./email-service.mjs').then(m => console.log('OK, exports:', Object.keys(m)))"`
Expected: `OK, exports: [ 'sendTemplatedEmail', 'sendToAdmins', 'sendTemplate', 'sendTemplateToAdmins', 'isResetRateLimited' ]`

- [ ] **Step 3: Commit**

```bash
git add chat-backend/email-service.mjs
git commit -m "feat: add email service module with SES singleton and rate limiting"
```

---

## Chunk 2: Wire Emails into Existing Handlers (Application + Auth)

### Task 4: Update application flow emails in index.mjs

**Files:**
- Modify: `chat-backend/index.mjs` (lines 22-28, 337-700, 1697-1883, 2417-2441, 3700-3815)

- [ ] **Step 1: Add imports at top of handler function and ADMIN_EMAILS constant**

At the top of `index.mjs` (around line 22-28), add after existing constants:

```javascript
// After line 28 (S3_REGION)
import { EMAIL_CONFIG, ADMIN_EMAILS, renderAdminNewApplication, renderApplicantAcknowledgment, renderApplicantApproved, renderApplicantRejected, renderUserWelcome, renderPasswordResetLink, renderPasswordChanged, renderNewLoginAlert, renderProjectDeployed, renderBuildFailedUser, renderBuildFailedAdmin, renderAccountDeactivated, renderSessionExpiryReminder, renderWeeklyDigest, renderReEngagement } from './email-templates.mjs';
import { sendTemplatedEmail, sendToAdmins, sendTemplate, sendTemplateToAdmins, isResetRateLimited } from './email-service.mjs';
```

Note: If `index.mjs` uses `export const handler` pattern rather than top-level imports, the imports need to be dynamic. Check the file structure — if the handler is inside `export const handler = async (event) => {`, then use dynamic imports inside the handler or at module level depending on the ESM structure.

- [ ] **Step 2: Replace sendEmail() function (line 337-441)**

Replace the old `sendEmail` function with one that uses the new template system. The function is called at line 3813 when contact info is first collected from chat.

Replace lines 337-441 (`async function sendEmail(...)`) with:

```javascript
// Send lead notification email via new template system
async function sendEmail(visitorInfo, messages, aiResponse, clientIP) {
  try {
    const data = {
      name: visitorInfo.name || 'Anonymous',
      email: visitorInfo.email || 'Not provided',
      phone: visitorInfo.phone || 'Not provided',
      industry: 'Chat Lead',
      businessStage: 'N/A',
      productIdea: messages.length > 0 ? messages[messages.length - 1].content?.substring(0, 200) : 'N/A',
      timeline: 'N/A'
    };
    const { html, text, subject } = renderAdminNewApplication(data);
    await sendToAdmins(subject, html, text);
    console.log('Lead notification email sent to admins');
    return true;
  } catch (error) {
    console.error('Email send error:', error.message);
    return false;
  }
}
```

- [ ] **Step 3: Replace sendFormSubmissionEmail() (line 445-553)**

Replace the old `sendFormSubmissionEmail` with:

```javascript
// Send form submission notification to all admins
async function sendFormSubmissionEmail(visitorInfo, formContent, clientIP) {
  try {
    const formLines = formContent.split('\n').filter(line => line.includes(':'));
    const formData = {};
    formLines.forEach(line => {
      const [key, ...valueParts] = line.split(':');
      formData[key.trim().toLowerCase().replace(/\s+/g, '')] = valueParts.join(':').trim();
    });

    const data = {
      name: visitorInfo.name || formData.fullname || 'New Applicant',
      email: visitorInfo.email || formData.email || 'Not provided',
      phone: visitorInfo.phone || formData.phone || 'Not provided',
      industry: formData.industry || 'Not provided',
      businessStage: formData.businessstage || formData.stage || 'Not provided',
      productIdea: formData.productidea || formData.idea || 'Not provided',
      timeline: formData.timeline || 'Not provided'
    };
    const { html, text, subject } = renderAdminNewApplication(data);
    await sendToAdmins(subject, html, text);
    console.log('Form submission email sent to all admins');
    return true;
  } catch (error) {
    console.error('Form submission email error:', error.message);
    return false;
  }
}
```

- [ ] **Step 4: Replace sendApplicantConfirmationEmail() (line 557-720)**

Replace with:

```javascript
// Send acknowledgment to applicant
async function sendApplicantConfirmationEmail(visitorInfo, formContent) {
  const applicantEmail = visitorInfo.email;
  if (!applicantEmail) {
    console.log('No applicant email provided, skipping confirmation email');
    return false;
  }
  try {
    const data = {
      name: visitorInfo.name || 'Partner',
      productIdea: visitorInfo.productIdea || ''
    };
    const { html, text, subject } = renderApplicantAcknowledgment(data);
    await sendTemplatedEmail(applicantEmail, subject, html, text);
    console.log('Applicant acknowledgment sent to:', applicantEmail);
    return true;
  } catch (error) {
    console.error('Applicant confirmation email error:', error.message);
    return false;
  }
}
```

- [ ] **Step 5: Add approval/rejection emails to admin-update handler**

Find the `admin-update` action handler (around line 2417). After the status is saved and GUID is generated (around line 1761), add email sending.

Find the section after `applicationData.status = newStatus;` and the S3 PutObject that saves the updated application. After the successful save, add:

```javascript
// Send approval/rejection email to applicant
const applicantEmail = applicationData.visitorInfo?.email || applicationData.formData?.email;
const applicantName = applicationData.visitorInfo?.name || applicationData.formData?.fullName;

if (newStatus === 'approved' && applicantEmail) {
  const approvalData = {
    name: applicantName,
    guid: applicationData.guid,
    sessionUrl: applicationData.sessionLink || null,
    deploymentUrl: null // Will be set after deployment
  };
  const { html, text, subject } = renderApplicantApproved(approvalData);
  sendTemplatedEmail(applicantEmail, subject, html, text).catch(e => console.error('Approval email failed:', e.message));
}

if (newStatus === 'rejected' && applicantEmail) {
  const { html, text, subject } = renderApplicantRejected({ name: applicantName });
  sendTemplatedEmail(applicantEmail, subject, html, text).catch(e => console.error('Rejection email failed:', e.message));
}
```

- [ ] **Step 6: Commit**

```bash
git add chat-backend/index.mjs
git commit -m "feat: wire application flow emails (#1-4) into existing handlers"
```

---

### Task 5: Add auth flow emails (welcome, forgot/reset password, login alert)

**Files:**
- Modify: `chat-backend/index.mjs`

- [ ] **Step 1: Add welcome email to user-signup handler (around line 2854)**

After the successful signup response is prepared (around line 2854, after profile.json is saved), add before the return:

```javascript
// Send welcome email (fire-and-forget)
sendTemplate(email, renderUserWelcome, { name: app.visitorInfo?.name || app.formData?.fullName || '', guid }).catch(e => console.error('Welcome email failed:', e.message));
```

- [ ] **Step 2: Add email-index creation during signup**

After saving profile.json in the signup handler, add:

```javascript
// Create email-index for forgot-password lookup
const crypto = await import('crypto');
const emailHash = crypto.createHash('sha256').update(email.toLowerCase().trim()).digest('hex');
await s3.send(new PutObjectCommand({
  Bucket: S3_BUCKET,
  Key: `email-index/${emailHash}.json`,
  Body: JSON.stringify({ guid, email: email.toLowerCase().trim() }),
  ContentType: 'application/json'
}));
```

- [ ] **Step 3: Add forgot-password handler**

After the `user-change-password` handler (around line 3239), add:

```javascript
// Forgot password - send reset link
if (action === 'forgot-password') {
  const { email } = body;
  if (!email) {
    return { statusCode: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }, body: JSON.stringify({ success: false, error: 'Email is required' }) };
  }

  // Always return success to prevent email enumeration
  const successResponse = { statusCode: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' }, body: JSON.stringify({ success: true, message: 'If an account exists with this email, a reset link has been sent.' }) };

  // Rate limiting
  if (isResetRateLimited(email)) {
    return successResponse;
  }

  try {
    const { S3Client, GetObjectCommand, PutObjectCommand } = await import('@aws-sdk/client-s3');
    const crypto = await import('crypto');
    const s3 = new S3Client({ region: S3_REGION });

    // Look up GUID from email index
    const emailHash = crypto.createHash('sha256').update(email.toLowerCase().trim()).digest('hex');
    let indexData;
    try {
      const result = await s3.send(new GetObjectCommand({ Bucket: S3_BUCKET, Key: `email-index/${emailHash}.json` }));
      indexData = JSON.parse(await result.Body.transformToString());
    } catch (e) {
      // Email not found - return success anyway
      return successResponse;
    }

    const guid = indexData.guid;

    // Get user profile for name
    let userName = '';
    try {
      const profileResult = await s3.send(new GetObjectCommand({ Bucket: S3_BUCKET, Key: `users/${guid}/profile.json` }));
      const profile = JSON.parse(await profileResult.Body.transformToString());
      userName = profile.name || '';
    } catch (e) { /* No profile */ }

    // Generate reset token
    const resetToken = crypto.randomBytes(32).toString('hex');
    const now = new Date();
    const expiresAt = new Date(now.getTime() + 60 * 60 * 1000); // 1 hour

    // Store reset token
    await s3.send(new PutObjectCommand({
      Bucket: S3_BUCKET,
      Key: `users/${guid}/reset-token.json`,
      Body: JSON.stringify({ token: resetToken, email: email.toLowerCase().trim(), createdAt: now.toISOString(), expiresAt: expiresAt.toISOString() }),
      ContentType: 'application/json'
    }));

    // Send reset email (fire-and-forget)
    const { html, text, subject } = renderPasswordResetLink({ name: userName, guid, resetToken });
    sendTemplatedEmail(email, subject, html, text).catch(e => console.error('Reset email failed:', e.message));

    return successResponse;
  } catch (error) {
    console.error('Forgot password error:', error.message);
    return successResponse; // Always return success
  }
}

// Reset password - validate token and update password
if (action === 'reset-password') {
  const { guid, resetToken, newPassword } = body;
  if (!guid || !resetToken || !newPassword) {
    return { statusCode: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }, body: JSON.stringify({ success: false, error: 'All fields are required' }) };
  }
  if (newPassword.length < 6) {
    return { statusCode: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }, body: JSON.stringify({ success: false, error: 'Password must be at least 6 characters' }) };
  }

  try {
    const { S3Client, GetObjectCommand, PutObjectCommand, DeleteObjectCommand } = await import('@aws-sdk/client-s3');
    const bcrypt = (await import('bcryptjs')).default;
    const s3 = new S3Client({ region: S3_REGION });

    // Validate reset token
    let tokenData;
    try {
      const result = await s3.send(new GetObjectCommand({ Bucket: S3_BUCKET, Key: `users/${guid}/reset-token.json` }));
      tokenData = JSON.parse(await result.Body.transformToString());
    } catch (e) {
      return { statusCode: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }, body: JSON.stringify({ success: false, error: 'Invalid or expired reset link' }) };
    }

    // Check token matches and not expired
    if (tokenData.token !== resetToken) {
      return { statusCode: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }, body: JSON.stringify({ success: false, error: 'Invalid or expired reset link' }) };
    }
    if (new Date(tokenData.expiresAt) < new Date()) {
      return { statusCode: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }, body: JSON.stringify({ success: false, error: 'Reset link has expired. Please request a new one.' }) };
    }

    // Update password
    const credResult = await s3.send(new GetObjectCommand({ Bucket: S3_BUCKET, Key: `users/${guid}/credentials.json` }));
    const credentials = JSON.parse(await credResult.Body.transformToString());
    credentials.passwordHash = await bcrypt.hash(newPassword, 10);
    await s3.send(new PutObjectCommand({
      Bucket: S3_BUCKET,
      Key: `users/${guid}/credentials.json`,
      Body: JSON.stringify(credentials),
      ContentType: 'application/json'
    }));

    // Delete reset token (single-use)
    await s3.send(new DeleteObjectCommand({ Bucket: S3_BUCKET, Key: `users/${guid}/reset-token.json` }));

    // Get user profile for name
    let userName = '';
    try {
      const profileResult = await s3.send(new GetObjectCommand({ Bucket: S3_BUCKET, Key: `users/${guid}/profile.json` }));
      const profile = JSON.parse(await profileResult.Body.transformToString());
      userName = profile.name || '';
    } catch (e) { /* No profile */ }

    // Send password changed confirmation (fire-and-forget)
    const { html, text, subject } = renderPasswordChanged({ name: userName });
    sendTemplatedEmail(tokenData.email, subject, html, text).catch(e => console.error('Password changed email failed:', e.message));

    return { statusCode: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' }, body: JSON.stringify({ success: true, message: 'Password has been reset successfully.' }) };
  } catch (error) {
    return { statusCode: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }, body: JSON.stringify({ success: false, error: error.message }) };
  }
}
```

- [ ] **Step 4: Add login IP tracking and new-login alert to user-login handler**

In the `user-login` handler (around line 2870), after the successful session creation and before the return, add:

```javascript
// Track login IP and send alert if new IP
const clientIP = event.requestContext?.http?.sourceIp || event.headers?.['X-Forwarded-For']?.split(',')[0]?.trim() || 'Unknown';

// Read login history
let loginHistory = { logins: [] };
try {
  const histResult = await s3.send(new GetObjectCommand({ Bucket: S3_BUCKET, Key: `users/${guid}/login-history.json` }));
  loginHistory = JSON.parse(await histResult.Body.transformToString());
} catch (e) { /* No history yet */ }

const knownIPs = loginHistory.logins.map(l => l.ip);
const isNewIP = clientIP !== 'Unknown' && !knownIPs.includes(clientIP);

// Add current login
loginHistory.logins.push({ ip: clientIP, timestamp: now.toISOString(), userAgent: event.headers?.['user-agent'] || '' });
loginHistory.logins = loginHistory.logins.slice(-10); // Keep last 10

await s3.send(new PutObjectCommand({
  Bucket: S3_BUCKET,
  Key: `users/${guid}/login-history.json`,
  Body: JSON.stringify(loginHistory),
  ContentType: 'application/json'
}));

// Send new login alert if IP is different
if (isNewIP && loginHistory.logins.length > 1) { // Skip first-ever login
  let userName = '';
  try {
    const profileResult = await s3.send(new GetObjectCommand({ Bucket: S3_BUCKET, Key: `users/${guid}/profile.json` }));
    const profile = JSON.parse(await profileResult.Body.transformToString());
    userName = profile.name || '';
  } catch (e) { /* No profile */ }

  const { html, text, subject } = renderNewLoginAlert({ name: userName, guid, ip: clientIP, timestamp: now.toISOString() });
  sendTemplatedEmail(credentials.email, subject, html, text).catch(e => console.error('Login alert email failed:', e.message));
}
```

- [ ] **Step 5: Add password-changed email to user-change-password handler**

In the `user-change-password` handler (around line 3230, after the successful password update), add before the return:

```javascript
// Send password changed confirmation
let userName = '';
try {
  const profileResult = await s3.send(new GetObjectCommand({ Bucket: S3_BUCKET, Key: `users/${guid}/profile.json` }));
  const profile = JSON.parse(await profileResult.Body.transformToString());
  userName = profile.name || '';
} catch (e) { /* No profile */ }
const { html, text, subject } = renderPasswordChanged({ name: userName });
sendTemplatedEmail(credentials.email, subject, html, text).catch(e => console.error('Password changed email failed:', e.message));
```

- [ ] **Step 6: Commit**

```bash
git add chat-backend/index.mjs
git commit -m "feat: add auth flow emails - welcome, forgot/reset password, login alert (#5-8)"
```

---

## Chunk 3: Project Flow, Account Management, Scheduled Emails, Cost Reports

### Task 6: Add project deployed and build failed email hooks

**Files:**
- Modify: `chat-backend/index.mjs`

- [ ] **Step 1: Find the build completion/failure points in index.mjs**

Search for where build status is updated to "deployed" or "failed". This is in the progress update handler or the Tmux Builder callback. Add email sends at those points:

For deployment success (when progress status becomes "completed"):
```javascript
// After updating progress to completed/deployed
if (applicantEmail) {
  const { html, text, subject } = renderProjectDeployed({ name: applicantName, projectName: projectName || 'Your Project', deploymentUrl, guid });
  sendTemplatedEmail(applicantEmail, subject, html, text).catch(e => console.error('Deploy notification failed:', e.message));
}
```

For build failure:
```javascript
// After updating progress to failed
if (applicantEmail) {
  const { html, text, subject } = renderBuildFailedUser({ name: applicantName, projectName, errorSummary: error.message || 'Build failed' });
  sendTemplatedEmail(applicantEmail, subject, html, text).catch(e => console.error('Build failed user email error:', e.message));
}
// Also notify admins
const adminEmail = renderBuildFailedAdmin({ userName: applicantName, userEmail: applicantEmail, guid, projectName, jobId, errorDetails: error.message || 'Unknown' });
sendToAdmins(adminEmail.subject, adminEmail.html, adminEmail.text).catch(e => console.error('Build failed admin email error:', e.message));
```

- [ ] **Step 2: Commit**

```bash
git add chat-backend/index.mjs
git commit -m "feat: add project deployed and build failed email notifications (#9-10)"
```

---

### Task 7: Add scheduled email handlers and account management

**Files:**
- Modify: `chat-backend/index.mjs`

- [ ] **Step 1: Add account deactivated email to admin actions**

Find the admin handler for deactivating/removing users. Add:

```javascript
if (newStatus === 'deactivated' && applicantEmail) {
  const { html, text, subject } = renderAccountDeactivated({ name: applicantName });
  sendTemplatedEmail(applicantEmail, subject, html, text).catch(e => console.error('Deactivation email failed:', e.message));
}
```

- [ ] **Step 2: Add unsubscribe preferences handler**

After the reset-password handler, add:

```javascript
// Update email preferences (unsubscribe)
if (action === 'update-email-preferences') {
  const { guid, sessionToken, preferences } = body;
  if (!guid) {
    return { statusCode: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }, body: JSON.stringify({ success: false, error: 'GUID is required' }) };
  }

  try {
    const { S3Client, GetObjectCommand, PutObjectCommand } = await import('@aws-sdk/client-s3');
    const s3 = new S3Client({ region: S3_REGION });

    // Get current profile
    let profile = {};
    try {
      const result = await s3.send(new GetObjectCommand({ Bucket: S3_BUCKET, Key: `users/${guid}/profile.json` }));
      profile = JSON.parse(await result.Body.transformToString());
    } catch (e) { /* No profile */ }

    // Update preferences
    profile.emailPreferences = {
      ...(profile.emailPreferences || { weeklyDigest: true, reEngagement: true }),
      ...preferences
    };

    await s3.send(new PutObjectCommand({
      Bucket: S3_BUCKET,
      Key: `users/${guid}/profile.json`,
      Body: JSON.stringify(profile),
      ContentType: 'application/json'
    }));

    return { statusCode: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' }, body: JSON.stringify({ success: true }) };
  } catch (error) {
    return { statusCode: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }, body: JSON.stringify({ success: false, error: error.message }) };
  }
}
```

- [ ] **Step 3: Add scheduled session-expiry handler**

Add at the same level as other action handlers:

```javascript
// Scheduled: Session expiry reminders
if (action === 'scheduled-session-expiry') {
  const { S3Client, GetObjectCommand, ListObjectsV2Command } = await import('@aws-sdk/client-s3');
  const s3 = new S3Client({ region: S3_REGION });
  let sent = 0, errors = 0;

  try {
    // List all user directories
    const listResult = await s3.send(new ListObjectsV2Command({ Bucket: S3_BUCKET, Prefix: 'users/', Delimiter: '/' }));
    const userPrefixes = (listResult.CommonPrefixes || []).map(p => p.Prefix);

    for (const prefix of userPrefixes) {
      try {
        const guid = prefix.replace('users/', '').replace('/', '');
        const sessResult = await s3.send(new GetObjectCommand({ Bucket: S3_BUCKET, Key: `users/${guid}/sessions.json` }));
        const sessions = JSON.parse(await sessResult.Body.transformToString());

        // Check if any session expires within 24 hours
        const now = new Date();
        const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000);
        const expiringSoon = sessions.tokens?.some(t => {
          const exp = new Date(t.expiresAt);
          return exp > now && exp < tomorrow;
        });

        if (expiringSoon) {
          // Get profile for name and email
          const profileResult = await s3.send(new GetObjectCommand({ Bucket: S3_BUCKET, Key: `users/${guid}/profile.json` }));
          const profile = JSON.parse(await profileResult.Body.transformToString());
          if (profile.email) {
            const { html, text, subject } = renderSessionExpiryReminder({ name: profile.name, guid });
            await sendTemplatedEmail(profile.email, subject, html, text);
            sent++;
          }
        }
      } catch (e) { errors++; }
    }
  } catch (e) { console.error('Session expiry scan error:', e.message); }

  return { statusCode: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' }, body: JSON.stringify({ success: true, sent, errors }) };
}
```

- [ ] **Step 4: Add scheduled weekly-digest handler**

```javascript
// Scheduled: Weekly project digest
if (action === 'scheduled-weekly-digest') {
  const { S3Client, GetObjectCommand, ListObjectsV2Command } = await import('@aws-sdk/client-s3');
  const s3 = new S3Client({ region: S3_REGION });
  let sent = 0, errors = 0, skipped = 0;

  try {
    const allApps = await listApplications();
    const approvedApps = allApps.filter(app => app.guid && app.visitorInfo?.email);

    const now = new Date();
    const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const weekRange = `${weekAgo.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} - ${now.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`;

    for (const app of approvedApps) {
      try {
        const guid = app.guid;
        const email = app.visitorInfo.email;
        const name = app.visitorInfo?.name || email.split('@')[0];

        // Check unsubscribe preference
        let profile = {};
        try {
          const profileResult = await s3.send(new GetObjectCommand({ Bucket: S3_BUCKET, Key: `users/${guid}/profile.json` }));
          profile = JSON.parse(await profileResult.Body.transformToString());
        } catch (e) { /* No profile */ }

        if (profile.emailPreferences?.weeklyDigest === false) {
          skipped++;
          continue;
        }

        // Get last activity from login history
        let lastActivity = 'N/A';
        try {
          const histResult = await s3.send(new GetObjectCommand({ Bucket: S3_BUCKET, Key: `users/${guid}/login-history.json` }));
          const history = JSON.parse(await histResult.Body.transformToString());
          if (history.logins?.length > 0) {
            lastActivity = new Date(history.logins[history.logins.length - 1].timestamp).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
          }
        } catch (e) { /* No history */ }

        // Get deployment status from progress
        let deploymentStatus = 'Pending';
        if (app.jobId) {
          try {
            const progressResult = await s3.send(new GetObjectCommand({ Bucket: S3_BUCKET, Key: `progress/${app.jobId}.json` }));
            const progress = JSON.parse(await progressResult.Body.transformToString());
            deploymentStatus = progress.status || 'Pending';
          } catch (e) { /* No progress */ }
        }

        const { html, text, subject } = renderWeeklyDigest({
          name, guid, weekRange,
          projectStatus: app.status || 'Active',
          lastActivity,
          deploymentStatus
        });
        await sendTemplatedEmail(email, subject, html, text);
        sent++;
      } catch (e) { errors++; }
    }
  } catch (e) { console.error('Weekly digest error:', e.message); }

  return { statusCode: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' }, body: JSON.stringify({ success: true, sent, errors, skipped }) };
}
```

- [ ] **Step 5: Add scheduled re-engagement handler**

```javascript
// Scheduled: Re-engagement emails
if (action === 'scheduled-re-engagement') {
  const { S3Client, GetObjectCommand, ListObjectsV2Command } = await import('@aws-sdk/client-s3');
  const s3 = new S3Client({ region: S3_REGION });
  let sent = 0, errors = 0, skipped = 0;

  try {
    const allApps = await listApplications();
    const approvedApps = allApps.filter(app => app.guid && app.visitorInfo?.email);

    const now = new Date();
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

    for (const app of approvedApps) {
      try {
        const guid = app.guid;
        const email = app.visitorInfo.email;
        const name = app.visitorInfo?.name || email.split('@')[0];

        // Check unsubscribe preference
        let profile = {};
        try {
          const profileResult = await s3.send(new GetObjectCommand({ Bucket: S3_BUCKET, Key: `users/${guid}/profile.json` }));
          profile = JSON.parse(await profileResult.Body.transformToString());
        } catch (e) { /* No profile */ }

        if (profile.emailPreferences?.reEngagement === false) {
          skipped++;
          continue;
        }

        // Check last login
        let lastLogin = null;
        try {
          const histResult = await s3.send(new GetObjectCommand({ Bucket: S3_BUCKET, Key: `users/${guid}/login-history.json` }));
          const history = JSON.parse(await histResult.Body.transformToString());
          if (history.logins?.length > 0) {
            lastLogin = history.logins[history.logins.length - 1].timestamp;
          }
        } catch (e) { /* No history */ }

        // Only send if last login was 30+ days ago (or never logged in)
        if (lastLogin && new Date(lastLogin) > thirtyDaysAgo) {
          continue; // Active user, skip
        }

        const { html, text, subject } = renderReEngagement({
          name, guid, lastLogin,
          projectStatus: app.status || 'Active'
        });
        await sendTemplatedEmail(email, subject, html, text);
        sent++;
      } catch (e) { errors++; }
    }
  } catch (e) { console.error('Re-engagement error:', e.message); }

  return { statusCode: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' }, body: JSON.stringify({ success: true, sent, errors, skipped }) };
}
```

- [ ] **Step 6: Commit**

```bash
git add chat-backend/index.mjs
git commit -m "feat: add scheduled emails - session expiry, weekly digest, re-engagement (#11-14)"
```

---

### Task 8: Update cost report recipients

**Files:**
- Modify: `chat-backend/costs/email-reports.mjs` (lines 1081-1090)

- [ ] **Step 1: Update admin summary recipients**

At line 1081, replace:
```javascript
const adminEmail = 'CEO@cocreateidea.com';
const ccEmail = 'info@cocreateidea.com';
```
With:
```javascript
const adminEmails = ['CEO@cocreateidea.com', 'COO@cocreateidea.com', 'CTO@cocreateidea.com'];
const ccEmail = 'info@cocreateidea.com';
```

At line 1088-1090, replace:
```javascript
Source: adminEmail,
Destination: { ToAddresses: [adminEmail, ccEmail] },
ReplyToAddresses: [adminEmail],
```
With:
```javascript
Source: 'noreply@cocreateidea.com',
Destination: { ToAddresses: adminEmails, CcAddresses: [ccEmail] },
ReplyToAddresses: ['CEO@cocreateidea.com'],
```

Also update the console.log at line 1104:
```javascript
console.log('[Admin Summary] Sent admin summary to:', adminEmails.join(', '), '+ CC:', ccEmail, 'MessageId:', result.MessageId);
```

- [ ] **Step 2: Commit**

```bash
git add chat-backend/costs/email-reports.mjs
git commit -m "feat: send AWS cost reports to all admin emails (CEO, COO, CTO)"
```

---

## Chunk 4: Frontend Updates & EventBridge Setup

### Task 9: Update frontend for forgot/reset password flow

**Files:**
- Modify: `site/js/user-core.js`

- [ ] **Step 1: Ensure reset token is read from URL**

Check if `user-core.js` already handles the `?reset=` URL parameter. The existing code at line 107-112 shows `forgotPasswordApi` and `resetPasswordApi` are defined. Verify the initialization logic reads the token from URL and shows the reset screen.

If missing, add to the initialization function:

```javascript
// Check for reset token in URL
const urlParams = new URLSearchParams(window.location.search);
const resetToken = urlParams.get('reset');
if (resetToken && currentGuid) {
  currentResetToken = resetToken;
  showScreen('reset');
  return;
}

// Check for unsubscribe param
const unsubscribe = urlParams.get('unsubscribe');
if (unsubscribe && currentGuid) {
  apiCall('update-email-preferences', { guid: currentGuid, preferences: { [unsubscribe]: false } })
    .then(result => {
      if (result.success) {
        showToast('You have been unsubscribed.', 'success');
      }
    });
}
```

- [ ] **Step 2: Verify forgot password shows success message**

Ensure the forgot password form handler shows "Check your email for a reset link" on success rather than just a generic message. The existing `forgotPasswordApi` function calls the backend - verify the UI updates appropriately.

- [ ] **Step 3: Commit**

```bash
git add site/js/user-core.js
git commit -m "feat: handle reset token from URL and unsubscribe param in frontend"
```

---

### Task 10: Create EventBridge rules

- [ ] **Step 1: Get the Lambda function ARN**

Run: `aws lambda get-function --function-name cocreate-chat-backend --query 'Configuration.FunctionArn' --output text --region us-east-1`

Note: The actual function name may differ. Check with: `aws lambda list-functions --query 'Functions[?contains(FunctionName, `cocreate`)].FunctionName' --output text --region us-east-1`

- [ ] **Step 2: Create session-expiry EventBridge rule**

```bash
aws events put-rule \
  --name cocreate-session-expiry-check \
  --schedule-expression "cron(0 13 * * ? *)" \
  --state ENABLED \
  --description "Daily check for expiring CoCreate sessions (8AM EST)" \
  --region us-east-1

aws events put-targets \
  --rule cocreate-session-expiry-check \
  --targets "Id"="1","Arn"="LAMBDA_ARN","Input"="{\"action\":\"scheduled-session-expiry\"}" \
  --region us-east-1
```

- [ ] **Step 3: Create weekly-digest EventBridge rule**

```bash
aws events put-rule \
  --name cocreate-weekly-digest \
  --schedule-expression "cron(0 15 ? * MON *)" \
  --state ENABLED \
  --description "Monday 10AM EST weekly project digest" \
  --region us-east-1

aws events put-targets \
  --rule cocreate-weekly-digest \
  --targets "Id"="1","Arn"="LAMBDA_ARN","Input"="{\"action\":\"scheduled-weekly-digest\"}" \
  --region us-east-1
```

- [ ] **Step 4: Create re-engagement EventBridge rule**

```bash
aws events put-rule \
  --name cocreate-re-engagement \
  --schedule-expression "cron(0 14 * * ? *)" \
  --state ENABLED \
  --description "Daily 9AM EST re-engagement check for inactive users" \
  --region us-east-1

aws events put-targets \
  --rule cocreate-re-engagement \
  --targets "Id"="1","Arn"="LAMBDA_ARN","Input"="{\"action\":\"scheduled-re-engagement\"}" \
  --region us-east-1
```

- [ ] **Step 5: Add Lambda permission for EventBridge**

```bash
aws lambda add-permission \
  --function-name LAMBDA_FUNCTION_NAME \
  --statement-id cocreate-session-expiry \
  --action lambda:InvokeFunction \
  --principal events.amazonaws.com \
  --source-arn "arn:aws:events:us-east-1:ACCOUNT_ID:rule/cocreate-session-expiry-check" \
  --region us-east-1

aws lambda add-permission \
  --function-name LAMBDA_FUNCTION_NAME \
  --statement-id cocreate-weekly-digest \
  --action lambda:InvokeFunction \
  --principal events.amazonaws.com \
  --source-arn "arn:aws:events:us-east-1:ACCOUNT_ID:rule/cocreate-weekly-digest" \
  --region us-east-1

aws lambda add-permission \
  --function-name LAMBDA_FUNCTION_NAME \
  --statement-id cocreate-re-engagement \
  --action lambda:InvokeFunction \
  --principal events.amazonaws.com \
  --source-arn "arn:aws:events:us-east-1:ACCOUNT_ID:rule/cocreate-re-engagement" \
  --region us-east-1
```

- [ ] **Step 6: Commit docs update**

```bash
git commit -m "docs: document EventBridge rules for scheduled emails"
```

---

### Task 11: Deploy and verify

- [ ] **Step 1: Build Lambda deployment package**

```bash
cd C:/Projects/ai-product-studio/option-a-threejs-gsap-tailwind/chat-backend
# The deploy script handles building and uploading
bash deploy.sh
```

- [ ] **Step 2: Upload frontend changes to S3**

```bash
cd C:/Projects/ai-product-studio/option-a-threejs-gsap-tailwind
aws s3 sync site/ s3://cocreateidea.com/ --delete --exclude ".git/*" --region us-east-1
```

- [ ] **Step 3: Invalidate CloudFront cache**

```bash
aws cloudfront create-invalidation --distribution-id DISTRIBUTION_ID --paths "/*" --region us-east-1
```

- [ ] **Step 4: Test each email flow manually**

1. Submit test application at apply.html → verify admin notification + acknowledgment
2. Approve test application in admin.html → verify approval email with URLs
3. Sign up at user.html → verify welcome email
4. Click "Forgot Password" → verify reset email arrives
5. Use reset link → verify password changed confirmation
6. Log in from different IP/browser → verify login alert
7. Trigger scheduled handlers manually via AWS console (test event)

- [ ] **Step 5: Verify SES sending (check sandbox status)**

```bash
aws ses get-account --region us-east-1
```

If in sandbox, verify COO and CTO email addresses:
```bash
aws ses verify-email-identity --email-address COO@cocreateidea.com --region us-east-1
aws ses verify-email-identity --email-address CTO@cocreateidea.com --region us-east-1
```

- [ ] **Step 6: Final commit**

```bash
git add -A
git commit -m "feat: complete CoCreate email system - 14 emails, all flows wired"
```
