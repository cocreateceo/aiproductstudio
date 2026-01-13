# Deployment Guide

## Quick Reference (Copy-Paste Commands)

### Deploy Frontend to S3
```bash
cd "/mnt/c/Shri Hari Hari/Ubuntu/sunware-tech/aws-cost-analyzer/AI-Product-Studio/option-a-threejs-gsap-tailwind"

# Deploy HTML files
aws s3 cp site/admin.html s3://ai-product-studio-sunware/admin.html --profile sunwaretech --content-type "text/html"
aws s3 cp site/index.html s3://ai-product-studio-sunware/index.html --profile sunwaretech --content-type "text/html"
aws s3 cp site/apply.html s3://ai-product-studio-sunware/apply.html --profile sunwaretech --content-type "text/html"

# Deploy JS files
aws s3 cp site/js/chat-widget.js s3://ai-product-studio-sunware/js/chat-widget.js --profile sunwaretech --content-type "application/javascript"
aws s3 cp site/js/config.js s3://ai-product-studio-sunware/js/config.js --profile sunwaretech --content-type "application/javascript"
aws s3 cp site/js/theme.js s3://ai-product-studio-sunware/js/theme.js --profile sunwaretech --content-type "application/javascript"

# Deploy CSS files
aws s3 cp site/css/chat-widget.css s3://ai-product-studio-sunware/css/chat-widget.css --profile sunwaretech --content-type "text/css"

# Verify
aws s3 ls s3://ai-product-studio-sunware/ --profile sunwaretech

# Invalidate CloudFront cache (IMPORTANT after any S3 upload)
aws cloudfront create-invalidation --distribution-id E85ZBHF63VW9W --paths "/*" --profile sunwaretech
```

### Deploy Lambda Backend
```bash
cd "/mnt/c/Shri Hari Hari/Ubuntu/sunware-tech/aws-cost-analyzer/AI-Product-Studio/option-a-threejs-gsap-tailwind/chat-backend"

# Install dependencies (if node_modules missing or package.json changed)
npm install

# Create zip with dependencies and deploy
rm -f function.zip && zip -r function.zip index.mjs node_modules
aws lambda update-function-code \
  --function-name ai-product-studio-chat \
  --zip-file fileb://function.zip \
  --profile sunwaretech \
  --region ap-south-1
```

**IMPORTANT:** Lambda requires `node_modules` to be included in the zip. Don't deploy just `index.mjs`!

### Start Local Dev Server
```bash
cd "/mnt/c/Shri Hari Hari/Ubuntu/sunware-tech/aws-cost-analyzer/AI-Product-Studio/option-a-threejs-gsap-tailwind/local-dev"
node server.js
# Server runs on http://localhost:5000
# WebSocket on ws://localhost:5001
```

### Start Local Worker (MVP Builder)
```bash
cd "/mnt/c/Shri Hari Hari/Ubuntu/sunware-tech/aws-cost-analyzer/AI-Product-Studio/option-a-threejs-gsap-tailwind/local-dev"
node worker.js
# Polls S3 for jobs, builds MVPs locally
```

---

## AWS Resources Summary

| Resource | Name/ID | Region | Purpose |
|----------|---------|--------|---------|
| Lambda | `ai-product-studio-chat` | ap-south-1 | Chat API, Admin API |
| API Gateway | `bx0ywfkona` | ap-south-1 | REST API endpoint |
| **CloudFront** | `E85ZBHF63VW9W` | Global | HTTPS CDN for site |
| S3 (Site) | `ai-product-studio-sunware` | us-east-1 | Landing page hosting |
| S3 (Data) | `ai-product-studio-applications` | ap-south-1 | Apps, chats, builds |
| EC2 | `i-08322e5fcb32f56d4` (65.1.106.211) | ap-south-1 | MVP Builder Worker |
| SES | - | us-east-1 | Email notifications |

---

## URLs

