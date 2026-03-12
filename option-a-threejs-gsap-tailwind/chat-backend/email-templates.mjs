/**
 * Email Templates for CoCreate Idea Platform
 *
 * Provides branded, table-based HTML email templates for all platform flows:
 * - Application (admin notification, applicant acknowledgment/approved/rejected)
 * - Auth (welcome, password reset/changed, login alert)
 * - Project (deployed, build failed user/admin)
 * - Account (deactivated, session expiry)
 * - Engagement (weekly digest, re-engagement)
 *
 * All renderers return { html, text, subject }.
 */

// ─── Config ──────────────────────────────────────────────────────────────────

export const EMAIL_CONFIG = {
  from: 'CoCreate Idea <noreply@cocreateidea.com>',
  replyTo: 'support@cocreateidea.com',
  logoUrl: 'https://www.cocreateidea.com/assets/logo.png',
  siteUrl: 'https://www.cocreateidea.com',
  supportEmail: 'support@cocreateidea.com',
};

export const ADMIN_EMAILS = [
  'ceo@cocreateidea.com',
  'coo@cocreateidea.com',
  'cto@cocreateidea.com',
];

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Format a date for display in emails.
 * Accepts Date objects, ISO strings, or timestamps.
 */
export function formatDate(date) {
  if (!date) return 'N/A';
  const d = date instanceof Date ? date : new Date(date);
  if (isNaN(d.getTime())) return String(date);
  return d.toLocaleString('en-US', {
    weekday: 'short',
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZoneName: 'short',
  });
}

/**
 * Render a CTA button (table-based for email client compatibility).
 */
export function ctaButton(url, text) {
  return `
<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:24px auto;">
  <tr>
    <td align="center" bgcolor="#c4671a" style="border-radius:6px;">
      <a href="${escHtml(url)}" target="_blank"
         style="display:inline-block;padding:14px 32px;font-size:16px;font-weight:bold;color:#ffffff;text-decoration:none;border-radius:6px;">
        ${escHtml(text)}
      </a>
    </td>
  </tr>
</table>`;
}

/**
 * Render a single label/value table row.
 */
export function tableRow(label, value) {
  return `
<tr>
  <td style="padding:8px 12px;border-bottom:1px solid #3a2820;color:#c4671a;font-weight:bold;white-space:nowrap;">${escHtml(label)}</td>
  <td style="padding:8px 12px;border-bottom:1px solid #3a2820;color:#e0d0c0;">${escHtml(String(value ?? 'N/A'))}</td>
</tr>`;
}

/**
 * Render a full data table from an array of [label, value] pairs.
 */
export function dataTable(rows) {
  const inner = rows.map(([label, value]) => tableRow(label, value)).join('');
  return `
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:16px 0;border-collapse:collapse;">
  ${inner}
</table>`;
}

// ─── Base Layout ─────────────────────────────────────────────────────────────

/**
 * Branded HTML email wrapper.
 * Table-based layout for maximum email client support.
 */
export function getEmailBaseHtml(content) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>CoCreate Idea</title>
</head>
<body style="margin:0;padding:0;background-color:#1a0a00;font-family:Arial,Helvetica,sans-serif;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#1a0a00">
  <tr>
    <td align="center" style="padding:24px 16px;">

      <!-- Main container -->
      <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;width:100%;">

        <!-- Header with gradient -->
        <tr>
          <td align="center" style="background:linear-gradient(135deg,#c4671a,#8b4513);padding:28px 24px;border-radius:8px 8px 0 0;">
            <img src="${EMAIL_CONFIG.logoUrl}" alt="CoCreate Idea" width="160" style="display:block;max-width:160px;height:auto;" />
          </td>
        </tr>

        <!-- Content area -->
        <tr>
          <td bgcolor="#2a1810" style="padding:32px 28px;color:#e0d0c0;font-size:15px;line-height:1.6;border-radius:0 0 8px 8px;">
            ${content}
          </td>
        </tr>

        <!-- Footer -->
        <tr>
          <td align="center" style="padding:20px 16px;font-size:12px;color:#8a7a6a;">
            <p style="margin:0 0 6px 0;">&copy; ${new Date().getFullYear()} CoCreate Idea. All rights reserved.</p>
            <p style="margin:0;">
              Need help? <a href="mailto:${EMAIL_CONFIG.supportEmail}" style="color:#c4671a;text-decoration:underline;">Contact Support</a>
            </p>
          </td>
        </tr>

      </table>
    </td>
  </tr>
