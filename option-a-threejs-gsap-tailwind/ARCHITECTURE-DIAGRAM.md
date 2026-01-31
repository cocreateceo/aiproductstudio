# CoCreate - Infrastructure & Services Architecture

## High-Level Overview

```
                                    +---------------------------+
                                    |       USERS/CLIENTS       |
                                    |  (Desktop/Mobile Browser) |
                                    +-------------+-------------+
                                                  |
                                                  | HTTPS
                                                  v
+---------------------------------------------------------------------------------------------+
|                                     AWS CLOUDFRONT (CDN)                                    |
|                                   Production Domain + SSL                                   |
+---------------------------------------------------------------------------------------------+
                                                  |
                    +-----------------------------+-----------------------------+
                    |                                                           |
                    v                                                           v
+-----------------------------------+                       +-----------------------------------+
|         AWS S3 (Static)           |                       |      AWS API GATEWAY              |
|    ai-product-studio bucket       |                       |    bx0ywfkona (ap-south-1)        |
|                                   |                       |                                   |
|  /site/                           |                       |  Routes:                          |
|    - index.html                   |                       |    POST /prod/chat                |
|    - *.html (25+ pages)           |                       |    GET  /prod/scheduler/slots     |
|    - /css/themes/*.css            |                       |    POST /prod/scheduler/book      |
|    - /js/*.js                     |                       |                                   |
|    - /assets/                     |                       +----------------+------------------+
|                                   |                                        |
|  /applications/                   |                                        v
|    - {email}.json                 |                       +-----------------------------------+
|                                   |                       |        AWS LAMBDA                 |
|  /jobs/                           |                       |    chat-backend (Node.js 20)      |
|    - {jobId}.json                 |                       |                                   |
|                                   |                       |  Handler: index.mjs               |
|  /progress/                       |                       |                                   |
|    - {jobId}_progress.json        |                       |  Features:                        |
+-----------------------------------+                       |    - Chat processing              |
                                                            |    - Form validation              |
                                                            |    - Contact extraction           |
                                                            |    - Scheduler management         |
                                                            |    - Email triggers               |
                                                            +----------------+------------------+
                                                                             |
                    +------------------------+-------------------------------+------------------+
                    |                        |                               |                  |
                    v                        v                               v                  v
+-------------------+------+  +-------------------+------+  +-------------------+  +-----------+-------+
|   ANTHROPIC CLAUDE API   |  |     OPENAI API         |  |   GOOGLE CALENDAR  |  |   AWS SES          |
|                          |  |     (Fallback)         |  |       API          |  |  (us-east-1)       |
|  Model: claude-sonnet-4  |  |  Model: gpt-4o-mini    |  |                    |  |                    |
|  Max tokens: 500         |  |                        |  |  - Slot management |  |  - Lead alerts     |
|                          |  |                        |  |  - Meet link gen   |  |  - Form submissions|
|  Uses:                   |  |                        |  |  - Booking create  |  |  - Confirmations   |
|    - Chat responses      |  |                        |  |                    |  |                    |
|    - Data extraction     |  |                        |  |  Service Account   |  |  Recipient:        |
|    - Validation          |  |                        |  |  Authentication    |  |  gopi@sunware...   |
+-------------------------+  +------------------------+  +-------------------+  +-------------------+
```

## Frontend Architecture

```
+-------------------------------------------------------------------------------------------+
|                                    BROWSER (Client-Side)                                  |
+-------------------------------------------------------------------------------------------+
|                                                                                           |
|  +---------------------------+  +---------------------------+  +------------------------+ |
|  |      HTML PAGES           |  |     CSS STYLING           |  |    JAVASCRIPT          | |
|  +---------------------------+  +---------------------------+  +------------------------+ |
|  |                           |  |                           |  |                        | |
|  | Main Pages:               |  | /css/themes/              |  | Core Modules:          | |
|  |   - index.html            |  |   - ember.css (default)   |  |   - config.js          | |
|  |   - apply.html            |  |   - coral.css             |  |   - theme.js           | |
|  |   - schedule.html         |  |   - sunset.css            |  |   - chat-widget.js     | |
|  |   - chat.html             |  |   - aurora.css            |  |   - chat-loader.js     | |
|  |   - admin.html            |  |   - legacy.css            |  |   - scheduler.js       | |
|  |   - contact.html          |  |   - sandstone.css         |  |   - admin-core.js      | |
|  |   - who-we-are.html       |  |   - champagne.css         |  |                        | |
|  |   - what-we-do.html       |  |   - zoom.css              |  | External Libraries:    | |
|  |   - blogs.html            |  |                           |  |   - Tailwind (CDN)     | |
|  |   - careers.html          |  | Components:               |  |   - GSAP 3.12.2        | |
|  |   - insights.html         |  |   - chat-widget.css       |  |   - html2canvas        | |
|  |   - investors.html        |  |   - scheduler.css         |  |                        | |
|  |   - success-stories.html  |  |   - responsive.css        |  | Browser APIs:          | |
|  |                           |  |                           |  |   - Web Speech API     | |
|  | Industry Pages:           |  | Design System:            |  |   - localStorage       | |
|  |   /industries/            |  |   - CSS Variables         |  |   - Intl (timezone)    | |
|  |   - healthcare.html       |  |   - Glass-morphism        |  |   - Clipboard API      | |
|  |   - financial-services    |  |   - Gradient overlays     |  |                        | |
|  |   - manufacturing.html    |  |   - DM Sans + Outfit      |  |                        | |
|  |   - retail.html           |  |                           |  |                        | |
|  +---------------------------+  +---------------------------+  +------------------------+ |
|                                                                                           |
+-------------------------------------------------------------------------------------------+
```