### Production (HTTPS via CloudFront) - **USE THESE**
| Page | URL |
|------|-----|
| **Landing Page** | https://dtvq5afmkjebb.cloudfront.net |
| **Admin Portal** | https://dtvq5afmkjebb.cloudfront.net/admin.html |
| **Apply Page** | https://dtvq5afmkjebb.cloudfront.net/apply.html |
| **API Endpoint** | https://bx0ywfkona.execute-api.ap-south-1.amazonaws.com/prod/chat |

### Development / Legacy (HTTP - no microphone)
| Environment | URL |
|-------------|-----|
| S3 Direct (HTTP) | http://ai-product-studio-sunware.s3-website-us-east-1.amazonaws.com |
| Local Dev | http://localhost:5000 |

---

## Project Structure

```
option-a-threejs-gsap-tailwind/
├── site/                          # Frontend (deploy to S3)
│   ├── index.html                 # Landing page with chat widget
│   ├── apply.html                 # Partnership application form
│   ├── admin.html                 # Admin portal with theme selector
│   ├── favicon.svg                # Site favicon
│   ├── js/
│   │   ├── chat-widget.js         # Chat widget logic
│   │   ├── config.js              # API URL configuration
│   │   └── theme.js               # Unified theme system (4 themes)
│   └── css/
│       └── chat-widget.css        # Chat widget styles (responsive)
│
├── chat-backend/                  # Lambda function
│   ├── index.mjs                  # All API endpoints
│   └── package.json
│
├── local-dev/                     # Local development
│   ├── server.js                  # Express server (mirrors Lambda)
│   ├── worker.js                  # MVP builder worker
│   ├── mvp-agent.js               # Agent SDK implementation
│   └── .env                       # Local configuration
│
├── mvp-builder/                   # MVP builder assets
│   ├── .claude/agents/            # Sub-agent definitions
│   │   ├── architect.md
│   │   ├── developer.md
│   │   └── deployer.md
│   ├── skills/product-builder/    # Builder skill
│   ├── builds/                    # Local build outputs
│   └── test-job/                  # Test job data
│
└── docs/                          # Documentation
    ├── DEPLOYMENT.md              # This file
    ├── ARCHITECTURE.md            # System design
    ├── API.md                     # API reference
    └── DATA_MODELS.md             # Data schemas
```

---

## Configuration Files

### Local Dev `.env` (`local-dev/.env`)
```env
# API Keys
ANTHROPIC_API_KEY=sk-ant-api03-...

# AWS
AWS_PROFILE=sunwaretech
AWS_REGION=ap-south-1
SES_REGION=us-east-1
S3_BUCKET=ai-product-studio-applications

# Server
PORT=5000
WS_PORT=5001
POLL_INTERVAL=10000

# Security
ADMIN_PASSWORD=aiproductstudio2026

# Build Config
CLAUDE_MODEL=claude-sonnet-4-20250514
MAX_TOKENS=16384              # Increased from 8192 for large HTML
COMMAND_TIMEOUT=30000

# Options
NOTIFICATION_EMAIL=gopi@sunwaretechnologies.com
SKIP_EMAIL=true
LOCAL_MODE=true
DEBUG=false
```

### Frontend Config (`site/js/config.js`)
```javascript
const CONFIG = {
    API_URL: 'https://bx0ywfkona.execute-api.ap-south-1.amazonaws.com/prod/chat',
    WS_URL: 'ws://localhost:5001',  // For local dev
    // ...
};
```

---

## Deployment Procedures

### 1. Frontend Changes (S3 + CloudFront)

**When to deploy:** Any changes to `site/*.html`, `site/js/*.js`, or `site/css/*.css`

```bash
# Single file
aws s3 cp site/admin.html s3://ai-product-studio-sunware/admin.html \
  --profile sunwaretech --content-type "text/html"

# All files
aws s3 sync site/ s3://ai-product-studio-sunware/ \
  --profile sunwaretech \
  --exclude "*.js" --exclude "*.css"

aws s3 sync site/js/ s3://ai-product-studio-sunware/js/ \
  --profile sunwaretech --content-type "application/javascript"

aws s3 sync site/css/ s3://ai-product-studio-sunware/css/ \
  --profile sunwaretech --content-type "text/css"

# IMPORTANT: Invalidate CloudFront cache after S3 upload
aws cloudfront create-invalidation \
  --distribution-id E85ZBHF63VW9W \
  --paths "/*" \
  --profile sunwaretech
```

