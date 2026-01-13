# AI Product Studio - Functional Documentation

## Overview

AI Product Studio is a venture studio landing page with an intelligent AI chat assistant that helps potential partners learn about the studio and submit partnership applications. The system uses Claude AI (with OpenAI fallback) for natural conversations and automated lead capture.

**Live URLs:**
- Main Site: http://ai-product-studio-sunware.s3-website-us-east-1.amazonaws.com
- Apply Page: http://ai-product-studio-sunware.s3-website-us-east-1.amazonaws.com/apply.html

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                         Frontend (S3 Static)                        │
│  ┌─────────────────┐              ┌─────────────────────────────┐  │
│  │   index.html    │              │        apply.html           │  │
│  │  Landing Page   │──────────────│   Partnership Application   │  │
│  │  + Chat Widget  │              │   Form + AI Chat Assistant  │  │
│  └────────┬────────┘              └──────────────┬──────────────┘  │
└───────────┼──────────────────────────────────────┼──────────────────┘
            │                                      │
            └──────────────┬───────────────────────┘
                           │ HTTPS POST
                           ▼
┌─────────────────────────────────────────────────────────────────────┐
│                    AWS Lambda (ap-south-1)                          │
│                   ai-product-studio-chat                            │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │  • Claude API (primary) / OpenAI API (fallback)             │   │
│  │  • LLM-based contact info extraction                        │   │
│  │  • Guardrails for off-topic questions                       │   │
│  │  • Form data extraction and parsing                         │   │
│  └─────────────────────────────────────────────────────────────┘   │
└────────────────────────┬────────────────────────┬───────────────────┘
                         │                        │
                         ▼                        ▼
              ┌──────────────────┐    ┌──────────────────────────┐
              │   AWS SES        │    │   AWS S3                 │
              │   (us-east-1)    │    │   (ap-south-1)           │
              │                  │    │                          │
              │  Email alerts to │    │  ai-product-studio-      │
              │  gopi@sunware... │    │  applications bucket     │
              └──────────────────┘    └──────────────────────────┘
```

---

## Features

### 1. AI Chat Assistant

**Description:** An intelligent chatbot powered by Claude AI that engages visitors, answers questions about AI Product Studio, and collects lead information.

**Technical Implementation:**
- **Primary Model:** Claude Sonnet (claude-sonnet-4-20250514)
- **Fallback Model:** OpenAI GPT-4o-mini
- **Max Tokens:** 500 per response
- **API Endpoint:** `https://bx0ywfkona.execute-api.ap-south-1.amazonaws.com/prod/chat`

**Request Format:**
```json
{
  "messages": [
    { "role": "user", "content": "How does the partnership work?" }
  ],
  "visitorInfo": {
    "name": "John",
    "email": "john@example.com"
  },
  "page": "index"
}
```

**Response Format:**
```json
{
  "success": true,
  "response": "AI response text...",
  "provider": "claude",
  "visitorInfo": {
    "name": "John Smith",
    "email": "john@example.com",
    "phone": "+1234567890"
  },
  "hasContactInfo": true,
  "contactStatus": {
    "hasName": true,
    "hasContact": true,
    "complete": true
  }
}
```

---

### 2. LLM-Based Contact Extraction

**Description:** Uses Claude AI to intelligently extract contact information (name, email, phone) from natural conversation text, eliminating the need for rigid regex patterns.

**Technical Implementation:**
- Analyzes entire conversation history
- Handles various name formats (lowercase, mixed case, multiple words)
- Extracts email addresses and phone numbers in any format
- Returns structured JSON with extracted data

**Extraction Prompt:**
```
Analyze this conversation and extract any contact information the user has provided.
Extract and return ONLY a JSON object with these fields (use null if not found):
- name: The person's full name
- email: Their email address
- phone: Their phone number (any format)
```

**Example:**
- Input: "hey im john smith, you can reach me at john@gmail.com or call 555-1234"
- Output: `{"name": "John Smith", "email": "john@gmail.com", "phone": "555-1234"}`

---

### 3. Guardrails System

**Description:** Keeps the AI focused on AI Product Studio topics and politely declines off-topic questions.

**Allowed Topics:**
- Partnership opportunities
- Venture studio model explanation
- AI product development process
- Business ideas for AI products
- Portfolio and success stories
- Pricing, timelines, partnership terms

**Blocked Topics:**
- General knowledge/trivia
- Coding help/debugging
- Personal advice (health, legal, financial)
- News, politics, entertainment
- Homework/academic work
- Competitor information