## Data Flow Diagrams

### 1. Chat Conversation Flow

```
+--------+     +---------------+     +------------+     +--------+     +----------+
|  User  | --> | chat-widget.js| --> | API Gateway| --> | Lambda | --> | Claude   |
| Input  |     | (Validation)  |     | /prod/chat |     | Handler|     | Sonnet 4 |
+--------+     +---------------+     +------------+     +--------+     +----------+
                                                              |              |
                                                              v              |
                                                        +-----------+        |
                                                        |  Extract  |<-------+
                                                        | Form Data |
                                                        +-----------+
                                                              |
                    +----------------+------------------------+
                    |                |                        |
                    v                v                        v
              +-----------+   +------------+          +-------------+
              | Save to   |   | Send Email |          | Return      |
              | S3 Bucket |   | (AWS SES)  |          | Response    |
              +-----------+   +------------+          +-------------+
                                                              |
                                                              v
                                                      +---------------+
                                                      | chat-widget.js|
                                                      | Parse & Render|
                                                      +---------------+
                                                              |
                                                              v
                                                      +---------------+
                                                      | chat-loader.js|
                                                      | Auto-fill Form|
                                                      +---------------+
```

### 2. Application Submission Flow

```
+--------+     +-----------+     +------------+     +--------+     +---------+
|  User  | --> | apply.html| --> | API Gateway| --> | Lambda | --> | S3      |
| Form   |     | (8 fields)|     | /admin/app |     | Validate|    | Store   |
+--------+     +-----------+     +------------+     +--------+     +---------+
                                                         |              |
                                                         v              |
                                                   +-----------+        |
                                                   | Send Email|        |
                                                   | (AWS SES) |        |
                                                   +-----------+        |
                                                                        |
                    +---------------------------------------------------+
                    |
                    v
+--------+     +-----------+     +------------+     +--------+     +---------+
| Admin  | --> | admin.html| --> | WebSocket  | --> | Worker | --> | Build   |
| Review |     | (Approve) |     | (WS:5001)  |     | Process|     | MVP     |
+--------+     +-----------+     +------------+     +--------+     +---------+
```

### 3. Scheduler Booking Flow

```
+--------+     +-------------+     +------------+     +--------+     +----------+
|  User  | --> | schedule.js | --> | API Gateway| --> | Lambda | --> | Google   |
| Select |     | (Calendar)  |     | /slots     |     | Handler|     | Calendar |
| Date   |     +-------------+     +------------+     +--------+     +----------+
+--------+                                                  |              |
                                                           v              |
                                                   +---------------+      |
                                                   | Filter Slots  |<-----+
                                                   | (Busy times)  |
                                                   +---------------+
                                                           |
+--------+     +-------------+     +------------+     +--------+
|  User  | <-- | Display     | <-- | Available  | <-- | Return |
| Picks  |     | Time Slots  |     | Slots JSON |     | Slots  |
| Slot   |     +-------------+     +------------+     +--------+
+--------+
    |
    v
+--------+     +-------------+     +------------+     +--------+     +----------+
| Submit | --> | schedule.js | --> | API Gateway| --> | Lambda | --> | Google   |
| Form   |     | (Book)      |     | /book      |     | Book   |     | Calendar |
+--------+     +-------------+     +------------+     +--------+     +----------+
                                                           |              |
                                                           v              v
                                                   +---------------+ +----------+
                                                   | Send Email    | | Meet Link|
                                                   | Confirmation  | | Created  |
                                                   +---------------+ +----------+
```

## Theme System Architecture

