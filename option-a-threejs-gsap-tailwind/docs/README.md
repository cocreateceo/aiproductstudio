# AI Product Studio - Complete Documentation

## System Overview

AI Product Studio is an automated MVP (Minimum Viable Product) building platform that uses Claude AI to transform business ideas into deployed web applications.

**Live URL:** https://dtvq5afmkjebb.cloudfront.net (Production)
**Admin Portal:** https://dtvq5afmkjebb.cloudfront.net/admin.html
**Local Dev:** http://localhost:5000

---

## Documentation Index

| Document | Description |
|----------|-------------|
| [Architecture](./ARCHITECTURE.md) | System components and data flow |
| [Storage Strategy](./STORAGE.md) | EC2 vs S3 storage split |
| [API Reference](./API.md) | All Lambda/Server endpoints |
| [Data Models](./DATA_MODELS.md) | JSON schemas for all data types |
| [Local Development](./LOCAL_DEV.md) | Running the system locally |
| [Deployment](./DEPLOYMENT.md) | AWS deployment procedures |

---

## Quick Start

### Local Development

```bash
# Terminal 1 - Start Server
cd local-dev
npm install
node server.js
# Server at http://localhost:5000
# WebSocket at ws://localhost:5001

# Terminal 2 - Start Worker (MVP Builder)
cd local-dev
node worker.js
# Polls S3 for jobs, builds MVPs
```

### Test Full Flow

1. **Submit Application:** http://localhost:5000/apply.html
2. **Admin Portal:** http://localhost:5000/admin.html (password: `aiproductstudio2026`)
3. **Approve** an application
4. **Watch** build progress in admin portal
5. **View MVP** when complete

---

## System Components

```
+------------------+     +------------------+     +------------------+
|   Landing Page   |---->|   Apply Page     |---->|   Admin Portal   |
|   (index.html)   |     |   (apply.html)   |     |   (admin.html)   |
+------------------+     +------------------+     +--------+---------+
                                                          |
                                                   APPROVE |
                                                          v
+------------------+     +------------------+     +--------+---------+
|   CloudFront     |<----|   S3 Bucket      |<----|     Lambda       |
|   (MVP Hosting)  |     |   (Storage)      |     | (Chat/Admin API) |
+------------------+     +--------+---------+     +------------------+
                                  ^
                                  |
                         +--------+---------+
                         |   EC2 Worker     |
                         | (MVP Builder)    |
                         | Claude Code CLI  |
                         +------------------+
```

---

## Tech Stack

| Component | Technology |
|-----------|------------|
| Frontend | HTML, Tailwind CSS, Three.js, GSAP |
| Backend API | AWS Lambda (Node.js 20.x) |
| Local Server | Express.js |
| MVP Builder | Claude Code CLI on EC2 |
| AI | Claude claude-sonnet-4-20250514 (Anthropic) |
| Storage | AWS S3 + EC2 Local (50GB) |
| CDN | AWS CloudFront |
| Email | AWS SES |

---

## Key Features

### 1. AI-Powered Chat
- Landing page and apply page have AI chat
- Collects visitor contact info
- Helps fill application form
- All conversations saved to S3
- Responsive sidebar with close button

### 2. Unified Theme System
- 4 themes: Dark, Midnight, Dusk, Light
- Persists across pages via localStorage
- Theme selector in admin portal header
- CSS variables for consistent styling

### 3. Application Management
- Form submissions saved to S3
- Admin portal for review
- Approve/Reject workflow
- Email notifications

### 4. Automated MVP Building
- Approved applications trigger build jobs
- EC2 worker picks up jobs
- Claude Code CLI builds MVP autonomously
- Three phases: Architect -> Developer -> Deployer

### 5. Progress Tracking
- Real-time build progress in admin
- Phase status (pending/in_progress/completed/failed)
- MVP URL displayed when ready
- View build logs with filtering

### 6. History & Audit
- All chat sessions preserved
- Client profiles with timeline
- Build history with agent logs
- Complete audit trail

---

## AWS Resources

| Resource | Name/ID | Region | Purpose |
|----------|---------|--------|---------|
| Lambda | ai-product-studio-chat | ap-south-1 | API endpoints |
| API Gateway | bx0ywfkona | ap-south-1 | REST API |
| CloudFront | E85ZBHF63VW9W | Global | Main site CDN (HTTPS) |
| S3 (Site) | ai-product-studio-sunware | us-east-1 | Static hosting |
| S3 (Data) | ai-product-studio-applications | ap-south-1 | Apps, chats, builds |
| EC2 | i-08322e5fcb32f56d4 | ap-south-1 | MVP builder worker |
| SES | - | us-east-1 | Email notifications |

---

## Folder Structure

```
option-a-threejs-gsap-tailwind/
├── site/                    # Frontend files (deployed to S3/CloudFront)
│   ├── index.html          # Landing page with chat
│   ├── apply.html          # Application form with chat
│   ├── admin.html          # Admin portal with theme selector
│   ├── favicon.svg         # Site favicon
│   ├── js/
│   │   ├── chat-widget.js  # Chat widget logic
│   │   ├── config.js       # API URL configuration
│   │   └── theme.js        # Unified theme system (4 themes)
│   └── css/
│       └── chat-widget.css # Chat widget responsive styles
│
├── chat-backend/           # Lambda function code
│   ├── index.mjs           # All API endpoints
│   └── node_modules/       # Dependencies (include in deploy zip)
│
├── local-dev/              # Local development environment
│   ├── server.js           # Express server (mirrors Lambda)
│   ├── worker.js           # Local MVP builder
│   ├── mvp-agent.js        # Claude Agent SDK implementation
│   └── .env                # Configuration
│
├── mvp-builder/            # MVP builder artifacts
│   ├── builds/             # Generated MVPs (local)
│   └── skills/             # Claude Code skills
│
└── docs/                   # Documentation (you are here)
    ├── README.md           # This file
    ├── ARCHITECTURE.md     # System architecture
    ├── STORAGE.md          # Storage strategy
    ├── API.md              # API reference
    ├── DATA_MODELS.md      # Data schemas
    ├── LOCAL_DEV.md        # Local development
    └── DEPLOYMENT.md       # AWS deployment
```

---

## Environment Variables

### Lambda
```
ANTHROPIC_API_KEY=sk-ant-...
OPENAI_API_KEY=sk-proj-...  (backup)
NOTIFICATION_EMAIL=gopi@sunwaretechnologies.com
```

### Local Development (.env)
```
ANTHROPIC_API_KEY=sk-ant-...
AWS_REGION=ap-south-1
S3_BUCKET=ai-product-studio-applications
SKIP_EMAIL=true
LOCAL_MODE=true
POLL_INTERVAL=10000
```

### EC2 Worker
```
ANTHROPIC_API_KEY=sk-ant-...
AWS_REGION=ap-south-1
S3_BUCKET=ai-product-studio-applications
```

---

## Admin Portal Access

**URL:** `/admin.html`
**Password:** `aiproductstudio2026`

### Features:
- **Applications Tab:** View/approve/reject applications
- **Chat History Tab:** View all user conversations
- **Clients Tab:** View client profiles with timeline
- **Builds Tab:** View build history with agent logs

---

## Contact

- **Team:** Sunware Technologies
- **Email:** gopi@sunwaretechnologies.com

---

*Last Updated: January 3, 2026*