**Decline Response Example:**
> "I appreciate your curiosity! However, I'm specifically here to help you explore partnership opportunities with AI Product Studio. Is there something about our venture model or AI product development I can help you with?"

---

### 4. Contact-Gated Responses

**Description:** Requires visitors to provide contact information before receiving detailed answers, ensuring lead capture.

**Flow:**
1. Visitor asks a relevant question
2. AI acknowledges the question briefly
3. AI requests name + phone/email
4. Once contact info is provided, AI gives detailed responses
5. Email notification is sent to team on first complete contact

**States:**
- `hasName: false, hasContact: false` → Ask for name first
- `hasName: true, hasContact: false` → Ask for phone/email
- `hasName: true, hasContact: true` → Provide full responses

---

### 5. Email Notifications (AWS SES)

**Description:** Sends beautifully formatted HTML emails when leads are captured or applications are submitted.

**Trigger Events:**
1. **New Lead:** When complete contact info is collected for the first time
2. **Form Submission:** When partnership application form is submitted

**Email Configuration:**
- **Region:** us-east-1
- **From/To:** gopi@sunwaretechnologies.com
- **Format:** HTML with text fallback

**New Lead Email Template:**
```
Subject: 🚀 New Lead: {name} - AI Product Studio

Body includes:
- Visitor name, email, phone
- Page where contact was made
- Client IP address
- Timestamp (IST)
- Full conversation history
- Latest AI response
```

**Form Submission Email Template:**
```
Subject: 🎉 New Partnership Application: {name}

Body includes:
- All form fields in organized table
- Personal info, business info, product idea
- Submission timestamp and IP
- Next steps reminder
```

---

### 6. S3 Application Storage

**Description:** Persists all partnership applications to S3 for record-keeping and analytics.

**Bucket:** `ai-product-studio-applications`
**Region:** ap-south-1

**Folder Structure:**
```
applications/
├── john_at_example_com/           # Folder per user (by email)
│   ├── 2026-01-01/                # Date subfolder
│   │   ├── 2026-01-01T10-30-00-000Z_abc123.json
│   │   └── 2026-01-01T14-45-00-000Z_def456.json
│   └── 2026-01-02/
│       └── ...
├── jane_smith/                     # Fallback to name if no email
│   └── ...
└── anonymous/                      # No identifying info
    └── ...
```

**Stored Data Format:**
```json
{
  "submittedAt": "2026-01-01T10:30:00.000Z",
  "submittedAtIST": "1/1/2026, 4:00:00 PM",
  "visitorInfo": {
    "name": "John Smith",
    "email": "john@example.com",
    "phone": "+1234567890"
  },
  "clientIP": "203.0.113.50",
  "page": "Apply Page",
  "formData": {
    "name": "John Smith",
    "email": "john@example.com",
    "business_stage": "validated",
    "industry": "fintech",
    "product_idea": "AI-powered expense tracker...",
    ...
  },
  "rawContent": "Full form submission text..."
}
```

---

### 7. Free-Text Form Filling

**Description:** AI assistant can parse unstructured text from users and automatically fill form fields.

**User Flow:**
1. User clicks "Ask AI to Help Fill Form"
2. AI prompts: "Just share whatever info you have..."
3. User types free-form text with their details
4. AI extracts structured data and returns it with special markers
5. Frontend parses response and auto-fills matching form fields
6. Visual feedback (green border) shows filled fields

**Example Input:**
> "I'm Sarah Johnson, sarah@startup.io, 555-9876. I've been in e-commerce for 10 years and want to build an AI product recommendation engine for small online stores. Already talked to 20 potential customers who love the idea. Want to launch within a month, can work on this full-time."

**AI Response Format:**
```
Based on what you shared, here's what I can fill in:

**Personal Info:**
- Name: Sarah Johnson
- Email: sarah@startup.io
- Phone: 555-9876

**Your Idea:**
- AI product recommendation engine for e-commerce
- Target: Small online stores

Does this look correct? I'll fill these into the form for you!

|||FORM_DATA|||{"fullName":"Sarah Johnson","email":"sarah@startup.io","phone":"555-9876","businessStage":"validated","industry":"ecommerce","background":"10 years in e-commerce","productIdea":"AI product recommendation engine for small online stores","targetCustomer":"Small online stores","marketValidation":"Talked to 20 potential customers who love the idea","timeCommitment":"fulltime","timeline":"1month"}|||END_FORM|||
```