**Note:** CloudFront caches files. After uploading to S3, invalidate the cache to see changes immediately (takes ~1-2 minutes).

### 2. Backend Changes (Lambda)

**When to deploy:** Any changes to `chat-backend/index.mjs`

```bash
cd chat-backend

# IMPORTANT: Always include node_modules!
npm install  # If needed
rm -f function.zip && zip -r function.zip index.mjs node_modules

aws lambda update-function-code \
  --function-name ai-product-studio-chat \
  --zip-file fileb://function.zip \
  --profile sunwaretech \
  --region ap-south-1
```

**WARNING:** Never deploy just `index.mjs` without `node_modules`. The Lambda requires `@anthropic-ai/sdk` and AWS SDK packages.

### 3. Worker Changes (EC2)

**When to deploy:** Changes to worker logic (rarely needed - local dev is preferred)

```bash
# SSH to EC2
ssh -i ~/.ssh/ai-product-studio.pem ubuntu@65.1.106.211

# Update worker
cd ~/ai-product-studio-worker
nano worker.js  # or scp from local

# Restart
pm2 restart ai-product-studio-worker
pm2 logs
```

---

## S3 Bucket Structure

### Site Bucket (`ai-product-studio-sunware`)
```
/
├── index.html           # Landing page
├── apply.html           # Application form
├── admin.html           # Admin portal
├── favicon.svg          # Site icon
├── js/
│   ├── chat-widget.js   # Chat widget logic
│   ├── config.js        # API configuration
│   └── theme.js         # Theme system
└── css/
    └── chat-widget.css  # Chat widget styles
```

### Data Bucket (`ai-product-studio-applications`)
```
/
├── applications/        # Submitted applications
│   └── {email}/{date}/{timestamp}_{id}.json
├── chats/              # Chat sessions
│   └── {sessionId}.json
├── clients/            # Client profiles
│   └── client-{email}.json
├── jobs/               # Pending build jobs (worker polls this)
│   └── {jobId}.json
├── progress/           # Real-time build progress
│   └── {jobId}.json
├── builds/             # Build metadata & logs
│   └── {jobId}/
│       ├── metadata.json
│       └── agent-log.json
├── processed/          # Completed jobs (moved from jobs/)
│   └── {jobId}.json
└── mvps/               # Built MVP files (for CloudFront)
    └── {mvpId}/
        └── index.html, js/, css/
```

---

## Recent Changes Log

### January 3, 2026

**Unified Theme System:**
- Created `theme.js` - unified theme management across all pages
- 4 themes available: Dark, Midnight, Dusk, Light
- Theme persists via localStorage across page navigation
- CSS variables used for all colors (no hardcoded values)

**Admin Portal Theme Support:**
- Added theme selector dropdown in admin header
- All UI elements now use CSS variables
- Filter buttons, nav tabs, modals adapt to selected theme
- Login screen uses theme colors

**Chat Widget Fixes:**
- Fixed close button visibility (was hidden behind nav bar)
- Chat sidebar now starts below nav (`top: 72px`)
- z-index properly layered: nav (10000) > chat (9999) > toggle (9998)
- Border radius on chat panel for polished look
- Mobile breakpoints adjusted for proper positioning

**Responsive Design:**
- Comprehensive breakpoints: 1400px+, 1024-1399, 768-1023, 600-767, 480-599, <480, <360
- Chat adapts to all screen sizes
- iOS safe area support
- Reduced motion and high contrast modes

**Landing Page Content Update (from PowerPoint):**
- Hero: "AI-powered co-founder model — we accelerate your ideas to market"
- Problem: "Great Ideas Remain Ideas When One Founder Does Everything"
- CTA: "Your product launch is scheduled in two weeks from signup"

### January 2, 2026

**CloudFront HTTPS Setup:**
- Created CloudFront distribution `E85ZBHF63VW9W`
- Domain: `https://dtvq5afmkjebb.cloudfront.net`
- Enables HTTPS for microphone/voice input support
- Auto-redirects HTTP to HTTPS
- Global CDN caching

