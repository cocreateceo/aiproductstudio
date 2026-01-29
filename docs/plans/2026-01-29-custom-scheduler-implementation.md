# Custom Scheduler Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace Calendly with a single-page custom scheduler using Google Calendar API.

**Architecture:** New schedule.html page with date picker, time slots, and booking form. Lambda backend gets two new endpoints (/scheduler/slots and /scheduler/book) that integrate with Google Calendar API for availability and booking.

**Tech Stack:** Vanilla JS frontend, Node.js Lambda backend, Google Calendar API (googleapis npm package), existing AWS infrastructure.

---

## Prerequisites (Manual Steps - Do First)

Before starting implementation, complete the Google Cloud setup:

### Step 1: Create Google Cloud Project
1. Go to https://console.cloud.google.com/
2. Click "Select a project" → "New Project"
3. Name: `CoCreate-Scheduler`
4. Click "Create"

### Step 2: Enable Google Calendar API
1. In the project, go to "APIs & Services" → "Library"
2. Search for "Google Calendar API"
3. Click it → Click "Enable"

### Step 3: Create Service Account
1. Go to "IAM & Admin" → "Service Accounts"
2. Click "Create Service Account"
3. Name: `scheduler-service`
4. Click "Create and Continue"
5. Skip role assignment → Click "Done"
6. Click on the created service account
7. Go to "Keys" tab → "Add Key" → "Create new key"
8. Select JSON → Click "Create"
9. Save the downloaded JSON file securely

### Step 4: Share CEO's Calendar
1. Go to Google Calendar (calendar.google.com)
2. Find the CEO's calendar in the left sidebar
3. Click the three dots → "Settings and sharing"
4. Scroll to "Share with specific people"
5. Add the service account email (from the JSON file: `client_email` field)
6. Permission: "Make changes to events"
7. Click "Send"

### Step 5: Note These Values
From the JSON file, you'll need:
- `client_email` (service account email)
- `private_key` (the long key string)
- Calendar ID (usually the CEO's email, e.g., `ceo@cocreate.com`)

---

## Task 1: Add googleapis Dependency

**Files:**
- Modify: `option-a-threejs-gsap-tailwind/chat-backend/package.json`

**Step 1: Add the dependency**

Open `option-a-threejs-gsap-tailwind/chat-backend/package.json` and add `googleapis`:

```json
{
  "name": "ai-product-studio-chat",
  "version": "1.0.0",
  "description": "Chat backend for AI Product Studio landing page",
  "type": "module",
  "main": "index.mjs",
  "scripts": {
    "build": "npm install && zip -r function.zip . -x '*.git*' -x 'deploy.sh' -x '*.md'",
    "deploy": "bash deploy.sh"
  },
  "dependencies": {
    "@anthropic-ai/sdk": "^0.52.0",
    "@aws-sdk/client-s3": "^3.962.0",
    "@aws-sdk/client-ses": "^3.962.0",
    "googleapis": "^131.0.0",
    "mammoth": "^1.8.0",
    "openai": "^6.15.0",
    "pdf-parse": "^1.1.1"
  },
  "devDependencies": {
    "archiver": "^7.0.1"
  }
}
```

**Step 2: Install dependencies**

```bash
cd option-a-threejs-gsap-tailwind/chat-backend
npm install
```

Expected: `googleapis` added to node_modules

**Step 3: Commit**

```bash
git add option-a-threejs-gsap-tailwind/chat-backend/package.json option-a-threejs-gsap-tailwind/chat-backend/package-lock.json
git commit -m "feat(scheduler): add googleapis dependency"
```

---

## Task 2: Add Scheduler Configuration to Backend

**Files:**
- Modify: `option-a-threejs-gsap-tailwind/chat-backend/index.mjs` (top of file)

**Step 1: Add scheduler config constants after existing constants**

Find the existing constants section (around line 28) and add scheduler config:

```javascript
// ========== SCHEDULER CONFIGURATION ==========
const SCHEDULER_CONFIG = {
  // Days of week (0=Sunday, 1=Monday, ..., 6=Saturday)
  availableDays: [1, 2, 3, 4, 5], // Monday-Friday

  // Hours (24-hour format, in CEO's timezone)
  startHour: 8,   // 8:00 AM
  endHour: 18,    // 6:00 PM

  // Slot duration in minutes
  slotDuration: 30,

  // CEO's timezone
  timezone: 'America/Chicago',

  // Meeting title prefix
  meetingTitle: 'CoCreate Introduction',

  // Calendar ID (CEO's calendar)
  calendarId: process.env.GOOGLE_CALENDAR_ID || 'primary',
};

// Google Service Account credentials (from environment)
const GOOGLE_SERVICE_ACCOUNT_EMAIL = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
const GOOGLE_PRIVATE_KEY = process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, '\n');
```

**Step 2: Commit**

```bash
git add option-a-threejs-gsap-tailwind/chat-backend/index.mjs
git commit -m "feat(scheduler): add scheduler configuration constants"
```

---

## Task 3: Add Google Calendar Auth Helper

**Files:**
- Modify: `option-a-threejs-gsap-tailwind/chat-backend/index.mjs`

**Step 1: Add import at top of file (after existing imports)**

```javascript
import { google } from 'googleapis';
```

**Step 2: Add Google Calendar auth helper function**

Add after the scheduler config section:

```javascript
// ========== GOOGLE CALENDAR AUTH ==========
let googleCalendar = null;

async function getGoogleCalendar() {
  if (googleCalendar) {
    return googleCalendar;
  }

  if (!GOOGLE_SERVICE_ACCOUNT_EMAIL || !GOOGLE_PRIVATE_KEY) {
    throw new Error('Google Calendar credentials not configured');
  }

  const auth = new google.auth.JWT(
    GOOGLE_SERVICE_ACCOUNT_EMAIL,
    null,
    GOOGLE_PRIVATE_KEY,
    ['https://www.googleapis.com/auth/calendar']
  );

  googleCalendar = google.calendar({ version: 'v3', auth });
  return googleCalendar;
}
```

**Step 3: Commit**

```bash
git add option-a-threejs-gsap-tailwind/chat-backend/index.mjs
git commit -m "feat(scheduler): add Google Calendar auth helper"
```

---

## Task 4: Add Slot Generation Helper Functions

**Files:**
- Modify: `option-a-threejs-gsap-tailwind/chat-backend/index.mjs`

**Step 1: Add helper functions for slot generation**

Add after the Google Calendar auth section:

```javascript
// ========== SCHEDULER HELPERS ==========

/**
 * Generate all possible time slots for a given month based on availability rules
 */
function generatePossibleSlots(year, month, userTimezone) {
  const slots = {};

  // Get first and last day of the month
  const firstDay = new Date(year, month - 1, 1);
  const lastDay = new Date(year, month, 0);

  // Get current time to filter out past slots
  const now = new Date();

  for (let day = 1; day <= lastDay.getDate(); day++) {
    const date = new Date(year, month - 1, day);
    const dayOfWeek = date.getDay();

    // Skip if not an available day (weekend)
    if (!SCHEDULER_CONFIG.availableDays.includes(dayOfWeek)) {
      continue;
    }

    const dateStr = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    slots[dateStr] = [];

    // Generate slots for this day
    for (let hour = SCHEDULER_CONFIG.startHour; hour < SCHEDULER_CONFIG.endHour; hour++) {
      for (let minute = 0; minute < 60; minute += SCHEDULER_CONFIG.slotDuration) {
        // Create datetime in CEO's timezone
        const slotTime = new Date(`${dateStr}T${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:00`);

        // Skip past slots
        if (slotTime <= now) {
          continue;
        }

        const timeStr = `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
        slots[dateStr].push(timeStr);
      }
    }

    // Remove empty dates
    if (slots[dateStr].length === 0) {
      delete slots[dateStr];
    }
  }

  return slots;
}