**Form Fields Mapping:**
| Form Field | JSON Key |
|------------|----------|
| Full Name | fullName |
| Email | email |
| Phone | phone |
| LinkedIn | linkedin |
| Business Stage | businessStage |
| Industry | industry |
| Background | background |
| Product Idea | productIdea |
| Target Customer | targetCustomer |
| Market Validation | marketValidation |
| Time Commitment | timeCommitment |
| Timeline | timeline |
| Additional Info | additionalInfo |

---

### 8. Resizable Chat Sidebar

**Description:** Users can resize the chat panel by dragging its left edge.

**Technical Implementation:**
- Minimum width: 300px
- Maximum width: 600px
- Default width: 380px
- Drag handle on left edge
- Visual feedback during drag (purple highlight)

**Code:**
```javascript
chatResizeHandle.addEventListener('mousedown', (e) => {
    isResizing = true;
    startX = e.clientX;
    startWidth = chatSidebar.offsetWidth;
});

document.addEventListener('mousemove', (e) => {
    if (!isResizing) return;
    const diff = startX - e.clientX;
    const newWidth = Math.min(600, Math.max(300, startWidth + diff));
    chatSidebar.style.width = newWidth + 'px';
});
```

---

### 9. Multi-line Chat Input

**Description:** Chat input supports multi-line text with Shift+Enter for new lines.

**Behavior:**
- `Enter` → Send message
- `Shift+Enter` → New line
- Auto-resize up to 120px height
- Minimum height: 48px

---

### 10. Responsive Design

**Description:** Both pages are fully responsive across devices.

**Breakpoints:**
- **Desktop:** > 768px - Full layout with side-by-side elements
- **Tablet:** 768px - Adjusted spacing, stacked elements
- **Mobile:** < 480px - Full-width chat, simplified layouts

**Key Responsive Features:**
- Chat sidebar goes full-width on mobile
- Form fields stack vertically on small screens
- Navigation adapts to screen size
- Touch-friendly tap targets

---

## API Reference

### POST /chat

Main endpoint for chat interactions.

**Headers:**
```
Content-Type: application/json
```

**Request Body:**
```json
{
  "messages": [
    { "role": "user", "content": "string" },
    { "role": "assistant", "content": "string" }
  ],
  "visitorInfo": {
    "name": "string (optional)",
    "email": "string (optional)",
    "phone": "string (optional)",
    "page": "string (optional)"
  },
  "page": "string (optional)"
}
```

**Success Response (200):**
```json
{
  "success": true,
  "response": "AI response text",
  "provider": "claude | openai",
  "visitorInfo": { ... },
  "hasContactInfo": true,
  "contactStatus": {
    "hasName": true,
    "hasContact": true,
    "complete": true
  }
}
```

**Form Submission Response (200):**
```json
{
  "success": true,
  "response": "Thank you for your application!...",
  "provider": "system",
  "visitorInfo": { ... },
  "hasContactInfo": true,
  "formSubmitted": true,
  "s3Key": "applications/user/date/file.json"
}
```

**Error Response (400/500):**
```json
{
  "error": "Error message",
  "message": "Detailed error description"
}
```

---

## Environment Variables

| Variable | Description | Required |
|----------|-------------|----------|
| ANTHROPIC_API_KEY | Claude API key | Yes |
| OPENAI_API_KEY | OpenAI API key (fallback) | Yes |
| NOTIFICATION_EMAIL | Email for notifications | No (default: gopi@sunwaretechnologies.com) |

---

## AWS Resources

| Resource | Type | Region | Purpose |
|----------|------|--------|---------|
| ai-product-studio-chat | Lambda | ap-south-1 | Chat API handler |
| ai-product-studio-chat-role | IAM Role | Global | Lambda execution role |
| ai-product-studio-sunware | S3 Bucket | us-east-1 | Static website hosting |
| ai-product-studio-applications | S3 Bucket | ap-south-1 | Application storage |
| SES (verified email) | SES | us-east-1 | Email notifications |

---

## Deployment

### Lambda Deployment
```bash
cd chat-backend
npm install
zip -r function.zip . -x '*.git*' -x 'deploy.sh' -x '*.md'
aws lambda update-function-code \
  --function-name ai-product-studio-chat \
  --zip-file fileb://function.zip \
  --profile sunwaretech \
  --region ap-south-1
```

### Site Deployment
```bash
aws s3 sync site/ s3://ai-product-studio-sunware \
  --profile sunwaretech \
  --region us-east-1 \
  --delete
```

