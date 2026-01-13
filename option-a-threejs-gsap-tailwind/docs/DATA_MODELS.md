# Data Models

All data is stored as JSON files in S3 or EC2 local storage.

---

## Chat Session

**Location:** `S3: chats/{landing|apply}/{sessionId}.json`

```json
{
  "sessionId": "sess-1704211200000-abc12345",
  "source": "apply",
  "startedAt": "2026-01-02T10:00:00.000Z",
  "lastActivity": "2026-01-02T10:30:00.000Z",
  "status": "active",
  "clientId": "client-john-example-com",
  "visitorInfo": {
    "name": "John Doe",
    "email": "john@example.com",
    "phone": "+1234567890"
  },
  "messages": [
    {
      "role": "user",
      "content": "Hi, I want to build an AI product",
      "timestamp": "2026-01-02T10:00:00.000Z",
      "index": 0
    },
    {
      "role": "assistant",
      "content": "Great! Tell me more about your idea...",
      "timestamp": "2026-01-02T10:00:05.000Z",
      "index": 1
    }
  ],
  "metadata": {
    "userAgent": "Mozilla/5.0...",
    "convertedToApplication": "applications/john/2026-01-02/file.json",
    "totalMessages": 15
  }
}
```

**Status Values:**
- `active` - Ongoing conversation
- `completed` - User left without submitting
- `converted` - User submitted application
- `abandoned` - No activity for 30+ minutes

---

## Application

**Location:** `S3: applications/{email}/{date}/{timestamp}.json`

```json
{
  "submittedAt": "2026-01-02T10:30:00.000Z",
  "submittedAtEST": "1/2/2026, 5:30:00 AM",
  "status": "pending",
  "visitorInfo": {
    "name": "John Doe",
    "email": "john@example.com",
    "phone": "+1234567890"
  },
  "clientIP": "192.168.1.1",
  "page": "Apply Page",
  "formData": {
    "full_name": "John Doe",
    "email": "john@example.com",
    "phone": "+1234567890",
    "linkedin": "https://linkedin.com/in/johndoe",
    "business_stage": "idea",
    "industry": "fintech",
    "professional_background": "10 years in finance...",
    "product_idea": "An AI-powered investment advisor...",
    "target_customer": "Retail investors aged 25-45",
    "market_validation": "Conducted 50 interviews...",
    "time_commitment": "full-time",
    "desired_timeline": "asap"
  },
  "rawContent": "Full form text submission...",
  "reviewedAt": "2026-01-02T12:00:00.000Z",
  "reviewedAtEST": "1/2/2026, 7:00:00 AM",
  "reviewNotes": "Great idea, approved!",
  "jobId": "job-1704211200000-xyz789"
}
```

**Status Values:**
- `pending` - Awaiting review
- `approved` - Approved, build started
- `rejected` - Rejected by admin

---

## Client Profile

**Location:** `S3: clients/{clientId}.json`

```json
{
  "clientId": "client-john-example-com",
  "name": "John Doe",
  "email": "john@example.com",
  "phone": "+1234567890",
  "company": "Acme Inc",
  "createdAt": "2026-01-02T10:00:00.000Z",
  "updatedAt": "2026-01-02T14:00:00.000Z",
  "status": "delivered",
  "chatSessions": [
    "sess-1704211200000-abc123",
    "sess-1704211500000-def456"
  ],
  "applications": [
    "applications/john-example-com/2026-01-02/file.json"
  ],
  "builds": [
    "job-1704211200000-xyz789"
  ],
  "timeline": [
    {
      "event": "profile_created",
      "timestamp": "2026-01-02T10:00:00.000Z"
    },
    {
      "event": "chat_with_contact",
      "timestamp": "2026-01-02T10:15:00.000Z",
      "ref": "sess-1704211200000-abc123"
    },
    {
      "event": "application_submitted",
      "timestamp": "2026-01-02T10:30:00.000Z",
      "ref": "applications/..."
    },
    {
      "event": "build_started",
      "timestamp": "2026-01-02T12:00:00.000Z",
      "ref": "job-1704211200000-xyz789"
    },
    {
      "event": "mvp_delivered",
      "timestamp": "2026-01-02T14:00:00.000Z",
      "ref": "job-1704211200000-xyz789",
      "url": "https://d123.cloudfront.net"
    }
  ]
}
```

**Status Values:**
- `prospect` - Has chatted, no application
- `applied` - Submitted application
- `approved` - Application approved
- `building` - MVP being built
- `delivered` - MVP completed and delivered

---

## Build Job

**Location:** `S3: jobs/{jobId}.json` (pending) or `S3: processed/{jobId}.json` (completed)

```json
{
  "jobId": "job-1704211200000-xyz789",
  "createdAt": "2026-01-02T12:00:00.000Z",
  "createdAtEST": "1/2/2026, 7:00:00 AM",
  "status": "pending",
  "applicationS3Key": "applications/john/2026-01-02/file.json",
  "client": {
    "name": "John Doe",
    "email": "john@example.com",
    "phone": "+1234567890"
  },
  "business": {
    "idea": "An AI-powered investment advisor that helps retail investors...",
    "industry": "fintech",
    "stage": "idea",
    "targetCustomer": "Retail investors aged 25-45",
    "marketValidation": "Conducted 50 interviews...",
    "background": "10 years in finance..."
  },
  "preferences": {
    "timeline": "asap",
    "techStack": "threejs-gsap-tailwind",
    "deployment": "cloudfront"
  }
}
```