/**
 * Remove busy times from available slots
 */
function subtractBusyTimes(slots, busyPeriods) {
  const result = { ...slots };

  for (const busy of busyPeriods) {
    const busyStart = new Date(busy.start);
    const busyEnd = new Date(busy.end);

    // Check each date's slots
    for (const dateStr in result) {
      result[dateStr] = result[dateStr].filter(timeStr => {
        const [hour, minute] = timeStr.split(':').map(Number);
        const slotStart = new Date(`${dateStr}T${timeStr}:00`);
        const slotEnd = new Date(slotStart.getTime() + SCHEDULER_CONFIG.slotDuration * 60 * 1000);

        // Keep slot if it doesn't overlap with busy period
        return slotEnd <= busyStart || slotStart >= busyEnd;
      });

      // Remove empty dates
      if (result[dateStr].length === 0) {
        delete result[dateStr];
      }
    }
  }

  return result;
}

/**
 * Convert time from CEO's timezone to user's timezone for display
 */
function convertTimezone(dateStr, timeStr, fromTz, toTz) {
  // Create date in source timezone
  const dateTimeStr = `${dateStr}T${timeStr}:00`;

  // For now, return as-is (timezone conversion can be added later)
  // The frontend will handle display conversion
  return timeStr;
}
```

**Step 2: Commit**

```bash
git add option-a-threejs-gsap-tailwind/chat-backend/index.mjs
git commit -m "feat(scheduler): add slot generation helper functions"
```

---

## Task 5: Add GET Slots Endpoint

**Files:**
- Modify: `option-a-threejs-gsap-tailwind/chat-backend/index.mjs`

**Step 1: Add the /scheduler/slots endpoint handler**

Find the main handler function and add this route handling (in the routing section, before the final catch-all):

```javascript
    // ========== SCHEDULER ENDPOINTS ==========

    // Get available slots for a month
    if (path === '/scheduler/slots' && httpMethod === 'POST') {
      try {
        const { month, timezone } = body;

        if (!month || !/^\d{4}-\d{2}$/.test(month)) {
          return {
            statusCode: 400,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            body: JSON.stringify({
              success: false,
              error: 'Invalid month format. Use YYYY-MM'
            })
          };
        }

        const [year, monthNum] = month.split('-').map(Number);
        const userTimezone = timezone || 'America/Chicago';

        // Generate all possible slots based on availability rules
        const possibleSlots = generatePossibleSlots(year, monthNum, userTimezone);

        // Get busy times from Google Calendar
        const calendar = await getGoogleCalendar();
        const timeMin = new Date(year, monthNum - 1, 1).toISOString();
        const timeMax = new Date(year, monthNum, 0, 23, 59, 59).toISOString();

        const freeBusyResponse = await calendar.freebusy.query({
          requestBody: {
            timeMin,
            timeMax,
            timeZone: SCHEDULER_CONFIG.timezone,
            items: [{ id: SCHEDULER_CONFIG.calendarId }]
          }
        });

        const busyPeriods = freeBusyResponse.data.calendars[SCHEDULER_CONFIG.calendarId]?.busy || [];

        // Subtract busy times from possible slots
        const availableSlots = subtractBusyTimes(possibleSlots, busyPeriods);

        return {
          statusCode: 200,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            success: true,
            month,
            timezone: userTimezone,
            ceoTimezone: SCHEDULER_CONFIG.timezone,
            slotDuration: SCHEDULER_CONFIG.slotDuration,
            slots: availableSlots
          })
        };

      } catch (error) {
        console.error('Scheduler slots error:', error);
        return {
          statusCode: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            success: false,
            error: 'Unable to fetch available slots. Please try again.'
          })
        };
      }
    }
