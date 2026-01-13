# Storage Strategy

## Overview

AI Product Studio uses a hybrid storage approach:
- **S3** - Shared data accessible by Lambda and Admin Portal
- **EC2 (50GB)** - Local storage for build process and detailed history

---

## Why Two Storage Locations?

| Requirement | S3 | EC2 Local |
|-------------|----|-----------|
| Lambda access | ✅ Yes | ❌ No |
| Admin portal access | ✅ Yes (via Lambda) | ❌ No |
| Fast build I/O | ❌ Slower | ✅ Fast |
| CloudFront serving | ✅ Yes | ❌ No |
| Detailed logs (GB) | ❌ Expensive | ✅ Cheap |
| Persistence | ✅ Durable | ⚠️ Instance-bound |

---

## Storage Split

### S3 Bucket: `ai-product-studio-applications`

**Purpose:** Shared data that needs to be accessed by Lambda, Admin Portal, and EC2

```
ai-product-studio-applications/
│
├── chats/                      # User chat conversations
│   ├── landing/                # Chats from index.html
│   │   └── sess-{timestamp}-{id}.json
│   └── apply/                  # Chats from apply.html
│       └── sess-{timestamp}-{id}.json
│
├── applications/               # Form submissions
│   └── {email}/{date}/{timestamp}.json
│
├── clients/                    # Client profiles
│   └── client-{email-or-name}.json
│
├── jobs/                       # Build job queue (pending)
│   └── job-{timestamp}-{id}.json
│
├── processed/                  # Completed jobs (moved from jobs/)
│   └── job-{timestamp}-{id}.json
│
├── progress/                   # Real-time build progress
│   └── {jobId}.json
│
├── builds/                     # Build metadata (summary only)
│   └── {jobId}/
│       └── metadata.json       # Status, timestamps, MVP URL
│
└── mvps/                       # Final deployed MVPs
    └── {clientId}/
        ├── index.html
        ├── js/
        ├── css/
        └── assets/
```

### EC2 Local Storage (50GB)

**Purpose:** Build workspace and detailed history (not shared)

```
/home/ubuntu/ai-product-studio-worker/
│
├── builds/                     # Active builds (working directory)
│   └── {client-name}-{jobId}/
│       ├── input.json          # Job input from S3
│       ├── architecture.json   # Architect output
│       ├── output/             # Generated MVP files
│       │   ├── index.html
│       │   ├── js/
│       │   ├── css/
│       │   └── assets/
│       └── deployed.json       # Deployment info
│
├── completed/                  # Archived completed builds
│   └── {client-name}-{jobId}/  # Full build artifacts
│       ├── input.json
│       ├── architecture.json
│       ├── output/
│       ├── agent-log.json      # Full Claude output (can be large)
│       └── deployed.json
│
├── failed/                     # Failed builds for debugging
│   └── {client-name}-{jobId}/
│
└── logs/                       # Worker process logs
    ├── worker.log              # Main worker log
    └── {jobId}.log             # Per-job logs
```

---

## Data Flow by Storage

### User Creates Request (S3 Only)

```
1. User chats on landing/apply page
   └── Lambda saves to: S3 chats/{source}/{sessionId}.json

2. User submits application form
   └── Lambda saves to: S3 applications/{email}/{date}/{id}.json
   └── Lambda updates: S3 chats/{sessionId}.json (status: converted)
   └── Lambda creates: S3 clients/{clientId}.json

3. Admin views in portal
   └── Lambda reads from: S3 chats/, applications/, clients/
```

### Admin Approves (S3 + EC2)

```
4. Admin clicks "Approve"
   └── Lambda creates: S3 jobs/{jobId}.json
   └── Lambda creates: S3 progress/{jobId}.json
   └── Lambda updates: S3 applications/{...}.json (add jobId)

5. EC2 worker polls S3 jobs/
   └── EC2 downloads: S3 jobs/{jobId}.json
   └── EC2 creates: LOCAL builds/{name}-{jobId}/input.json

6. EC2 runs Claude Code
   └── EC2 writes to: LOCAL builds/{name}-{jobId}/output/
   └── EC2 updates: S3 progress/{jobId}.json (real-time status)

7. Build completes
   └── EC2 uploads: S3 mvps/{clientId}/ (final MVP)
   └── EC2 writes: S3 builds/{jobId}/metadata.json (summary)
   └── EC2 updates: S3 progress/{jobId}.json (completed, MVP URL)
   └── EC2 updates: S3 clients/{clientId}.json (status: delivered)
   └── EC2 moves: LOCAL builds/ → LOCAL completed/
   └── EC2 moves: S3 jobs/{jobId}.json → S3 processed/{jobId}.json
```

