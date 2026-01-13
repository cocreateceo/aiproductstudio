# API Reference

## Base URL

| Environment | URL |
|-------------|-----|
| Production | `https://bx0ywfkona.execute-api.ap-south-1.amazonaws.com/prod/chat` |
| Local | `http://localhost:3000/api/chat` |

All endpoints use `POST` method with JSON body.

---

## Authentication

- **Public endpoints:** No authentication (chat)
- **Admin endpoints:** Password in request body

```json
{
  "action": "admin-*",
  "password": "aiproductstudio2026"
}
```

---

## Endpoints

### Chat Endpoint

Send a chat message and get AI response.

**Request:**
```json
{
  "messages": [
    { "role": "user", "content": "Hello" },
    { "role": "assistant", "content": "Hi! How can I help?" },
    { "role": "user", "content": "Tell me about your services" }
  ],
  "visitorInfo": {
    "name": "John",
    "email": "john@example.com",
    "phone": "+1234567890",
    "page": "apply.html"
  },
  "sessionId": "sess-1234567890-abc123"  // Optional, generated if not provided
}
```

**Response:**
```json
{
  "success": true,
  "response": "AI response text...",
  "provider": "claude",
  "visitorInfo": {
    "name": "John",
    "email": "john@example.com",
    "phone": "+1234567890"
  },
  "hasContactInfo": true,
  "contactStatus": {
    "hasName": true,
    "hasContact": true,
    "complete": true
  },
  "sessionId": "sess-1234567890-abc123"
}
```

---

### Form Submission

When the last message contains `PARTNERSHIP APPLICATION SUBMISSION`:

**Request:**
```json
{
  "messages": [
    { "role": "user", "content": "PARTNERSHIP APPLICATION SUBMISSION\n\nFull Name: John Doe\nEmail: john@example.com\n..." }
  ],
  "visitorInfo": { ... },
  "sessionId": "sess-123"
}
```

**Response:**
```json
{
  "success": true,
  "response": "Thank you for your application! We will review it and get back to you within 24 hours.",
  "provider": "system",
  "visitorInfo": { ... },
  "hasContactInfo": true,
  "formSubmitted": true,
  "s3Key": "applications/john-example-com/2026-01-02/...",
  "sessionId": "sess-123"
}
```

---

### Admin Login

**Request:**
```json
{
  "action": "admin-login",
  "password": "aiproductstudio2026"
}
```

**Response (success):**
```json
{
  "success": true,
  "message": "Login successful"
}
```

**Response (failure):**
```json
{
  "success": false,
  "error": "Invalid password"
}
```

---

### Admin List Applications

**Request:**
```json
{
  "action": "admin-list",
  "password": "aiproductstudio2026"
}
```

**Response:**
```json
{
  "success": true,
  "applications": [
    {
      "s3Key": "applications/...",
      "submittedAt": "2026-01-02T10:00:00Z",
      "status": "pending",
      "visitorInfo": {
        "name": "John Doe",
        "email": "john@example.com"
      },
      "formData": { ... },
      "jobId": "job-123-abc"  // Only if approved
    }
  ]
}
```

---

### Admin Update Status

**Request:**
```json
{
  "action": "admin-update",
  "password": "aiproductstudio2026",
  "s3Key": "applications/john/2026-01-02/file.json",
  "status": "approved",  // or "rejected"
  "reviewNotes": "Optional notes"
}
```

**Response:**
```json
{
  "success": true,
  "application": {
    "s3Key": "...",
    "status": "approved",
    "reviewedAt": "2026-01-02T12:00:00Z",
    "jobId": "job-1234567890-abc123"  // Created on approval
  }
}
```

---

### Admin Get Build Progress

**Request:**
```json
{
  "action": "admin-progress",
  "password": "aiproductstudio2026",
  "jobId": "job-1234567890-abc123"
}
```

**Response:**
```json
{
  "success": true,
  "progress": {
    "jobId": "job-1234567890-abc123",
    "status": "in_progress",
    "currentPhase": "developer",
    "phases": {
      "architect": { "status": "completed" },
      "developer": { "status": "in_progress" },
      "deployer": { "status": "pending" }
    },
    "result": {
      "mvpUrl": "https://...",  // Only when completed
      "localPath": "..."
    },
    "logs": [
      { "timestamp": "...", "message": "Started architect phase" }
    ]
  }
}
```