```

**Step 2: Commit**

```bash
git add option-a-threejs-gsap-tailwind/chat-backend/index.mjs
git commit -m "feat(scheduler): add /scheduler/slots endpoint"
```

---

## Task 6: Add Book Appointment Endpoint

**Files:**
- Modify: `option-a-threejs-gsap-tailwind/chat-backend/index.mjs`

**Step 1: Add the /scheduler/book endpoint handler**

Add after the /scheduler/slots handler:

```javascript
    // Book an appointment
    if (path === '/scheduler/book' && httpMethod === 'POST') {
      try {
        const { date, time, timezone, name, email, productIdea, notes } = body;

        // Validate required fields
        if (!date || !time || !name || !email) {
          return {
            statusCode: 400,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            body: JSON.stringify({
              success: false,
              error: 'Missing required fields: date, time, name, email'
            })
          };
        }

        // Validate email format
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(email)) {
          return {
            statusCode: 400,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            body: JSON.stringify({
              success: false,
              error: 'Invalid email format'
            })
          };
        }

        const calendar = await getGoogleCalendar();

        // Create start and end times
        const startDateTime = `${date}T${time}:00`;
        const startDate = new Date(startDateTime);
        const endDate = new Date(startDate.getTime() + SCHEDULER_CONFIG.slotDuration * 60 * 1000);
        const endTime = `${String(endDate.getHours()).padStart(2, '0')}:${String(endDate.getMinutes()).padStart(2, '0')}`;
        const endDateTime = `${date}T${endTime}:00`;

        // Re-verify slot is available (prevent double-booking)
        const freeBusyResponse = await calendar.freebusy.query({
          requestBody: {
            timeMin: startDateTime,
            timeMax: endDateTime,
            timeZone: SCHEDULER_CONFIG.timezone,
            items: [{ id: SCHEDULER_CONFIG.calendarId }]
          }
        });

        const busyPeriods = freeBusyResponse.data.calendars[SCHEDULER_CONFIG.calendarId]?.busy || [];
        if (busyPeriods.length > 0) {
          return {
            statusCode: 409,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            body: JSON.stringify({
              success: false,
              error: 'slot_unavailable',
              message: 'This time slot is no longer available. Please select another.'
            })
          };
        }

        // Build event description
        let description = `**Product Idea:** ${productIdea || 'Not provided'}`;
        if (notes) {
          description += `\n\n**Notes:** ${notes}`;
        }
        description += `\n\n---\nBooked via CoCreate AI Scheduler`;

        // Create the calendar event
        const event = {
          summary: `${SCHEDULER_CONFIG.meetingTitle} - ${name}`,
          description,
          start: {
            dateTime: startDateTime,
            timeZone: SCHEDULER_CONFIG.timezone,
          },
          end: {
            dateTime: endDateTime,
            timeZone: SCHEDULER_CONFIG.timezone,
          },
          attendees: [
            { email: email }
          ],
          conferenceData: {
            createRequest: {
              requestId: `cocreate-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
              conferenceSolutionKey: { type: 'hangoutsMeet' }
            }
          },
          reminders: {
            useDefault: false,
            overrides: [
              { method: 'email', minutes: 60 },
              { method: 'popup', minutes: 15 }
            ]
          }
        };

        const createdEvent = await calendar.events.insert({
          calendarId: SCHEDULER_CONFIG.calendarId,
          requestBody: event,
          conferenceDataVersion: 1,
          sendUpdates: 'all' // Send email invites to attendees
        });

        const meetLink = createdEvent.data.conferenceData?.entryPoints?.find(
          ep => ep.entryPointType === 'video'
        )?.uri || null;

        console.log('Scheduler: Booking created', {
          eventId: createdEvent.data.id,
          name,
          email,
          date,
          time,
          meetLink
        });

        return {
          statusCode: 200,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            success: true,
            booking: {
              eventId: createdEvent.data.id,
              title: event.summary,
              date,
              time,
              endTime,
              duration: `${SCHEDULER_CONFIG.slotDuration} minutes`,
              timezone: timezone || SCHEDULER_CONFIG.timezone,
              meetLink,
              htmlLink: createdEvent.data.htmlLink
            }
          })
        };

      } catch (error) {
        console.error('Scheduler book error:', error);
        return {
          statusCode: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            success: false,
            error: 'Unable to create booking. Please try again.'
          })
        };
      }
    }
```

**Step 2: Commit**

```bash
git add option-a-threejs-gsap-tailwind/chat-backend/index.mjs
git commit -m "feat(scheduler): add /scheduler/book endpoint"
```

---

## Task 7: Update Frontend Config

**Files:**
- Modify: `option-a-threejs-gsap-tailwind/site/js/config.js`

**Step 1: Add scheduler endpoints to config**

Find the `api` section and add scheduler endpoints:

```javascript
    // API Configuration
    api: {
      // Chat endpoint - always use production API (no local backend)
      chat: 'https://bx0ywfkona.execute-api.ap-south-1.amazonaws.com/prod/chat',

      // Scheduler endpoints
      schedulerSlots: isLocal
        ? 'http://localhost:5000/scheduler/slots'
        : 'https://bx0ywfkona.execute-api.ap-south-1.amazonaws.com/prod/scheduler/slots',
      schedulerBook: isLocal
        ? 'http://localhost:5000/scheduler/book'
        : 'https://bx0ywfkona.execute-api.ap-south-1.amazonaws.com/prod/scheduler/book',

      // Admin endpoints (local only)
      admin: isLocal ? `http://localhost:5000/api/admin` : null,
      applications: isLocal ? `http://localhost:5000/api/admin/applications` : null,
      approve: isLocal ? `http://localhost:5000/api/admin/approve` : null,
      builds: isLocal ? `http://localhost:5000/api/builds` : null,
      triggerBuild: isLocal ? `http://localhost:5000/api/admin/trigger-build` : null
    },
```

**Step 2: Commit**

```bash
git add option-a-threejs-gsap-tailwind/site/js/config.js
git commit -m "feat(scheduler): add scheduler endpoints to frontend config"
```

---

## Task 8: Create Scheduler CSS

**Files:**
- Create: `option-a-threejs-gsap-tailwind/site/css/scheduler.css`

**Step 1: Create the CSS file**

```css
/**
 * CoCreate AI - Scheduler Styles
 */

/* Container */
.scheduler-container {
  max-width: 1000px;
  margin: 0 auto;
  padding: 2rem;
}

.scheduler-header {
  text-align: center;
  margin-bottom: 2rem;
}

.scheduler-header h1 {
  font-size: 1.75rem;
  font-weight: 700;
  margin-bottom: 0.5rem;
}

.scheduler-meta {
  display: flex;
  justify-content: center;
  gap: 1rem;
  color: var(--text-secondary);
  font-size: 0.875rem;
}

.scheduler-meta span {
  display: flex;
  align-items: center;
  gap: 0.25rem;
}

/* Main Grid */
.scheduler-grid {
  display: grid;
  grid-template-columns: 1fr 1fr 1fr;
  gap: 1.5rem;
}

@media (max-width: 900px) {
  .scheduler-grid {
    grid-template-columns: 1fr;
  }
}

/* Calendar */
.calendar-section {
  background: var(--bg-secondary);
  border-radius: 12px;
  padding: 1.25rem;
  border: 1px solid var(--border-color);
}

.calendar-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 1rem;
}

.calendar-header h3 {
  font-size: 1rem;
  font-weight: 600;
}

.calendar-nav {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.calendar-nav button {
  background: var(--bg-tertiary);
  border: 1px solid var(--border-color);
  border-radius: 6px;
  padding: 0.375rem 0.5rem;
  cursor: pointer;
  color: var(--text-primary);
  transition: background 0.2s;
}

.calendar-nav button:hover {
  background: var(--bg-hover);
}

.calendar-nav button:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.calendar-month {
  font-weight: 600;
  min-width: 120px;
  text-align: center;
}

.calendar-grid {
  display: grid;
  grid-template-columns: repeat(7, 1fr);
  gap: 4px;
}

.calendar-day-header {
  text-align: center;
  font-size: 0.75rem;
  font-weight: 600;
  color: var(--text-secondary);
  padding: 0.5rem 0;
}

.calendar-day {
  aspect-ratio: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 0.875rem;
  border-radius: 8px;
  cursor: pointer;
  transition: all 0.2s;
  border: 2px solid transparent;
}

.calendar-day:hover:not(.disabled):not(.empty) {
  background: var(--bg-hover);
}

.calendar-day.empty {
  cursor: default;
}

.calendar-day.disabled {
  color: var(--text-disabled);
  cursor: not-allowed;
}

.calendar-day.available {
  background: var(--bg-tertiary);
  font-weight: 500;
}

.calendar-day.available:hover {
  background: var(--primary);
  color: white;
}

.calendar-day.selected {
  background: var(--primary);
  color: white;
  border-color: var(--primary);
}

.calendar-day.today {
  border-color: var(--primary);
}

/* Time Slots */
.timeslots-section {
  background: var(--bg-secondary);
  border-radius: 12px;
  padding: 1.25rem;
  border: 1px solid var(--border-color);
}

.timeslots-section h3 {
  font-size: 1rem;
  font-weight: 600;
  margin-bottom: 0.5rem;
}

.timeslots-date {
  color: var(--text-secondary);
  font-size: 0.875rem;
  margin-bottom: 1rem;
}

.timeslots-container {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  max-height: 350px;
  overflow-y: auto;
}

.timeslot {
  padding: 0.75rem 1rem;
  background: var(--bg-tertiary);
  border: 2px solid var(--border-color);
  border-radius: 8px;
  cursor: pointer;
  transition: all 0.2s;
  text-align: center;
  font-weight: 500;
}

.timeslot:hover {
  border-color: var(--primary);
  background: var(--bg-hover);
}

.timeslot.selected {
  background: var(--primary);
  color: white;
  border-color: var(--primary);
}

.timeslots-empty {
  text-align: center;
  color: var(--text-secondary);
  padding: 2rem;
}

.timezone-select {
  margin-top: 1rem;
  padding-top: 1rem;
  border-top: 1px solid var(--border-color);
  font-size: 0.875rem;
  color: var(--text-secondary);
}

.timezone-select select {
  margin-top: 0.5rem;
  width: 100%;
  padding: 0.5rem;
  border-radius: 6px;
  border: 1px solid var(--border-color);
  background: var(--bg-primary);
  color: var(--text-primary);
}

/* Details Form */
.details-section {
  background: var(--bg-secondary);
  border-radius: 12px;
  padding: 1.25rem;
  border: 1px solid var(--border-color);
}

.details-section h3 {
  font-size: 1rem;
  font-weight: 600;
  margin-bottom: 1rem;
}

.form-group {
  margin-bottom: 1rem;
}

.form-group label {
  display: block;
  font-size: 0.875rem;
  font-weight: 500;
  margin-bottom: 0.375rem;
  color: var(--text-secondary);
}

.form-group input,
.form-group textarea {
  width: 100%;
  padding: 0.625rem 0.75rem;
  border: 1px solid var(--border-color);
  border-radius: 8px;
  background: var(--bg-primary);
  color: var(--text-primary);
  font-size: 0.875rem;
}

.form-group input:focus,
.form-group textarea:focus {
  outline: none;
  border-color: var(--primary);
}

.form-group input[readonly] {
  background: var(--bg-tertiary);
  color: var(--text-secondary);
}

.form-group textarea {
  min-height: 80px;
  resize: vertical;
}

.submit-btn {
  width: 100%;
  padding: 0.875rem;
  background: var(--primary);
  color: white;
  border: none;
  border-radius: 8px;
  font-size: 1rem;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.2s;
  margin-top: 0.5rem;
}

.submit-btn:hover:not(:disabled) {
  filter: brightness(1.1);
}

.submit-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

/* Confirmation */
.confirmation-container {
  text-align: center;
  padding: 3rem 2rem;
}

.confirmation-icon {
  width: 80px;
  height: 80px;
  background: #10b981;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  margin: 0 auto 1.5rem;
}

.confirmation-icon svg {
  width: 40px;
  height: 40px;
  color: white;
}

.confirmation-container h2 {
  font-size: 1.5rem;
  font-weight: 700;
  margin-bottom: 1.5rem;
}

.booking-details {
  background: var(--bg-secondary);
  border-radius: 12px;
  padding: 1.5rem;
  max-width: 400px;
  margin: 0 auto 1.5rem;
  border: 1px solid var(--border-color);
  text-align: left;
}

.booking-details p {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  margin-bottom: 0.75rem;
  color: var(--text-secondary);
}

.booking-details p:last-child {
  margin-bottom: 0;
}

.meet-link-box {
  background: var(--bg-tertiary);
  border-radius: 8px;
  padding: 0.75rem;
  margin-top: 1rem;
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.meet-link-box a {
  flex: 1;
  color: var(--primary);
  text-decoration: none;
  word-break: break-all;
  font-size: 0.875rem;
}

.meet-link-box button {
  padding: 0.5rem 0.75rem;
  background: var(--bg-primary);
  border: 1px solid var(--border-color);
  border-radius: 6px;
  cursor: pointer;
  font-size: 0.75rem;
  white-space: nowrap;
}

.confirmation-note {
  color: var(--text-secondary);
  font-size: 0.875rem;
  margin-bottom: 1.5rem;
}

.confirmation-actions {
  display: flex;
  justify-content: center;
  gap: 1rem;
}

.confirmation-actions button {
  padding: 0.75rem 1.5rem;
  border-radius: 8px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s;
}

.btn-secondary {
  background: var(--bg-tertiary);
  border: 1px solid var(--border-color);
  color: var(--text-primary);
}

.btn-primary {
  background: var(--primary);
  border: none;
  color: white;
}

/* Loading State */
.loading-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.5);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
}

.loading-spinner {
  width: 48px;
  height: 48px;
  border: 4px solid var(--bg-tertiary);
  border-top-color: var(--primary);
  border-radius: 50%;
  animation: spin 1s linear infinite;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

/* Error State */
.error-message {
  background: #fee2e2;
  color: #dc2626;
  padding: 1rem;
  border-radius: 8px;
  margin-bottom: 1rem;
  text-align: center;
}

/* Hidden utility */
.hidden {
  display: none !important;
}
```

**Step 2: Commit**

```bash
git add option-a-threejs-gsap-tailwind/site/css/scheduler.css
git commit -m "feat(scheduler): add scheduler CSS styles"
```

---

## Task 9: Create Scheduler JavaScript

**Files:**
- Create: `option-a-threejs-gsap-tailwind/site/js/scheduler.js`

**Step 1: Create the JavaScript file**

```javascript
/**
 * CoCreate AI - Scheduler
 * Single-page scheduling component using Google Calendar API
 */

(function(window) {
  'use strict';

  const Scheduler = {
    // State
    state: {
      currentMonth: null,      // { year, month }
      selectedDate: null,      // 'YYYY-MM-DD'
      selectedTime: null,      // 'HH:MM'
      userTimezone: null,
      slotsCache: {},          // { 'YYYY-MM': { slots } }
      loading: false,
      error: null,
      userData: {
        name: '',
        email: '',
        productIdea: '',
        notes: ''
      }
    },

    // DOM Elements
    elements: {},

    // Initialize
    init: function() {
      // Detect user timezone
      this.state.userTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone;

      // Set current month
      const now = new Date();
      this.state.currentMonth = {
        year: now.getFullYear(),
        month: now.getMonth() + 1
      };

      // Parse URL params
      this.parseUrlParams();

      // Cache DOM elements
      this.cacheElements();

      // Bind events
      this.bindEvents();

      // Initial render
      this.render();

      // Fetch initial slots
      this.fetchSlots(this.state.currentMonth.year, this.state.currentMonth.month);
    },

    parseUrlParams: function() {
      const params = new URLSearchParams(window.location.search);
      this.state.userData.name = params.get('name') || '';
      this.state.userData.email = params.get('email') || '';
      this.state.userData.productIdea = params.get('idea') || '';
    },

    cacheElements: function() {
      this.elements = {
        schedulerContainer: document.getElementById('scheduler-container'),
        confirmationContainer: document.getElementById('confirmation-container'),
        calendarGrid: document.getElementById('calendar-grid'),
        calendarMonth: document.getElementById('calendar-month'),
        prevMonthBtn: document.getElementById('prev-month'),
        nextMonthBtn: document.getElementById('next-month'),
        timeslotsContainer: document.getElementById('timeslots-container'),
        timeslotsDate: document.getElementById('timeslots-date'),
        timezoneSelect: document.getElementById('timezone-select'),
        nameInput: document.getElementById('input-name'),
        emailInput: document.getElementById('input-email'),
        ideaInput: document.getElementById('input-idea'),
        notesInput: document.getElementById('input-notes'),
        submitBtn: document.getElementById('submit-btn'),
        errorMessage: document.getElementById('error-message'),
        loadingOverlay: document.getElementById('loading-overlay')
      };
    },

    bindEvents: function() {
      // Month navigation
      this.elements.prevMonthBtn.addEventListener('click', () => this.navigateMonth(-1));
      this.elements.nextMonthBtn.addEventListener('click', () => this.navigateMonth(1));

      // Timezone change
      this.elements.timezoneSelect.addEventListener('change', (e) => {
        this.state.userTimezone = e.target.value;
        this.render();
      });

      // Form inputs
      this.elements.nameInput.addEventListener('input', (e) => {
        this.state.userData.name = e.target.value;
        this.updateSubmitButton();
      });

      this.elements.emailInput.addEventListener('input', (e) => {
        this.state.userData.email = e.target.value;
        this.updateSubmitButton();
      });

      this.elements.notesInput.addEventListener('input', (e) => {
        this.state.userData.notes = e.target.value;
      });

      // Submit
      this.elements.submitBtn.addEventListener('click', () => this.submitBooking());
    },

    navigateMonth: function(delta) {
      let { year, month } = this.state.currentMonth;
      month += delta;

      if (month > 12) {
        month = 1;
        year++;
      } else if (month < 1) {
        month = 12;
        year--;
      }

      // Don't allow going to past months
      const now = new Date();
      if (year < now.getFullYear() || (year === now.getFullYear() && month < now.getMonth() + 1)) {
        return;
      }

      this.state.currentMonth = { year, month };
      this.state.selectedDate = null;
      this.state.selectedTime = null;

      this.render();
      this.fetchSlots(year, month);
    },

    fetchSlots: async function(year, month) {
      const cacheKey = `${year}-${String(month).padStart(2, '0')}`;

      // Check cache
      if (this.state.slotsCache[cacheKey]) {
        this.render();
        return;
      }

      this.showLoading(true);
      this.state.error = null;

      try {
        const response = await fetch(AppConfig.api.schedulerSlots, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            month: cacheKey,
            timezone: this.state.userTimezone
          })
        });

        const data = await response.json();

        if (data.success) {
          this.state.slotsCache[cacheKey] = data.slots;
        } else {
          this.state.error = data.error || 'Failed to load available times';
        }
      } catch (err) {
        console.error('Fetch slots error:', err);
        this.state.error = 'Unable to load available times. Please try again.';
      }

      this.showLoading(false);
      this.render();
    },

    render: function() {
      this.renderCalendar();
      this.renderTimeSlots();
      this.renderForm();
      this.updateSubmitButton();
      this.renderError();
    },

    renderCalendar: function() {
      const { year, month } = this.state.currentMonth;
      const cacheKey = `${year}-${String(month).padStart(2, '0')}`;
      const slots = this.state.slotsCache[cacheKey] || {};

      // Update month display
      const monthNames = ['January', 'February', 'March', 'April', 'May', 'June',
                          'July', 'August', 'September', 'October', 'November', 'December'];
      this.elements.calendarMonth.textContent = `${monthNames[month - 1]} ${year}`;

      // Update prev button state
      const now = new Date();
      const isCurrentMonth = year === now.getFullYear() && month === now.getMonth() + 1;
      this.elements.prevMonthBtn.disabled = isCurrentMonth;

      // Build calendar grid
      const firstDay = new Date(year, month - 1, 1);
      const lastDay = new Date(year, month, 0);
      const startDayOfWeek = firstDay.getDay();
      const daysInMonth = lastDay.getDate();

      let html = '';

      // Day headers
      const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
      dayNames.forEach(day => {
        html += `<div class="calendar-day-header">${day}</div>`;
      });

      // Empty cells before first day
      for (let i = 0; i < startDayOfWeek; i++) {
        html += '<div class="calendar-day empty"></div>';
      }

      // Days
      const today = new Date();
      today.setHours(0, 0, 0, 0);

      for (let day = 1; day <= daysInMonth; day++) {
        const dateStr = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
        const date = new Date(year, month - 1, day);
        const hasSlots = slots[dateStr] && slots[dateStr].length > 0;
        const isPast = date < today;
        const isToday = date.getTime() === today.getTime();
        const isSelected = dateStr === this.state.selectedDate;

        let classes = 'calendar-day';
        if (isPast) classes += ' disabled';
        else if (hasSlots) classes += ' available';
        else classes += ' disabled';
        if (isToday) classes += ' today';
        if (isSelected) classes += ' selected';

        const clickHandler = hasSlots && !isPast ? `Scheduler.selectDate('${dateStr}')` : '';

        html += `<div class="${classes}" onclick="${clickHandler}">${day}</div>`;
      }

      this.elements.calendarGrid.innerHTML = html;
    },

    renderTimeSlots: function() {
      if (!this.state.selectedDate) {
        this.elements.timeslotsDate.textContent = 'Select a date';
        this.elements.timeslotsContainer.innerHTML = '<div class="timeslots-empty">Please select a date from the calendar</div>';
        return;
      }

      const { year, month } = this.state.currentMonth;
      const cacheKey = `${year}-${String(month).padStart(2, '0')}`;
      const slots = this.state.slotsCache[cacheKey] || {};
      const daySlots = slots[this.state.selectedDate] || [];

      // Format date for display
      const date = new Date(this.state.selectedDate + 'T12:00:00');
      const options = { weekday: 'long', month: 'long', day: 'numeric' };
      this.elements.timeslotsDate.textContent = date.toLocaleDateString('en-US', options);

      if (daySlots.length === 0) {
        this.elements.timeslotsContainer.innerHTML = '<div class="timeslots-empty">No available times for this date</div>';
        return;
      }

      let html = '';
      daySlots.forEach(time => {
        const isSelected = time === this.state.selectedTime;
        const displayTime = this.formatTime(time);
        html += `<div class="timeslot${isSelected ? ' selected' : ''}" onclick="Scheduler.selectTime('${time}')">${displayTime}</div>`;
      });

      this.elements.timeslotsContainer.innerHTML = html;
    },

    renderForm: function() {
      this.elements.nameInput.value = this.state.userData.name;
      this.elements.emailInput.value = this.state.userData.email;
      this.elements.ideaInput.value = this.state.userData.productIdea;
      this.elements.notesInput.value = this.state.userData.notes;
      this.elements.timezoneSelect.value = this.state.userTimezone;
    },

    renderError: function() {
      if (this.state.error) {
        this.elements.errorMessage.textContent = this.state.error;
        this.elements.errorMessage.classList.remove('hidden');
      } else {
        this.elements.errorMessage.classList.add('hidden');
      }
    },

    selectDate: function(dateStr) {
      this.state.selectedDate = dateStr;
      this.state.selectedTime = null;
      this.render();
    },

    selectTime: function(time) {
      this.state.selectedTime = time;
      this.render();
    },

    formatTime: function(time) {
      const [hours, minutes] = time.split(':').map(Number);
      const ampm = hours >= 12 ? 'PM' : 'AM';
      const displayHours = hours % 12 || 12;
      return `${displayHours}:${String(minutes).padStart(2, '0')} ${ampm}`;
    },

    updateSubmitButton: function() {
      const { selectedDate, selectedTime, userData } = this.state;
      const isValid = selectedDate && selectedTime && userData.name && userData.email && this.isValidEmail(userData.email);
      this.elements.submitBtn.disabled = !isValid;
    },

    isValidEmail: function(email) {
      return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
    },

    showLoading: function(show) {
      this.state.loading = show;
      if (show) {
        this.elements.loadingOverlay.classList.remove('hidden');
      } else {
        this.elements.loadingOverlay.classList.add('hidden');
      }
    },

    submitBooking: async function() {
      if (this.state.loading) return;

      this.showLoading(true);
      this.state.error = null;

      try {
        const response = await fetch(AppConfig.api.schedulerBook, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            date: this.state.selectedDate,
            time: this.state.selectedTime,
            timezone: this.state.userTimezone,
            name: this.state.userData.name,
            email: this.state.userData.email,
            productIdea: this.state.userData.productIdea,
            notes: this.state.userData.notes
          })
        });

        const data = await response.json();

        if (data.success) {
          this.showConfirmation(data.booking);
        } else if (data.error === 'slot_unavailable') {
          this.state.error = data.message;
          // Refresh slots for the current month
          const cacheKey = `${this.state.currentMonth.year}-${String(this.state.currentMonth.month).padStart(2, '0')}`;
          delete this.state.slotsCache[cacheKey];
          this.state.selectedTime = null;
          this.fetchSlots(this.state.currentMonth.year, this.state.currentMonth.month);
        } else {
          this.state.error = data.error || 'Failed to create booking';
        }
      } catch (err) {
        console.error('Submit booking error:', err);
        this.state.error = 'Unable to create booking. Please try again.';
      }

      this.showLoading(false);
      this.render();
    },

    showConfirmation: function(booking) {
      // Hide scheduler, show confirmation
      this.elements.schedulerContainer.classList.add('hidden');
      this.elements.confirmationContainer.classList.remove('hidden');

      // Populate confirmation details
      const date = new Date(booking.date + 'T' + booking.time);
      const dateOptions = { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' };
      const timeDisplay = `${this.formatTime(booking.time)} - ${this.formatTime(booking.endTime)}`;

      document.getElementById('conf-date').textContent = date.toLocaleDateString('en-US', dateOptions);
      document.getElementById('conf-time').textContent = `${timeDisplay} (${booking.timezone})`;

      const meetLinkEl = document.getElementById('conf-meet-link');
      if (booking.meetLink) {
        meetLinkEl.href = booking.meetLink;
        meetLinkEl.textContent = booking.meetLink.replace('https://', '');
        document.getElementById('conf-meet-container').classList.remove('hidden');
      } else {
        document.getElementById('conf-meet-container').classList.add('hidden');
      }

      document.getElementById('conf-email').textContent = this.state.userData.email;
    },

    copyMeetLink: function() {
      const link = document.getElementById('conf-meet-link').href;
      navigator.clipboard.writeText(link).then(() => {
        const btn = document.getElementById('copy-link-btn');
        const originalText = btn.textContent;
        btn.textContent = 'Copied!';
        setTimeout(() => { btn.textContent = originalText; }, 2000);
      });
    },

    goHome: function() {
      window.location.href = 'index.html';
    }
  };

  // Expose to window
  window.Scheduler = Scheduler;

  // Initialize on DOM ready
  document.addEventListener('DOMContentLoaded', () => Scheduler.init());

})(window);
```

**Step 2: Commit**

```bash
git add option-a-threejs-gsap-tailwind/site/js/scheduler.js
git commit -m "feat(scheduler): add scheduler JavaScript"
```

---

## Task 10: Create schedule.html Page

**Files:**
- Create: `option-a-threejs-gsap-tailwind/site/schedule.html`

**Step 1: Create the HTML file**

```html
<!DOCTYPE html>
<html lang="en" data-theme="dark">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <link rel="icon" type="image/svg+xml" href="favicon.svg">
    <title>Schedule Your Call | CoCreate AI</title>
    <meta name="description" content="Schedule an introduction call with CoCreate AI to discuss your product idea.">

    <!-- Tailwind CSS -->
    <script src="https://cdn.tailwindcss.com"></script>
    <script>
        tailwind.config = {
            theme: {
                extend: {
                    colors: {
                        primary: 'var(--primary)',
                        secondary: 'var(--secondary)',
                        accent: 'var(--accent)',
                    },
                    fontFamily: {
                        sans: ['Inter', 'system-ui', 'sans-serif'],
                    }
                }
            }
        }
    </script>

    <!-- Google Fonts -->
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
    <link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800&display=swap" rel="stylesheet">

    <!-- Centralized Configuration -->
    <script src="js/config.js"></script>

    <!-- Unified Theme System -->
    <script src="js/theme.js"></script>

    <!-- Page Styles -->
    <link rel="stylesheet" href="css/chat-widget.css">
    <link rel="stylesheet" href="css/scheduler.css">
