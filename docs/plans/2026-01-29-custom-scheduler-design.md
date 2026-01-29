# Custom Scheduler with Google Calendar API - Design Document

**Date:** 2026-01-29
**Status:** Approved
**Purpose:** Replace Calendly multi-step flow with a single-page custom scheduler using Google Calendar API

---

## Overview

Build a custom scheduling page that displays date picker, time slots, and booking form all on one page. Uses Google Calendar API (free) to check availability and create events with auto-generated Google Meet links.

---

## User Flow

```
apply.html (form submit)
    │
    ▼
Validation + Save to S3
    │
    ▼
Redirect to schedule.html?name=X&email=Y&idea=Z
    │
    ▼
schedule.html (single page)
├── Select date from calendar
├── Select time slot
├── Review pre-filled details (name, email, idea)
├── Add optional notes
├── Click "Schedule Call"
    │
    ▼
Confirmation shown on same page
├── Meeting details displayed
├── Google Meet link with copy button
├── "Calendar invite sent to your email"
├── Back to Home button
```

---

## Configuration

| Setting | Value |
|---------|-------|
| Available days | Monday - Friday |
| Available hours | 8:00 AM - 6:00 PM |
| Timezone | Central Time (America/Chicago) |
| Meeting duration | 30 minutes |
| Buffer between meetings | None |
| Booking window | Unlimited (navigate to any future month) |
| Video conferencing | Auto-generated Google Meet link |

---

## Page Layout - schedule.html

```
┌─────────────────────────────────────────────────────────────────────────┐
│  ⚡ CoCreate AI                                    ← Back to Home       │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│                     Schedule Your Introduction Call                      │
│                 30 min │ Google Meet │ CEO-CoCreate                     │
│                                                                          │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│  ┌──────────────────────┐ ┌──────────────────┐ ┌─────────────────────┐  │
│  │    SELECT DATE       │ │   SELECT TIME    │ │    YOUR DETAILS     │  │
│  │                      │ │                  │ │                     │  │
│  │   ◀ January 2026 ▶   │ │  Thu, Jan 29     │ │  Name               │  │
│  │   Su Mo Tu We Th Fr Sa│ │                  │ │  ┌───────────────┐  │  │
│  │       1  2  3  4  5  6│ │  ○ 8:00 AM      │ │  │ Kumar         │  │  │
│  │    7  8  9 10 11 12 13│ │  ○ 8:30 AM      │ │  └───────────────┘  │  │
│  │   14 15 16 17 18 19 20│ │  ● 9:00 AM      │ │                     │  │
│  │   21 22 23 24 25 26 27│ │  ○ 9:30 AM      │ │  Email              │  │
│  │   28[29]30 31         │ │  ○ 10:00 AM     │ │  ┌───────────────┐  │  │
│  │                      │ │     ...          │ │  │kumar@gmail.com│  │  │
│  └──────────────────────┘ │                  │ │  └───────────────┘  │  │
│                           │  ⏰ Central Time │ │                     │  │
│                           │     (change)     │ │  Product Idea       │  │
│                           └──────────────────┘ │  ┌───────────────┐  │  │
│                                                │  │ AI scheduling │  │  │
│                                                │  └───────────────┘  │  │
│                                                │                     │  │
│                                                │  Notes (optional)   │  │
│                                                │  ┌───────────────┐  │  │
│                                                │  │               │  │  │
│                                                │  └───────────────┘  │  │
│                                                │                     │  │
│                                                │  [Schedule Call]    │  │
│                                                └─────────────────────┘  │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## Confirmation UI (After Booking)

```
┌─────────────────────────────────────────────────────────────────────────┐
│  ⚡ CoCreate AI                                    ← Back to Home       │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│                              ✓                                          │
│                                                                          │
│                         You're All Set!                                  │
│                                                                          │
│         ┌─────────────────────────────────────────────────┐             │
│         │  📅  Thursday, January 29, 2026                 │             │
│         │  ⏰  9:00 AM - 9:30 AM (Central Time)           │             │
│         │  📍  Google Meet                                 │             │
│         │                                                  │             │
│         │  🔗 meet.google.com/abc-xyz-123  [Copy Link]    │             │
│         └─────────────────────────────────────────────────┘             │
│                                                                          │
│            📧 A calendar invite has been sent to kumar@gmail.com        │
│                                                                          │
│                      [Add to Calendar]  [Back to Home]                  │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## API Endpoints

### 1. Get Available Slots

```
POST /scheduler/slots

Request:
{
  "month": "2026-01",
  "timezone": "America/Chicago"
}

Response:
{
  "success": true,
  "month": "2026-01",
  "timezone": "America/Chicago",
  "slots": {
    "2026-01-29": ["08:00", "08:30", "09:00", "10:30", "14:00"],
    "2026-01-30": ["08:00", "09:00", "11:00", "13:00", "16:00"],
    "2026-01-31": []
  }
}
```