```
+-------------------------------------------------------------------------------------------+
|                                    THEME SYSTEM                                           |
+-------------------------------------------------------------------------------------------+
|                                                                                           |
|   localStorage                    theme.js (ThemeManager)                CSS Variables    |
|   +-----------+                   +---------------------+               +-------------+   |
|   | cocreate- |  <-- get/set -->  | init()              |  -- apply --> | :root {     |   |
|   | theme     |                   | set(themeName)      |               |   --primary |   |
|   | = "ember" |                   | get()               |               |   --bg-*    |   |
|   +-----------+                   | apply()             |               |   --text-*  |   |
|                                   | themes()            |               |   --border  |   |
|                                   | current()           |               |   --glow    |   |
|                                   | isLight()           |               | }           |   |
|                                   +---------------------+               +-------------+   |
|                                            |                                   |          |
|                                            v                                   v          |
|                                   +---------------------+               +-------------+   |
|                                   | Custom Event:       |               | Theme CSS:  |   |
|                                   | 'themechange'       |               | ember.css   |   |
|                                   | { theme, colors,    |               | coral.css   |   |
|                                   |   type, name }      |               | sunset.css  |   |
|                                   +---------------------+               | aurora.css  |   |
|                                                                         | legacy.css  |   |
|   8 Themes Available:                                                   | sandstone   |   |
|   +-------+--------+---------+--------+--------+-----------+            | champagne   |   |
|   | Ember | Coral  | Sunset  | Aurora | Legacy | Sandstone |            | zoom.css    |   |
|   | (dark)| (light)| (dark)  | (light)| (dark) | (light)   |            +-------------+   |
|   +-------+--------+---------+--------+--------+-----------+                              |
|   | Champagne | Zoom   |                                                                  |
|   | (light)   | (light)|                                                                  |
|   +-----------+--------+                                                                  |
|                                                                                           |
+-------------------------------------------------------------------------------------------+
```

## Local Development Environment

```
+-------------------------------------------------------------------------------------------+
|                              LOCAL DEVELOPMENT STACK                                      |
+-------------------------------------------------------------------------------------------+
|                                                                                           |
|   Browser (localhost:3000)                                                                |
|   +---------------------+                                                                 |
|   | Static HTML/CSS/JS  |                                                                 |
|   | from ../site/       |                                                                 |
|   +----------+----------+                                                                 |
|              |                                                                            |
|              v                                                                            |
|   +---------------------+     +---------------------+     +---------------------+         |
|   | Express Server      |     | WebSocket Server    |     | Worker Process      |         |
|   | (server.js)         |     | (WS on :5001)       |     | (worker.js)         |         |
|   | Port: 5000          |     |                     |     |                     |         |
|   +----------+----------+     +----------+----------+     +----------+----------+         |
|              |                           |                           |                    |
|              v                           v                           v                    |
|   +----------+---------------------------+---------------------------+----------+         |
|   |                              .env Configuration                              |         |
|   |   ANTHROPIC_API_KEY, AWS_PROFILE, S3_BUCKET, ADMIN_PASSWORD, etc.           |         |
|   +-----------------------------------------------------------------------------+         |
|              |                           |                           |                    |
|              v                           v                           v                    |
|   +---------------------+     +---------------------+     +---------------------+         |
|   | Claude API          |     | AWS S3 (Real)       |     | Google Calendar     |         |
|   | (via SDK)           |     | (applications/)     |     | (via googleapis)    |         |
|   +---------------------+     +---------------------+     +---------------------+         |
|                                                                                           |
+-------------------------------------------------------------------------------------------+
```

## Security Architecture

```
+-------------------------------------------------------------------------------------------+
|                                  SECURITY LAYERS                                          |
+-------------------------------------------------------------------------------------------+
|                                                                                           |
|   +---------------------------+     +---------------------------+                         |
|   |    FRONTEND SECURITY      |     |     BACKEND SECURITY      |                         |
|   +---------------------------+     +---------------------------+                         |
|   |                           |     |                           |                         |
|   | - HTTPS via CloudFront    |     | - API Gateway validation  |                         |
|   | - No exposed API keys     |     | - CORS whitelist          |                         |
|   | - localStorage (24h TTL)  |     | - Admin password auth     |                         |
|   | - Input sanitization      |     | - Env vars for secrets    |                         |
|   |                           |     | - S3 bucket policies      |                         |
|   +---------------------------+     +---------------------------+                         |
|                                                                                           |
|   +---------------------------+     +---------------------------+                         |
|   |    DATA VALIDATION        |     |    EMAIL VALIDATION       |                         |
|   +---------------------------+     +---------------------------+                         |
|   |                           |     |                           |                         |
|   | - LLM-based validation    |     | - Format validation       |                         |
|   | - Name gibberish check    |     | - Duplicate detection     |                         |
|   | - Email format check      |     | - AWS SES reputation      |                         |
|   | - Product idea coherence  |     |                           |                         |
|   |                           |     |                           |                         |
|   +---------------------------+     +---------------------------+                         |
|                                                                                           |
+-------------------------------------------------------------------------------------------+
```