</head>
<body class="min-h-screen" style="background: var(--bg-primary); color: var(--text-primary);">

    <!-- Header -->
    <header class="border-b" style="border-color: var(--border-color); background: var(--bg-secondary);">
        <div class="max-w-7xl mx-auto px-4 py-4 flex items-center justify-between">
            <a href="index.html" class="flex items-center gap-2">
                <div class="w-10 h-10 rounded-xl flex items-center justify-center" style="background: linear-gradient(135deg, var(--primary), var(--secondary));">
                    <svg class="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 10V3L4 14h7v7l9-11h-7z"/>
                    </svg>
                </div>
                <span class="text-xl font-bold gradient-text">CoCreate AI</span>
            </a>
            <a href="index.html" class="flex items-center gap-1 text-sm" style="color: var(--text-secondary);">
                <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 19l-7-7m0 0l7-7m-7 7h18"/>
                </svg>
                Back to Home
            </a>
        </div>
    </header>

    <!-- Main Content -->
    <main class="py-8 px-4">

        <!-- Error Message -->
        <div id="error-message" class="error-message max-w-3xl mx-auto hidden"></div>

        <!-- Scheduler Container -->
        <div id="scheduler-container" class="scheduler-container">

            <!-- Header -->
            <div class="scheduler-header">
                <h1>Schedule Your Introduction Call</h1>
                <div class="scheduler-meta">
                    <span>🕐 30 min</span>
                    <span>📹 Google Meet</span>
                    <span>👤 CEO - CoCreate</span>
                </div>
            </div>

            <!-- Main Grid -->
            <div class="scheduler-grid">

                <!-- Calendar Section -->
                <div class="calendar-section">
                    <div class="calendar-header">
                        <h3>Select Date</h3>
                        <div class="calendar-nav">
                            <button id="prev-month" title="Previous month">
                                <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 19l-7-7 7-7"/>
                                </svg>
                            </button>
                            <span id="calendar-month" class="calendar-month">January 2026</span>
                            <button id="next-month" title="Next month">
                                <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7"/>
                                </svg>
                            </button>
                        </div>
                    </div>
                    <div id="calendar-grid" class="calendar-grid">
                        <!-- Rendered by JS -->
                    </div>
                </div>

                <!-- Time Slots Section -->
                <div class="timeslots-section">
                    <h3>Select Time</h3>
                    <div id="timeslots-date" class="timeslots-date">Select a date</div>
                    <div id="timeslots-container" class="timeslots-container">
                        <div class="timeslots-empty">Please select a date from the calendar</div>
                    </div>
                    <div class="timezone-select">
                        <label>Timezone</label>
                        <select id="timezone-select">
                            <option value="America/New_York">Eastern Time (ET)</option>
                            <option value="America/Chicago">Central Time (CT)</option>
                            <option value="America/Denver">Mountain Time (MT)</option>
                            <option value="America/Los_Angeles">Pacific Time (PT)</option>
                            <option value="America/Phoenix">Arizona (MST)</option>
                            <option value="America/Anchorage">Alaska (AKT)</option>
                            <option value="Pacific/Honolulu">Hawaii (HST)</option>
                            <option value="Europe/London">London (GMT/BST)</option>
                            <option value="Europe/Paris">Paris (CET)</option>
                            <option value="Europe/Berlin">Berlin (CET)</option>
                            <option value="Asia/Dubai">Dubai (GST)</option>
                            <option value="Asia/Kolkata">India (IST)</option>
                            <option value="Asia/Singapore">Singapore (SGT)</option>
                            <option value="Asia/Tokyo">Tokyo (JST)</option>
                            <option value="Australia/Sydney">Sydney (AEST)</option>
                        </select>
                    </div>
                </div>

                <!-- Details Section -->
                <div class="details-section">
                    <h3>Your Details</h3>

                    <div class="form-group">
                        <label for="input-name">Name *</label>
                        <input type="text" id="input-name" placeholder="Your name" required>
                    </div>

                    <div class="form-group">
                        <label for="input-email">Email *</label>
                        <input type="email" id="input-email" placeholder="you@example.com" required>
                    </div>

                    <div class="form-group">
                        <label for="input-idea">Product Idea</label>
                        <input type="text" id="input-idea" readonly>
                    </div>

                    <div class="form-group">
                        <label for="input-notes">Notes (optional)</label>
                        <textarea id="input-notes" placeholder="Anything you'd like us to know before the call..."></textarea>
                    </div>

                    <button id="submit-btn" class="submit-btn" disabled>Schedule Call</button>
                </div>

            </div>
        </div>

        <!-- Confirmation Container (hidden by default) -->
        <div id="confirmation-container" class="confirmation-container hidden">
            <div class="confirmation-icon">
                <svg fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="3" d="M5 13l4 4L19 7"/>
                </svg>
            </div>

            <h2>You're All Set!</h2>

            <div class="booking-details">
                <p>📅 <span id="conf-date"></span></p>
                <p>⏰ <span id="conf-time"></span></p>
                <p>📍 Google Meet</p>

                <div id="conf-meet-container" class="meet-link-box">
                    <span>🔗</span>
                    <a id="conf-meet-link" href="#" target="_blank"></a>
                    <button id="copy-link-btn" onclick="Scheduler.copyMeetLink()">Copy Link</button>
                </div>
            </div>

            <p class="confirmation-note">
                📧 A calendar invite has been sent to <strong id="conf-email"></strong>
            </p>

            <div class="confirmation-actions">
                <button class="btn-primary" onclick="Scheduler.goHome()">Back to Home</button>
            </div>
        </div>

    </main>

    <!-- Loading Overlay -->
    <div id="loading-overlay" class="loading-overlay hidden">
        <div class="loading-spinner"></div>
    </div>

    <!-- Scheduler Script -->
    <script src="js/scheduler.js"></script>