</table>
</body>
</html>`;
}

// ─── Internal Utilities ──────────────────────────────────────────────────────

function escHtml(str) {
  if (str == null) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function heading(text) {
  return `<h2 style="margin:0 0 16px 0;color:#c4671a;font-size:22px;">${escHtml(text)}</h2>`;
}

function paragraph(text) {
  return `<p style="margin:0 0 14px 0;color:#e0d0c0;">${text}</p>`;
}

function divider() {
  return '<hr style="border:none;border-top:1px solid #3a2820;margin:20px 0;" />';
}

function bulletList(items) {
  return `<ul style="margin:12px 0;padding-left:20px;color:#e0d0c0;">
${items.map(i => `  <li style="margin-bottom:6px;">${escHtml(i)}</li>`).join('\n')}
</ul>`;
}

function plainTextSeparator() {
  return '\n----------------------------------------\n';
}

// ─── Application Flow ────────────────────────────────────────────────────────

export function renderAdminNewApplication(data) {
  const { name, email, company, role, message, applicationId } = data;
  const subject = `New Application: ${name}`;

  const rows = [
    ['Name', name],
    ['Email', email],
    ['Company', company || 'Not provided'],
    ['Role', role || 'Not provided'],
    ['Application ID', applicationId || 'N/A'],
  ];
  if (message) rows.push(['Message', message]);

  const content = [
    heading('New Application Received'),
    paragraph('A new application has been submitted for review.'),
    dataTable(rows),
    ctaButton(`${EMAIL_CONFIG.siteUrl}/admin.html`, 'Review in Admin Panel'),
  ].join('');

  const text = [
    'NEW APPLICATION RECEIVED',
    plainTextSeparator(),
    `Name: ${name}`,
    `Email: ${email}`,
    `Company: ${company || 'Not provided'}`,
    `Role: ${role || 'Not provided'}`,
    `Application ID: ${applicationId || 'N/A'}`,
    message ? `Message: ${message}` : '',
    '',
    `Review at: ${EMAIL_CONFIG.siteUrl}/admin.html`,
  ].filter(Boolean).join('\n');

  return { html: getEmailBaseHtml(content), text, subject };
}

export function renderApplicantAcknowledgment(data) {
  const { name } = data;
  const subject = 'Application Received - CoCreate Idea';

  const content = [
    heading('Thank You for Applying!'),
    paragraph(`Hi ${escHtml(name)},`),
    paragraph('We\'ve received your application and our team is excited to review it.'),
    paragraph('<strong>What happens next:</strong>'),
    bulletList([
      'Our team will review your application within 48 hours.',
      'You\'ll receive an email with our decision.',
      'If approved, you\'ll get immediate access to the platform.',
    ]),
    paragraph('If you have any questions in the meantime, feel free to reach out to our support team.'),
  ].join('');

  const text = [
    `Hi ${name},`,
    '',
    'Thank you for applying to CoCreate Idea! We\'ve received your application.',
    '',
    'What happens next:',
    '- Our team will review your application within 48 hours.',
    '- You\'ll receive an email with our decision.',
    '- If approved, you\'ll get immediate access to the platform.',
    '',
    `Questions? Email us at ${EMAIL_CONFIG.supportEmail}`,
  ].join('\n');

  return { html: getEmailBaseHtml(content), text, subject };
}

export function renderApplicantApproved(data) {
  const { name, guid, dashboardUrl, builderSessionUrl, deploymentUrl } = data;
  const subject = 'You\'re Approved! Welcome to CoCreate Idea';

  const dashboard = dashboardUrl || `${EMAIL_CONFIG.siteUrl}/dashboard.html?id=${guid}`;
  const builder = builderSessionUrl || `${EMAIL_CONFIG.siteUrl}/builder.html?id=${guid}`;
  const deployment = deploymentUrl || `${EMAIL_CONFIG.siteUrl}/deploy.html?id=${guid}`;

  const content = [
    heading('Congratulations, You\'re Approved!'),
    paragraph(`Hi ${escHtml(name)},`),
    paragraph('Great news — your application has been approved! You now have full access to the CoCreate Idea platform.'),
    paragraph('<strong>Your links:</strong>'),
    dataTable([
      ['Dashboard', `<a href="${escHtml(dashboard)}" style="color:#c4671a;">${escHtml(dashboard)}</a>`],
      ['Builder Session', `<a href="${escHtml(builder)}" style="color:#c4671a;">${escHtml(builder)}</a>`],
      ['Deployment', `<a href="${escHtml(deployment)}" style="color:#c4671a;">${escHtml(deployment)}</a>`],
    ]),
    ctaButton(dashboard, 'Go to Dashboard'),
    divider(),
    paragraph('<strong>Next steps:</strong>'),
    bulletList([
      'Explore your dashboard to manage projects.',
      'Start a builder session to create your first project.',
      'Deploy your project when it\'s ready.',
    ]),
  ].join('');

  const text = [
    `Hi ${name},`,
    '',
    'Congratulations! Your application has been approved.',
    '',
    'Your links:',
    `- Dashboard: ${dashboard}`,
    `- Builder Session: ${builder}`,
    `- Deployment: ${deployment}`,
    '',
    'Next steps:',
    '- Explore your dashboard to manage projects.',
    '- Start a builder session to create your first project.',
    '- Deploy your project when it\'s ready.',
  ].join('\n');

  return { html: getEmailBaseHtml(content), text, subject };
}

export function renderApplicantRejected(data) {
  const { name, reason } = data;
  const subject = 'Application Update - CoCreate Idea';

  const content = [
    heading('Application Update'),
    paragraph(`Hi ${escHtml(name)},`),
    paragraph('Thank you for your interest in CoCreate Idea. After careful review, we\'re unable to approve your application at this time.'),
    reason ? paragraph(`<strong>Feedback:</strong> ${escHtml(reason)}`) : '',
    paragraph('We encourage you to reapply in the future as our platform evolves and capacity grows.'),
    paragraph('Thank you for your understanding, and we wish you the best with your projects.'),
  ].join('');

  const text = [
    `Hi ${name},`,
    '',
    'Thank you for your interest in CoCreate Idea. After careful review, we\'re unable to approve your application at this time.',
    reason ? `\nFeedback: ${reason}` : '',
    '',
    'We encourage you to reapply in the future.',
    '',
    'Thank you for your understanding.',
  ].filter(l => l !== undefined).join('\n');

  return { html: getEmailBaseHtml(content), text, subject };
}

// ─── Auth Flow ───────────────────────────────────────────────────────────────

export function renderUserWelcome(data) {
  const { name, email, guid } = data;
  const subject = 'Welcome to CoCreate Idea!';
  const dashboard = `${EMAIL_CONFIG.siteUrl}/dashboard.html?id=${guid}`;

  const content = [
    heading('Welcome to CoCreate Idea!'),
    paragraph(`Hi ${escHtml(name)},`),
    paragraph('Your account is ready. Here\'s what you can do from your dashboard:'),
    bulletList([
      'Create and manage AI-powered projects',
      'Deploy sites with one click',
      'Monitor usage and costs in real time',
      'Access the AI builder for rapid prototyping',
      'Manage your account and security settings',
    ]),
    ctaButton(dashboard, 'Open Dashboard'),
    paragraph(`Your login email: <strong>${escHtml(email)}</strong>`),
  ].join('');

  const text = [
    `Hi ${name},`,
    '',
    'Welcome to CoCreate Idea! Your account is ready.',
    '',
    'Dashboard features:',
    '- Create and manage AI-powered projects',
    '- Deploy sites with one click',
    '- Monitor usage and costs in real time',
    '- Access the AI builder for rapid prototyping',
    '- Manage your account and security settings',
    '',
    `Dashboard: ${dashboard}`,
    `Login email: ${email}`,
  ].join('\n');

  return { html: getEmailBaseHtml(content), text, subject };
}

export function renderPasswordResetLink(data) {
  const { name, guid, resetToken } = data;
  const subject = 'Password Reset - CoCreate Idea';
  const resetUrl = `${EMAIL_CONFIG.siteUrl}/user.html?id=${guid}&reset=${resetToken}`;

  const content = [
    heading('Password Reset Request'),
    paragraph(`Hi ${escHtml(name)},`),
    paragraph('We received a request to reset your password. Click the button below to set a new password.'),
    ctaButton(resetUrl, 'Reset Password'),
    paragraph('<strong>This link will expire in 1 hour.</strong>'),
    divider(),
    paragraph('If you didn\'t request this, you can safely ignore this email. Your password will remain unchanged.'),
  ].join('');

  const text = [
    `Hi ${name},`,
    '',
    'We received a request to reset your password.',
    '',
    `Reset your password: ${resetUrl}`,
    '',
    'This link will expire in 1 hour.',
    '',
    'If you didn\'t request this, you can safely ignore this email.',
  ].join('\n');

  return { html: getEmailBaseHtml(content), text, subject };
}

export function renderPasswordChanged(data) {
  const { name, changedAt } = data;
  const subject = 'Password Changed - CoCreate Idea';
  const timestamp = formatDate(changedAt || new Date());

  const content = [
    heading('Password Changed Successfully'),
    paragraph(`Hi ${escHtml(name)},`),
    paragraph('Your password has been changed successfully.'),
    dataTable([['Changed at', timestamp]]),
    paragraph('If you did not make this change, please contact support immediately and reset your password.'),
    ctaButton(`mailto:${EMAIL_CONFIG.supportEmail}`, 'Contact Support'),
  ].join('');

  const text = [
    `Hi ${name},`,
    '',
    'Your password has been changed successfully.',
    `Changed at: ${timestamp}`,
    '',
    'If you did not make this change, please contact support immediately.',
    `Support: ${EMAIL_CONFIG.supportEmail}`,
  ].join('\n');

  return { html: getEmailBaseHtml(content), text, subject };
}

export function renderNewLoginAlert(data) {
  const { name, ip, timestamp, userAgent, guid } = data;
  const subject = 'New Login Detected - CoCreate Idea';
  const changePasswordUrl = `${EMAIL_CONFIG.siteUrl}/user.html?id=${guid}`;
  const ts = formatDate(timestamp || new Date());

  const content = [
    heading('New Login Detected'),
    paragraph(`Hi ${escHtml(name)},`),
    paragraph('A new login was detected on your account.'),
    dataTable([
      ['IP Address', ip || 'Unknown'],
      ['Time', ts],
      ['Device', userAgent || 'Unknown'],
    ]),
    paragraph('If this was you, no action is needed. If you don\'t recognize this login, change your password immediately.'),
    ctaButton(changePasswordUrl, 'Change Password'),
  ].join('');

  const text = [
    `Hi ${name},`,
    '',
    'A new login was detected on your account.',
    `IP Address: ${ip || 'Unknown'}`,
    `Time: ${ts}`,
    `Device: ${userAgent || 'Unknown'}`,
    '',
    'If this wasn\'t you, change your password immediately:',
    changePasswordUrl,
  ].join('\n');

  return { html: getEmailBaseHtml(content), text, subject };
}

// ─── Project Flow ────────────────────────────────────────────────────────────

export function renderProjectDeployed(data) {
  const { name, projectName, liveUrl, deployedAt } = data;
  const subject = `Project Deployed: ${projectName}`;
  const ts = formatDate(deployedAt || new Date());

  const content = [
    heading('Project Deployed Successfully!'),
    paragraph(`Hi ${escHtml(name)},`),
    paragraph(`Your project <strong>${escHtml(projectName)}</strong> has been deployed and is now live.`),
    dataTable([
      ['Project', projectName],
      ['Live URL', `<a href="${escHtml(liveUrl)}" style="color:#c4671a;">${escHtml(liveUrl)}</a>`],
      ['Deployed at', ts],
    ]),
    ctaButton(liveUrl, 'View Live Site'),
  ].join('');

  const text = [
    `Hi ${name},`,
    '',
    `Your project "${projectName}" has been deployed successfully!`,
    `Live URL: ${liveUrl}`,
    `Deployed at: ${ts}`,
  ].join('\n');

  return { html: getEmailBaseHtml(content), text, subject };
}

export function renderBuildFailedUser(data) {
  const { name, projectName, errorSummary } = data;
  const subject = `Build Failed: ${projectName}`;

  const content = [
    heading('Build Failed'),
    paragraph(`Hi ${escHtml(name)},`),
    paragraph(`Unfortunately, the latest build for <strong>${escHtml(projectName)}</strong> did not complete successfully.`),
    errorSummary ? paragraph(`<strong>Error:</strong> ${escHtml(errorSummary)}`) : '',
    paragraph('Our team has been notified and is looking into it. You can also try rebuilding from your dashboard.'),
    ctaButton(EMAIL_CONFIG.siteUrl, 'Go to Dashboard'),
  ].join('');

  const text = [
    `Hi ${name},`,
    '',
    `The latest build for "${projectName}" failed.`,
    errorSummary ? `Error: ${errorSummary}` : '',
    '',
    'Our team has been notified. You can try rebuilding from your dashboard.',
    `Dashboard: ${EMAIL_CONFIG.siteUrl}`,
  ].filter(Boolean).join('\n');

  return { html: getEmailBaseHtml(content), text, subject };
}

export function renderBuildFailedAdmin(data) {
  const { projectName, userEmail, userName, errorDetails, jobId, timestamp } = data;
  const subject = `[ADMIN] Build Failed: ${projectName} (${userEmail})`;
  const ts = formatDate(timestamp || new Date());

  const content = [
    heading('Build Failure Report'),
    dataTable([
      ['Project', projectName],
      ['User', `${userName || 'Unknown'} (${userEmail})`],
      ['Job ID', jobId || 'N/A'],
      ['Timestamp', ts],
    ]),
    paragraph('<strong>Error Details:</strong>'),
    `<pre style="background:#1a0a00;padding:14px;border-radius:4px;color:#e0d0c0;overflow-x:auto;font-size:13px;border:1px solid #3a2820;">${escHtml(errorDetails || 'No details available')}</pre>`,
  ].join('');

  const text = [
    'BUILD FAILURE REPORT',
    plainTextSeparator(),
    `Project: ${projectName}`,
    `User: ${userName || 'Unknown'} (${userEmail})`,
    `Job ID: ${jobId || 'N/A'}`,
    `Timestamp: ${ts}`,
    '',
    'Error Details:',
    errorDetails || 'No details available',
  ].join('\n');

  return { html: getEmailBaseHtml(content), text, subject };
}

// ─── Account Management ──────────────────────────────────────────────────────

export function renderAccountDeactivated(data) {
  const { name } = data;
  const subject = 'Account Deactivated - CoCreate Idea';

  const content = [
    heading('Account Deactivated'),
    paragraph(`Hi ${escHtml(name)},`),
    paragraph('Your CoCreate Idea account has been deactivated.'),
    paragraph('<strong>Important:</strong> Your data will be retained for 30 days. After that period, all associated data will be permanently deleted.'),
    paragraph('If you believe this was done in error, or if you\'d like to reactivate your account, please contact our support team within the 30-day window.'),
    ctaButton(`mailto:${EMAIL_CONFIG.supportEmail}`, 'Contact Support'),
  ].join('');

  const text = [
    `Hi ${name},`,
    '',
    'Your CoCreate Idea account has been deactivated.',
    '',
    'Important: Your data will be retained for 30 days. After that, all data will be permanently deleted.',
    '',
    'To reactivate your account, contact support within 30 days.',
    `Support: ${EMAIL_CONFIG.supportEmail}`,
  ].join('\n');

  return { html: getEmailBaseHtml(content), text, subject };
}

export function renderSessionExpiryReminder(data) {
  const { name, guid, expiresAt } = data;
  const subject = 'Session Expiring Soon - CoCreate Idea';
  const loginUrl = `${EMAIL_CONFIG.siteUrl}/user.html?id=${guid}`;
  const ts = formatDate(expiresAt);

  const content = [
    heading('Session Expiring Tomorrow'),
    paragraph(`Hi ${escHtml(name)},`),
    paragraph('Your current session is set to expire tomorrow. Log in again to keep your session active.'),
    expiresAt ? paragraph(`<strong>Expires:</strong> ${escHtml(ts)}`) : '',
    ctaButton(loginUrl, 'Log In Now'),
  ].join('');

  const text = [
    `Hi ${name},`,
    '',
    'Your session expires tomorrow. Log in to keep it active.',
    expiresAt ? `Expires: ${ts}` : '',
    '',
    `Log in: ${loginUrl}`,
  ].filter(Boolean).join('\n');

  return { html: getEmailBaseHtml(content), text, subject };
}

// ─── Engagement ──────────────────────────────────────────────────────────────

export function renderWeeklyDigest(data) {
  const { name, guid, projects, unsubscribeUrl } = data;
  const subject = 'Your Weekly Digest - CoCreate Idea';
  const dashboard = `${EMAIL_CONFIG.siteUrl}/dashboard.html?id=${guid}`;
  const unsub = unsubscribeUrl || `${EMAIL_CONFIG.siteUrl}/unsubscribe.html?id=${guid}&type=digest`;

  let projectRows = '';
  if (projects && projects.length > 0) {
    const rows = projects.map(p => [
      escHtml(p.name),
      escHtml(p.lastActivity || 'N/A'),
      escHtml(p.deploymentStatus || 'N/A'),
    ]);
    projectRows = `
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:16px 0;border-collapse:collapse;">
  <tr>
    <th style="padding:8px 12px;border-bottom:2px solid #3a2820;color:#c4671a;text-align:left;">Project</th>
    <th style="padding:8px 12px;border-bottom:2px solid #3a2820;color:#c4671a;text-align:left;">Last Activity</th>
    <th style="padding:8px 12px;border-bottom:2px solid #3a2820;color:#c4671a;text-align:left;">Status</th>
  </tr>
  ${rows.map(([n, a, s]) => `<tr>
    <td style="padding:8px 12px;border-bottom:1px solid #3a2820;color:#e0d0c0;">${n}</td>
    <td style="padding:8px 12px;border-bottom:1px solid #3a2820;color:#e0d0c0;">${a}</td>
    <td style="padding:8px 12px;border-bottom:1px solid #3a2820;color:#e0d0c0;">${s}</td>
  </tr>`).join('\n  ')}