---

### Admin List Chat Sessions

**Request:**
```json
{
  "action": "admin-chats",
  "password": "aiproductstudio2026",
  "source": "all",  // "all", "landing", or "apply"
  "limit": 50
}
```

**Response:**
```json
{
  "success": true,
  "sessions": [
    {
      "sessionId": "sess-123",
      "source": "apply",
      "startedAt": "2026-01-02T10:00:00Z",
      "lastActivity": "2026-01-02T10:15:00Z",
      "status": "converted",
      "visitorInfo": {
        "name": "John Doe",
        "email": "john@example.com"
      },
      "metadata": {
        "totalMessages": 10,
        "convertedToApplication": "applications/..."
      },
      "messages": [ ... ]
    }
  ]
}
```

---

### Admin Get Chat Session Detail

**Request:**
```json
{
  "action": "admin-chat-detail",
  "password": "aiproductstudio2026",
  "sessionId": "sess-123",
  "source": "apply"  // Optional
}
```

**Response:**
```json
{
  "success": true,
  "session": {
    "sessionId": "sess-123",
    "source": "apply",
    "messages": [
      { "role": "user", "content": "...", "timestamp": "..." },
      { "role": "assistant", "content": "...", "timestamp": "..." }
    ],
    ...
  }
}
```

---

### Admin List Client Profiles

**Request:**
```json
{
  "action": "admin-clients",
  "password": "aiproductstudio2026",
  "limit": 50
}
```

**Response:**
```json
{
  "success": true,
  "clients": [
    {
      "clientId": "client-john-example-com",
      "name": "John Doe",
      "email": "john@example.com",
      "phone": "+1234567890",
      "status": "delivered",
      "chatSessions": ["sess-123"],
      "applications": ["applications/..."],
      "builds": ["job-123"],
      "timeline": [
        { "event": "profile_created", "timestamp": "..." },
        { "event": "application_submitted", "timestamp": "..." },
        { "event": "mvp_delivered", "timestamp": "...", "url": "..." }
      ]
    }
  ]
}
```

---

### Admin Get Client Detail

**Request:**
```json
{
  "action": "admin-client-detail",
  "password": "aiproductstudio2026",
  "clientId": "client-john-example-com"
}
```

**Response:**
```json
{
  "success": true,
  "client": {
    "clientId": "client-john-example-com",
    "name": "John Doe",
    ...
  }
}
```

---

### Admin List Build History

**Request:**
```json
{
  "action": "admin-builds",
  "password": "aiproductstudio2026",
  "limit": 50
}
```

**Response:**
```json
{
  "success": true,
  "builds": [
    {
      "buildId": "job-1234567890-abc123",
      "clientId": "client-john",
      "status": "completed",
      "client": {
        "name": "John Doe",
        "email": "john@example.com"
      },
      "business": {
        "idea": "An AI-powered..."
      },
      "timestamps": {
        "created": "...",
        "started": "...",
        "completed": "..."
      },
      "mvpUrl": "https://...",
      "filesCreated": ["index.html", "js/main.js", ...]
    }
  ]
}
```

---

### Admin Get Build Detail

**Request:**
```json
{
  "action": "admin-build-detail",
  "password": "aiproductstudio2026",
  "buildId": "job-1234567890-abc123"
}
```

**Response:**
```json
{
  "success": true,
  "build": {
    "buildId": "job-1234567890-abc123",
    "status": "completed",
    "mvpUrl": "https://...",
    "filesCreated": [...],
    "agentLog": {
      "totalEntries": 150,
      "entries": [
        { "timestamp": "...", "phase": "architect", "type": "output", "content": "..." },
        { "timestamp": "...", "phase": "developer", "type": "action", "content": "..." }
      ]
    }
  }
}
```

---

## Error Responses

All endpoints return errors in this format:

```json
{
  "success": false,
  "error": "Error message"
}
```

Common HTTP status codes:
- `400` - Bad request (missing parameters)
- `401` - Unauthorized (wrong password)
- `404` - Not found
- `500` - Server error

---

## Rate Limits

- Lambda: No explicit rate limit (AWS default)
- Claude API: Depends on Anthropic plan
- Recommended: Max 10 requests/second per client

---

*Last Updated: January 2, 2026*