</body>
</html>
```

**Step 2: Commit**

```bash
git add option-a-threejs-gsap-tailwind/site/schedule.html
git commit -m "feat(scheduler): add schedule.html page"
```

---

## Task 11: Modify apply.html to Redirect

**Files:**
- Modify: `option-a-threejs-gsap-tailwind/site/apply.html`

**Step 1: Remove Calendly CSS link (line 38)**

Find and remove:
```html
<link href="https://assets.calendly.com/assets/external/widget.css" rel="stylesheet">
```

**Step 2: Remove Calendly JS script (line 39)**

Find and remove:
```html
<script src="https://assets.calendly.com/assets/external/widget.js" type="text/javascript" async></script>
```

**Step 3: Remove Calendly fullscreen div (lines 688-701)**

Find and remove the entire block:
```html
<!-- Full-screen Calendly (outside container for full width) -->
<div id="calendly-fullscreen" class="hidden" style="position: fixed; top: 0; left: 0; right: 0; bottom: 0; z-index: 9999; background: var(--bg-primary);">
    ...
</div>
```

**Step 4: Replace form success handler**

Find the form submission success handler (around line 837-856) and replace with redirect:

```javascript
if (result.success) {
    // Build URL with parameters from form
    const params = new URLSearchParams({
        name: formData.fullName || formData.name || '',
        email: formData.email || '',
        idea: formData.productIdea || formData.product_idea || ''
    });

    // Redirect to scheduler
    window.location.href = `schedule.html?${params.toString()}`;
}
```

**Step 5: Remove Calendly close event listener (lines 881-887)**

Find and remove:
```javascript
// Close Calendly fullscreen
document.getElementById('calendly-close').addEventListener('click', () => {
    document.getElementById('calendly-fullscreen').classList.add('hidden');
    document.body.style.overflow = '';
    window.location.href = 'index.html';
});
```

**Step 6: Commit**

```bash
git add option-a-threejs-gsap-tailwind/site/apply.html
git commit -m "feat(scheduler): replace Calendly with redirect to scheduler"
```

---

## Task 12: Add Scheduler Endpoints to Local Dev Server

**Files:**
- Modify: `option-a-threejs-gsap-tailwind/local-dev/server.js`

**Step 1: Add googleapis import at top**

```javascript
import { google } from 'googleapis';
```

**Step 2: Add scheduler config after existing config**

```javascript
// Scheduler Configuration
const SCHEDULER_CONFIG = {
  availableDays: [1, 2, 3, 4, 5],
  startHour: 8,
  endHour: 18,
  slotDuration: 30,
  timezone: 'America/Chicago',
  meetingTitle: 'CoCreate Introduction',
  calendarId: process.env.GOOGLE_CALENDAR_ID || 'primary',
};

