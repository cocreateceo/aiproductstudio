# Google Calendar Integration - Setup Tasks

## Overview

The scheduler at https://www.cocreateidea.com/schedule.html requires Google Calendar integration to:
1. Check CEO's calendar availability
2. Book meetings and send calendar invites
3. Generate Google Meet links

## Current Status

**Issue:** Scheduler failing with "Unable to load available times. Please try again."
**Root Cause:** Google Calendar credentials not configured in Lambda environment variables

## Required Environment Variables

The following environment variables need to be added to the Lambda function (`ai-product-studio-chat`):

| Variable | Description |
|----------|-------------|
| `GOOGLE_SERVICE_ACCOUNT_EMAIL` | Service account email (e.g., `scheduler@project-id.iam.gserviceaccount.com`) |
| `GOOGLE_PRIVATE_KEY` | Private key from service account JSON (replace `\n` with actual newlines) |
| `GOOGLE_CALENDAR_ID` | Calendar ID to check/book (e.g., `primary` or specific calendar email) |

## Setup Steps

### 1. Create Google Cloud Project (if not exists)
- Go to https://console.cloud.google.com/
- Create a new project or use existing one

### 2. Enable Google Calendar API
- Go to APIs & Services > Library
- Search for "Google Calendar API"
- Click Enable

### 3. Create Service Account
- Go to APIs & Services > Credentials
- Click "Create Credentials" > "Service Account"
- Give it a name (e.g., "CoCreate Scheduler")
- Grant role: No role needed (we'll share calendar directly)
- Click "Done"

### 4. Generate Service Account Key
- Click on the created service account
- Go to "Keys" tab
- Click "Add Key" > "Create new key"
- Choose JSON format
- Download the JSON file (keep it secure!)

### 5. Share Calendar with Service Account
- Open Google Calendar (calendar.google.com)
- Find the calendar you want to use (CEO's calendar)
- Click the three dots > "Settings and sharing"
- Under "Share with specific people", add the service account email
- Give permission: "Make changes to events"

### 6. Update Lambda Environment Variables

Run this command (replace placeholders with actual values):

```bash
aws lambda update-function-configuration \
  --function-name ai-product-studio-chat \
  --environment "Variables={
    ANTHROPIC_API_KEY=<existing>,
    OPENAI_API_KEY=<existing>,
    ADMIN_PASSWORD=<existing>,
    NOTIFICATION_EMAIL=<existing>,
    GOOGLE_SERVICE_ACCOUNT_EMAIL=<service-account-email>,
    GOOGLE_PRIVATE_KEY=<private-key-from-json>,
    GOOGLE_CALENDAR_ID=<calendar-id-or-primary>
  }" \
  --profile sunwaretech \
  --region ap-south-1
```

**Note:** The private key contains newlines. When setting via CLI, escape them as `\n`.

### 7. Test the Integration

```bash
curl "https://bx0ywfkona.execute-api.ap-south-1.amazonaws.com/prod/scheduler/slots?year=2026&month=2&timezone=America/Chicago"
```

Expected response: JSON with available time slots

## Lambda Code Reference

The scheduler code is in:
- `option-a-threejs-gsap-tailwind/chat-backend/index.mjs`

Key functions:
- `getGoogleCalendar()` - Authenticates with Google Calendar API
- `generatePossibleSlots()` - Generates available time slots (8 AM - 6 PM CST, Mon-Fri)
- `subtractBusyTimes()` - Removes busy calendar events from available slots

## Scheduler Configuration

Current settings in `SCHEDULER_CONFIG`:
- Available days: Monday - Friday
- Available hours: 8:00 AM - 6:00 PM (CEO's timezone)
- Slot duration: 30 minutes
- Timezone: America/Chicago (CST)

## API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/scheduler/slots` | GET | Get available time slots for a month |
| `/scheduler/book` | POST | Book a meeting slot |

## Files Modified Today (Feb 1, 2026)

1. Added API Gateway routes for scheduler endpoints
2. Updated Lambda to handle GET requests for `/scheduler/slots`
3. Added `queryParams` parsing for GET requests
4. Added path prefix stripping for `/prod/` stage

## Next Steps

1. [ ] Obtain Google Cloud project access
2. [ ] Create service account and download credentials
3. [ ] Share calendar with service account
4. [ ] Set Lambda environment variables
5. [ ] Test scheduler functionality
6. [ ] Verify booking creates calendar events with Meet links