---

## File Structure

```
option-a-threejs-gsap-tailwind/
├── site/
│   ├── index.html          # Main landing page
│   └── apply.html          # Partnership application page
├── chat-backend/
│   ├── index.mjs           # Lambda handler
│   ├── package.json        # Dependencies
│   └── deploy.sh           # Deployment script
└── FUNCTIONAL_DOCUMENTATION.md
```

---

### 11. Mobile Navigation Fix

**Description:** Navigation bar stays accessible on mobile even when chat is open.

**Technical Implementation:**
- Navigation z-index: 10000 (above chat's 9999)
- Mobile chat offset: `top: 64px`, `height: calc(100vh - 64px)`
- Prevents chat from overlapping navigation links

---

### 12. Business Idea Brainstorming

**Description:** AI assistant can help users brainstorm and refine their business ideas before filling the form.

**Welcome Message Options:**
- **Brainstorm your business idea** - explore what AI product to build
- **Fill out the form** - share info in free text
- **Answer questions** - about partnership model and process

**Example Prompts:**
- "I have a vague idea about using AI for restaurants..."
- "What kind of AI products work best in healthcare?"
- "Help me think through my SaaS idea for freelancers"

**AI Behavior:**
- Asks probing questions to clarify the idea
- Suggests potential AI applications
- Identifies target customers
- Eventually guides user to fill the application form

---

### 13. Form Submission Loading State

**Description:** Prevents double-submission with visual feedback during form processing.

**Technical Implementation:**
```javascript
// Prevent multiple submissions
if (isSubmitting) return;
isSubmitting = true;

// Show loading state
submitBtn.disabled = true;
submitBtn.innerHTML = `<svg class="animate-spin">...</svg> Submitting...`;
submitBtn.style.opacity = '0.7';
submitBtn.style.cursor = 'not-allowed';
```

**User Experience:**
1. User clicks "Submit Application"
2. Button shows spinning loader + "Submitting..."
3. Button is disabled (greyed out, cursor changes)
4. On success: Form hidden, success message shown
5. On error: Alert shown, button reset to original state

---

### 14. Admin Portal

**Description:** Password-protected admin dashboard to review and manage partnership applications.

**URL:** http://ai-product-studio-sunware.s3-website-us-east-1.amazonaws.com/admin.html

**Default Password:** `aiproductstudio2024` (set via ADMIN_PASSWORD env var)

**Features:**
- Secure login with password authentication
- Dashboard with application statistics (Total, Pending, Approved, Rejected)
- Filter applications by status
- View full application details in modal
- Approve or reject applications with optional notes
- Session persistence (stays logged in during browser session)
- Responsive design for mobile/tablet

**Application Status Flow:**
```
[pending] → [approved] or [rejected]
```

**Admin API Endpoints:**
```javascript
// Login
POST { action: 'admin-login', password: '...' }

// List Applications
POST { action: 'admin-list', password: '...' }

// Update Status
POST { action: 'admin-update', password: '...', s3Key: '...', status: 'approved|rejected', reviewNotes: '...' }
```

**S3 Data Structure (after review):**
```json
{
  "status": "approved",
  "reviewedAt": "2026-01-01T15:30:00.000Z",
  "reviewedAtEST": "1/1/2026, 10:30:00 AM",
  "reviewNotes": "Great idea, schedule call"
}
```

---

### 15. US Eastern Time (EST/EDT)

**Description:** All timestamps now use US Eastern timezone instead of IST.

**Affected Areas:**
- Email notifications (lead capture and form submission)
- S3 stored application data (`submittedAtEST`, `reviewedAtEST`)
- Admin portal display

**Implementation:**
```javascript
new Date().toLocaleString('en-US', { timeZone: 'America/New_York' })
```

---

## Version History

| Date | Version | Changes |
|------|---------|---------|
| 2026-01-01 | 1.0.0 | Initial release with chat, email, S3 storage |
| 2026-01-01 | 1.1.0 | Added free-text form filling |
| 2026-01-01 | 1.2.0 | Added guardrails, LLM contact extraction |
| 2026-01-01 | 1.2.1 | Fixed mobile navigation z-index overlap |
| 2026-01-01 | 1.3.0 | Added brainstorming option, submit button loading state |
| 2026-01-01 | 1.4.0 | Changed timezone to US EST, added Admin Portal |

---

## Support

For technical issues or feature requests, contact the development team.