**Build Failure Fix:**
- Increased `MAX_TOKENS` from 8192 to 16384 in `.env`
- Added `write_file_chunked` tool for large HTML files
- Added content validation to prevent undefined writes

**Admin Portal Enhancements:**
- Added "📋 Logs" button to build cards
- Added "View Logs" button for failed builds
- Full log viewer modal with filters (All/Errors/Tools/Progress)
- Download logs as JSON
- Restart button now shows loading state, prevents double-clicks
- Builds sorted by datetime descending (newest first)

**Other:**
- Added favicon.svg to all pages

---

## Troubleshooting

### Build Failed - No index.html
**Cause:** Token limit hit during HTML generation
**Fix:**
1. Check `MAX_TOKENS` in `.env` (should be 16384+)
2. View logs in admin portal for details
3. The agent should use `write_file_chunked` for large files

### Chat Widget Not Working
**Cause:** API URL mismatch
**Fix:** Check `site/js/config.js` has correct API URL

### Admin Login Fails
**Cause:** Password mismatch
**Fix:** Check `ADMIN_PASSWORD` in Lambda env vars matches what you're using

### S3 Access Denied
**Cause:** AWS profile not configured
**Fix:**
```bash
aws configure --profile sunwaretech
# Enter Access Key, Secret Key, Region
```

### Lambda Timeout
**Cause:** Cold start or slow API calls
**Fix:** Increase Lambda timeout in AWS Console (currently 30s)

### Theme Not Persisting Across Pages
**Cause:** `theme.js` not loaded or localStorage key mismatch
**Fix:**
1. Ensure `theme.js` is included in all pages (before other scripts)
2. Check localStorage key is `'theme'` (not `'ai-product-studio-theme'`)
3. Verify theme.js is deployed to S3 and CloudFront cache invalidated

### Chat Close Button Hidden
**Cause:** Chat sidebar z-index conflict with nav bar
**Fix:** Ensure chat-widget.css has `top: 72px` and `z-index: 9999` for `.chat-sidebar`

---

## Useful Commands

### View Lambda Logs
```bash
aws logs tail /aws/lambda/ai-product-studio-chat \
  --profile sunwaretech --region ap-south-1 --follow
```

### Check S3 Objects
```bash
# Recent applications
aws s3 ls s3://ai-product-studio-applications/applications/ \
  --recursive --profile sunwaretech | tail -10

# Recent builds
aws s3 ls s3://ai-product-studio-applications/builds/ \
  --profile sunwaretech --region ap-south-1

# Pending jobs
aws s3 ls s3://ai-product-studio-applications/jobs/ \
  --profile sunwaretech --region ap-south-1
```

### EC2 Management
```bash
# Start EC2
aws ec2 start-instances --instance-ids i-08322e5fcb32f56d4 \
  --profile sunwaretech --region ap-south-1

# Stop EC2
aws ec2 stop-instances --instance-ids i-08322e5fcb32f56d4 \
  --profile sunwaretech --region ap-south-1

# Check status
aws ec2 describe-instance-status --instance-ids i-08322e5fcb32f56d4 \
  --profile sunwaretech --region ap-south-1
```

---

## Cost Optimization

| Resource | Cost | Optimization |
|----------|------|--------------|
| Lambda | ~$0/month (free tier) | - |
| API Gateway | ~$1/month | - |
| S3 | ~$0.50/month | Lifecycle rules for old data |
| EC2 t3.large | ~$60/month | Stop when not building |
| CloudFront | Pay per use | - |

**Tip:** Stop EC2 when not actively building MVPs:
```bash
aws ec2 stop-instances --instance-ids i-08322e5fcb32f56d4 \
  --profile sunwaretech --region ap-south-1
```

---

## Security Notes

- Lambda env vars store API keys (not in code)
- Admin portal is password-protected
- S3 data bucket has public access blocked
- EC2 uses SSH key authentication
- CORS configured to allow site domain

---

*Last Updated: January 3, 2026*
