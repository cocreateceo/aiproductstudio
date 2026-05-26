// domains/events.mjs — extracted from index.mjs (Phase 2 refactor)

import { getS3 } from '../lib/aws.mjs';
import { S3_BUCKET } from '../lib/config.mjs';
import { corsHeaders } from '../lib/http.mjs';
import { renderEventRegistrationConfirmation, renderEventRegistrationAdminNotification } from '../email-templates.mjs';
import { sendTemplatedEmail, sendToAdmins } from '../email-service.mjs';

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'aiproductstudio2026';

// Computes the active Saturday's eventId in America/Chicago.
// Mirrors /event.html: if Sat before 11 AM CT, today; otherwise upcoming Saturday.
export function currentWeekEventId() {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Chicago',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', hour12: false, weekday: 'short'
  }).formatToParts(new Date());
  const get = (t) => parts.find(p => p.type === t).value;
  const year = +get('year'), month = +get('month'), day = +get('day');
  const hour = +get('hour') % 24;
  const weekday = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].indexOf(get('weekday'));
  let satOffset;
  if (weekday === 6 && hour < 11) satOffset = 0;
  else if (weekday === 6) satOffset = 7;
  else satOffset = (6 - weekday + 7) % 7;
  const d = new Date(Date.UTC(year, month - 1, day + satOffset));
  return 'build-product-2hrs-' + d.toISOString().slice(0, 10);
}

// Weekly "Build Your Product in 2 Hours" event resolver.
// Accepts eventId = "build-product-2hrs-YYYY-MM-DD" where the date is a Saturday.
// Static workshop details — only the date varies week to week.
export function resolveWeeklyEvent(eventId) {
  if (typeof eventId !== 'string') return null;
  const match = eventId.match(/^build-product-2hrs-(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  const [, y, m, d] = match;
  const year = +y, month = +m, day = +d;
  const dt = new Date(Date.UTC(year, month - 1, day));
  if (dt.getUTCFullYear() !== year || dt.getUTCMonth() !== month - 1 || dt.getUTCDate() !== day) return null;
  if (dt.getUTCDay() !== 6) return null; // must be Saturday
  const dateLabel = dt.toLocaleDateString('en-US', {
    weekday: 'long', month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC'
  });
  return {
    title: 'Build Your Product in Less Than 2 Hours',
    date: dateLabel,                                        // e.g. "Saturday, April 25, 2026"
    time: '9:00 AM - 11:00 AM CST (Chicago)',
    zoomLink: 'https://us06web.zoom.us/j/2245204604?pwd=Yk9ReE42K080LzRoUXBPdzFNRFlvUT09',
    zoomMeetingId: '224 520 4604',
    zoomPasscode: '1234',
  };
}

// ---------------------------------------------------------------------------
// handleEventRegister — action 'event-register'
// ---------------------------------------------------------------------------
export async function handleEventRegister(body, event) {
  const clientIP = event.requestContext?.http?.sourceIp ||
                   event.headers?.['x-forwarded-for']?.split(',')[0] ||
                   'Unknown';
  try {
    const { name, email, phone, productIdea, eventId } = body;

    if (!name || !email) {
      return {
        statusCode: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify({ success: false, error: 'Name and email are required' })
      };
    }

    // Event configuration (timezone: America/Chicago)
    // eventId format: build-product-2hrs-YYYY-MM-DD (must be a Saturday)
    // Static workshop details; only the date varies week to week.
    const eventConfig = resolveWeeklyEvent(eventId);
    if (!eventConfig) {
      return {
        statusCode: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify({ success: false, error: 'Invalid event' })
      };
    }

    const { PutObjectCommand, ListObjectsV2Command } = await import('@aws-sdk/client-s3');
    const s3 = getS3();

    // ── Store registration in S3 ──
    const timestamp = new Date().toISOString();
    const registrationData = {
      name, email, phone, productIdea, eventId,
      registeredAt: timestamp,
      ip: clientIP,
    };

    const s3Key = `events/${eventId}/registrations/${email.toLowerCase().replace(/[^a-z0-9]/g, '_')}.json`;
    await s3.send(new PutObjectCommand({
      Bucket: S3_BUCKET,
      Key: s3Key,
      Body: JSON.stringify(registrationData, null, 2),
      ContentType: 'application/json',
    }));

    // Count total registrations
    let totalRegistrations = 'N/A';
    try {
      const listResult = await s3.send(new ListObjectsV2Command({
        Bucket: S3_BUCKET,
        Prefix: `events/${eventId}/registrations/`,
      }));
      totalRegistrations = String(listResult.KeyCount || 0);
    } catch (e) { /* ignore count errors */ }

    // ── Send confirmation email with Zoom link ──
    const confirmationEmail = renderEventRegistrationConfirmation({
      name, email,
      eventTitle: eventConfig.title,
      eventDate: eventConfig.date,
      eventTime: eventConfig.time,
      zoomLink: eventConfig.zoomLink,
      zoomMeetingId: eventConfig.zoomMeetingId,
      zoomPasscode: eventConfig.zoomPasscode,
    });

    await sendTemplatedEmail(
      email,
      confirmationEmail.subject,
      confirmationEmail.html,
      confirmationEmail.text
    );

    // ── Notify admins ──
    const adminEmail = renderEventRegistrationAdminNotification({
      name, email, phone, productIdea,
      eventTitle: eventConfig.title,
      eventId,
      totalRegistrations,
    });

    await sendToAdmins(
      adminEmail.subject,
      adminEmail.html,
      adminEmail.text
    );

    return {
      statusCode: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      body: JSON.stringify({ success: true, message: 'Registration successful' })
    };
  } catch (error) {
    console.error('Event registration error:', error);
    return {
      statusCode: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      body: JSON.stringify({ success: false, error: 'Registration failed. Please try again.' })
    };
  }
}

// ---------------------------------------------------------------------------
// handleEventListRegistrations — action 'event-list-registrations' (Admin)
// ---------------------------------------------------------------------------
export async function handleEventListRegistrations(body, event) {
  try {
    const { password, eventId } = body;
    if (password !== ADMIN_PASSWORD) {
      return {
        statusCode: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify({ success: false, error: 'Unauthorized' })
      };
    }

    const targetEventId = eventId || currentWeekEventId();
    const { ListObjectsV2Command, GetObjectCommand } = await import('@aws-sdk/client-s3');
    const s3 = getS3();

    const prefix = `events/${targetEventId}/registrations/`;
    const listResult = await s3.send(new ListObjectsV2Command({
      Bucket: S3_BUCKET,
      Prefix: prefix,
    }));

    const registrations = [];
    if (listResult.Contents) {
      for (const obj of listResult.Contents) {
        try {
          const data = await s3.send(new GetObjectCommand({
            Bucket: S3_BUCKET,
            Key: obj.Key,
          }));
          const record = JSON.parse(await data.Body.transformToString());
          registrations.push(record);
        } catch (e) { /* skip bad records */ }
      }
    }

    // Sort by registration time (newest first)
    registrations.sort((a, b) => new Date(b.registeredAt) - new Date(a.registeredAt));

    return {
      statusCode: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        success: true,
        eventId: targetEventId,
        total: registrations.length,
        registrations
      })
    };
  } catch (error) {
    console.error('Event list error:', error);
    return {
      statusCode: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      body: JSON.stringify({ success: false, error: 'Failed to load registrations' })
    };
  }
}

// ---------------------------------------------------------------------------
// Routes map
// ---------------------------------------------------------------------------
export const routes = {
  'event-register': handleEventRegister,
  'event-list-registrations': handleEventListRegistrations,
};
