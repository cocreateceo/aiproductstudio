# System Architecture

## Overview

AI Product Studio uses a serverless-first architecture with an EC2 instance for compute-intensive MVP building tasks.

---

## Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                              USER INTERFACE LAYER                                │
├─────────────────────────────────────────────────────────────────────────────────┤
│                                                                                  │
│  ┌────────────────┐     ┌────────────────┐     ┌────────────────┐              │
│  │  Landing Page  │     │   Apply Page   │     │  Admin Portal  │              │
│  │  (index.html)  │     │  (apply.html)  │     │  (admin.html)  │              │
│  │                │     │                │     │                │              │
│  │  - AI Chat     │     │  - AI Chat     │     │  - Applications│              │
│  │  - Info        │     │  - Form Fill   │     │  - Chat History│              │
│  │  - CTA         │     │  - Submit      │     │  - Clients     │              │
│  └───────┬────────┘     └───────┬────────┘     │  - Builds      │              │
│          │                      │              └───────┬────────┘              │
│          │                      │                      │                        │
└──────────┼──────────────────────┼──────────────────────┼────────────────────────┘
           │                      │                      │
           │    HTTPS/REST API    │                      │
           └──────────────────────┼──────────────────────┘
                                  │
┌─────────────────────────────────┼───────────────────────────────────────────────┐
│                          API GATEWAY + LAMBDA                                    │
├─────────────────────────────────┼───────────────────────────────────────────────┤
│                                 ▼                                                │
│  ┌──────────────────────────────────────────────────────────────────────────┐   │
│  │                    Lambda: ai-product-studio-chat                         │   │
│  │                                                                           │   │
│  │  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐     │   │
│  │  │    Chat     │  │   Admin     │  │   History   │  │   Build     │     │   │
│  │  │  Endpoints  │  │  Endpoints  │  │  Endpoints  │  │   Trigger   │     │   │
│  │  │             │  │             │  │             │  │             │     │   │
│  │  │ - Chat msg  │  │ - Login     │  │ - Chats     │  │ - Create    │     │   │
│  │  │ - Extract   │  │ - List apps │  │ - Clients   │  │   job in S3 │     │   │
│  │  │   contact   │  │ - Update    │  │ - Builds    │  │ - Update    │     │   │
│  │  │ - Save form │  │   status    │  │ - Details   │  │   progress  │     │   │
│  │  └─────────────┘  └─────────────┘  └─────────────┘  └──────┬──────┘     │   │
│  └───────────────────────────────────────────────────────────┼──────────────┘   │
│                                                               │                  │
└───────────────────────────────────────────────────────────────┼──────────────────┘
                                                                │
                        Creates job file in S3                  │
                                                                ▼
┌───────────────────────────────────────────────────────────────────────────────────┐
│                              STORAGE LAYER (S3)                                    │
├───────────────────────────────────────────────────────────────────────────────────┤
│                                                                                    │
│  S3 Bucket: ai-product-studio-applications                                        │
│                                                                                    │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐              │
│  │   chats/    │  │applications/│  │   clients/  │  │    jobs/    │              │
│  │             │  │             │  │             │  │             │◄─── Lambda   │
│  │  User chat  │  │   Form      │  │   Client    │  │  Build job  │     writes   │
│  │  sessions   │  │   submits   │  │   profiles  │  │   queue     │              │
│  └─────────────┘  └─────────────┘  └─────────────┘  └──────┬──────┘              │
│                                                             │                     │
│  ┌─────────────┐  ┌─────────────┐                          │ EC2 polls           │
│  │  progress/  │  │   builds/   │                          │                     │
│  │             │  │             │                          ▼                     │
│  │  Real-time  │  │   Build     │◄────────────────────────────                   │
│  │  status     │  │   metadata  │    EC2 writes metadata                         │
│  └─────────────┘  └─────────────┘                                                │
│                                                                                    │
│  ┌─────────────┐                                                                  │
│  │    mvps/    │                                                                  │
│  │             │                                                                  │
│  │  Deployed   │◄──── EC2 uploads final MVP                                      │
│  │   MVPs      │                                                                  │
│  └─────────────┘                                                                  │
│                                                                                    │
└───────────────────────────────────────────────────────────────────────────────────┘
                                        │
                                        │ EC2 polls jobs/
                                        ▼