const GOOGLE_SERVICE_ACCOUNT_EMAIL = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
const GOOGLE_PRIVATE_KEY = process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, '\n');
```

**Step 3: Add Google Calendar auth helper**

```javascript
let googleCalendar = null;

async function getGoogleCalendar() {
  if (googleCalendar) return googleCalendar;

  if (!GOOGLE_SERVICE_ACCOUNT_EMAIL || !GOOGLE_PRIVATE_KEY) {
    throw new Error('Google Calendar credentials not configured');
  }

  const auth = new google.auth.JWT(
    GOOGLE_SERVICE_ACCOUNT_EMAIL,
    null,
    GOOGLE_PRIVATE_KEY,
    ['https://www.googleapis.com/auth/calendar']
  );

  googleCalendar = google.calendar({ version: 'v3', auth });
  return googleCalendar;
}
```

**Step 4: Add slot generation helpers**

Copy the same `generatePossibleSlots` and `subtractBusyTimes` functions from Task 4.

**Step 5: Add scheduler routes**

```javascript
// Scheduler: Get available slots
app.post('/scheduler/slots', async (req, res) => {
  // Copy the handler logic from Task 5, adapting for Express response format
  // Use res.json() instead of returning Lambda response object
});

// Scheduler: Book appointment
app.post('/scheduler/book', async (req, res) => {
  // Copy the handler logic from Task 6, adapting for Express response format
  // Use res.json() instead of returning Lambda response object
});
```

**Step 6: Add googleapis to local-dev package.json**

```bash
cd option-a-threejs-gsap-tailwind/local-dev
npm install googleapis
```

**Step 7: Commit**

```bash
git add option-a-threejs-gsap-tailwind/local-dev/server.js option-a-threejs-gsap-tailwind/local-dev/package.json option-a-threejs-gsap-tailwind/local-dev/package-lock.json
git commit -m "feat(scheduler): add scheduler endpoints to local dev server"
```

---

## Task 13: Add Environment Variables

**Files:**
- Modify: `option-a-threejs-gsap-tailwind/local-dev/.env` (create if needed)
- Lambda environment variables (AWS Console)

**Step 1: Add to local .env file**

```
# Google Calendar (Scheduler)
GOOGLE_SERVICE_ACCOUNT_EMAIL=scheduler-service@cocreate-scheduler.iam.gserviceaccount.com
GOOGLE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n"
GOOGLE_CALENDAR_ID=ceo@cocreate.com
```

Note: Replace with actual values from the service account JSON file.

**Step 2: Add to Lambda environment variables**

In AWS Console → Lambda → Function → Configuration → Environment variables:
- `GOOGLE_SERVICE_ACCOUNT_EMAIL`
- `GOOGLE_PRIVATE_KEY`
- `GOOGLE_CALENDAR_ID`

**Step 3: DO NOT commit .env file (contains secrets)**

Ensure `.env` is in `.gitignore`.

---

## Task 14: Test Locally

**Step 1: Start local dev server**

```bash
cd option-a-threejs-gsap-tailwind/local-dev
npm start
```

**Step 2: Test the scheduler page**

1. Open http://localhost:5000/schedule.html
2. Verify calendar displays current month
3. Click an available date
4. Verify time slots appear
5. Select a time slot
6. Fill in name and email
7. Click "Schedule Call"
8. Verify confirmation appears

**Step 3: Test the apply flow**

1. Open http://localhost:5000/apply.html
2. Fill the form with valid data
3. Submit the form
4. Verify redirect to schedule.html with URL params pre-filled

---

## Task 15: Deploy to Production

**Step 1: Deploy Lambda**

```bash
cd option-a-threejs-gsap-tailwind/chat-backend
npm run build
# Upload function.zip to AWS Lambda
```

**Step 2: Deploy frontend**

```bash
cd option-a-threejs-gsap-tailwind/site
aws s3 sync . s3://ai-product-studio-sunware --exclude "*.DS_Store"
```

**Step 3: Invalidate CloudFront cache (if applicable)**

```bash
aws cloudfront create-invalidation --distribution-id YOUR_DIST_ID --paths "/*"
```

**Step 4: Final commit**

```bash
git add -A
git commit -m "feat(scheduler): complete custom scheduler implementation"
```

---

## Summary

| Task | Description | Files |
|------|-------------|-------|
| 1 | Add googleapis dependency | package.json |
| 2 | Add scheduler config | index.mjs |
| 3 | Add Google auth helper | index.mjs |
| 4 | Add slot generation helpers | index.mjs |
| 5 | Add /scheduler/slots endpoint | index.mjs |
| 6 | Add /scheduler/book endpoint | index.mjs |
| 7 | Update frontend config | config.js |
| 8 | Create scheduler CSS | scheduler.css |
| 9 | Create scheduler JS | scheduler.js |
| 10 | Create schedule.html | schedule.html |
| 11 | Modify apply.html | apply.html |
| 12 | Update local dev server | server.js |
| 13 | Add environment variables | .env, Lambda |
| 14 | Test locally | - |
| 15 | Deploy to production | - |

**Total new files:** 3 (schedule.html, scheduler.js, scheduler.css)
**Modified files:** 5 (index.mjs, config.js, apply.html, server.js, package.json)
