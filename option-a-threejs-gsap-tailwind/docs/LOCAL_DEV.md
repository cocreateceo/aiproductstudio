# Local Development Guide

## Overview

The local development environment mirrors the AWS production setup:
- Express server replaces Lambda
- Same S3 bucket is used (real AWS)
- Local worker replaces EC2 worker
- MVP builds stored locally

---

## Prerequisites

1. **Node.js 18+**
2. **AWS CLI** configured with `sunwaretech` profile
3. **Claude Code CLI** (optional, for full worker)
4. **Anthropic API Key**

---

## Quick Start

### 1. Install Dependencies

```bash
cd local-dev
npm install
```

### 2. Configure Environment

Create/edit `.env` file:

```bash
# local-dev/.env
ANTHROPIC_API_KEY=sk-ant-api03-...
AWS_REGION=ap-south-1
S3_BUCKET=ai-product-studio-applications
SKIP_EMAIL=true
LOCAL_MODE=true
POLL_INTERVAL=10000
AWS_PROFILE=sunwaretech
```

### 3. Start the Server

```bash
npm start
```

Output:
```
🚀 AI Product Studio - Local Development Server
================================================
   Site:    http://localhost:3000/
   Apply:   http://localhost:3000/apply.html
   Admin:   http://localhost:3000/admin.html
   API:     http://localhost:3000/api/chat
   Builds:  http://localhost:3000/builds/
```

### 4. Start the Worker (Optional)

In a new terminal:

```bash
npm run worker
```

Output:
```
🏭 AI Product Studio - Local Worker
====================================
   Polling S3: ai-product-studio-applications/jobs/
   Builds: /path/to/mvp-builder/builds/

⏳ Polling for jobs... (every 10s)
```

---

## Testing the Full Flow

### Step 1: Submit an Application

1. Open http://localhost:3000/apply.html
2. Chat with the AI assistant
3. Provide your info and business idea
4. Submit the form

### Step 2: Review in Admin Portal

1. Open http://localhost:3000/admin.html
2. Login with password: `aiproductstudio2026`
3. Find your application in the list
4. Click to view details

### Step 3: Approve the Application

1. Click **Approve** button
2. Application status changes to "approved"
3. Build job is created in S3

### Step 4: Watch the Build

1. If worker is running, it will pick up the job
2. Progress updates appear in admin portal
3. View the "Builds" tab for status

### Step 5: View the MVP

When build completes:
- MVP URL shown in admin portal
- Click "View MVP" to open
- Local URL: `http://localhost:3000/builds/{name}/output/index.html`

---

## Project Structure

```
local-dev/
├── server.js       # Express server (mirrors Lambda)
├── worker.js       # Local MVP builder (mirrors EC2)
├── package.json    # Dependencies
├── .env            # Configuration (not committed)
└── README.md       # Local dev documentation

../site/            # Frontend files
├── index.html      # Landing page
├── apply.html      # Application form
└── admin.html      # Admin portal

../mvp-builder/     # MVP builder files
├── builds/         # Generated MVPs (local)
└── skills/         # Claude Code skills
```

---

## API Auto-Detection

Frontend files automatically detect local vs production:

```javascript
// In index.html, apply.html, admin.html
const isLocal = window.location.hostname === 'localhost'
             || window.location.hostname === '127.0.0.1';

const API_URL = isLocal
  ? 'http://localhost:3000/api/chat'
  : 'https://bx0ywfkona.execute-api.ap-south-1.amazonaws.com/prod/chat';
```

---

## Available Endpoints (Local)

| Endpoint | Description |
|----------|-------------|
| `GET /` | Landing page |
| `GET /apply.html` | Application form |
| `GET /admin.html` | Admin portal |
| `GET /builds/*` | Generated MVPs |
| `POST /api/chat` | All API actions |
| `GET /api/health` | Health check |

---

## Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `ANTHROPIC_API_KEY` | Claude API key | Required |
| `AWS_REGION` | AWS region | ap-south-1 |
| `S3_BUCKET` | S3 bucket name | ai-product-studio-applications |
| `SKIP_EMAIL` | Skip email notifications | true |
| `LOCAL_MODE` | Enable local mode | true |
| `POLL_INTERVAL` | Worker poll interval (ms) | 10000 |
| `PORT` | Server port | 3000 |

---

## Differences from Production

| Aspect | Local | Production |
|--------|-------|------------|
| API Server | Express (localhost:3000) | Lambda + API Gateway |
| Worker | Node.js process | EC2 instance |
| MVP Storage | `../mvp-builder/builds/` | S3 + CloudFront |
| MVP URL | `localhost:3000/builds/...` | CloudFront URL |
| Email | Skipped | AWS SES |
| Chat/Apps | Real S3 | Real S3 |

---

## Debugging

### Server Logs

Server logs appear in terminal:
```
📋 Form submission detected
📁 Form saved to S3: applications/...
💬 Chat session saved: chats/apply/sess-...
👤 Client profile updated: client-...
```

### Worker Logs

Worker logs appear in terminal:
```
📋 Found 1 pending job(s)
📦 Processing job: job-1234567890-abc123
   Client: John Doe
   Idea: An AI-powered...
   Running Claude Code...
   ✅ MVP generated successfully!
   Saved build metadata to S3
```

### S3 Contents

Check S3 directly:
```bash
# List all prefixes
aws s3 ls s3://ai-product-studio-applications/ --profile sunwaretech

# List specific prefix
aws s3 ls s3://ai-product-studio-applications/chats/ --recursive --profile sunwaretech

# Download a file to inspect
aws s3 cp s3://ai-product-studio-applications/clients/client-xxx.json . --profile sunwaretech
```

---

## Common Issues

### "ANTHROPIC_API_KEY not set"

Add your API key to `.env`:
```
ANTHROPIC_API_KEY=sk-ant-api03-...
```

### "S3 access denied"

Check AWS credentials:
```bash
aws sts get-caller-identity --profile sunwaretech
```

### "Worker not picking up jobs"

1. Check worker is running
2. Verify S3 `jobs/` folder has pending jobs
3. Check job was created after approval

### "CORS error"

Server has CORS enabled. If issues persist:
```javascript
// server.js already has:
app.use(cors());
```

### "Port 3000 in use"

Change port in `.env`:
```
PORT=3001
```

---

## Testing Without Worker

You can test chat and applications without the worker:

1. Start only the server (`npm start`)
2. Chat and submit applications work normally
3. Approvals create jobs but won't be processed
4. Jobs remain in S3 `jobs/` folder

To process manually later:
```bash
npm run worker  # Start worker anytime
```

---

## Hot Reload

The server doesn't have hot reload. Restart after changes:

```bash
# Ctrl+C to stop
npm start  # Restart
```

For active development, use `nodemon`:
```bash
npm install -D nodemon
npx nodemon server.js
```

---

*Last Updated: January 2, 2026*