┌───────────────────────────────────────────────────────────────────────────────────┐
│                              COMPUTE LAYER (EC2)                                   │
├───────────────────────────────────────────────────────────────────────────────────┤
│                                                                                    │
│  EC2 Instance: i-08322e5fcb32f56d4 (t3.large, 50GB)                              │
│  IP: 65.1.106.211                                                                 │
│                                                                                    │
│  ┌──────────────────────────────────────────────────────────────────────────┐    │
│  │                         Worker Process (worker.js)                        │    │
│  │                                                                           │    │
│  │   1. Poll S3 jobs/ folder every 30 seconds                               │    │
│  │   2. Download job file                                                    │    │
│  │   3. Run Claude Code CLI                                                  │    │
│  │   4. Update progress in S3                                               │    │
│  │   5. Upload MVP to S3 mvps/                                              │    │
│  │   6. Move job to processed/                                              │    │
│  │                                                                           │    │
│  └──────────────────────────────────────────────────────────────────────────┘    │
│                                        │                                          │
│                                        ▼                                          │
│  ┌──────────────────────────────────────────────────────────────────────────┐    │
│  │                         Claude Code CLI                                   │    │
│  │                                                                           │    │
│  │   ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐         │    │
│  │   │   ARCHITECT     │  │   DEVELOPER     │  │    DEPLOYER     │         │    │
│  │   │   Sub-Agent     │──▶│   Sub-Agent     │──▶│   Sub-Agent     │         │    │
│  │   │                 │  │                 │  │                 │         │    │
│  │   │ - Analyze req   │  │ - Generate HTML │  │ - Upload to S3  │         │    │
│  │   │ - Design struct │  │ - Three.js code │  │ - CloudFront    │         │    │
│  │   │ - Plan 3D/anim  │  │ - GSAP anims    │  │ - Return URL    │         │    │
│  │   └─────────────────┘  └─────────────────┘  └─────────────────┘         │    │
│  └──────────────────────────────────────────────────────────────────────────┘    │
│                                                                                    │
│  Local Storage (50GB):                                                            │
│  ┌─────────────────────────────────────────────────────────────────────────┐     │
│  │  /home/ubuntu/ai-product-studio-worker/                                  │     │
│  │  ├── builds/           # Active builds (working directory)               │     │
│  │  ├── completed/        # Archived builds (history)                       │     │
│  │  └── logs/             # Detailed agent logs                             │     │
│  └─────────────────────────────────────────────────────────────────────────┘     │
│                                                                                    │
└───────────────────────────────────────────────────────────────────────────────────┘
                                        │
                                        │ Final MVP uploaded
                                        ▼