**Logic:**
1. Generate all possible slots from availability rules (Mon-Fri, 8am-6pm Central)
2. Query Google Calendar FreeBusy API for busy times
3. Subtract busy times from possible slots
4. Convert to user's timezone
5. Return available slots grouped by date

### 2. Book Appointment

```
POST /scheduler/book

Request:
{
  "date": "2026-01-29",
  "time": "09:00",
  "timezone": "America/Chicago",
  "name": "Kumar",
  "email": "kumar@gmail.com",
  "productIdea": "AI scheduling tool",
  "notes": "Looking forward to discussing!"
}

Response (success):
{
  "success": true,
  "booking": {
    "eventId": "abc123xyz",
    "title": "CoCreate Introduction - Kumar",
    "dateTime": "2026-01-29T09:00:00-06:00",
    "duration": "30 minutes",
    "timezone": "America/Chicago",
    "meetLink": "https://meet.google.com/abc-defg-hij"
  }
}

Response (slot taken):
{
  "success": false,
  "error": "slot_unavailable",
  "message": "This time slot is no longer available. Please select another."
}
```

**Logic:**
1. Convert user's time to CEO's timezone
2. Re-verify slot is still available (prevent double-booking)
3. Create Google Calendar event with attendee
4. Google auto-generates Meet link and sends invite email
5. Return confirmation details

---

## Google Calendar Integration

### One-Time Setup

1. Create Google Cloud Project ("CoCreate Scheduler")
2. Enable Google Calendar API
3. Create Service Account, download JSON key
4. Share CEO's calendar with Service Account (Make changes to events)
5. Store credentials in Lambda environment variables

### Environment Variables

```
GOOGLE_SERVICE_ACCOUNT_EMAIL=scheduler@cocreate-123.iam.gserviceaccount.com
GOOGLE_PRIVATE_KEY=-----BEGIN PRIVATE KEY-----\n...
GOOGLE_CALENDAR_ID=ceo@cocreate.com
SCHEDULER_DAYS=1,2,3,4,5
SCHEDULER_START_HOUR=8
SCHEDULER_END_HOUR=18
SCHEDULER_TIMEZONE=America/Chicago
SCHEDULER_SLOT_DURATION=30
```

### NPM Package

```json
{
  "dependencies": {
    "googleapis": "^126.0.0"
  }
}
```

---

## Frontend Behavior

### Calendar Navigation
- Page loads → Fetch current month
- Click "▶" → Fetch next month (cache result)
- Click "◀" → Use cached data or re-fetch
- No limit on forward navigation

### Date Selection
- Dates with no slots → Grayed out, unclickable
- Past dates → Grayed out
- Weekends → Grayed out
- Click available date → Show time slots for that date

### Time Selection
- Display in user's detected timezone
- Show timezone with option to change
- Click slot → Select it (radio button style)

### Form Validation
- Name: Required
- Email: Required, valid format
- Product Idea: Pre-filled, display only
- Notes: Optional
- Schedule button: Disabled until date + time + name + email valid

---

## Error Handling

| Scenario | Handling |
|----------|----------|
| Slot taken (race condition) | Re-verify before booking, show error, refresh slots |
| Google API down | Show friendly error, log for monitoring |
| Invalid email | Frontend + backend validation |
| Past month navigation | Disable "◀" on current month |
| CEO vacation (all-day event) | FreeBusy returns full day busy, no slots shown |
| Missing URL params | Show empty fields, require user to fill |

### Rate Limiting

```
/scheduler/slots: 30 requests/minute per IP
/scheduler/book: 5 requests/minute per IP
```

---

## File Changes

### New Files

| File | Purpose |
|------|---------|
| `site/schedule.html` | Single-page scheduler UI |
| `site/js/scheduler.js` | Scheduler logic |
| `site/css/scheduler.css` | Scheduler styles (optional) |

### Modified Files

| File | Change |
|------|--------|
| `site/apply.html` | Remove Calendly, add redirect |
| `chat-backend/index.mjs` | Add scheduler endpoints + Google auth |
| `chat-backend/package.json` | Add googleapis dependency |

### Removals from apply.html

- Calendly CSS link (line 38)
- Calendly JS script (line 39)
- `#calendly-fullscreen` div (lines 688-701)
- `#calendly-close` event listener (lines 881-887)
- Calendly initialization code (lines 844-856)

---

## Cost

| Component | Cost |
|-----------|------|
| Google Calendar API | Free (1M queries/day quota) |
| Google Meet links | Free (included with Calendar) |
| Lambda execution | Existing infrastructure |
| No Calendly subscription | $0 |

---

## Summary

This design replaces the 4-step Calendly flow with a single-page custom scheduler. Users see date, time, and form all at once. Google Calendar API handles availability and booking for free, with automatic Meet links and email invites.