---

## Build Progress

**Location:** `S3: progress/{jobId}.json`

```json
{
  "jobId": "job-1704211200000-xyz789",
  "applicationId": "applications/john/2026-01-02/file.json",
  "clientEmail": "john@example.com",
  "status": "in_progress",
  "currentPhase": "developer",
  "phases": {
    "architect": {
      "status": "completed",
      "startedAt": "2026-01-02T12:00:00.000Z",
      "completedAt": "2026-01-02T12:05:00.000Z"
    },
    "developer": {
      "status": "in_progress",
      "startedAt": "2026-01-02T12:05:00.000Z"
    },
    "deployer": {
      "status": "pending"
    }
  },
  "result": {
    "mvpUrl": "https://d123.cloudfront.net",
    "localPath": "/builds/john-doe-123/output",
    "mode": "local"
  },
  "logs": [
    {
      "timestamp": "2026-01-02T12:00:00.000Z",
      "message": "Job created and queued"
    },
    {
      "timestamp": "2026-01-02T12:00:30.000Z",
      "message": "Starting architect phase"
    },
    {
      "timestamp": "2026-01-02T12:05:00.000Z",
      "message": "Architect phase completed"
    }
  ],
  "createdAt": "2026-01-02T12:00:00.000Z",
  "updatedAt": "2026-01-02T12:10:00.000Z"
}
```

**Status Values:**
- `pending` - In queue
- `in_progress` - Being built
- `completed` - Successfully deployed
- `failed` - Build failed

**Phase Status Values:**
- `pending` - Not started
- `in_progress` - Currently running
- `completed` - Successfully finished
- `failed` - Failed

---

## Build Metadata

**Location:** `S3: builds/{jobId}/metadata.json`

```json
{
  "buildId": "job-1704211200000-xyz789",
  "clientId": "client-john-example-com",
  "applicationId": "applications/john/2026-01-02/file.json",
  "client": {
    "name": "John Doe",
    "email": "john@example.com"
  },
  "business": {
    "idea": "An AI-powered investment advisor..."
  },
  "status": "completed",
  "timestamps": {
    "created": "2026-01-02T12:00:00.000Z",
    "started": "2026-01-02T12:00:30.000Z",
    "completed": "2026-01-02T14:00:00.000Z"
  },
  "phases": {
    "architect": { "status": "completed" },
    "developer": { "status": "completed" },
    "deployer": { "status": "completed" }
  },
  "mvpUrl": "https://d123.cloudfront.net",
  "localPath": "/builds/john-doe-123",
  "mode": "local",
  "filesCreated": [
    "index.html",
    "js/main.js",
    "js/animations.js",
    "css/styles.css",
    "assets/logo.svg"
  ]
}
```

---

## Agent Log

**Location:** `S3: builds/{jobId}/agent-log.json` (summary) or `EC2: completed/{dir}/agent-log.json` (full)

```json
{
  "buildId": "job-1704211200000-xyz789",
  "capturedAt": "2026-01-02T14:00:00.000Z",
  "totalEntries": 150,
  "entries": [
    {
      "timestamp": "2026-01-02T12:00:30.000Z",
      "phase": "system",
      "type": "action",
      "content": "Starting build for job job-1704211200000-xyz789"
    },
    {
      "timestamp": "2026-01-02T12:01:00.000Z",
      "phase": "architect",
      "type": "output",
      "content": "Analyzing business requirements..."
    },
    {
      "timestamp": "2026-01-02T12:05:00.000Z",
      "phase": "developer",
      "type": "action",
      "content": "Developer phase started"
    },
    {
      "timestamp": "2026-01-02T12:10:00.000Z",
      "phase": "developer",
      "type": "output",
      "content": "Creating index.html with hero section..."
    },
    {
      "timestamp": "2026-01-02T13:50:00.000Z",
      "phase": "deployer",
      "type": "action",
      "content": "Deployer phase started"
    },
    {
      "timestamp": "2026-01-02T14:00:00.000Z",
      "phase": "system",
      "type": "action",
      "content": "MVP deployed successfully at https://d123.cloudfront.net"
    }
  ]
}
```

**Entry Types:**
- `thought` - Claude's reasoning
- `action` - Action being taken
- `output` - Output/result
- `error` - Error message

**Phases:**
- `system` - Worker system messages
- `architect` - Architect sub-agent
- `developer` - Developer sub-agent
- `deployer` - Deployer sub-agent

---

## ID Generation

### Session ID
```javascript
const sessionId = `sess-${Date.now()}-${Math.random().toString(36).substring(2, 10)}`;
// Example: sess-1704211200000-abc12345
```

### Client ID
```javascript
// From email (preferred)
const clientId = `client-${email.toLowerCase().replace(/[^a-z0-9]/g, '-')}`;
// Example: client-john-example-com

// From name (fallback)
const clientId = `client-${name.toLowerCase().replace(/\s+/g, '-')}-${Date.now()}`;
// Example: client-john-doe-1704211200000
```

### Job ID
```javascript
const jobId = `job-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;
// Example: job-1704211200000-xyz789
```

---

*Last Updated: January 2, 2026*