┌───────────────────────────────────────────────────────────────────────────────────┐
│                              DELIVERY LAYER (CloudFront)                           │
├───────────────────────────────────────────────────────────────────────────────────┤
│                                                                                    │
│  ┌──────────────────────────────────────────────────────────────────────────┐    │
│  │                      CloudFront Distribution                              │    │
│  │                                                                           │    │
│  │   Origin: S3 mvps/{clientId}/                                            │    │
│  │   URL: https://d{id}.cloudfront.net                                      │    │
│  │                                                                           │    │
│  │   Features:                                                               │    │
│  │   - HTTPS (SSL/TLS)                                                      │    │
│  │   - Global edge caching                                                  │    │
│  │   - Gzip compression                                                     │    │
│  │                                                                           │    │
│  └──────────────────────────────────────────────────────────────────────────┘    │
│                                                                                    │
└───────────────────────────────────────────────────────────────────────────────────┘
```

---

## Component Details

### 1. Frontend (Static Sites)

| File | Purpose | Key Features |
|------|---------|--------------|
| index.html | Landing page | AI chat, company info, CTA |
| apply.html | Application form | AI-assisted form filling |
| admin.html | Admin portal | 4 tabs: Apps, Chats, Clients, Builds |

**Auto-Detection:** Frontend automatically detects local vs production:
```javascript
const isLocal = window.location.hostname === 'localhost';
const API_URL = isLocal ? 'http://localhost:3000/api/chat' : 'https://...';
```

### 2. Lambda Function

**Name:** `ai-product-studio-chat`
**Runtime:** Node.js 20.x
**Memory:** 256 MB
**Timeout:** 30 seconds

**Endpoints:**
- Chat (AI conversation)
- Admin login/list/update
- History (chats, clients, builds)
- Build progress

### 3. S3 Storage

**Bucket:** `ai-product-studio-applications`
**Region:** ap-south-1

**Prefixes:**
- `chats/` - User conversations
- `applications/` - Form submissions
- `clients/` - Client profiles
- `jobs/` - Build queue
- `progress/` - Real-time status
- `builds/` - Build metadata
- `mvps/` - Final deployed MVPs

### 4. EC2 Worker

**Instance:** t3.large
**Storage:** 50GB gp3
**OS:** Ubuntu 22.04

**Components:**
- Node.js 20.x
- Claude Code CLI
- AWS CLI v2

**Process:**
1. Worker polls `jobs/` folder
2. Downloads job JSON
3. Runs Claude Code with skills
4. Updates `progress/`
5. Uploads MVP to `mvps/`
6. Moves job to `processed/`

### 5. CloudFront

**Purpose:** Serve final MVPs globally with HTTPS

**Configuration:**
- Origin: S3 bucket (mvps/ prefix)
- Price Class: 100 (US, Canada, Europe)
- TTL: 24 hours default
- Compression: Enabled

---

## Data Flow

### Chat Flow
```
User types message
    │
    ▼
Frontend sends to API
    │
    ▼
Lambda extracts contact info (LLM)
    │
    ▼
Lambda calls Claude for response
    │
    ▼
Lambda saves chat session to S3
    │
    ▼
Response returned to user
```

### Application Flow
```
User submits form
    │
    ▼
Lambda saves to S3 applications/
    │
    ▼
Lambda sends email notification
    │
    ▼
Lambda updates chat session (converted)
    │
    ▼
Lambda creates/updates client profile
```

### Build Flow
```
Admin clicks Approve
    │
    ▼
Lambda creates job in S3 jobs/
    │
    ▼
Lambda creates progress in S3 progress/
    │
    ▼
Lambda updates application with jobId
    │
    ▼
EC2 worker picks up job
    │
    ▼
Claude Code builds MVP (3 phases)
    │
    ▼
EC2 updates progress in S3
    │
    ▼
EC2 uploads MVP to S3 mvps/
    │
    ▼
EC2 saves build metadata to S3 builds/
    │
    ▼
EC2 updates client profile (delivered)
    │
    ▼
Admin sees MVP URL in portal
```

---

## Scaling Considerations

### Current Limits
- Lambda: 1000 concurrent executions
- EC2: Single instance (serial processing)
- S3: Virtually unlimited

### Future Scaling
1. **Multiple EC2 instances** - Parallel builds
2. **SQS queue** - Replace S3 polling
3. **Auto-scaling group** - Demand-based
4. **Spot instances** - Cost reduction

---

## Security

### Network
- Lambda in VPC (optional)
- EC2 security group: SSH from admin IP only
- S3: Block public access (except CloudFront OAI)

### Authentication
- Admin portal: Password-protected
- API: No auth (public chat) / Password (admin)
- AWS: IAM roles for Lambda and EC2

### Data
- S3: Server-side encryption (SSE-S3)
- API keys: Environment variables
- No PII in logs

---

*Last Updated: January 2, 2026*
