# Local Development Environment

Full end-to-end testing of AI Product Studio locally before deploying to AWS.

## Architecture

```
LOCAL FLOW:

┌──────────────────────────────────────────────────────────────────────────┐
│  Browser (localhost:3000)                                                 │
│  ├── /              → Landing page with chat                             │
│  ├── /apply.html    → Partnership application form                       │
│  ├── /admin.html    → Admin portal (approve/reject)                      │
│  └── /builds/       → Generated MVP sites                                │
└─────────────────────────────┬────────────────────────────────────────────┘
                              │
                              ▼
┌──────────────────────────────────────────────────────────────────────────┐
│  Local Express Server (server.js)                                         │
│  ├── Serves static files from ../site/                                   │
│  ├── POST /api/chat → Same logic as Lambda                               │
│  └── Uses real S3 for storage                                            │
└─────────────────────────────┬────────────────────────────────────────────┘
                              │
                              ▼
┌──────────────────────────────────────────────────────────────────────────┐
│  AWS S3 (real bucket: ai-product-studio-applications)                     │
│  ├── applications/  → Form submissions                                   │
│  ├── jobs/          → Pending build jobs                                 │
│  └── progress/      → Job progress tracking                              │
└─────────────────────────────┬────────────────────────────────────────────┘
                              │
                              ▼
┌──────────────────────────────────────────────────────────────────────────┐
│  Local Worker (worker.js)                                                 │
│  ├── Polls S3 for jobs                                                   │
│  ├── Runs Claude Code CLI                                                │
│  └── Outputs MVP to ../mvp-builder/builds/                               │
└──────────────────────────────────────────────────────────────────────────┘
```

## Prerequisites

1. **Node.js 18+**
2. **Claude Code CLI**: `npm install -g @anthropic-ai/claude-code`
3. **AWS CLI configured** with access to S3 bucket

## Setup

```bash
cd local-dev

# Install dependencies
npm install

# Copy and edit .env (add your ANTHROPIC_API_KEY)
# .env file should already have the key from mvp-builder/.env
```

## Running

### Terminal 1: Start the Server

```bash
npm start
```

This starts:
- Web server at http://localhost:3000
- API endpoints at http://localhost:3000/api/*

### Terminal 2: Start the Worker

```bash
npm run worker
```

This:
- Polls S3 for approved applications
- Runs Claude Code to build MVPs
- Outputs to `../mvp-builder/builds/`

## Testing the Full Flow

### Step 1: Submit an Application

1. Open http://localhost:3000/apply.html
2. Chat with AI to fill the form
3. Submit the application

### Step 2: Approve in Admin

1. Open http://localhost:3000/admin.html
2. Login with password: `aiproductstudio2026`
3. Find the application
4. Click **Approve**

### Step 3: Watch the Worker

In Terminal 2 (worker), you'll see:
```
📋 Found 1 pending job(s)
📦 Processing job: job-1234567890-abc123
   Client: John Doe
   Running Claude Code...
   ✅ MVP generated successfully!
```

### Step 4: View the MVP

The MVP URL will be shown in:
- Worker output
- Admin portal (after refresh)
- Progress file in S3

Example: http://localhost:3000/builds/john-doe-1234567890/output/index.html

## Differences from AWS

| Aspect | Local | AWS |
|--------|-------|-----|
| Web Server | Express (localhost:3000) | S3 + CloudFront |
| API | Express endpoints | Lambda |
| Storage | Real S3 | Real S3 |
| Worker | Node.js process | EC2 instance |
| MVP Hosting | localhost:3000/builds/ | CloudFront |

## Troubleshooting

### "ANTHROPIC_API_KEY not set"
Edit `.env` and add your key.

### "Claude Code not found"
Install it: `npm install -g @anthropic-ai/claude-code`

### "S3 access denied"
Check AWS credentials: `aws sts get-caller-identity --profile sunwaretech`

### Worker not picking up jobs
1. Check S3 bucket has `jobs/` folder
2. Verify job was created after approving

## Files

```
local-dev/
├── server.js      # Express server (API + static files)
├── worker.js      # MVP builder worker
├── package.json   # Dependencies
├── .env           # Configuration (not committed)
└── README.md      # This file
```