</table>`;
  } else {
    projectRows = paragraph('No active projects this week. <a href="' + escHtml(dashboard) + '" style="color:#c4671a;">Start building!</a>');
  }

  const content = [
    heading('Your Weekly Digest'),
    paragraph(`Hi ${escHtml(name)},`),
    paragraph('Here\'s a summary of your projects this week:'),
    projectRows,
    ctaButton(dashboard, 'View Dashboard'),
    divider(),
    `<p style="margin:0;font-size:12px;color:#8a7a6a;text-align:center;">
      <a href="${escHtml(unsub)}" style="color:#8a7a6a;text-decoration:underline;">Unsubscribe from weekly digests</a>
    </p>`,
  ].join('');

  let projectText = 'No active projects this week.';
  if (projects && projects.length > 0) {
    projectText = projects.map(p =>
      `- ${p.name} | Last activity: ${p.lastActivity || 'N/A'} | Status: ${p.deploymentStatus || 'N/A'}`
    ).join('\n');
  }

  const text = [
    `Hi ${name},`,
    '',
    'Your Weekly Digest',
    plainTextSeparator(),
    projectText,
    '',
    `Dashboard: ${dashboard}`,
    '',
    `Unsubscribe: ${unsub}`,
  ].join('\n');

  return { html: getEmailBaseHtml(content), text, subject };
}

export function renderReEngagement(data) {
  const { name, guid, lastLogin, projectStatus, unsubscribeUrl } = data;
  const subject = 'We Miss You - CoCreate Idea';
  const dashboard = `${EMAIL_CONFIG.siteUrl}/dashboard.html?id=${guid}`;
  const unsub = unsubscribeUrl || `${EMAIL_CONFIG.siteUrl}/unsubscribe.html?id=${guid}&type=engagement`;
  const lastLoginFormatted = formatDate(lastLogin);

  const content = [
    heading('We Miss You!'),
    paragraph(`Hi ${escHtml(name)},`),
    paragraph('It\'s been a while since we\'ve seen you on CoCreate Idea. Your projects are waiting for you!'),
    dataTable([
      ['Last Login', lastLoginFormatted],
      ['Project Status', projectStatus || 'Idle'],
    ]),
    paragraph('Come back and pick up where you left off — or start something new.'),
    ctaButton(dashboard, 'Return to Dashboard'),
    divider(),
    `<p style="margin:0;font-size:12px;color:#8a7a6a;text-align:center;">
      <a href="${escHtml(unsub)}" style="color:#8a7a6a;text-decoration:underline;">Unsubscribe</a>
    </p>`,
  ].join('');

  const text = [
    `Hi ${name},`,
    '',
    'We miss you at CoCreate Idea! It\'s been a while.',
    '',
    `Last Login: ${lastLoginFormatted}`,
    `Project Status: ${projectStatus || 'Idle'}`,
    '',
    'Come back and pick up where you left off.',
    `Dashboard: ${dashboard}`,
    '',
    `Unsubscribe: ${unsub}`,
  ].join('\n');

  return { html: getEmailBaseHtml(content), text, subject };
}