## Technology Stack Summary

```
+-------------------------------------------------------------------------------------------+
|                                 TECHNOLOGY STACK                                          |
+-------------------------------------------------------------------------------------------+
|                                                                                           |
|   FRONTEND                     BACKEND                      INFRASTRUCTURE               |
|   +-----------------------+    +-----------------------+    +-----------------------+     |
|   | HTML5                 |    | Node.js 20            |    | AWS S3                |     |
|   | CSS3 + Tailwind       |    | AWS Lambda            |    | AWS CloudFront        |     |
|   | Vanilla JavaScript    |    | API Gateway           |    | AWS SES               |     |
|   | GSAP (animations)     |    |                       |    | Google Cloud          |     |
|   | html2canvas           |    | DEPENDENCIES:         |    |   (Calendar API)      |     |
|   |                       |    | @anthropic-ai/sdk     |    |                       |     |
|   | FONTS:                |    | @aws-sdk/client-s3    |    | DOMAINS:              |     |
|   | - DM Sans             |    | @aws-sdk/client-ses   |    | - CloudFront dist     |     |
|   | - Outfit              |    | googleapis            |    | - Custom domain       |     |
|   |                       |    | openai (fallback)     |    |                       |     |
|   | DESIGN:               |    | pdf-parse             |    | REGIONS:              |     |
|   | - 8 color themes      |    | mammoth               |    | - ap-south-1 (main)   |     |
|   | - Glass-morphism      |    |                       |    | - us-east-1 (SES)     |     |
|   | - CSS Variables       |    |                       |    |                       |     |
|   +-----------------------+    +-----------------------+    +-----------------------+     |
|                                                                                           |
|   AI/ML SERVICES               EXTERNAL SERVICES            LOCAL DEV                    |
|   +-----------------------+    +-----------------------+    +-----------------------+     |
|   | Anthropic Claude      |    | Google Calendar       |    | Express.js            |     |
|   |   - Sonnet 4          |    |   - Slot management   |    | WebSocket (ws)        |     |
|   |   - Chat responses    |    |   - Meet links        |    | dotenv                |     |
|   |   - Data extraction   |    |   - Bookings          |    | CORS                  |     |
|   |   - Validation        |    |                       |    |                       |     |
|   |                       |    | Google Fonts          |    | Ports:                |     |
|   | OpenAI (Fallback)     |    |   - DM Sans           |    | - 3000 (static)       |     |
|   |   - GPT-4o-mini       |    |   - Outfit            |    | - 5000 (API)          |     |
|   |                       |    |                       |    | - 5001 (WebSocket)    |     |
|   +-----------------------+    +-----------------------+    +-----------------------+     |
|                                                                                           |
+-------------------------------------------------------------------------------------------+
```

## API Endpoints Reference

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/prod/chat` | POST | Main chat conversation endpoint |
| `/prod/scheduler/slots` | GET | Get available calendar slots |
| `/prod/scheduler/book` | POST | Book a calendar slot |
| `/api/admin/applications` | GET | List applications (admin) |
| `/api/admin/applications` | POST | Submit new application |
| `/api/admin/approve` | POST | Approve application (admin) |
| `/api/admin/reject` | POST | Reject application (admin) |

## File Structure

```
option-a-threejs-gsap-tailwind/
├── site/                          # Frontend (Static)
│   ├── index.html                 # Landing page
│   ├── apply.html                 # Application form
│   ├── schedule.html              # Booking calendar
│   ├── admin.html                 # Admin portal
│   ├── [20+ other pages]          # Content pages
│   ├── css/
│   │   ├── themes/                # 8 theme files
│   │   ├── chat-widget.css
│   │   ├── scheduler.css
│   │   └── responsive.css
│   ├── js/
│   │   ├── config.js              # Central configuration
│   │   ├── theme.js               # Theme management
│   │   ├── chat-widget.js         # Chat component
│   │   ├── chat-loader.js         # Form integration
│   │   ├── scheduler.js           # Calendar booking
│   │   └── admin-core.js          # Admin logic
│   └── assets/
│       ├── cocreate_bg.png        # Background image
│       └── cocreate-logo.svg      # Brand logo
├── chat-backend/                  # AWS Lambda
│   ├── index.mjs                  # Lambda handler
│   ├── package.json               # Dependencies
│   └── deploy.sh                  # Deployment script
└── local-dev/                     # Development server
    ├── server.js                  # Express server
    ├── worker.js                  # Job processor
    ├── .env.example               # Environment template
    └── README.md                  # Dev documentation
```

---

*Generated: January 2026*
*Architecture Version: 2.0*