### Admin Views Build History

```
8. Admin views "Builds" tab
   └── Lambda reads: S3 builds/{jobId}/metadata.json
   └── (Detailed agent logs stay on EC2, not transferred)
```

---

## What Goes Where (Decision Guide)

### Store in S3 When:
- ✅ Lambda needs to read/write it
- ✅ Admin portal needs to display it
- ✅ Data is relatively small (< 1MB per file)
- ✅ CloudFront needs to serve it
- ✅ Data must persist if EC2 is replaced

### Store on EC2 When:
- ✅ Only the worker process needs it
- ✅ Data is large (agent logs can be 10MB+)
- ✅ Fast I/O needed during build
- ✅ Temporary working files
- ✅ Cost optimization (S3 storage is more expensive)

---

## Specific Data Types

| Data Type | Location | Reason |
|-----------|----------|--------|
| Chat sessions | S3 | Lambda writes, Admin reads |
| Applications | S3 | Lambda writes, Admin reads |
| Client profiles | S3 | Lambda writes, Admin reads |
| Job queue | S3 | Lambda writes, EC2 reads |
| Build progress | S3 | EC2 writes, Admin reads (polling) |
| Build metadata | S3 | EC2 writes summary, Admin reads |
| **Agent logs (full)** | **EC2** | Large, only needed for debugging |
| **Build artifacts** | **EC2** | Working directory during build |
| **Build history** | **EC2** | Archived completed builds |
| Final MVP | S3 | CloudFront serves to end users |

---

## Size Estimates

### S3 Storage (per client)
```
Chat session:        ~10 KB
Application:         ~5 KB
Client profile:      ~2 KB
Job file:           ~3 KB
Progress file:       ~2 KB
Build metadata:      ~3 KB
Final MVP:          ~500 KB - 2 MB
─────────────────────────────
Total per client:   ~600 KB - 2 MB
```

### EC2 Storage (per build)
```
Input files:         ~10 KB
Build output:        ~500 KB - 2 MB
Agent logs:          ~5 MB - 20 MB (varies by complexity)
─────────────────────────────
Total per build:     ~6 MB - 25 MB

With 50GB disk:      ~2,000 - 8,000 builds stored
```

---

## Cleanup & Retention

### S3 Lifecycle Policies
```
jobs/       → Move to Glacier after 30 days
processed/  → Delete after 90 days
progress/   → Delete after 30 days
builds/     → Keep indefinitely (metadata only)
mvps/       → Keep indefinitely
chats/      → Keep indefinitely (audit)
clients/    → Keep indefinitely
```

### EC2 Cleanup Script
```bash
# cleanup-builds.sh - Run weekly
# Keep last 100 completed builds, delete older
cd /home/ubuntu/ai-product-studio-worker/completed
ls -t | tail -n +101 | xargs rm -rf

# Delete failed builds older than 7 days
find /home/ubuntu/ai-product-studio-worker/failed -mtime +7 -delete

# Rotate logs
find /home/ubuntu/ai-product-studio-worker/logs -name "*.log" -mtime +30 -delete
```

---

## Cost Comparison

### S3 Pricing (ap-south-1)
```
Storage:     $0.023 per GB/month
PUT/POST:    $0.005 per 1,000 requests
GET:         $0.0004 per 1,000 requests
```

### EC2 EBS Pricing (ap-south-1)
```
gp3 50GB:    $4.00 per month (flat)
```

### Example: 100 Clients/Month
```
S3 Storage (200 MB MVPs):        $0.0046/month
S3 Storage (misc data 50 MB):    $0.00115/month
S3 Requests (~10,000):           $0.054/month
EC2 EBS (50GB):                  $4.00/month
─────────────────────────────────────────────
Total Storage:                   ~$4.06/month
```

**Conclusion:** Using EC2 for large files (agent logs) saves money compared to storing everything in S3.

---

## Backup Strategy

### S3 (Automatic)
- S3 provides 99.999999999% durability
- Enable versioning for critical prefixes
- Cross-region replication (optional, for DR)

### EC2 (Manual/Scheduled)
```bash
# Backup important builds to S3 (optional)
aws s3 sync /home/ubuntu/ai-product-studio-worker/completed/ \
  s3://ai-product-studio-applications/ec2-backup/ \
  --exclude "*.log"
```

---

## Local Development

In local development mode:
- S3 is still used (same bucket)
- EC2 local storage is replaced with `local-dev/../mvp-builder/builds/`
- Same logic, different paths

```
Local paths:
├── local-dev/
│   └── ../mvp-builder/builds/     # Equivalent to EC2 /builds/
│       └── {client-name}-{jobId}/
```

---

*Last Updated: January 2, 2026*
