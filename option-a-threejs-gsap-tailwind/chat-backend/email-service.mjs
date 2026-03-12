/**
 * Email Service Module
 *
 * Wraps AWS SES with a singleton client, convenience helpers for sending
 * templated emails, and in-memory rate limiting for password resets.
 */

import { EMAIL_CONFIG, ADMIN_EMAILS } from './email-templates.mjs';

// ─── SES Client Singleton ────────────────────────────────────────────────────

let _sesClient = null;
let _SendEmailCommand = null;

async function getSesClient() {
  if (!_sesClient) {
    const { SESClient, SendEmailCommand } = await import('@aws-sdk/client-ses');
    _sesClient = new SESClient({ region: 'us-east-1' });
    _SendEmailCommand = SendEmailCommand;
  }
  return { ses: _sesClient, SendEmailCommand: _SendEmailCommand };
}

// ─── Core Send ───────────────────────────────────────────────────────────────

/**
 * Send an email via SES.
 *
 * @param {string|string[]} to - Recipient address(es)
 * @param {string} subject
 * @param {string} html - HTML body
 * @param {string} text - Plain-text body
 * @param {object} [options]
 * @param {string|string[]} [options.cc]
 * @param {string} [options.replyTo]
 * @param {string} [options.from]
 * @returns {Promise<{success: boolean, messageId?: string, error?: string}>}
 */
export async function sendTemplatedEmail(to, subject, html, text, options = {}) {
  const {
    cc,
    replyTo = EMAIL_CONFIG.replyTo,
    from = EMAIL_CONFIG.from,
  } = options;

  const toAddresses = Array.isArray(to) ? to : [to];
  const ccAddresses = cc ? (Array.isArray(cc) ? cc : [cc]) : undefined;

  try {
    const { ses, SendEmailCommand } = await getSesClient();

    const params = {
      Source: from,
      Destination: {
        ToAddresses: toAddresses,
        ...(ccAddresses && { CcAddresses: ccAddresses }),
      },
      Message: {
        Subject: { Data: subject, Charset: 'UTF-8' },
        Body: {
          Html: { Data: html, Charset: 'UTF-8' },
          Text: { Data: text, Charset: 'UTF-8' },
        },
      },
      ReplyToAddresses: [replyTo],
    };

    const result = await ses.send(new SendEmailCommand(params));
    const messageId = result.MessageId;
    console.log(`[email-service] Sent to=${toAddresses.join(',')} subject="${subject}" messageId=${messageId}`);
    return { success: true, messageId };
  } catch (err) {
    console.error(`[email-service] Failed to send to=${toAddresses.join(',')} subject="${subject}"`, err);
    return { success: false, error: err.message || String(err) };
  }
}

// ─── Admin Helpers ───────────────────────────────────────────────────────────

/**
 * Send an email to all admin addresses, CC info@cocreateidea.com.
 */
export async function sendToAdmins(subject, html, text, options = {}) {
  return sendTemplatedEmail(ADMIN_EMAILS, subject, html, text, {
    ...options,
    cc: options.cc || 'info@cocreateidea.com',
  });
}

// ─── Template Convenience ────────────────────────────────────────────────────

/**
 * Render a template and send to the given address(es).
 *
 * @param {string|string[]} to
 * @param {Function} renderer - Template renderer that returns { html, text, subject }
 * @param {object} data - Data passed to the renderer
 * @param {object} [options] - Extra options forwarded to sendTemplatedEmail
 */
export async function sendTemplate(to, renderer, data, options = {}) {
  const { html, text, subject } = renderer(data);
  return sendTemplatedEmail(to, subject, html, text, options);
}

/**
 * Render a template and send to all admins.
 */
export async function sendTemplateToAdmins(renderer, data, options = {}) {
  const { html, text, subject } = renderer(data);
  return sendToAdmins(subject, html, text, options);
}

// ─── Rate Limiting ───────────────────────────────────────────────────────────

const _resetTimestamps = new Map();

/**
 * In-memory rate limiter for forgot-password requests.
 * Returns true if a reset was requested for this email within the last 60 seconds.
 * Automatically cleans the cache when it exceeds 1000 entries.
 */
export function isResetRateLimited(email) {
  const key = email.toLowerCase();
  const now = Date.now();

  // Clean cache if too large
  if (_resetTimestamps.size > 1000) {
    const cutoff = now - 60_000;
    for (const [k, ts] of _resetTimestamps) {
      if (ts < cutoff) _resetTimestamps.delete(k);
    }
  }

  const lastRequest = _resetTimestamps.get(key);
  if (lastRequest && now - lastRequest < 60_000) {
    return true;
  }

  _resetTimestamps.set(key, now);
  return false;
}
