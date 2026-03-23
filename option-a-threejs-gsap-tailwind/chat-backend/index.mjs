/**
 * AI Product Studio Chat Lambda
 * - Claude API for professional responses + contact extraction
 * - OpenAI as backup
 * - AWS SES for email notifications
 * - LLM-based contact info extraction
 * - Guardrails for off-topic questions
 * - Chat history preservation
 * - Client profile management
 * - Build history tracking
 */

import Anthropic from '@anthropic-ai/sdk';
import pdfParse from 'pdf-parse';
import mammoth from 'mammoth';
import crypto from 'crypto';
import { handleAdminCostsSummary, handleUserCosts } from './costs/index.mjs';
import { handleScheduledCostReports, handleManualCostReportTrigger, handleSendAdminSummaryReport, computeAdminSummaryData } from './costs/email-reports.mjs';
import { handleAwsCostSummary, handleAwsCostDaily, handleAwsCostDailyByService, handleAwsCostForecast, handleAwsCostServiceDetail, handleAwsProjectCosts, handleAwsProjectCostsDynamic, handleAwsCostDailyByProject, handleAwsUnusedResources, handleAwsDeleteResource, handleAwsS3Browse, handleAwsS3Delete, handleAwsS3Analysis, handleAwsActivityLog, handleAwsActivityEmailReport, handleAwsCostDashboardBatch, handleAwsCostStorageBatch } from './aws-costs/index.mjs';

// Configuration
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const NOTIFICATION_EMAIL = process.env.NOTIFICATION_EMAIL; // Must be set and verified in SES

// LLM model configuration (update here when switching models)
const CLAUDE_MODEL = process.env.CLAUDE_MODEL || 'claude-sonnet-4-20250514';
const OPENAI_MODEL = process.env.OPENAI_MODEL || 'gpt-4o-mini';

// LLM pricing per 1K tokens (update here when pricing changes)
const LLM_PRICING = {
  claude: { input: 0.003, output: 0.015 },
  openai: { input: 0.00015, output: 0.0006 }
};

// S3 bucket for storing all data (must exist in cocreate account us-east-1)
const S3_BUCKET = process.env.S3_BUCKET || 'cocreate-applications-data';
const S3_REGION = process.env.AWS_REGION || 'us-east-1';

import { EMAIL_CONFIG, ADMIN_EMAILS, renderAdminNewApplication, renderApplicantAcknowledgment, renderApplicantApproved, renderApplicantRejected, renderUserWelcome, renderPasswordResetLink, renderPasswordChanged, renderNewLoginAlert, renderProjectDeployed, renderBuildFailedUser, renderBuildFailedAdmin, renderAccountDeactivated, renderSessionExpiryReminder, renderWeeklyDigest, renderReEngagement } from './email-templates.mjs';
import { sendTemplatedEmail, sendToAdmins, sendTemplate, sendTemplateToAdmins, isResetRateLimited } from './email-service.mjs';

// System prompt for the AI Product Studio chat agent with guardrails
const SYSTEM_PROMPT = `You are a friendly and professional AI assistant for AI Product Studio - a venture studio that partners with business founders to build AI-powered products.

## About AI Product Studio:
- We are your AI co-founder, not an agency
- We build products in 2 weeks using AI-accelerated development
- Partnership model: 40% Tech Founder (us), 40% Business Founder (them), 20% Operations
- $0 upfront cost - we share risk and reward
- We handle: AI architecture, development, hosting, continuous support
- They handle: Market validation, sales, partnerships, revenue strategy

## Current Products in Portfolio:
1. Personal Transformation - AI-powered personal growth platform
2. Vedic Astrology - AI-enhanced astrological insights
3. Career Builder - AI career coaching platform

## GUARDRAILS - Stay On Topic:
You are ONLY here to discuss:
- AI Product Studio partnership opportunities
- How our venture studio model works
- AI product development and our process
- Business ideas that could become AI products
- Our portfolio and success stories
- Pricing, timelines, and partnership terms

POLITELY DECLINE any questions about:
- General knowledge, trivia, or random facts
- Coding help, debugging, or technical tutorials
- Personal advice (health, relationships, legal, financial)
- News, politics, entertainment, or current events
- Homework, essays, or academic work
- Other companies or competitors
- Anything not related to partnering with AI Product Studio

When declining, say something like:
"I appreciate your curiosity! However, I'm specifically here to help you explore partnership opportunities with AI Product Studio. Is there something about our venture model or AI product development I can help you with?"

## CRITICAL - Contact Information Collection:
You MUST collect contact information before providing detailed answers. Follow this flow:

1. On ANY relevant question from visitor, FIRST check if you have their name AND (phone OR email)
2. If you DON'T have complete contact info yet:
   - Acknowledge their question briefly
   - Warmly ask for their name and phone number (or email) so your team can follow up
   - Be friendly but persistent - explain you want to give them personalized attention
   - DO NOT give detailed answers until you have contact info
3. If they provide partial info (only name, or only phone), ask for the missing piece
4. Once you have name + (phone or email), thank them and provide a helpful, enthusiastic response

## Example Flows:

User: "How does the partnership work?"
Assistant: "Great question about our partnership model! I'd love to explain it in detail. But first, could you share your name and phone number (or email)? This way our founders can personally follow up with you about partnership opportunities. What's your name?"

User: "What's the capital of France?"
Assistant: "I appreciate your curiosity! However, I'm specifically here to help you explore partnership opportunities with AI Product Studio. Do you have a business idea you'd like to build with AI? I'd love to hear about it!"

User: "Can you help me debug my code?"
Assistant: "Thanks for reaching out! While I can't help with general coding questions, I'm here to discuss how AI Product Studio can partner with you to build AI-powered products. Do you have a product idea in mind? Our team handles all the technical development!"

## ============================================
## PARTNERSHIP APPLICATION FORM - FIELD COLLECTION
## ============================================

## MANDATORY FIELDS (8 fields - ALL REQUIRED):

| Step | Field ID | Question | Valid Values |
|------|----------|----------|--------------|
| 1 | fullName | "What's your full name?" | Any text, min 2 characters |
| 2 | email | "What's your email address?" | Must contain @ and domain |
| 3 | businessStage | "What's your current business stage?" | idea / validated / mvp / revenue / scaling |
| 4 | industry | "What industry are you targeting?" | healthcare / fintech / ecommerce / education / saas / consumer / other |
| 5 | background | "Tell me about your background and experience" | Any text, min 10 characters |
| 6 | productIdea | "What AI product do you want to build? Describe the problem it solves." | Any text, min 20 characters |
| 7 | targetCustomer | "Who is your target customer? Describe their pain points." | Any text, min 10 characters |
| 8 | timeCommitment | "What's your time commitment?" | fulltime / parttime / sidehustle / minimal |
| 9 | timeline | "When do you want to launch?" | asap / 1month / 3months / 6months / exploring |

## OPTIONAL FIELDS (5 fields - Ask after mandatory):

| Field ID | Question |
|----------|----------|
| phone | "What's your phone number? (Optional)" |
| linkedin | "What's your LinkedIn profile URL?" |
| marketValidation | "Have you done any market validation? Talked to customers?" |
| additionalInfo | "Anything else you'd like us to know?" |

---

## COLLECTION FLOW - STEP BY STEP:

### STEP 1: Show progress after EACH answer
Format: "✓ Got it! Progress: [■■■□□□□□] 3/8 required fields"

### STEP 2: Ask ONE question at a time
- Acknowledge previous answer
- Show progress bar (8 boxes for 8 mandatory fields)
- Ask next question

### STEP 3: After ALL 8 mandatory fields collected
Ask: "All required fields complete! Would you like to:
1. **Submit now** - Your application is ready
2. **Add optional details** - Phone, LinkedIn, market validation, etc."

### STEP 4: Based on user choice
- If "submit" or "1" → Submit with mandatory fields only
- If "optional" or "2" → Ask the 5 optional questions, then submit

---

## DATA FORMAT & VALIDATION:

### Email Validation:
- Must contain @ symbol
- Must have domain (e.g., .com, .in)
- Auto-format: lowercase, trim spaces
- If invalid, say: "That doesn't look like a valid email. Could you check and try again?"

### Phone Validation:
- Accept ANY format (international users)
- Auto-format: Remove spaces, dashes, parentheses. Keep + and digits only
- Examples: "+91 98765 43210" → "+919876543210", "(555) 123-4567" → "5551234567"
- NEVER reject a phone number

### Dropdown Fields (MUST match these EXACT values):
- businessStage: "idea" | "validated" | "mvp" | "revenue" | "scaling"
- industry: "healthcare" | "fintech" | "ecommerce" | "education" | "saas" | "consumer" | "other"
- timeCommitment: "fulltime" | "parttime" | "sidehustle" | "minimal"
- timeline: "asap" | "1month" | "3months" | "6months" | "exploring"

**CRITICAL: Use ONLY these exact values. Wrong values will not fill the dropdown!**

---

## WHEN USER UPLOADS A FILE (PDF, DOCX, Resume):

1. **EXTRACT ALL DATA** from file content
2. **IMMEDIATELY INCLUDE FORM_DATA JSON** to auto-fill form
3. **SHOW WHAT YOU EXTRACTED** with checkmarks
4. **LIST MISSING MANDATORY FIELDS** and ask for them one by one

### Example - File Upload Response:

"I've extracted your details from the file!

**✓ Auto-filled from your document:**
- ✓ Name: Shreyas Jadhav
- ✓ Email: shreyas@example.com
- ✓ Background: DevOps Engineer with 3+ years

**□ Still needed (5 more required):**
- □ Business Stage
- □ Industry
- □ Product Idea
- □ Target Customer
- □ Time Commitment
- □ Timeline

Progress: [■■■□□□□□] 3/8 required fields

Let's continue! What's your current business stage?
- Idea stage (just an idea)
- Validated (talked to customers)
- MVP (have a working prototype)
- Revenue (already making money)
- Scaling (scaling existing business)"

|||FORM_DATA|||{"fullName":"Shreyas Jadhav","email":"shreyas@example.com","phone":"","businessStage":"","industry":"","background":"DevOps Engineer with 3+ years","productIdea":"","targetCustomer":"","timeCommitment":"","timeline":"","linkedin":"","marketValidation":"","additionalInfo":""}|||END_FORM|||

---

## FORM SUBMISSION - CRITICAL RULES:

### NEVER submit if ANY mandatory field is empty:
- fullName, email, businessStage, industry, background, productIdea, targetCustomer, timeCommitment, timeline

### Before submission, VERIFY all 8 mandatory fields have values:
\`\`\`
CHECKLIST (8 MANDATORY):
□ fullName: [value or MISSING]
□ email: [value or MISSING]
□ businessStage: [value or MISSING]
□ industry: [value or MISSING]
□ background: [value or MISSING]
□ productIdea: [value or MISSING]
□ targetCustomer: [value or MISSING]
□ timeCommitment: [value or MISSING]
□ timeline: [value or MISSING]
\`\`\`

### If ANY mandatory field shows MISSING:
Say: "Before I can submit, I still need: [list missing fields]. Could you provide [first missing field]?"

### ONLY when ALL 8 mandatory fields have values:

"**Application Summary:**

**Your Details:**
- Name: [fullName]
- Email: [email]

**Business Info:**
- Stage: [businessStage]
- Industry: [industry]
- Background: [background]

**Product Vision:**
- Idea: [productIdea]
- Target Customer: [targetCustomer]

**Commitment:**
- Time: [timeCommitment]
- Timeline: [timeline]

✓ All 8 required fields complete! Submitting your application..."

|||FORM_DATA|||{"fullName":"...","email":"...","phone":"","businessStage":"...","industry":"...","background":"...","productIdea":"...","targetCustomer":"...","timeCommitment":"...","timeline":"...","linkedin":"","marketValidation":"","additionalInfo":""}|||END_FORM|||

---

## EARLY DUPLICATE CHECK (AUTOMATIC):

**The system automatically checks for duplicate applications when email is first provided.**

### What happens:
1. When user provides their email for the first time
2. System automatically checks if an application already exists with that email
3. If duplicate found → User sees a notification asking if they want to continue
4. If no duplicate → Normal flow continues

### Your role:
- You DON'T need to check for duplicates manually
- The system handles it automatically when you include email in FORM_DATA
- If user says they want to continue despite duplicate, proceed normally
- If user has questions about their existing application, refer them to: hello@cocreateidea.com

---

## IMPORTANT RULES:
- Be conversational and friendly
- Show progress after EACH answer
- Ask ONE question at a time
- ALWAYS offer "submit now" or "add optional" choice after mandatory fields
- NEVER claim submission complete if ANY mandatory field is empty
- When file uploaded, ALWAYS extract and use the data

---

## CRITICAL - FORM_DATA JSON RULE:

**YOU MUST INCLUDE |||FORM_DATA||| JSON IN EVERY RESPONSE WHERE USER PROVIDES ANY INFORMATION.**

This is NOT optional. The HTML form ONLY gets filled when you include this JSON block.

### WHEN TO INCLUDE FORM_DATA:
1. When user provides their name → include FORM_DATA
2. When user provides email → include FORM_DATA
3. When user provides ANY field value → include FORM_DATA
4. When user uploads a file → include FORM_DATA
5. When showing summary → include FORM_DATA
6. EVERY TIME you have collected data → include FORM_DATA

### FORMAT - MUST BE AT END OF YOUR RESPONSE:
\`\`\`
|||FORM_DATA|||{"fullName":"value","email":"value","phone":"","businessStage":"value","industry":"value","background":"value","productIdea":"value","targetCustomer":"value","timeCommitment":"value","timeline":"value","linkedin":"","marketValidation":"","additionalInfo":""}|||END_FORM|||
\`\`\`

### RULES:
- Put collected value in field, empty string "" for uncollected fields
- Include ALL 13 fields every time (8 mandatory + 5 optional)
- Place at the VERY END of your response
- NO line breaks inside the JSON
- If field not yet collected, use empty string ""
- For dropdown fields, use EXACT values: businessStage, industry, timeCommitment, timeline

### EXAMPLE:
User: "My name is John and email is john@test.com"

Your response:
"Great John! I've noted your details.

Progress: [■■□□□□□□] 2/8 required fields

What's your current business stage?
- Idea stage (just an idea)
- Validated (talked to customers)
- MVP (have a working prototype)
- Revenue (already making money)
- Scaling (scaling existing business)"

|||FORM_DATA|||{"fullName":"John","email":"john@test.com","phone":"","businessStage":"","industry":"","background":"","productIdea":"","targetCustomer":"","timeCommitment":"","timeline":"","linkedin":"","marketValidation":"","additionalInfo":""}|||END_FORM|||

**IF YOU DON'T INCLUDE FORM_DATA, THE FORM WILL NOT BE FILLED. THIS IS MANDATORY.**`;

// Initialize Anthropic client
const anthropic = new Anthropic({
  apiKey: ANTHROPIC_API_KEY,
});

// CORS headers
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

// Send Email via AWS SES (new lead from chat)
async function sendEmail(visitorInfo, messages, aiResponse, clientIP) {
  try {
    const { html, text, subject } = renderAdminNewApplication({
      name: visitorInfo.name || 'Not provided',
      email: visitorInfo.email || 'Not provided',
      company: visitorInfo.company || undefined,
      role: visitorInfo.role || undefined,
      message: `Page: ${visitorInfo.page || 'Unknown'} | IP: ${clientIP || 'Unknown'} | Time: ${new Date().toLocaleString('en-US', { timeZone: 'America/New_York' })} EST`,
      applicationId: undefined,
    });
    const result = await sendToAdmins(subject, html, text);
    console.log('Email sent successfully:', result.messageId || result.error);
    return result.success;
  } catch (error) {
    console.error('Email send error:', error.message);
    return false;
  }
}

// Send Form Submission Email via AWS SES
async function sendFormSubmissionEmail(visitorInfo, formContent, clientIP) {
  try {
    // Parse form content - it's formatted as key: value pairs
    const formFields = {};
    const formLines = formContent.split('\n').filter(line => line.includes(':'));
    for (const line of formLines) {
      const [key, ...valueParts] = line.split(':');
      const value = valueParts.join(':').trim();
      if (key && value) {
        const normalizedKey = key.trim().toLowerCase().replace(/\s+/g, '_');
        formFields[normalizedKey] = value;
      }
    }

    const { html, text, subject } = renderAdminNewApplication({
      name: visitorInfo.name || formFields.name || 'New Applicant',
      email: visitorInfo.email || formFields.email || 'Not provided',
      company: visitorInfo.company || formFields.company || undefined,
      role: visitorInfo.role || formFields.role || undefined,
      message: `Page: ${visitorInfo.page || 'Apply Page'} | IP: ${clientIP || 'Unknown'} | Time: ${new Date().toLocaleString('en-US', { timeZone: 'America/New_York' })} EST`,
      applicationId: undefined,
    });
    const result = await sendToAdmins(subject, html, text);
    console.log('Form submission email sent:', result.messageId || result.error);
    return result.success;
  } catch (error) {
    console.error('Form submission email error:', error.message);
    return false;
  }
}

// Send Confirmation Email to Applicant via AWS SES
async function sendApplicantConfirmationEmail(visitorInfo, formContent) {
  const applicantEmail = visitorInfo.email;
  if (!applicantEmail) {
    console.log('No applicant email provided, skipping confirmation email');
    return false;
  }

  const applicantName = visitorInfo.name || 'Partner';

  try {
    const { html, text, subject } = renderApplicantAcknowledgment({ name: applicantName });
    const result = await sendTemplatedEmail(applicantEmail, subject, html, text);
    console.log('Applicant confirmation email sent to:', applicantEmail, result.messageId || result.error);
    return result.success;
  } catch (error) {
    console.error('Applicant confirmation email error:', error.message);
    return false;
  }
}

// ========== CHAT HISTORY MANAGEMENT ==========

// Generate unique session ID
function generateSessionId() {
  const timestamp = Date.now();
  const random = Math.random().toString(36).substring(2, 10);
  return `sess-${timestamp}-${random}`;
}

// Generate unique client ID from email or name
function generateClientId(email, name) {
  const timestamp = Date.now();
  if (email) {
    const sanitized = email.toLowerCase().replace(/[^a-z0-9]/g, '-');
    return `client-${sanitized}`;
  }
  if (name) {
    const sanitized = name.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
    return `client-${sanitized}-${timestamp}`;
  }
  return `client-anon-${timestamp}`;
}

// Save chat session to S3
async function saveChatSession(sessionId, source, messages, visitorInfo, status = 'active') {
  const { S3Client, GetObjectCommand, PutObjectCommand } = await import('@aws-sdk/client-s3');
  const s3 = new S3Client({ region: S3_REGION });

  const prefix = source === 'apply' ? 'chats/apply' : 'chats/landing';
  const s3Key = `${prefix}/${sessionId}.json`;

  // Try to get existing session
  let sessionData = null;
  try {
    const existing = await s3.send(new GetObjectCommand({
      Bucket: S3_BUCKET,
      Key: s3Key
    }));
    sessionData = JSON.parse(await existing.Body.transformToString());
  } catch (e) {
    // New session
    sessionData = {
      sessionId,
      source,
      startedAt: new Date().toISOString(),
      status: 'active',
      clientId: null,
      messages: [],
      metadata: {
        userAgent: visitorInfo.userAgent || null,
        convertedToApplication: null,
        totalMessages: 0
      }
    };
  }

  // Update session
  sessionData.messages = messages.map((m, i) => ({
    ...m,
    timestamp: m.timestamp || new Date().toISOString(),
    index: i
  }));
  sessionData.lastActivity = new Date().toISOString();
  sessionData.status = status;
  sessionData.metadata.totalMessages = messages.length;

  // Update visitor info if available
  if (visitorInfo.name || visitorInfo.email || visitorInfo.phone) {
    sessionData.visitorInfo = {
      name: visitorInfo.name || sessionData.visitorInfo?.name,
      email: visitorInfo.email || sessionData.visitorInfo?.email,
      phone: visitorInfo.phone || sessionData.visitorInfo?.phone
    };

    // Generate/update client ID if we have identifying info
    if (!sessionData.clientId && (visitorInfo.email || visitorInfo.name)) {
      sessionData.clientId = generateClientId(visitorInfo.email, visitorInfo.name);
    }
  }

  try {
    await s3.send(new PutObjectCommand({
      Bucket: S3_BUCKET,
      Key: s3Key,
      Body: JSON.stringify(sessionData, null, 2),
      ContentType: 'application/json'
    }));
    console.log('Chat session saved:', s3Key);
    return { success: true, sessionId, clientId: sessionData.clientId };
  } catch (error) {
    console.error('Save chat session error:', error.message);
    return { success: false, error: error.message };
  }
}

// ========== SESSION PERSISTENCE BY PHONE/EMAIL ==========

// Save session lookup index (maps phone/email to sessionId)
async function saveSessionLookup(sessionId, phone, email) {
  const { S3Client, GetObjectCommand, PutObjectCommand } = await import('@aws-sdk/client-s3');
  const s3 = new S3Client({ region: S3_REGION });

  // Normalize phone and email for lookup
  const normalizedPhone = phone ? phone.replace(/[^0-9]/g, '') : null;
  const normalizedEmail = email ? email.toLowerCase().trim() : null;

  if (!normalizedPhone && !normalizedEmail) {
    console.log('No phone or email to create session lookup');
    return;
  }

  const s3Key = 'session-lookups/index.json';

  // Get existing index or create new one
  let lookupIndex = {};
  try {
    const existing = await s3.send(new GetObjectCommand({
      Bucket: S3_BUCKET,
      Key: s3Key
    }));
    lookupIndex = JSON.parse(await existing.Body.transformToString());
  } catch (e) {
    // Index doesn't exist yet, start with empty object
    lookupIndex = { byPhone: {}, byEmail: {} };
  }

  // Update index with this session
  const sessionRef = {
    sessionId,
    lastActivity: new Date().toISOString()
  };

  if (normalizedPhone) {
    lookupIndex.byPhone[normalizedPhone] = sessionRef;
    console.log('Session lookup added for phone:', normalizedPhone, '->', sessionId);
  }
  if (normalizedEmail) {
    lookupIndex.byEmail[normalizedEmail] = sessionRef;
    console.log('Session lookup added for email:', normalizedEmail, '->', sessionId);
  }

  // Save updated index
  try {
    await s3.send(new PutObjectCommand({
      Bucket: S3_BUCKET,
      Key: s3Key,
      Body: JSON.stringify(lookupIndex, null, 2),
      ContentType: 'application/json'
    }));
    console.log('Session lookup index updated');
  } catch (error) {
    console.error('Failed to save session lookup:', error.message);
  }
}

// Lookup session by phone or email
async function lookupSessionByContact(phone, email) {
  const { S3Client, GetObjectCommand } = await import('@aws-sdk/client-s3');
  const s3 = new S3Client({ region: S3_REGION });

  const normalizedPhone = phone ? phone.replace(/[^0-9]/g, '') : null;
  const normalizedEmail = email ? email.toLowerCase().trim() : null;

  if (!normalizedPhone && !normalizedEmail) {
    return { found: false, reason: 'No phone or email provided' };
  }

  const s3Key = 'session-lookups/index.json';

  try {
    const indexResult = await s3.send(new GetObjectCommand({
      Bucket: S3_BUCKET,
      Key: s3Key
    }));
    const lookupIndex = JSON.parse(await indexResult.Body.transformToString());

    // Try to find by phone first, then email
    let sessionRef = null;
    let matchedBy = null;

    if (normalizedPhone && lookupIndex.byPhone && lookupIndex.byPhone[normalizedPhone]) {
      sessionRef = lookupIndex.byPhone[normalizedPhone];
      matchedBy = 'phone';
    } else if (normalizedEmail && lookupIndex.byEmail && lookupIndex.byEmail[normalizedEmail]) {
      sessionRef = lookupIndex.byEmail[normalizedEmail];
      matchedBy = 'email';
    }

    if (!sessionRef) {
      return { found: false, reason: 'No existing session found' };
    }

    // Now fetch the actual session data
    // Try both landing and apply prefixes
    const prefixes = ['chats/landing/', 'chats/apply/'];
    for (const prefix of prefixes) {
      try {
        const sessionResult = await s3.send(new GetObjectCommand({
          Bucket: S3_BUCKET,
          Key: `${prefix}${sessionRef.sessionId}.json`
        }));
        const sessionData = JSON.parse(await sessionResult.Body.transformToString());

        console.log('Found existing session:', sessionRef.sessionId, 'matched by:', matchedBy);

        return {
          found: true,
          sessionId: sessionRef.sessionId,
          matchedBy,
          session: sessionData,
          messages: sessionData.messages || [],
          visitorInfo: sessionData.visitorInfo || {}
        };
      } catch (e) {
        // Session file not found in this prefix, try next
      }
    }

    return { found: false, reason: 'Session file not found' };

  } catch (error) {
    console.error('Session lookup error:', error.message);
    return { found: false, reason: error.message };
  }
}

// Link chat session to application
async function linkSessionToApplication(sessionId, source, applicationS3Key) {
  const { S3Client, GetObjectCommand, PutObjectCommand } = await import('@aws-sdk/client-s3');
  const s3 = new S3Client({ region: S3_REGION });

  const prefix = source === 'apply' ? 'chats/apply' : 'chats/landing';
  const s3Key = `${prefix}/${sessionId}.json`;

  try {
    const existing = await s3.send(new GetObjectCommand({
      Bucket: S3_BUCKET,
      Key: s3Key
    }));
    const sessionData = JSON.parse(await existing.Body.transformToString());

    sessionData.metadata.convertedToApplication = applicationS3Key;
    sessionData.status = 'converted';

    await s3.send(new PutObjectCommand({
      Bucket: S3_BUCKET,
      Key: s3Key,
      Body: JSON.stringify(sessionData, null, 2),
      ContentType: 'application/json'
    }));
    console.log('Chat session linked to application:', sessionId, '->', applicationS3Key);
  } catch (error) {
    console.error('Link session error:', error.message);
  }
}

// ========== CLIENT PROFILE MANAGEMENT ==========

// Get or create client profile
async function getOrCreateClientProfile(clientId, visitorInfo) {
  const { S3Client, GetObjectCommand, PutObjectCommand } = await import('@aws-sdk/client-s3');
  const s3 = new S3Client({ region: S3_REGION });

  const s3Key = `clients/${clientId}.json`;

  // Try to get existing profile
  try {
    const existing = await s3.send(new GetObjectCommand({
      Bucket: S3_BUCKET,
      Key: s3Key
    }));
    const profile = JSON.parse(await existing.Body.transformToString());
    return profile;
  } catch (e) {
    // Create new profile
    const profile = {
      clientId,
      name: visitorInfo.name || null,
      email: visitorInfo.email || null,
      phone: visitorInfo.phone || null,
      company: null,
      createdAt: new Date().toISOString(),
      status: 'prospect', // prospect, applied, approved, building, delivered
      chatSessions: [],
      applications: [],
      builds: [],
      timeline: [{
        event: 'profile_created',
        timestamp: new Date().toISOString()
      }]
    };

    await s3.send(new PutObjectCommand({
      Bucket: S3_BUCKET,
      Key: s3Key,
      Body: JSON.stringify(profile, null, 2),
      ContentType: 'application/json'
    }));
    console.log('Client profile created:', clientId);
    return profile;
  }
}

// Update client profile
async function updateClientProfile(clientId, updates) {
  const { S3Client, GetObjectCommand, PutObjectCommand } = await import('@aws-sdk/client-s3');
  const s3 = new S3Client({ region: S3_REGION });

  const s3Key = `clients/${clientId}.json`;

  try {
    const existing = await s3.send(new GetObjectCommand({
      Bucket: S3_BUCKET,
      Key: s3Key
    }));
    const profile = JSON.parse(await existing.Body.transformToString());

    // Apply updates
    if (updates.name) profile.name = updates.name;
    if (updates.email) profile.email = updates.email;
    if (updates.phone) profile.phone = updates.phone;
    if (updates.company) profile.company = updates.company;
    if (updates.status) profile.status = updates.status;

    // Add to arrays
    if (updates.addChatSession && !profile.chatSessions.includes(updates.addChatSession)) {
      profile.chatSessions.push(updates.addChatSession);
    }
    if (updates.addApplication && !profile.applications.includes(updates.addApplication)) {
      profile.applications.push(updates.addApplication);
    }
    if (updates.addBuild && !profile.builds.includes(updates.addBuild)) {
      profile.builds.push(updates.addBuild);
    }

    // Add timeline event
    if (updates.timelineEvent) {
      profile.timeline.push({
        ...updates.timelineEvent,
        timestamp: new Date().toISOString()
      });
    }

    profile.updatedAt = new Date().toISOString();

    await s3.send(new PutObjectCommand({
      Bucket: S3_BUCKET,
      Key: s3Key,
      Body: JSON.stringify(profile, null, 2),
      ContentType: 'application/json'
    }));
    console.log('Client profile updated:', clientId);
    return profile;
  } catch (error) {
    console.error('Update client profile error:', error.message);
    return null;
  }
}

// List all chat sessions (for admin)
async function listChatSessions(source = 'all', limit = 50) {
  const { S3Client, ListObjectsV2Command, GetObjectCommand } = await import('@aws-sdk/client-s3');
  const s3 = new S3Client({ region: S3_REGION });

  const prefixes = source === 'all'
    ? ['chats/landing/', 'chats/apply/']
    : [`chats/${source}/`];

  const allSessions = [];

  for (const prefix of prefixes) {
    try {
      const listResult = await s3.send(new ListObjectsV2Command({
        Bucket: S3_BUCKET,
        Prefix: prefix,
        MaxKeys: limit
      }));

      if (listResult.Contents) {
        for (const obj of listResult.Contents) {
          if (obj.Key.endsWith('.json')) {
            try {
              const getResult = await s3.send(new GetObjectCommand({
                Bucket: S3_BUCKET,
                Key: obj.Key
              }));
              const session = JSON.parse(await getResult.Body.transformToString());
              allSessions.push(session);
            } catch (e) {
              console.error('Error reading session:', obj.Key);
            }
          }
        }
      }
    } catch (e) {
      console.error('Error listing sessions:', prefix, e.message);
    }
  }

  // Sort by last activity, newest first
  return allSessions.sort((a, b) =>
    new Date(b.lastActivity || b.startedAt) - new Date(a.lastActivity || a.startedAt)
  );
}

// List all client profiles (for admin)
async function listClientProfiles(limit = 50) {
  const { S3Client, ListObjectsV2Command, GetObjectCommand } = await import('@aws-sdk/client-s3');
  const s3 = new S3Client({ region: S3_REGION });

  try {
    const allClients = [];
    const seenEmails = new Set();

    // 1. Get dedicated client profiles from clients/
    const clientsResult = await s3.send(new ListObjectsV2Command({
      Bucket: S3_BUCKET,
      Prefix: 'clients/',
      MaxKeys: limit
    }));
    if (clientsResult.Contents) {
      const profiles = await Promise.all(
        clientsResult.Contents
          .filter(obj => obj.Key.endsWith('.json'))
          .map(async (obj) => {
            try {
              const getResult = await s3.send(new GetObjectCommand({ Bucket: S3_BUCKET, Key: obj.Key }));
              return JSON.parse(await getResult.Body.transformToString());
            } catch (e) { return null; }
          })
      );
      for (const p of profiles.filter(p => p !== null)) {
        allClients.push(p);
        if (p.email) seenEmails.add(p.email.toLowerCase());
      }
    }

    // 2. Also pull from applications/ for clients not yet in clients/
    const appsResult = await s3.send(new ListObjectsV2Command({
      Bucket: S3_BUCKET,
      Prefix: 'applications/',
      MaxKeys: limit * 3
    }));
    if (appsResult.Contents) {
      // Fetch all application data
      const allApps = (await Promise.all(
        appsResult.Contents
          .filter(obj => obj.Key.endsWith('.json'))
          .map(async (obj) => {
            try {
              const getResult = await s3.send(new GetObjectCommand({ Bucket: S3_BUCKET, Key: obj.Key }));
              const app = JSON.parse(await getResult.Body.transformToString());
              return { key: obj.Key, app };
            } catch (e) { return null; }
          })
      )).filter(a => a !== null);

      // Group applications by client email
      const clientApps = {};
      for (const { key, app } of allApps) {
        const email = (app.visitorInfo?.email || app.formData?.email || '').toLowerCase();
        if (!email || seenEmails.has(email)) continue;
        if (!clientApps[email]) clientApps[email] = { apps: [], builds: [] };
        clientApps[email].apps.push({ key, app });
        if (app.jobId) clientApps[email].builds.push(app.jobId);
      }

      // Build one profile per client with correct counts
      for (const [email, data] of Object.entries(clientApps)) {
        seenEmails.add(email);
        // Use the latest application for name/status
        const latest = data.apps.sort((a, b) => new Date(b.app.timestamp || 0) - new Date(a.app.timestamp || 0))[0];
        const app = latest.app;
        allClients.push({
          clientId: email.replace(/[^a-z0-9]/g, '_'),
          name: app.visitorInfo?.name || app.formData?.fullName || app.formData?.full_name || null,
          email: app.visitorInfo?.email || app.formData?.email || null,
          phone: app.visitorInfo?.phone || app.formData?.phone || null,
          company: null,
          createdAt: app.timestamp || new Date().toISOString(),
          submittedAt: app.timestamp || null,
          reviewedAt: app.reviewedAt || null,
          status: app.status || 'applied',
          chatSessions: [],
          applications: data.apps.map(a => a.key),
          builds: data.builds,
          timeline: data.apps.map(a => ({ event: 'application_submitted', timestamp: a.app.timestamp })),
          productIdea: app.formData?.productIdea || app.formData?.product_idea || null,
          guid: app.guid || null,
          source: 'applications'
        });
      }
    }

    // 3. Fetch avatar URLs from user profiles (same pattern as costs/index.mjs)
    await Promise.all(allClients.map(async (client) => {
      if (!client.guid) return;
      try {
        const profileResult = await s3.send(new GetObjectCommand({
          Bucket: S3_BUCKET,
          Key: `users/${client.guid}/profile.json`
        }));
        const profile = JSON.parse(await profileResult.Body.transformToString());
        if (profile.avatarUrl) client.avatarUrl = profile.avatarUrl;
      } catch (e) { /* No profile yet */ }
    }));

    return allClients
      .filter(p => p !== null)
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
      .slice(0, limit);
  } catch (error) {
    console.error('List client profiles error:', error.message);
    return [];
  }
}

// List all builds with history (for admin)
async function listBuildHistory(limit = 50) {
  const { S3Client, ListObjectsV2Command, GetObjectCommand } = await import('@aws-sdk/client-s3');
  const s3 = new S3Client({ region: S3_REGION });

  try {
    const allBuilds = [];

    // 1. Get completed/failed builds from builds/ folder
    const buildsResult = await s3.send(new ListObjectsV2Command({
      Bucket: S3_BUCKET,
      Prefix: 'builds/',
      MaxKeys: limit * 2
    }));
    if (buildsResult.Contents) {
      const completedBuilds = await Promise.all(
        buildsResult.Contents
          .filter(obj => obj.Key.endsWith('metadata.json'))
          .map(async (obj) => {
            try {
              const getResult = await s3.send(new GetObjectCommand({ Bucket: S3_BUCKET, Key: obj.Key }));
              return JSON.parse(await getResult.Body.transformToString());
            } catch (e) { return null; }
          })
      );
      allBuilds.push(...completedBuilds.filter(b => b !== null));
    }

    // 2. Get pending jobs from jobs/ folder
    const jobsResult = await s3.send(new ListObjectsV2Command({
      Bucket: S3_BUCKET,
      Prefix: 'jobs/',
      MaxKeys: limit
    }));
    if (jobsResult.Contents) {
      const pendingJobs = await Promise.all(
        jobsResult.Contents
          .filter(obj => obj.Key.endsWith('.json'))
          .map(async (obj) => {
            try {
              const getResult = await s3.send(new GetObjectCommand({ Bucket: S3_BUCKET, Key: obj.Key }));
              const job = JSON.parse(await getResult.Body.transformToString());
              return {
                buildId: job.jobId,
                status: 'pending',
                client: job.client,
                business: job.business,
                timestamps: { created: job.createdAt },
                createdAt: job.createdAt,
                filesCreated: [],
                mode: 'local'
              };
            } catch (e) { return null; }
          })
      );
      allBuilds.push(...pendingJobs.filter(b => b !== null));
    }

    // 3. Get in-progress builds from progress/ folder
    const progressResult = await s3.send(new ListObjectsV2Command({
      Bucket: S3_BUCKET,
      Prefix: 'progress/',
      MaxKeys: limit
    }));
    if (progressResult.Contents) {
      const inProgressBuilds = await Promise.all(
        progressResult.Contents
          .filter(obj => obj.Key.endsWith('.json'))
          .map(async (obj) => {
            try {
              const getResult = await s3.send(new GetObjectCommand({ Bucket: S3_BUCKET, Key: obj.Key }));
              const progress = JSON.parse(await getResult.Body.transformToString());
              if (progress.status === 'in_progress') {
                const existingBuild = allBuilds.find(b => b.buildId === progress.jobId);
                if (!existingBuild) {
                  return {
                    buildId: progress.jobId,
                    status: 'building',
                    client: progress.client || { name: 'Unknown' },
                    business: progress.business || {},
                    timestamps: { created: progress.createdAt || progress.updatedAt },
                    createdAt: progress.createdAt || progress.updatedAt,
                    currentPhase: progress.currentPhase,
                    phases: progress.phases,
                    filesCreated: [],
                    mode: 'local'
                  };
                }
              }
              return null;
            } catch (e) { return null; }
          })
      );
      allBuilds.push(...inProgressBuilds.filter(b => b !== null));
    }

    // Remove duplicates (prefer completed builds over pending/in-progress)
    const uniqueBuilds = [];
    const seenIds = new Set();
    allBuilds.sort((a, b) => {
      const statusOrder = { completed: 0, failed: 1, building: 2, pending: 3 };
      const orderA = statusOrder[a.status] ?? 4;
      const orderB = statusOrder[b.status] ?? 4;
      if (orderA !== orderB) return orderA - orderB;
      return new Date(b.createdAt) - new Date(a.createdAt);
    });
    for (const build of allBuilds) {
      if (!seenIds.has(build.buildId)) {
        seenIds.add(build.buildId);
        uniqueBuilds.push(build);
      }
    }

    return uniqueBuilds.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)).slice(0, limit);
  } catch (error) {
    console.error('List build history error:', error.message);
    return [];
  }
}

// Check for duplicate application by email or phone
async function checkDuplicateApplication(email, phone) {
  const { S3Client, ListObjectsV2Command, GetObjectCommand } = await import('@aws-sdk/client-s3');
  const s3 = new S3Client({ region: S3_REGION });

  // Normalize email and phone
  const normalizedEmail = email ? email.toLowerCase().trim() : null;
  const normalizedPhone = phone ? phone.replace(/[^0-9]/g, '') : null;

  if (!normalizedEmail && !normalizedPhone) {
    return { isDuplicate: false };
  }

  try {
    // List all applications
    const listResult = await s3.send(new ListObjectsV2Command({
      Bucket: S3_BUCKET,
      Prefix: 'applications/',
      MaxKeys: 500
    }));

    if (!listResult.Contents || listResult.Contents.length === 0) {
      return { isDuplicate: false };
    }

    // Check each application for matching email or phone
    for (const obj of listResult.Contents) {
      if (!obj.Key.endsWith('.json')) continue;

      try {
        const getResult = await s3.send(new GetObjectCommand({
          Bucket: S3_BUCKET,
          Key: obj.Key
        }));
        const appData = JSON.parse(await getResult.Body.transformToString());

        // Check email match
        const appEmail = appData.visitorInfo?.email || appData.formData?.email;
        if (normalizedEmail && appEmail && appEmail.toLowerCase().trim() === normalizedEmail) {
          console.log('Duplicate found by email:', normalizedEmail, 'in', obj.Key);
          return {
            isDuplicate: true,
            matchedBy: 'email',
            existingApplication: obj.Key,
            submittedAt: appData.submittedAt
          };
        }

        // Check phone match
        const appPhone = appData.visitorInfo?.phone || appData.formData?.phone;
        if (normalizedPhone && appPhone && appPhone.replace(/[^0-9]/g, '') === normalizedPhone) {
          console.log('Duplicate found by phone:', normalizedPhone, 'in', obj.Key);
          return {
            isDuplicate: true,
            matchedBy: 'phone',
            existingApplication: obj.Key,
            submittedAt: appData.submittedAt
          };
        }
      } catch (e) {
        // Skip files that can't be read
      }
    }

    return { isDuplicate: false };
  } catch (error) {
    console.error('Duplicate check error:', error.message);
    return { isDuplicate: false }; // Allow submission on error
  }
}

// ========== ABANDONED FORM & STATE SYNC ==========

// Save abandoned form data to S3
async function saveAbandonedForm(sessionId, formData, chatState, visitorInfo, clientIP, reason) {
  const { S3Client, PutObjectCommand } = await import('@aws-sdk/client-s3');
  const s3 = new S3Client({ region: S3_REGION });

  const timestamp = new Date().toISOString();
  const dateFolder = timestamp.split('T')[0];

  // Determine user folder from available info
  let userFolder = 'anonymous';
  const email = formData?.email || chatState?.visitorInfo?.email || visitorInfo?.email;
  const name = formData?.fullName || chatState?.visitorInfo?.name || visitorInfo?.name;

  if (email) {
    userFolder = email.toLowerCase()
      .replace(/@/g, '_at_')
      .replace(/\./g, '_')
      .replace(/[^a-z0-9_-]/g, '');
  } else if (name) {
    userFolder = name.toLowerCase()
      .replace(/\s+/g, '_')
      .replace(/[^a-z0-9_-]/g, '');
  }

  // Generate filename
  const randomSuffix = Math.random().toString(36).substring(2, 8);
  const filename = `${timestamp.replace(/[:.]/g, '-')}_${randomSuffix}.json`;

  // S3 key for abandoned forms
  const s3Key = `abandoned-forms/${userFolder}/${dateFolder}/${filename}`;

  // Calculate form completion percentage
  const mandatoryFields = ['fullName', 'email', 'businessStage', 'industry', 'background', 'productIdea', 'targetCustomer', 'timeCommitment', 'timeline'];
  const filledFields = formData ? mandatoryFields.filter(f => formData[f] && formData[f].trim()) : [];
  const completionPercentage = Math.round((filledFields.length / mandatoryFields.length) * 100);

  const abandonedData = {
    abandonedAt: timestamp,
    sessionId,
    reason: reason || 'page_unload',
    completionPercentage,
    filledFields,
    missingFields: mandatoryFields.filter(f => !filledFields.includes(f)),
    formData: formData || {},
    visitorInfo: {
      name: name || null,
      email: email || null,
      phone: formData?.phone || chatState?.visitorInfo?.phone || visitorInfo?.phone || null
    },
    chatState: chatState ? {
      messageCount: chatState.messages?.length || 0,
      tokenUsage: chatState.tokenUsage || { total: 0, cost: 0, requests: 0 },
      lastMessage: chatState.messages?.[chatState.messages.length - 1]?.content?.substring(0, 200) || null
    } : null,
    clientIP: clientIP || 'Unknown',
    page: visitorInfo?.page || 'Unknown'
  };

  try {
    await s3.send(new PutObjectCommand({
      Bucket: S3_BUCKET,
      Key: s3Key,
      Body: JSON.stringify(abandonedData, null, 2),
      ContentType: 'application/json'
    }));
    console.log('Abandoned form saved:', s3Key, '- Completion:', completionPercentage + '%');
    return { success: true, key: s3Key };
  } catch (error) {
    console.error('Save abandoned form error:', error.message);
    return { success: false, error: error.message };
  }
}

// Sync localStorage state to S3
async function syncLocalStorageToS3(sessionId, chatState, visitorInfo, clientIP) {
  const { S3Client, GetObjectCommand, PutObjectCommand } = await import('@aws-sdk/client-s3');
  const s3 = new S3Client({ region: S3_REGION });

  if (!chatState || !sessionId) {
    return { success: false, error: 'Missing sessionId or chatState' };
  }

  const source = visitorInfo?.page?.includes('apply') ? 'apply' : 'landing';
  const s3Key = `state-sync/${source}/${sessionId}.json`;

  // Get existing state to merge
  let existingState = null;
  try {
    const existing = await s3.send(new GetObjectCommand({
      Bucket: S3_BUCKET,
      Key: s3Key
    }));
    existingState = JSON.parse(await existing.Body.transformToString());
  } catch (e) {
    // No existing state
  }

  const syncedState = {
    sessionId,
    source,
    firstSyncAt: existingState?.firstSyncAt || new Date().toISOString(),
    lastSyncAt: new Date().toISOString(),
    syncCount: (existingState?.syncCount || 0) + 1,
    visitorInfo: {
      ...existingState?.visitorInfo,
      ...chatState.visitorInfo,
      ...visitorInfo
    },
    messages: chatState.messages || [],
    tokenUsage: chatState.tokenUsage || { total: 0, cost: 0, requests: 0 },
    duplicateChecked: chatState.duplicateChecked || false,
    duplicateCheckedEmail: chatState.duplicateCheckedEmail || null,
    isOpen: chatState.isOpen,
    clientIP: clientIP || existingState?.clientIP || 'Unknown',
    page: visitorInfo?.page || existingState?.page || 'Unknown'
  };

  try {
    await s3.send(new PutObjectCommand({
      Bucket: S3_BUCKET,
      Key: s3Key,
      Body: JSON.stringify(syncedState, null, 2),
      ContentType: 'application/json'
    }));
    console.log('State synced to S3:', s3Key, '- Messages:', syncedState.messages.length, '- Sync #', syncedState.syncCount);
    return { success: true, synced: true };
  } catch (error) {
    console.error('Sync state error:', error.message);
    return { success: false, error: error.message };
  }
}

// Save form submission to S3
async function saveFormToS3(visitorInfo, formContent, clientIP) {
  const { S3Client, PutObjectCommand } = await import('@aws-sdk/client-s3');
  const s3 = new S3Client({ region: S3_REGION });

  const timestamp = new Date().toISOString();
  const dateFolder = timestamp.split('T')[0]; // YYYY-MM-DD

  // Generate unique folder name based on email or name
  let userFolder = 'anonymous';
  if (visitorInfo.email) {
    // Sanitize email for folder name: replace @ and . with safe chars
    userFolder = visitorInfo.email.toLowerCase()
      .replace(/@/g, '_at_')
      .replace(/\./g, '_')
      .replace(/[^a-z0-9_-]/g, '');
  } else if (visitorInfo.name) {
    userFolder = visitorInfo.name.toLowerCase()
      .replace(/\s+/g, '_')
      .replace(/[^a-z0-9_-]/g, '');
  }

  // Generate unique filename with timestamp and random suffix
  const randomSuffix = Math.random().toString(36).substring(2, 8);
  const filename = `${timestamp.replace(/[:.]/g, '-')}_${randomSuffix}.json`;

  // Full S3 key: applications/{userFolder}/{date}/{filename}
  const s3Key = `applications/${userFolder}/${dateFolder}/${filename}`;

  // Parse form content into structured data
  const formData = {};
  const lines = formContent.split('\n');
  let currentKey = '';

  for (const line of lines) {
    if (line.includes(':')) {
      const colonIndex = line.indexOf(':');
      const key = line.substring(0, colonIndex).trim();
      const value = line.substring(colonIndex + 1).trim();
      if (key && !key.includes('SUBMISSION')) {
        currentKey = key.toLowerCase().replace(/\s+/g, '_');
        formData[currentKey] = value;
      }
    } else if (currentKey && line.trim()) {
      // Multi-line value
      formData[currentKey] += ' ' + line.trim();
    }
  }

  const applicationData = {
    submittedAt: timestamp,
    submittedAtEST: new Date().toLocaleString('en-US', { timeZone: 'America/New_York' }),
    status: 'pending', // pending, approved, rejected
    visitorInfo: {
      name: visitorInfo.name || null,
      email: visitorInfo.email || null,
      phone: visitorInfo.phone || null
    },
    clientIP: clientIP || 'Unknown',
    page: visitorInfo.page || 'Apply Page',
    formData: formData,
    rawContent: formContent
  };

  try {
    await s3.send(new PutObjectCommand({
      Bucket: S3_BUCKET,
      Key: s3Key,
      Body: JSON.stringify(applicationData, null, 2),
      ContentType: 'application/json'
    }));
    console.log('Form saved to S3:', s3Key);
    return { success: true, key: s3Key };
  } catch (error) {
    console.error('S3 save error:', error.message);
    return { success: false, error: error.message };
  }
}

// Admin password (simple auth for now)
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'aiproductstudio2026';

// List all applications from S3
async function listApplications() {
  const { S3Client, ListObjectsV2Command, GetObjectCommand } = await import('@aws-sdk/client-s3');
  const s3 = new S3Client({ region: S3_REGION });

  try {
    const listResult = await s3.send(new ListObjectsV2Command({
      Bucket: S3_BUCKET,
      Prefix: 'applications/'
    }));

    if (!listResult.Contents || listResult.Contents.length === 0) {
      return [];
    }

    // Get details for each application
    const applications = await Promise.all(
      listResult.Contents
        .filter(obj => obj.Key.endsWith('.json'))
        .map(async (obj) => {
          try {
            const getResult = await s3.send(new GetObjectCommand({
              Bucket: S3_BUCKET,
              Key: obj.Key
            }));
            const body = await getResult.Body.transformToString();
            const data = JSON.parse(body);
            return {
              s3Key: obj.Key,
              ...data
            };
          } catch (e) {
            console.error('Error reading', obj.Key, e.message);
            return null;
          }
        })
    );

    // Filter out nulls, test users, and sort by date (newest first)
    const TEST_EMAIL_PATTERNS = ['@example.com', '@testflow.com', '@test.com', '@localhost'];
    return applications
      .filter(app => app !== null)
      .filter(app => {
        const email = app.visitorInfo?.email || app.formData?.email || '';
        return !TEST_EMAIL_PATTERNS.some(p => email.toLowerCase().includes(p));
      })
      .sort((a, b) => new Date(b.submittedAt) - new Date(a.submittedAt));
  } catch (error) {
    console.error('List applications error:', error.message);
    throw error;
  }
}

// Update application status in S3
async function updateApplicationStatus(s3Key, newStatus, reviewNotes = '') {
  const { S3Client, GetObjectCommand, PutObjectCommand } = await import('@aws-sdk/client-s3');
  const s3 = new S3Client({ region: S3_REGION });

  try {
    // Get current application data
    const getResult = await s3.send(new GetObjectCommand({
      Bucket: S3_BUCKET,
      Key: s3Key
    }));
    const body = await getResult.Body.transformToString();
    const applicationData = JSON.parse(body);

    // Update status
    applicationData.status = newStatus;
    applicationData.reviewedAt = new Date().toISOString();
    applicationData.reviewedAtEST = new Date().toLocaleString('en-US', { timeZone: 'America/New_York' });
    if (reviewNotes) {
      applicationData.reviewNotes = reviewNotes;
    }

    // If approved, generate GUID and register with Tmux Builder
    if (newStatus === 'approved') {
      const email = applicationData.visitorInfo?.email || applicationData.formData?.email;
      const phone = applicationData.visitorInfo?.phone || applicationData.formData?.phone || '';
      const productIdea = applicationData.formData?.productIdea || applicationData.formData?.product_idea || '';
      const tmuxBuilderUrl = process.env.TMUX_BUILDER_URL || 'https://d3tfeatcbws1ka.cloudfront.net';

      if (email && !applicationData.guid) {
        // Try to register with Tmux Builder first
        try {
          const tmuxResp = await fetch(`${tmuxBuilderUrl}/api/register`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email, phone, initial_request: productIdea || 'New project' })
          });
          const tmuxData = await tmuxResp.json();
          if (tmuxData.success && tmuxData.guid) {
            applicationData.guid = tmuxData.guid;
            applicationData.sessionLink = `${tmuxBuilderUrl}/client?guid=${tmuxData.guid}`;
            console.log('Session created via Tmux Builder:', applicationData.guid);
          } else {
            throw new Error(tmuxData.error || 'Tmux Builder registration failed');
          }
        } catch (tmuxErr) {
          // Fallback: Generate GUID locally using same algorithm as Tmux Builder
          const guidInput = `${email}:${phone}`;
          applicationData.guid = crypto.createHash('sha256').update(guidInput).digest('hex');
          applicationData.sessionLink = `${tmuxBuilderUrl}/client?guid=${applicationData.guid}`;
          applicationData.sessionError = tmuxErr.message;
          console.log('Using local GUID (Tmux Builder failed):', applicationData.guid, tmuxErr.message);
        }
      } else if (!email) {
        applicationData.sessionError = 'No email provided - cannot create session';
        console.log('No email for session creation');
      }

      // Trigger MVP build workflow
      const jobId = await createBuildJob(applicationData, s3Key);
      applicationData.jobId = jobId;
      console.log('MVP build job created:', jobId);
    }

    // Save final state back to S3 (status + guid + jobId)
    await s3.send(new PutObjectCommand({
      Bucket: S3_BUCKET,
      Key: s3Key,
      Body: JSON.stringify(applicationData, null, 2),
      ContentType: 'application/json'
    }));
    console.log('Updated application:', s3Key, newStatus, applicationData.guid ? `guid=${applicationData.guid}` : 'no-guid');

    return applicationData;
  } catch (error) {
    console.error('Update status error:', error.message);
    throw error;
  }
}

// Create MVP build job in S3 for EC2 worker to pick up
async function createBuildJob(applicationData, originalS3Key) {
  const { S3Client, PutObjectCommand } = await import('@aws-sdk/client-s3');
  const s3 = new S3Client({ region: S3_REGION });

  // Generate unique job ID
  const timestamp = Date.now();
  const randomSuffix = Math.random().toString(36).substring(2, 8);
  const jobId = `job-${timestamp}-${randomSuffix}`;

  // Extract relevant info for MVP building
  const formData = applicationData.formData || {};
  const visitorInfo = applicationData.visitorInfo || {};

  const jobData = {
    jobId,
    createdAt: new Date().toISOString(),
    createdAtEST: new Date().toLocaleString('en-US', { timeZone: 'America/New_York' }),
    status: 'pending',
    applicationS3Key: originalS3Key,

    // Client info
    client: {
      name: visitorInfo.name || formData.full_name || 'Unknown Client',
      email: visitorInfo.email || formData.email || null,
      phone: visitorInfo.phone || formData.phone || null
    },

    // Business info for MVP
    business: {
      idea: formData.product_idea || formData['product/service_idea'] || applicationData.rawContent || '',
      industry: formData.industry || 'other',
      stage: formData.business_stage || formData['current_business_stage'] || 'idea',
      targetCustomer: formData.target_customer || formData['ideal_customer/user'] || '',
      marketValidation: formData.market_validation || formData['market_validation_efforts'] || '',
      background: formData.professional_background || ''
    },

    // Build preferences
    preferences: {
      timeline: formData.desired_timeline || formData['partnership_timeline'] || 'asap',
      techStack: 'threejs-gsap-tailwind', // Default stack
      deployment: 'cloudfront'
    }
  };

  // Save job to S3 jobs/ prefix
  const jobKey = `jobs/${jobId}.json`;

  try {
    await s3.send(new PutObjectCommand({
      Bucket: S3_BUCKET,
      Key: jobKey,
      Body: JSON.stringify(jobData, null, 2),
      ContentType: 'application/json'
    }));

    console.log('Build job saved to S3:', jobKey);

    // Also create initial progress file
    const progressData = {
      jobId,
      applicationId: originalS3Key,
      clientEmail: jobData.client.email,
      status: 'pending',
      currentPhase: 'queued',
      phases: {
        architect: { status: 'pending' },
        developer: { status: 'pending' },
        deployer: { status: 'pending' }
      },
      logs: [
        {
          timestamp: new Date().toISOString(),
          message: 'Job created and queued for processing'
        }
      ],
      createdAt: new Date().toISOString()
    };

    await s3.send(new PutObjectCommand({
      Bucket: S3_BUCKET,
      Key: `progress/${jobId}.json`,
      Body: JSON.stringify(progressData, null, 2),
      ContentType: 'application/json'
    }));

    console.log('Progress file created:', `progress/${jobId}.json`);

    // Also create builds metadata for admin Builds tab
    await s3.send(new PutObjectCommand({
      Bucket: S3_BUCKET,
      Key: `builds/${jobId}/metadata.json`,
      Body: JSON.stringify({
        buildId: jobId,
        ...jobData,
        timestamps: { created: jobData.createdAt }
      }, null, 2),
      ContentType: 'application/json'
    }));

    console.log('Build metadata created:', `builds/${jobId}/metadata.json`);

    return jobId;
  } catch (error) {
    console.error('Create build job error:', error.message);
    throw error;
  }
}

// Extract contact info using LLM
async function extractContactInfoWithLLM(messages) {
  const conversationText = messages
    .map(m => `${m.role}: ${m.content}`)
    .join('\n');

  const extractionPrompt = `Analyze this conversation and extract any contact information the user has provided.

CONVERSATION:
${conversationText}

Extract and return ONLY a JSON object with these fields (use null if not found):
- name: The person's full name (first name, or first and last name)
- email: Their email address
- phone: Their phone number (any format)

IMPORTANT:
- Look for names in phrases like "I'm John", "my name is Sarah", "This is Mike", or just a name by itself
- Names can be in any case (lowercase, uppercase, mixed)
- Return ONLY the JSON, no other text

Example response:
{"name": "John Smith", "email": "john@example.com", "phone": null}`;

  try {
    const response = await anthropic.messages.create({
      model: CLAUDE_MODEL,
      max_tokens: 150,
      messages: [{ role: 'user', content: extractionPrompt }]
    });

    const text = response.content[0].text.trim();
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      console.log('LLM extracted contact info:', parsed);
      return {
        name: parsed.name || null,
        email: parsed.email?.toLowerCase() || null,
        phone: parsed.phone || null
      };
    }
  } catch (error) {
    console.error('LLM extraction error:', error.message);
  }

  return { name: null, email: null, phone: null };
}

// Extract text from PDF attachment
async function extractTextFromPDF(base64Data) {
  try {
    // Remove data URL prefix if present
    const base64Content = base64Data.replace(/^data:[^;]+;base64,/, '');

    // Convert base64 to buffer
    const pdfBuffer = Buffer.from(base64Content, 'base64');

    // Parse PDF and extract text
    const pdfData = await pdfParse(pdfBuffer);

    console.log('PDF extracted:', {
      pages: pdfData.numpages,
      textLength: pdfData.text?.length || 0
    });

    // Clean up the extracted text
    let text = pdfData.text || '';

    // Remove excessive whitespace while preserving paragraph structure
    text = text
      .replace(/\r\n/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .replace(/[ \t]+/g, ' ')
      .trim();

    // Limit text length to avoid token overflow (roughly 10k chars)
    if (text.length > 10000) {
      text = text.substring(0, 10000) + '\n\n[... PDF content truncated due to length ...]';
    }

    return {
      success: true,
      text: text,
      pages: pdfData.numpages,
      info: pdfData.info || {}
    };
  } catch (error) {
    console.error('PDF extraction error:', error.message);
    return {
      success: false,
      error: error.message,
      text: null
    };
  }
}

// Extract text from DOCX attachment
async function extractTextFromDOCX(base64Data) {
  try {
    // Remove data URL prefix if present
    const base64Content = base64Data.replace(/^data:[^;]+;base64,/, '');

    // Convert base64 to buffer
    const docxBuffer = Buffer.from(base64Content, 'base64');

    // Parse DOCX and extract text
    const result = await mammoth.extractRawText({ buffer: docxBuffer });

    console.log('DOCX extracted:', {
      textLength: result.value?.length || 0,
      messages: result.messages
    });

    // Clean up the extracted text
    let text = result.value || '';

    // Remove excessive whitespace while preserving paragraph structure
    text = text
      .replace(/\r\n/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .replace(/[ \t]+/g, ' ')
      .trim();

    // Limit text length to avoid token overflow (roughly 10k chars)
    if (text.length > 10000) {
      text = text.substring(0, 10000) + '\n\n[... Document content truncated due to length ...]';
    }

    return {
      success: true,
      text: text
    };
  } catch (error) {
    console.error('DOCX extraction error:', error.message);
    return {
      success: false,
      error: error.message,
      text: null
    };
  }
}

// Process attachments and extract content
async function processAttachments(attachments) {
  if (!attachments || !Array.isArray(attachments) || attachments.length === 0) {
    return null;
  }

  const processedAttachments = [];

  for (const attachment of attachments) {
    const { name, type, dataUrl } = attachment;
    const data = dataUrl; // Frontend sends dataUrl, we use it as data

    console.log('Processing attachment:', { name, type, dataLength: data?.length || 0 });

    // Handle PDF files
    if (type === 'application/pdf' || name?.toLowerCase().endsWith('.pdf')) {
      const pdfResult = await extractTextFromPDF(data);
      if (pdfResult.success) {
        processedAttachments.push({
          type: 'pdf',
          name: name,
          content: pdfResult.text,
          pages: pdfResult.pages
        });
      } else {
        processedAttachments.push({
          type: 'pdf',
          name: name,
          error: pdfResult.error,
          content: `[Unable to extract text from PDF: ${pdfResult.error}]`
        });
      }
    }
    // Handle text files
    else if (type === 'text/plain' || name?.toLowerCase().endsWith('.txt')) {
      try {
        const textContent = Buffer.from(data.replace(/^data:[^;]+;base64,/, ''), 'base64').toString('utf-8');
        processedAttachments.push({
          type: 'text',
          name: name,
          content: textContent.substring(0, 10000) // Limit length
        });
      } catch (error) {
        processedAttachments.push({
          type: 'text',
          name: name,
          error: error.message,
          content: `[Unable to read text file: ${error.message}]`
        });
      }
    }
    // Handle Word documents (.docx with mammoth, .doc not fully supported)
    else if (type === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
             name?.toLowerCase().endsWith('.docx')) {
      const docxResult = await extractTextFromDOCX(data);
      if (docxResult.success) {
        processedAttachments.push({
          type: 'docx',
          name: name,
          content: docxResult.text
        });
      } else {
        processedAttachments.push({
          type: 'docx',
          name: name,
          error: docxResult.error,
          content: `[Unable to extract text from DOCX: ${docxResult.error}]`
        });
      }
    }
    // Handle old .doc format (not fully supported)
    else if (type === 'application/msword' || name?.toLowerCase().endsWith('.doc')) {
      processedAttachments.push({
        type: 'doc',
        name: name,
        content: `[Old Word format (.doc) uploaded: ${name}. Please save as .docx or PDF for text extraction.]`
      });
    }
    // Images are handled separately via Claude's vision
    else if (type?.startsWith('image/')) {
      processedAttachments.push({
        type: 'image',
        name: name,
        isImage: true,
        data: data // Keep for vision API
      });
    }
    // Unknown file type
    else {
      processedAttachments.push({
        type: 'unknown',
        name: name,
        content: `[File uploaded: ${name}. File type not supported for text extraction.]`
      });
    }
  }

  return processedAttachments.length > 0 ? processedAttachments : null;
}

// Chat with Claude
async function chatWithClaude(messages, hasContactInfo, screenshot = null, pageContext = null, processedAttachments = null) {
  try {
    let contextualPrompt = SYSTEM_PROMPT;

    // Add page context so AI knows where the user is
    if (pageContext && pageContext.currentPage) {
      contextualPrompt += `\n\n## CURRENT PAGE CONTEXT:
The user is currently viewing the "${pageContext.currentPage}" page on the AI Product Studio website.
Page URL: ${pageContext.url || 'Unknown'}
If the user asks about "this page" or "where am I", refer to this page context.`;
    }

    if (hasContactInfo) {
      contextualPrompt += '\n\n## Current Status: Contact info collected. Provide helpful detailed answers about AI Product Studio partnerships.';
    } else {
      contextualPrompt += '\n\n## Current Status: NO CONTACT INFO YET. You must ask for name and phone/email before giving detailed answers!';
    }

    // Build attachment context for the AI
    let attachmentContext = '';
    if (processedAttachments && processedAttachments.length > 0) {
      attachmentContext = '\n\n## ATTACHED FILES:\n';
      for (const att of processedAttachments) {
        if (att.type === 'pdf') {
          attachmentContext += `\n### PDF Document: ${att.name} (${att.pages} pages)\n`;
          attachmentContext += `---BEGIN PDF CONTENT---\n${att.content}\n---END PDF CONTENT---\n`;
        } else if (att.type === 'text') {
          attachmentContext += `\n### Text File: ${att.name}\n`;
          attachmentContext += `---BEGIN TEXT CONTENT---\n${att.content}\n---END TEXT CONTENT---\n`;
        } else if (att.type === 'docx') {
          attachmentContext += `\n### Word Document: ${att.name}\n`;
          attachmentContext += `---BEGIN DOCX CONTENT---\n${att.content}\n---END DOCX CONTENT---\n`;
        } else if (att.type === 'doc') {
          attachmentContext += `\n### ${att.content}\n`;
        } else if (att.type !== 'image') {
          attachmentContext += `\n### ${att.content}\n`;
        }
      }
      attachmentContext += '\nPlease analyze the attached content and respond to the user\'s question about it.';
    }

    // Build messages array, potentially with vision
    const apiMessages = messages.map((m, index) => {
      // If this is the last user message, handle screenshot and image attachments
      if (m.role === 'user' && index === messages.length - 1) {
        const contentParts = [];

        // Add screenshot if present
        if (screenshot) {
          const matches = screenshot.match(/^data:([^;]+);base64,(.+)$/);
          const mediaType = matches ? matches[1] : 'image/jpeg';
          const base64Data = matches ? matches[2] : screenshot;
          contentParts.push({
            type: 'image',
            source: {
              type: 'base64',
              media_type: mediaType,
              data: base64Data
            }
          });
        }

        // Add image attachments if present
        if (processedAttachments) {
          for (const att of processedAttachments) {
            if (att.isImage && att.data) {
              const matches = att.data.match(/^data:([^;]+);base64,(.+)$/);
              const mediaType = matches ? matches[1] : 'image/jpeg';
              const base64Data = matches ? matches[2] : att.data;
              contentParts.push({
                type: 'image',
                source: {
                  type: 'base64',
                  media_type: mediaType,
                  data: base64Data
                }
              });
            }
          }
        }

        // Add message text (with attachment context appended)
        const messageText = attachmentContext
          ? `${m.content}\n\n[User attached files - see content above in system context]`
          : m.content;

        contentParts.push({
          type: 'text',
          text: messageText
        });

        // Only use content array if we have images
        if (contentParts.length > 1 || contentParts.some(p => p.type === 'image')) {
          return {
            role: m.role,
            content: contentParts
          };
        }

        return { role: m.role, content: messageText };
      }
      return { role: m.role, content: m.content };
    });

    // Add attachment context to system prompt
    const fullSystemPrompt = contextualPrompt + attachmentContext;

    const response = await anthropic.messages.create({
      model: CLAUDE_MODEL,
      max_tokens: 1000, // Increased for attachment analysis
      system: fullSystemPrompt,
      messages: apiMessages
    });

    // Calculate token usage and estimated cost
    const inputTokens = response.usage?.input_tokens || 0;
    const outputTokens = response.usage?.output_tokens || 0;
    const totalTokens = inputTokens + outputTokens;
    const inputCost = (inputTokens / 1000) * LLM_PRICING.claude.input;
    const outputCost = (outputTokens / 1000) * LLM_PRICING.claude.output;
    const estimatedCost = parseFloat((inputCost + outputCost).toFixed(4));

    return {
      content: response.content[0].text,
      provider: 'claude',
      usage: {
        inputTokens,
        outputTokens,
        totalTokens,
        estimatedCost
      }
    };
  } catch (error) {
    console.error('Claude API error:', error);
    throw error;
  }
}

// Chat with OpenAI (backup)
async function chatWithOpenAI(messages, hasContactInfo, screenshot = null) {
  try {
    let contextualPrompt = SYSTEM_PROMPT;
    if (hasContactInfo) {
      contextualPrompt += '\n\n## Current Status: Contact info collected. Provide helpful detailed answers about AI Product Studio partnerships.';
    } else {
      contextualPrompt += '\n\n## Current Status: NO CONTACT INFO YET. You must ask for name and phone/email before giving detailed answers!';
    }

    // Build messages array, potentially with vision
    const apiMessages = [
      { role: 'system', content: contextualPrompt },
      ...messages.map((m, index) => {
        // If this is the last user message and we have a screenshot, include it
        if (screenshot && m.role === 'user' && index === messages.length - 1) {
          return {
            role: m.role,
            content: [
              {
                type: 'image_url',
                image_url: {
                  url: screenshot,
                  detail: 'low'
                }
              },
              {
                type: 'text',
                text: m.content
              }
            ]
          };
        }
        return { role: m.role, content: m.content };
      })
    ];

    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${OPENAI_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: OPENAI_MODEL,
        messages: apiMessages,
        max_tokens: 500,
        temperature: 0.7
      })
    });

    if (!response.ok) {
      throw new Error(`OpenAI API error: ${response.status}`);
    }

    const data = await response.json();

    // Calculate token usage and estimated cost
    const inputTokens = data.usage?.prompt_tokens || 0;
    const outputTokens = data.usage?.completion_tokens || 0;
    const totalTokens = data.usage?.total_tokens || 0;
    const inputCost = (inputTokens / 1000) * LLM_PRICING.openai.input;
    const outputCost = (outputTokens / 1000) * LLM_PRICING.openai.output;
    const estimatedCost = parseFloat((inputCost + outputCost).toFixed(4));

    return {
      content: data.choices[0].message.content,
      provider: 'openai',
      usage: {
        inputTokens,
        outputTokens,
        totalTokens,
        estimatedCost
      }
    };
  } catch (error) {
    console.error('OpenAI API error:', error);
    throw error;
  }
}

// Form validation prompt for AI-powered form validation
const FORM_VALIDATION_PROMPT = `You are a form validation agent. You receive form data as JSON and validate specific fields.

VALIDATION RULES:

1. NAME - Validate for:
   - Must be at least 2 characters
   - No numbers allowed
   - Detect gibberish (asdf, qwerty, aasdjf, fghj, etc.)
   - Detect fake names (test, admin, user, none, fake)
   - Detect keyboard mashing patterns
   If invalid: set valid=false, KEEP the original value in "value", provide helpful error message

2. EMAIL - Validate for:
   - Must be valid email format (name@domain.com)
   - Detect gibberish emails (asdf@asdf.com)
   - Detect obviously fake domains (test.com, fake.com, example.com)
   - Detect disposable email providers (tempmail, guerrillamail, mailinator, etc.)
   If invalid: set valid=false, KEEP the original value in "value", provide helpful error message

3. PRODUCT IDEA - Validate for:
   REJECT if:
   - Gibberish, random text, keyboard mashing (asdfasdf, xyz123)
   - Off-topic text (weather, food, unrelated personal topics)
   - Placeholder text (TBD, test, n/a, lorem ipsum, "will fill later")
   - Too vague with no clear problem/solution ("an app", "something with AI", "a platform")
   - Doesn't describe what problem it solves or who it helps
   - Fantasy/unrealistic ideas with no feasible path ("teleportation device", "mind reading app")
   - Just a buzzword combo with no substance ("AI blockchain metaverse solution")

   ACCEPT if:
   - Describes a specific product/service concept
   - Identifies a problem it solves OR a target audience it helps
   - Is feasible with current technology (even if ambitious)
   - Brief is OK if clear: "AI tool to help restaurants price their menu based on costs and competition"

   If invalid: set valid=false, KEEP the original value in "value", provide helpful error explaining what's missing (e.g., "Please describe what problem your product solves and who it helps")

OTHER FIELDS: Pass through unchanged with just "value" property.

RESPONSE FORMAT: Return ONLY valid JSON matching this structure:
{
  "success": true/false,
  "fields": {
    "name": { "valid": true, "value": "John Smith" },
    "email": { "valid": true, "value": "john@company.com" },
    "productIdea": { "valid": true, "value": "An AI tool for..." },
    "phone": { "value": "+1 555..." },
    "linkedin": { "value": "..." },
    ... (all other fields with just "value")
  }
}

Set "success": true ONLY if ALL 3 core validations (name, email, productIdea) pass.
Return ONLY the JSON. No explanation text before or after.`;

// Handle form validation using AI agent
async function handleFormValidation(formData, visitorInfo, clientIP) {
  const userMessage = `Validate this form data and return JSON response:
${JSON.stringify(formData, null, 2)}`;

  try {
    const response = await anthropic.messages.create({
      model: CLAUDE_MODEL,
      max_tokens: 1000,
      system: FORM_VALIDATION_PROMPT,
      messages: [{ role: 'user', content: userMessage }]
    });

    // Parse AI response
    const responseText = response.content[0].text.trim();
    let validationResult;

    try {
      const jsonMatch = responseText.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        validationResult = JSON.parse(jsonMatch[0]);
      } else {
        throw new Error('No JSON found in response');
      }
    } catch (parseError) {
      console.error('Failed to parse AI validation response:', parseError.message);
      console.error('Raw response:', responseText);
      return {
        success: false,
        error: 'Validation service error - please try again'
      };
    }

    if (!validationResult.success) {
      console.log('Form validation failed:', validationResult.fields);
      return {
        success: false,
        fields: validationResult.fields
      };
    }

    // Validation passed → check for duplicate, save to S3, send emails
    console.log('Form validation passed, saving application...');

    const { S3Client, ListObjectsV2Command, PutObjectCommand } = await import('@aws-sdk/client-s3');
    const s3 = new S3Client({ region: S3_REGION });

    // Check for duplicate email submission
    const email = formData.email?.toLowerCase();
    if (email) {
      const userFolder = email.replace(/@/g, '_at_').replace(/\./g, '_').replace(/[^a-z0-9_-]/g, '');
      try {
        const existingApps = await s3.send(new ListObjectsV2Command({
          Bucket: S3_BUCKET,
          Prefix: `applications/${userFolder}/`,
          MaxKeys: 1
        }));
        if (existingApps.Contents && existingApps.Contents.length > 0) {
          console.log('Duplicate application detected for:', email);
          return {
            success: false,
            fields: validationResult.fields,
            error: 'An application with this email already exists. Our team will be in touch soon!'
          };
        }
      } catch (err) {
        // Ignore errors, proceed with save
      }
    }

    // Save to S3
    const timestamp = new Date().toISOString();
    const dateFolder = timestamp.split('T')[0];
    let userFolder = 'anonymous';
    if (email) {
      userFolder = email.replace(/@/g, '_at_').replace(/\./g, '_').replace(/[^a-z0-9_-]/g, '');
    } else if (formData.name) {
      userFolder = formData.name.toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_-]/g, '');
    }

    const randomSuffix = Math.random().toString(36).substring(2, 8);
    const filename = `${timestamp.replace(/[:.]/g, '-')}_${randomSuffix}.json`;
    const s3Key = `applications/${userFolder}/${dateFolder}/${filename}`;

    const applicationData = {
      submittedAt: timestamp,
      submittedAtEST: new Date().toLocaleString('en-US', { timeZone: 'America/New_York' }),
      status: 'pending',
      source: 'direct-form',
      visitorInfo: {
        name: formData.name || null,
        email: formData.email || null,
        phone: formData.phone || null,
        ...visitorInfo
      },
      clientIP: clientIP || 'Unknown',
      formData: formData
    };

    await s3.send(new PutObjectCommand({
      Bucket: S3_BUCKET,
      Key: s3Key,
      Body: JSON.stringify(applicationData, null, 2),
      ContentType: 'application/json'
    }));

    console.log('Application saved to S3:', s3Key);

    // Send admin notification email using new template system
    try {
      const emailData = {
        name: formData.name || 'Not provided',
        email: formData.email || 'Not provided',
        productIdea: formData.productIdea || 'Not provided',
        source: 'Direct Form',
        s3Key
      };
      await sendTemplateToAdmins(renderAdminNewApplication, emailData);
      console.log('Admin notification email sent');
    } catch (emailError) {
      console.error('Admin email notification failed:', emailError.message);
    }

    // Send applicant acknowledgment email
    try {
      if (formData.email) {
        await sendTemplate(formData.email, renderApplicantAcknowledgment, {
          name: formData.name || 'Applicant'
        });
        console.log('Applicant acknowledgment email sent');
      }
    } catch (emailError) {
      console.error('Applicant acknowledgment email failed:', emailError.message);
    }

    return {
      success: true,
      fields: validationResult.fields,
      message: 'Application submitted successfully'
    };

  } catch (error) {
    console.error('Form validation error:', error);
    return {
      success: false,
      error: 'Validation service error - please try again'
    };
  }
}

// Main handler
export const handler = async (event) => {
  // Handle CORS preflight
  if (event.requestContext?.http?.method === 'OPTIONS') {
    return {
      statusCode: 200,
      headers: corsHeaders,
      body: ''
    };
  }

  try {
    // Handle EventBridge scheduled events (no event.body)
    if (event.source === 'aws.events' || event['detail-type']) {
      const reportType = event.detail?.reportType || 'weekly';
      console.log('[EventBridge] Triggered cost report:', reportType);
      const result = await handleScheduledCostReports({ reportType, S3_REGION, listApplications });
      return { statusCode: 200, body: JSON.stringify({ success: true, ...result }) };
    }

    const body = JSON.parse(event.body || '{}');
    const { action, messages, visitorInfo = {} } = body;

    // Get client IP from request context
    const clientIP = event.requestContext?.http?.sourceIp ||
                     event.headers?.['x-forwarded-for']?.split(',')[0] ||
                     'Unknown';

    // ========== FORM VALIDATION ENDPOINT ==========
    if (body.mode === 'validate') {
      const result = await handleFormValidation(body.formData, visitorInfo, clientIP);
      return {
        statusCode: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify(result)
      };
    }

    // ========== ADMIN ENDPOINTS ==========

    // Admin Login
    if (action === 'admin-login') {
      const { password } = body;
      if (password === ADMIN_PASSWORD) {
        return {
          statusCode: 200,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          body: JSON.stringify({ success: true, message: 'Login successful' })
        };
      } else {
        return {
          statusCode: 401,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          body: JSON.stringify({ success: false, error: 'Invalid password' })
        };
      }
    }

    // Admin List Applications
    if (action === 'admin-list') {
      const { password } = body;
      if (password !== ADMIN_PASSWORD) {
        return {
          statusCode: 401,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          body: JSON.stringify({ success: false, error: 'Unauthorized' })
        };
      }

      const applications = await listApplications();
      return {
        statusCode: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify({ success: true, applications })
      };
    }

    // Admin Update Application Status
    if (action === 'admin-update') {
      const { password, s3Key, status, reviewNotes } = body;
      if (password !== ADMIN_PASSWORD) {
        return {
          statusCode: 401,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          body: JSON.stringify({ success: false, error: 'Unauthorized' })
        };
      }

      if (!s3Key || !status) {
        return {
          statusCode: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          body: JSON.stringify({ success: false, error: 's3Key and status are required' })
        };
      }

      const updatedApp = await updateApplicationStatus(s3Key, status, reviewNotes);

      // Send approval/rejection email to applicant (fire-and-forget)
      const applicantEmail = updatedApp.visitorInfo?.email || updatedApp.formData?.email;
      const applicantName = updatedApp.visitorInfo?.name || updatedApp.formData?.name || 'Partner';
      if (applicantEmail && status === 'approved') {
        sendTemplate(applicantEmail, renderApplicantApproved, {
          name: applicantName,
          guid: updatedApp.guid,
          builderSessionUrl: updatedApp.sessionLink,
          deploymentUrl: updatedApp.deploymentUrl,
        }).catch(err => console.error('Approval email error:', err.message));
      } else if (applicantEmail && status === 'rejected') {
        sendTemplate(applicantEmail, renderApplicantRejected, {
          name: applicantName,
          reason: reviewNotes || undefined,
        }).catch(err => console.error('Rejection email error:', err.message));
      } else if (applicantEmail && status === 'deactivated') {
        const { html, text, subject } = renderAccountDeactivated({ name: applicantName });
        sendTemplatedEmail(applicantEmail, subject, html, text).catch(e => console.error('Deactivation email failed:', e.message));
      }

      return {
        statusCode: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify({ success: true, application: updatedApp })
      };
    }

    // Admin Get Job Progress
    if (action === 'admin-progress') {
      const { password, jobId } = body;
      if (password !== ADMIN_PASSWORD) {
        return {
          statusCode: 401,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          body: JSON.stringify({ success: false, error: 'Unauthorized' })
        };
      }

      if (!jobId) {
        return {
          statusCode: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          body: JSON.stringify({ success: false, error: 'jobId is required' })
        };
      }

      try {
        const { S3Client, GetObjectCommand } = await import('@aws-sdk/client-s3');
        const s3 = new S3Client({ region: S3_REGION });

        const progressResult = await s3.send(new GetObjectCommand({
          Bucket: S3_BUCKET,
          Key: `progress/${jobId}.json`
        }));
        const progressData = JSON.parse(await progressResult.Body.transformToString());

        return {
          statusCode: 200,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          body: JSON.stringify({ success: true, progress: progressData })
        };
      } catch (error) {
        return {
          statusCode: 404,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          body: JSON.stringify({ success: false, error: 'Progress not found' })
        };
      }
    }

    // Admin List Chat Sessions
    if (action === 'admin-chats') {
      const { password, source, limit } = body;
      if (password !== ADMIN_PASSWORD) {
        return {
          statusCode: 401,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          body: JSON.stringify({ success: false, error: 'Unauthorized' })
        };
      }

      const sessions = await listChatSessions(source || 'all', limit || 50);
      return {
        statusCode: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify({ success: true, sessions })
      };
    }

    // Admin List Client Profiles
    if (action === 'admin-clients') {
      const { password, limit } = body;
      if (password !== ADMIN_PASSWORD) {
        return {
          statusCode: 401,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          body: JSON.stringify({ success: false, error: 'Unauthorized' })
        };
      }

      const clients = await listClientProfiles(limit || 50);
      return {
        statusCode: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify({ success: true, clients })
      };
    }

    // Admin List Build History
    if (action === 'admin-builds') {
      const { password, limit } = body;
      if (password !== ADMIN_PASSWORD) {
        return {
          statusCode: 401,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          body: JSON.stringify({ success: false, error: 'Unauthorized' })
        };
      }

      const builds = await listBuildHistory(limit || 50);
      return {
        statusCode: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify({ success: true, builds })
      };
    }

    // ==================== AWS COSTS ENDPOINTS ====================

    // Admin Costs Summary - All users with total costs (see costs/index.mjs)
    if (action === 'admin-costs-summary') {
      return handleAdminCostsSummary({ body, corsHeaders, S3_REGION, ADMIN_PASSWORD, listApplications });
    }

    // Admin Summary - Infrastructure costs, grand total, deltas (see costs/email-reports.mjs)
    if (action === 'get-admin-summary') {
      if (body.password !== ADMIN_PASSWORD) {
        return { statusCode: 401, headers: corsHeaders, body: JSON.stringify({ success: false, error: 'Unauthorized' }) };
      }
      const data = await computeAdminSummaryData({ S3_REGION, ADMIN_PASSWORD, listApplications });
      return { statusCode: 200, headers: corsHeaders, body: JSON.stringify({ success: true, ...data }) };
    }

    // User Costs - Current user's projects with costs (see costs/index.mjs)
    if (action === 'user-costs') {
      return handleUserCosts({ body, corsHeaders, S3_REGION, listApplications });
    }

    // Send Cost Reports - Manual admin trigger for email cost reports (see costs/email-reports.mjs)
    if (action === 'send-cost-reports') {
      return handleManualCostReportTrigger({ body, corsHeaders, S3_REGION, ADMIN_PASSWORD, listApplications });
    }

    // Send All Reports - sends cost reports to all approved users
    if (action === 'send-all-reports') {
      body.reportType = body.period || 'weekly';
      return handleManualCostReportTrigger({ body, corsHeaders, S3_REGION, ADMIN_PASSWORD, listApplications });
    }

    // Send Admin Report - comprehensive admin summary with all users + infrastructure costs
    if (action === 'send-admin-report') {
      return handleSendAdminSummaryReport({ body, corsHeaders, S3_REGION, ADMIN_PASSWORD, listApplications });
    }

    // ── AWS Batch Endpoints (merged calls for dashboard performance) ──
    if (action === 'aws-cost-dashboard-batch') {
      return handleAwsCostDashboardBatch({ body, corsHeaders, ADMIN_PASSWORD });
    }
    if (action === 'aws-cost-storage-batch') {
      return handleAwsCostStorageBatch({ body, corsHeaders, ADMIN_PASSWORD });
    }

    // ── AWS Account-Wide Cost Endpoints (see aws-costs/index.mjs) ──
    if (action === 'aws-cost-summary') {
      return handleAwsCostSummary({ body, corsHeaders, ADMIN_PASSWORD });
    }
    if (action === 'aws-cost-daily') {
      return handleAwsCostDaily({ body, corsHeaders, ADMIN_PASSWORD });
    }
    if (action === 'aws-cost-daily-by-service') {
      return handleAwsCostDailyByService({ body, corsHeaders, ADMIN_PASSWORD });
    }
    if (action === 'aws-cost-forecast') {
      return handleAwsCostForecast({ body, corsHeaders, ADMIN_PASSWORD });
    }
    if (action === 'aws-cost-service-detail') {
      return handleAwsCostServiceDetail({ body, corsHeaders, ADMIN_PASSWORD });
    }
    if (action === 'aws-project-costs') {
      return handleAwsProjectCosts({ body, corsHeaders, ADMIN_PASSWORD });
    }
    if (action === 'aws-project-costs-dynamic') {
      return handleAwsProjectCostsDynamic({ body, corsHeaders, ADMIN_PASSWORD });
    }
    if (action === 'aws-cost-daily-by-project') {
      return handleAwsCostDailyByProject({ body, corsHeaders, ADMIN_PASSWORD });
    }
    if (action === 'aws-unused-resources') {
      return handleAwsUnusedResources({ body, corsHeaders, ADMIN_PASSWORD });
    }
    if (action === 'aws-delete-resource') {
      return handleAwsDeleteResource({ body, corsHeaders, ADMIN_PASSWORD });
    }
    if (action === 'aws-s3-browse') {
      return handleAwsS3Browse({ body, corsHeaders, ADMIN_PASSWORD });
    }
    if (action === 'aws-s3-delete') {
      return handleAwsS3Delete({ body, corsHeaders, ADMIN_PASSWORD });
    }
    if (action === 'aws-s3-analysis') {
      return handleAwsS3Analysis({ body, corsHeaders, ADMIN_PASSWORD });
    }
    if (action === 'aws-activity-log') {
      return handleAwsActivityLog({ body, corsHeaders, ADMIN_PASSWORD });
    }
    if (action === 'aws-activity-email-report') {
      return handleAwsActivityEmailReport({ body, corsHeaders, ADMIN_PASSWORD });
    }

    // Get Tmux Projects - Fetch deployed projects from Tmux Builder API
    if (action === 'get-tmux-projects') {
      try {
        const { guid } = body;
        if (!guid) {
          return {
            statusCode: 400,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            body: JSON.stringify({ success: false, error: 'guid is required' })
          };
        }

        // Call Tmux Builder API to get deployments from chat history
        const tmuxBuilderUrl = `https://d3tfeatcbws1ka.cloudfront.net/api/deployments?guid=${encodeURIComponent(guid)}`;
        console.log('[Get Tmux Projects] Fetching from:', tmuxBuilderUrl);

        const tmuxResponse = await fetch(tmuxBuilderUrl);
        const tmuxData = await tmuxResponse.json();

        console.log('[Get Tmux Projects] Tmux Builder response:', JSON.stringify(tmuxData));

        if (!tmuxData.success) {
          return {
            statusCode: 200,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            body: JSON.stringify({
              success: true,
              project: null,
              projects: [],
              activities: []
            })
          };
        }

        // Format projects for frontend (from tmux-builder deployments)
        const projects = (tmuxData.deployments || []).map((dep, index) => ({
          projectId: `${guid}-${index}`,
          projectName: dep.project_name || 'Project',
          deployedUrl: dep.url || '',
          status: dep.status || 'deployed',
          createdAt: dep.deployed_at,
          updatedAt: dep.deployed_at
        }));

        // Get the main project (first one, which is newest due to reverse sort)
        const mainProject = projects[0] || null;

        return {
          statusCode: 200,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            success: true,
            project: mainProject,
            projects: projects,
            activities: []
          })
        };
      } catch (error) {
        console.error('[Get Tmux Projects] Error:', error);
        return {
          statusCode: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          body: JSON.stringify({ success: false, error: error.message })
        };
      }
    }

    // ==================== USER DASHBOARD ENDPOINTS ====================

    // Helper: Generate session token
    function generateSessionToken() {
      const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
      let token = '';
      for (let i = 0; i < 64; i++) {
        token += chars.charAt(Math.floor(Math.random() * chars.length));
      }
      return token;
    }

    // Helper: Validate session
    async function validateSession(guid, sessionToken) {
      const { S3Client, GetObjectCommand } = await import('@aws-sdk/client-s3');
      const s3 = new S3Client({ region: S3_REGION });
      try {
        const result = await s3.send(new GetObjectCommand({
          Bucket: S3_BUCKET,
          Key: `users/${guid}/sessions.json`
        }));
        const sessions = JSON.parse(await result.Body.transformToString());
        const now = new Date();
        const validToken = sessions.tokens?.find(t =>
          t.token === sessionToken && new Date(t.expiresAt) > now
        );
        return !!validToken;
      } catch (e) {
        return false;
      }
    }

    // User check - does user exist and have account?
    if (action === 'user-check') {
      const { guid } = body;
      if (!guid) {
        return {
          statusCode: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          body: JSON.stringify({ success: false, error: 'GUID is required' })
        };
      }

      try {
        const { S3Client, GetObjectCommand } = await import('@aws-sdk/client-s3');
        const s3 = new S3Client({ region: S3_REGION });

        // Get application by guid
        const applications = await listApplications();
        const app = applications.find(a => a.guid === guid);
        if (!app) {
          return {
            statusCode: 200,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            body: JSON.stringify({ success: false, exists: false, hasAccount: false, error: 'Invalid session ID' })
          };
        }

        // Check if has account
        let hasAccount = false;
        let profile = { name: app.visitorInfo?.name || app.formData?.fullName || '', email: app.visitorInfo?.email || app.formData?.email || '' };
        try {
          await s3.send(new GetObjectCommand({ Bucket: S3_BUCKET, Key: `users/${guid}/credentials.json` }));
          hasAccount = true;
          const profileResult = await s3.send(new GetObjectCommand({ Bucket: S3_BUCKET, Key: `users/${guid}/profile.json` }));
          profile = JSON.parse(await profileResult.Body.transformToString());
        } catch (e) { /* No account or profile */ }

        return {
          statusCode: 200,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          body: JSON.stringify({ success: true, exists: true, hasAccount, profile, applicationData: app })
        };
      } catch (error) {
        return {
          statusCode: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          body: JSON.stringify({ success: false, error: error.message })
        };
      }
    }

    // User signup
    if (action === 'user-signup') {
      const { guid, email, password } = body;
      if (!guid || !email || !password) {
        return {
          statusCode: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          body: JSON.stringify({ success: false, error: 'GUID, email, and password are required' })
        };
      }
      if (password.length < 6) {
        return {
          statusCode: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          body: JSON.stringify({ success: false, error: 'Password must be at least 6 characters' })
        };
      }

      try {
        const { S3Client, GetObjectCommand, PutObjectCommand } = await import('@aws-sdk/client-s3');
        const bcrypt = (await import('bcryptjs')).default;
        const s3 = new S3Client({ region: S3_REGION });

        // Check if account exists
        try {
          await s3.send(new GetObjectCommand({ Bucket: S3_BUCKET, Key: `users/${guid}/credentials.json` }));
          return {
            statusCode: 400,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            body: JSON.stringify({ success: false, error: 'Account already exists. Please login instead.' })
          };
        } catch (e) { /* Good - no existing account */ }

        // Verify guid exists
        const applications = await listApplications();
        const app = applications.find(a => a.guid === guid);
        if (!app) {
          return {
            statusCode: 400,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            body: JSON.stringify({ success: false, error: 'Invalid session ID' })
          };
        }

        // Hash password and save credentials
        const passwordHash = await bcrypt.hash(password, 10);
        const sessionToken = generateSessionToken();
        const now = new Date();
        const expiresAt = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

        await s3.send(new PutObjectCommand({
          Bucket: S3_BUCKET,
          Key: `users/${guid}/credentials.json`,
          Body: JSON.stringify({ email: email.toLowerCase().trim(), passwordHash, createdAt: now.toISOString() }),
          ContentType: 'application/json'
        }));

        await s3.send(new PutObjectCommand({
          Bucket: S3_BUCKET,
          Key: `users/${guid}/sessions.json`,
          Body: JSON.stringify({ tokens: [{ token: sessionToken, createdAt: now.toISOString(), expiresAt: expiresAt.toISOString() }] }),
          ContentType: 'application/json'
        }));

        await s3.send(new PutObjectCommand({
          Bucket: S3_BUCKET,
          Key: `users/${guid}/profile.json`,
          Body: JSON.stringify({ name: app.visitorInfo?.name || app.formData?.fullName || '', email: email.toLowerCase().trim(), createdAt: now.toISOString() }),
          ContentType: 'application/json'
        }));

        // Send welcome email (fire-and-forget)
        sendTemplate(email, renderUserWelcome, { name: app.visitorInfo?.name || app.formData?.fullName || '', guid }).catch(e => console.error('Welcome email failed:', e.message));

        // Create email-index entry for forgot-password lookup
        const crypto = await import('crypto');
        const emailHash = crypto.createHash('sha256').update(email.toLowerCase().trim()).digest('hex');
        await s3.send(new PutObjectCommand({
          Bucket: S3_BUCKET,
          Key: `email-index/${emailHash}.json`,
          Body: JSON.stringify({ guid, email: email.toLowerCase().trim() }),
          ContentType: 'application/json'
        }));

        return {
          statusCode: 200,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          body: JSON.stringify({ success: true, sessionToken, expiresAt: expiresAt.toISOString() })
        };
      } catch (error) {
        return {
          statusCode: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          body: JSON.stringify({ success: false, error: error.message })
        };
      }
    }

    // User login
    if (action === 'user-login') {
      const { guid, email, password } = body;
      if (!guid || !email || !password) {
        return {
          statusCode: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          body: JSON.stringify({ success: false, error: 'GUID, email, and password are required' })
        };
      }

      try {
        const { S3Client, GetObjectCommand, PutObjectCommand } = await import('@aws-sdk/client-s3');
        const bcrypt = (await import('bcryptjs')).default;
        const s3 = new S3Client({ region: S3_REGION });

        // Get credentials
        let credentials;
        try {
          const result = await s3.send(new GetObjectCommand({ Bucket: S3_BUCKET, Key: `users/${guid}/credentials.json` }));
          credentials = JSON.parse(await result.Body.transformToString());
        } catch (e) {
          return {
            statusCode: 401,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            body: JSON.stringify({ success: false, error: 'Account not found. Please sign up first.' })
          };
        }

        // Verify password
        const isValid = await bcrypt.compare(password, credentials.passwordHash);
        if (!isValid || credentials.email !== email.toLowerCase().trim()) {
          return {
            statusCode: 401,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            body: JSON.stringify({ success: false, error: 'Invalid email or password' })
          };
        }

        // Create session
        const sessionToken = generateSessionToken();
        const now = new Date();
        const expiresAt = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

        let sessions = { tokens: [] };
        try {
          const result = await s3.send(new GetObjectCommand({ Bucket: S3_BUCKET, Key: `users/${guid}/sessions.json` }));
          sessions = JSON.parse(await result.Body.transformToString());
        } catch (e) { /* No sessions yet */ }

        sessions.tokens.push({ token: sessionToken, createdAt: now.toISOString(), expiresAt: expiresAt.toISOString() });
        sessions.tokens = sessions.tokens.slice(-5);

        await s3.send(new PutObjectCommand({
          Bucket: S3_BUCKET,
          Key: `users/${guid}/sessions.json`,
          Body: JSON.stringify(sessions),
          ContentType: 'application/json'
        }));

        // Track login IP and send new-login alert if needed (fire-and-forget)
        (async () => {
          try {
            const clientIp = event.requestContext?.http?.sourceIp || event.headers?.['X-Forwarded-For']?.split(',')[0]?.trim() || 'Unknown';
            let loginHistory = { logins: [] };
            try {
              const histResult = await s3.send(new GetObjectCommand({ Bucket: S3_BUCKET, Key: `users/${guid}/login-history.json` }));
              loginHistory = JSON.parse(await histResult.Body.transformToString());
            } catch (e) { /* No login history yet */ }

            const isNewIp = !loginHistory.logins.some(l => l.ip === clientIp);
            const isFirstLogin = loginHistory.logins.length === 0;

            loginHistory.logins.push({ ip: clientIp, timestamp: now.toISOString() });
            loginHistory.logins = loginHistory.logins.slice(-10);

            await s3.send(new PutObjectCommand({
              Bucket: S3_BUCKET,
              Key: `users/${guid}/login-history.json`,
              Body: JSON.stringify(loginHistory),
              ContentType: 'application/json'
            }));

            if (isNewIp && !isFirstLogin) {
              const name = credentials.name || email.split('@')[0];
              sendTemplate(email, renderNewLoginAlert, { name, guid, ip: clientIp, timestamp: now.toISOString() }).catch(e => console.error('New login alert email failed:', e.message));
            }
          } catch (e) {
            console.error('Login IP tracking failed:', e.message);
          }
        })();

        return {
          statusCode: 200,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          body: JSON.stringify({ success: true, sessionToken, expiresAt: expiresAt.toISOString() })
        };
      } catch (error) {
        return {
          statusCode: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          body: JSON.stringify({ success: false, error: error.message })
        };
      }
    }

    // User dashboard data
    if (action === 'user-dashboard') {
      const { guid, sessionToken } = body;
      if (!guid || !sessionToken) {
        return {
          statusCode: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          body: JSON.stringify({ success: false, error: 'GUID and session token are required' })
        };
      }

      try {
        const isValid = await validateSession(guid, sessionToken);
        if (!isValid) {
          return {
            statusCode: 401,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            body: JSON.stringify({ success: false, error: 'Invalid or expired session' })
          };
        }

        const { S3Client, GetObjectCommand } = await import('@aws-sdk/client-s3');
        const s3 = new S3Client({ region: S3_REGION });

        // Get profile
        let profile = {};
        try {
          const result = await s3.send(new GetObjectCommand({ Bucket: S3_BUCKET, Key: `users/${guid}/profile.json` }));
          profile = JSON.parse(await result.Body.transformToString());
        } catch (e) { /* No profile */ }

        // Get application
        const applications = await listApplications();
        const app = applications.find(a => a.guid === guid);
        if (!app) {
          return {
            statusCode: 404,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            body: JSON.stringify({ success: false, error: 'Application not found' })
          };
        }

        return {
          statusCode: 200,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            success: true,
            data: {
              user: {
                name: profile.name || app.visitorInfo?.name || app.formData?.fullName || '',
                email: profile.email || app.visitorInfo?.email || app.formData?.email || '',
                avatarUrl: profile.avatarUrl || '',
                theme: profile.theme || 'ember'
              },
              application: {
                status: app.status || 'approved',
                guid: app.guid || guid,
                email: app.visitorInfo?.email || app.formData?.email || '',
                formData: app.formData || {},
                submittedAt: app.submittedAt || app.timestamp,
                reviewedAt: app.reviewedAt || '',
                sessionLink: app.sessionLink || '',
                productIdea: app.formData?.productIdea || app.formData?.product_idea || '',
                targetCustomer: app.formData?.targetCustomer || app.formData?.target_customer || '',
                industry: app.formData?.industry || '',
                timeline: app.formData?.timeline || ''
              },
              buildSession: {
                link: app.sessionLink || ''
              }
            }
          })
        };
      } catch (error) {
        return {
          statusCode: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          body: JSON.stringify({ success: false, error: error.message })
        };
      }
    }

    // Upload profile avatar
    if (action === 'upload-avatar') {
      const { guid, sessionToken, image, contentType } = body;
      if (!guid || !sessionToken || !image) {
        return {
          statusCode: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          body: JSON.stringify({ success: false, error: 'Missing required fields' })
        };
      }

      try {
        const isValid = await validateSession(guid, sessionToken);
        if (!isValid) {
          return {
            statusCode: 401,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            body: JSON.stringify({ success: false, error: 'Invalid session' })
          };
        }

        const { S3Client, PutObjectCommand } = await import('@aws-sdk/client-s3');
        const s3 = new S3Client({ region: S3_REGION });

        // Extract base64 data
        const base64Data = image.replace(/^data:image\/\w+;base64,/, '');
        const buffer = Buffer.from(base64Data, 'base64');

        // Determine file extension
        const ext = contentType?.split('/')[1] || 'png';
        const avatarKey = `avatars/${guid}/avatar.${ext}`;

        // Upload to the PUBLIC site bucket (cocreateidea.com) served via CloudFront
        const SITE_BUCKET = 'cocreateidea.com';
        const SITE_REGION = 'ap-south-1';
        const s3Site = new S3Client({ region: SITE_REGION });
        try {
          await s3Site.send(new PutObjectCommand({
            Bucket: SITE_BUCKET,
            Key: avatarKey,
            Body: buffer,
            ContentType: contentType || 'image/png',
            CacheControl: 'no-cache'
          }));
          console.log('[Upload Avatar] Saved to site bucket:', avatarKey);
        } catch (siteErr) {
          console.error('[Upload Avatar] Site bucket upload failed:', siteErr.message);
        }

        // Also save to data bucket as backup (survives site bucket redeploys)
        await s3.send(new PutObjectCommand({
          Bucket: S3_BUCKET,
          Key: `users/${guid}/avatar.${ext}`,
          Body: buffer,
          ContentType: contentType || 'image/png'
        }));

        // URL via CloudFront (public, no pre-signing needed)
        const avatarUrl = `https://www.cocreateidea.com/${avatarKey}?t=${Date.now()}`;

        // Update profile in the private data bucket
        const { GetObjectCommand } = await import('@aws-sdk/client-s3');
        let profile = {};
        try {
          const result = await s3.send(new GetObjectCommand({ Bucket: S3_BUCKET, Key: `users/${guid}/profile.json` }));
          profile = JSON.parse(await result.Body.transformToString());
        } catch (e) { /* No profile yet */ }

        profile.avatarKey = avatarKey;
        profile.avatarUrl = avatarUrl;
        await s3.send(new PutObjectCommand({
          Bucket: S3_BUCKET,
          Key: `users/${guid}/profile.json`,
          Body: JSON.stringify(profile),
          ContentType: 'application/json'
        }));

        return {
          statusCode: 200,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          body: JSON.stringify({ success: true, avatarUrl })
        };
      } catch (error) {
        console.error('[Upload Avatar] Error:', error);
        return {
          statusCode: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          body: JSON.stringify({ success: false, error: error.message })
        };
      }
    }

    // Save user theme preference
    if (action === 'save-theme') {
      const { guid, sessionToken, theme } = body;
      if (!guid || !sessionToken || !theme) {
        return {
          statusCode: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          body: JSON.stringify({ success: false, error: 'Missing required fields' })
        };
      }

      // Validate theme
      const validThemes = ['ember', 'coral', 'sunset', 'aurora', 'legacy', 'sandstone', 'champagne', 'zoom'];
      if (!validThemes.includes(theme)) {
        return {
          statusCode: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          body: JSON.stringify({ success: false, error: 'Invalid theme' })
        };
      }

      try {
        const isValid = await validateSession(guid, sessionToken);
        if (!isValid) {
          return {
            statusCode: 401,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            body: JSON.stringify({ success: false, error: 'Invalid session' })
          };
        }

        const { S3Client, GetObjectCommand, PutObjectCommand } = await import('@aws-sdk/client-s3');
        const s3 = new S3Client({ region: S3_REGION });

        // Get existing profile
        let profile = {};
        try {
          const result = await s3.send(new GetObjectCommand({ Bucket: S3_BUCKET, Key: `users/${guid}/profile.json` }));
          profile = JSON.parse(await result.Body.transformToString());
        } catch (e) { /* No profile yet */ }

        // Update theme
        profile.theme = theme;
        await s3.send(new PutObjectCommand({
          Bucket: S3_BUCKET,
          Key: `users/${guid}/profile.json`,
          Body: JSON.stringify(profile),
          ContentType: 'application/json'
        }));

        return {
          statusCode: 200,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          body: JSON.stringify({ success: true, theme })
        };
      } catch (error) {
        console.error('[Save Theme] Error:', error);
        return {
          statusCode: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          body: JSON.stringify({ success: false, error: error.message })
        };
      }
    }

    // User change password
    if (action === 'user-change-password') {
      const { guid, sessionToken, oldPassword, newPassword } = body;
      if (!guid || !sessionToken || !oldPassword || !newPassword) {
        return {
          statusCode: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          body: JSON.stringify({ success: false, error: 'All fields are required' })
        };
      }

      try {
        const isValid = await validateSession(guid, sessionToken);
        if (!isValid) {
          return {
            statusCode: 401,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            body: JSON.stringify({ success: false, error: 'Invalid or expired session' })
          };
        }

        const { S3Client, GetObjectCommand, PutObjectCommand } = await import('@aws-sdk/client-s3');
        const bcrypt = (await import('bcryptjs')).default;
        const s3 = new S3Client({ region: S3_REGION });

        const credResult = await s3.send(new GetObjectCommand({ Bucket: S3_BUCKET, Key: `users/${guid}/credentials.json` }));
        const credentials = JSON.parse(await credResult.Body.transformToString());

        const isOldValid = await bcrypt.compare(oldPassword, credentials.passwordHash);
        if (!isOldValid) {
          return {
            statusCode: 400,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            body: JSON.stringify({ success: false, error: 'Current password is incorrect' })
          };
        }

        credentials.passwordHash = await bcrypt.hash(newPassword, 10);
        await s3.send(new PutObjectCommand({
          Bucket: S3_BUCKET,
          Key: `users/${guid}/credentials.json`,
          Body: JSON.stringify(credentials),
          ContentType: 'application/json'
        }));

        // Send password-changed confirmation (fire-and-forget)
        const name = credentials.name || credentials.email?.split('@')[0] || '';
        sendTemplate(credentials.email, renderPasswordChanged, { name }).catch(e => console.error('Password changed email failed:', e.message));

        return {
          statusCode: 200,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          body: JSON.stringify({ success: true })
        };
      } catch (error) {
        return {
          statusCode: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          body: JSON.stringify({ success: false, error: error.message })
        };
      }
    }

    // Forgot password
    if (action === 'forgot-password') {
      const { email } = body;
      const successResponse = {
        statusCode: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify({ success: true, message: 'If an account exists with that email, a reset link has been sent.' })
      };

      if (!email) return successResponse;

      try {
        if (await isResetRateLimited(email)) return successResponse;

        const { S3Client, GetObjectCommand, PutObjectCommand } = await import('@aws-sdk/client-s3');
        const crypto = await import('crypto');
        const s3 = new S3Client({ region: S3_REGION });

        // Look up GUID from email-index
        const emailHash = crypto.createHash('sha256').update(email.toLowerCase().trim()).digest('hex');
        let emailIndex;
        try {
          const result = await s3.send(new GetObjectCommand({ Bucket: S3_BUCKET, Key: `email-index/${emailHash}.json` }));
          emailIndex = JSON.parse(await result.Body.transformToString());
        } catch (e) {
          return successResponse; // Email not found, return success anyway
        }

        const guid = emailIndex.guid;

        // Generate reset token
        const resetToken = crypto.randomBytes(32).toString('hex');
        const now = new Date();
        const expiresAt = new Date(now.getTime() + 60 * 60 * 1000); // 1 hour

        await s3.send(new PutObjectCommand({
          Bucket: S3_BUCKET,
          Key: `users/${guid}/reset-token.json`,
          Body: JSON.stringify({ token: resetToken, email: email.toLowerCase().trim(), createdAt: now.toISOString(), expiresAt: expiresAt.toISOString() }),
          ContentType: 'application/json'
        }));

        // Get user name for the email
        let name = '';
        try {
          const profileResult = await s3.send(new GetObjectCommand({ Bucket: S3_BUCKET, Key: `users/${guid}/profile.json` }));
          const profile = JSON.parse(await profileResult.Body.transformToString());
          name = profile.name || '';
        } catch (e) { /* No profile */ }

        // Send reset email (fire-and-forget)
        sendTemplate(email, renderPasswordResetLink, { name, guid, resetToken }).catch(e => console.error('Reset email failed:', e.message));

        return successResponse;
      } catch (error) {
        console.error('Forgot password error:', error.message);
        return successResponse; // Always return success
      }
    }

    // Reset password
    if (action === 'reset-password') {
      const { guid, resetToken, newPassword } = body;
      if (!guid || !resetToken || !newPassword) {
        return {
          statusCode: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          body: JSON.stringify({ success: false, error: 'All fields are required' })
        };
      }
      if (newPassword.length < 6) {
        return {
          statusCode: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          body: JSON.stringify({ success: false, error: 'Password must be at least 6 characters' })
        };
      }

      try {
        const { S3Client, GetObjectCommand, PutObjectCommand, DeleteObjectCommand } = await import('@aws-sdk/client-s3');
        const bcrypt = (await import('bcryptjs')).default;
        const s3 = new S3Client({ region: S3_REGION });

        // Read and verify reset token
        let storedToken;
        try {
          const result = await s3.send(new GetObjectCommand({ Bucket: S3_BUCKET, Key: `users/${guid}/reset-token.json` }));
          storedToken = JSON.parse(await result.Body.transformToString());
        } catch (e) {
          return {
            statusCode: 400,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            body: JSON.stringify({ success: false, error: 'Invalid or expired reset token' })
          };
        }

        if (storedToken.token !== resetToken || new Date(storedToken.expiresAt) < new Date()) {
          return {
            statusCode: 400,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            body: JSON.stringify({ success: false, error: 'Invalid or expired reset token' })
          };
        }

        // Update password
        const credResult = await s3.send(new GetObjectCommand({ Bucket: S3_BUCKET, Key: `users/${guid}/credentials.json` }));
        const credentials = JSON.parse(await credResult.Body.transformToString());
        credentials.passwordHash = await bcrypt.hash(newPassword, 10);

        await s3.send(new PutObjectCommand({
          Bucket: S3_BUCKET,
          Key: `users/${guid}/credentials.json`,
          Body: JSON.stringify(credentials),
          ContentType: 'application/json'
        }));

        // Delete reset token (single-use)
        await s3.send(new DeleteObjectCommand({
          Bucket: S3_BUCKET,
          Key: `users/${guid}/reset-token.json`
        }));

        // Send password-changed confirmation (fire-and-forget)
        let name = '';
        try {
          const profileResult = await s3.send(new GetObjectCommand({ Bucket: S3_BUCKET, Key: `users/${guid}/profile.json` }));
          const profile = JSON.parse(await profileResult.Body.transformToString());
          name = profile.name || '';
        } catch (e) { /* No profile */ }

        sendTemplate(storedToken.email, renderPasswordChanged, { name }).catch(e => console.error('Password changed email failed:', e.message));

        return {
          statusCode: 200,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          body: JSON.stringify({ success: true })
        };
      } catch (error) {
        return {
          statusCode: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          body: JSON.stringify({ success: false, error: error.message })
        };
      }
    }

    // Admin Get Single Chat Session Detail
    if (action === 'admin-chat-detail') {
      const { password, sessionId, source } = body;
      if (password !== ADMIN_PASSWORD) {
        return {
          statusCode: 401,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          body: JSON.stringify({ success: false, error: 'Unauthorized' })
        };
      }

      if (!sessionId) {
        return {
          statusCode: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          body: JSON.stringify({ success: false, error: 'sessionId is required' })
        };
      }

      try {
        const { S3Client, GetObjectCommand } = await import('@aws-sdk/client-s3');
        const s3 = new S3Client({ region: S3_REGION });

        // Try both prefixes if source not specified
        const prefixes = source ? [`chats/${source}/`] : ['chats/landing/', 'chats/apply/'];

        for (const prefix of prefixes) {
          try {
            const result = await s3.send(new GetObjectCommand({
              Bucket: S3_BUCKET,
              Key: `${prefix}${sessionId}.json`
            }));
            const session = JSON.parse(await result.Body.transformToString());
            return {
              statusCode: 200,
              headers: { ...corsHeaders, 'Content-Type': 'application/json' },
              body: JSON.stringify({ success: true, session })
            };
          } catch (e) {
            // Try next prefix
          }
        }

        return {
          statusCode: 404,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          body: JSON.stringify({ success: false, error: 'Session not found' })
        };
      } catch (error) {
        return {
          statusCode: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          body: JSON.stringify({ success: false, error: error.message })
        };
      }
    }

    // Admin Get Client Profile Detail
    if (action === 'admin-client-detail') {
      const { password, clientId } = body;
      if (password !== ADMIN_PASSWORD) {
        return {
          statusCode: 401,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          body: JSON.stringify({ success: false, error: 'Unauthorized' })
        };
      }

      if (!clientId) {
        return {
          statusCode: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          body: JSON.stringify({ success: false, error: 'clientId is required' })
        };
      }

      try {
        const { S3Client, GetObjectCommand } = await import('@aws-sdk/client-s3');
        const s3 = new S3Client({ region: S3_REGION });

        const result = await s3.send(new GetObjectCommand({
          Bucket: S3_BUCKET,
          Key: `clients/${clientId}.json`
        }));
        const client = JSON.parse(await result.Body.transformToString());
        return {
          statusCode: 200,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          body: JSON.stringify({ success: true, client })
        };
      } catch (error) {
        return {
          statusCode: 404,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          body: JSON.stringify({ success: false, error: 'Client not found' })
        };
      }
    }

    // Admin Get Build Detail with Agent Log
    if (action === 'admin-build-detail') {
      const { password, buildId } = body;
      if (password !== ADMIN_PASSWORD) {
        return {
          statusCode: 401,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          body: JSON.stringify({ success: false, error: 'Unauthorized' })
        };
      }

      if (!buildId) {
        return {
          statusCode: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          body: JSON.stringify({ success: false, error: 'buildId is required' })
        };
      }

      try {
        const { S3Client, GetObjectCommand } = await import('@aws-sdk/client-s3');
        const s3 = new S3Client({ region: S3_REGION });

        let metadata = null;

        // Try builds/ metadata first
        try {
          const metadataResult = await s3.send(new GetObjectCommand({
            Bucket: S3_BUCKET,
            Key: `builds/${buildId}/metadata.json`
          }));
          metadata = JSON.parse(await metadataResult.Body.transformToString());
        } catch (e) {
          // Not in builds/, try jobs/
        }

        // Fallback to jobs/ prefix
        if (!metadata) {
          try {
            const jobResult = await s3.send(new GetObjectCommand({
              Bucket: S3_BUCKET,
              Key: `jobs/${buildId}.json`
            }));
            const job = JSON.parse(await jobResult.Body.transformToString());
            metadata = {
              buildId: job.jobId,
              status: 'pending',
              client: job.client,
              business: job.business,
              preferences: job.preferences,
              timestamps: { created: job.createdAt },
              createdAt: job.createdAt
            };
          } catch (e) {
            // Not in jobs/ either
          }
        }

        if (!metadata) {
          return {
            statusCode: 404,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            body: JSON.stringify({ success: false, error: 'Build not found' })
          };
        }

        // Try to get agent log
        let agentLog = null;
        try {
          const logResult = await s3.send(new GetObjectCommand({
            Bucket: S3_BUCKET,
            Key: `builds/${buildId}/agent-log.json`
          }));
          agentLog = JSON.parse(await logResult.Body.transformToString());
        } catch (e) {
          // Agent log may not exist yet
        }

        // Try to get progress data
        let progress = null;
        try {
          const progressResult = await s3.send(new GetObjectCommand({
            Bucket: S3_BUCKET,
            Key: `progress/${buildId}.json`
          }));
          progress = JSON.parse(await progressResult.Body.transformToString());
        } catch (e) {
          // Progress may not exist
        }

        return {
          statusCode: 200,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          body: JSON.stringify({ success: true, build: { ...metadata, agentLog, progress } })
        };
      } catch (error) {
        return {
          statusCode: 404,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          body: JSON.stringify({ success: false, error: 'Build not found' })
        };
      }
    }

    // ========== BUILD STATUS UPDATE (deploy/fail notifications) ==========
    if (action === 'update-build-status') {
      const { jobId, status: buildStatus, guid, projectName, deploymentUrl, errorMessage } = body;

      if (!jobId || !buildStatus) {
        return {
          statusCode: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          body: JSON.stringify({ success: false, error: 'jobId and status are required' })
        };
      }

      try {
        const { S3Client, GetObjectCommand, PutObjectCommand } = await import('@aws-sdk/client-s3');
        const s3 = new S3Client({ region: S3_REGION });

        // Update the progress file with new status
        let progressData = {};
        try {
          const progressResult = await s3.send(new GetObjectCommand({
            Bucket: S3_BUCKET,
            Key: `progress/${jobId}.json`
          }));
          progressData = JSON.parse(await progressResult.Body.transformToString());
        } catch (e) {
          console.warn('Could not read progress file for', jobId);
        }

        progressData.status = buildStatus;
        progressData.updatedAt = new Date().toISOString();
        if (deploymentUrl) progressData.deploymentUrl = deploymentUrl;
        if (errorMessage) progressData.errorMessage = errorMessage;

        await s3.send(new PutObjectCommand({
          Bucket: S3_BUCKET,
          Key: `progress/${jobId}.json`,
          Body: JSON.stringify(progressData, null, 2),
          ContentType: 'application/json'
        }));

        // Resolve applicant info from the progress data or the request body
        const applicantEmail = progressData.clientEmail || body.applicantEmail;
        const applicantName = progressData.clientName || body.applicantName || 'Partner';

        // Send deployment success email
        if ((buildStatus === 'completed' || buildStatus === 'deployed') && applicantEmail) {
          const { html, text, subject } = renderProjectDeployed({
            name: applicantName,
            projectName: projectName || progressData.projectName || 'Your Project',
            deploymentUrl: deploymentUrl || progressData.deploymentUrl || '',
            guid: guid || progressData.guid || ''
          });
          sendTemplatedEmail(applicantEmail, subject, html, text).catch(e => console.error('Deploy notification failed:', e.message));
        }

        // Send build failed emails
        if (buildStatus === 'failed') {
          if (applicantEmail) {
            const { html, text, subject } = renderBuildFailedUser({
              name: applicantName,
              projectName: projectName || progressData.projectName || 'Your Project',
              errorSummary: errorMessage || 'An unexpected error occurred during the build process.'
            });
            sendTemplatedEmail(applicantEmail, subject, html, text).catch(e => console.error('Build failed user email error:', e.message));
          }
          const adminEmail = renderBuildFailedAdmin({
            userName: applicantName,
            userEmail: applicantEmail || 'unknown',
            guid: guid || progressData.guid || '',
            projectName: projectName || progressData.projectName || 'Unknown Project',
            jobId,
            errorDetails: errorMessage || 'No error details available.'
          });
          sendToAdmins(adminEmail.subject, adminEmail.html, adminEmail.text).catch(e => console.error('Build failed admin email error:', e.message));
        }

        return {
          statusCode: 200,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          body: JSON.stringify({ success: true, status: buildStatus })
        };
      } catch (error) {
        console.error('Update build status error:', error.message);
        return {
          statusCode: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          body: JSON.stringify({ success: false, error: error.message })
        };
      }
    }

    // Admin Delete Chats
    if (action === 'admin-delete-chats') {
      const { password, sessionIds } = body;
      if (password !== ADMIN_PASSWORD) {
        return {
          statusCode: 401,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          body: JSON.stringify({ success: false, error: 'Unauthorized' })
        };
      }

      if (!sessionIds || !Array.isArray(sessionIds) || sessionIds.length === 0) {
        return {
          statusCode: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          body: JSON.stringify({ success: false, error: 'sessionIds array is required' })
        };
      }

      try {
        const { S3Client, DeleteObjectCommand } = await import('@aws-sdk/client-s3');
        const s3 = new S3Client({ region: S3_REGION });

        const deletePromises = sessionIds.map(async (sessionInfo) => {
          const { sessionId, source } = sessionInfo;
          const key = `chats/${source}/${sessionId}.json`;

          try {
            await s3.send(new DeleteObjectCommand({
              Bucket: S3_BUCKET,
              Key: key
            }));
            return { sessionId, success: true };
          } catch (e) {
            console.error('Error deleting session:', sessionId, e.message);
            return { sessionId, success: false, error: e.message };
          }
        });

        const results = await Promise.all(deletePromises);
        const successCount = results.filter(r => r.success).length;
        const failedCount = results.filter(r => !r.success).length;

        return {
          statusCode: 200,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            success: true,
            deleted: successCount,
            failed: failedCount,
            results
          })
        };
      } catch (error) {
        console.error('Delete chats error:', error.message);
        return {
          statusCode: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          body: JSON.stringify({ success: false, error: error.message })
        };
      }
    }

    // ========== SESSION LOOKUP ENDPOINT ==========

    // Lookup existing session by phone or email (for returning users)
    if (action === 'lookup-session') {
      const { phone, email } = body;

      if (!phone && !email) {
        return {
          statusCode: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          body: JSON.stringify({ success: false, error: 'Phone or email is required' })
        };
      }

      const result = await lookupSessionByContact(phone, email);

      if (result.found) {
        return {
          statusCode: 200,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            success: true,
            found: true,
            sessionId: result.sessionId,
            matchedBy: result.matchedBy,
            messages: result.messages,
            visitorInfo: result.visitorInfo,
            lastActivity: result.session.lastActivity
          })
        };
      } else {
        return {
          statusCode: 200,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            success: true,
            found: false,
            reason: result.reason
          })
        };
      }
    }

    // ========== EARLY DUPLICATE CHECK ENDPOINT ==========
    // Called by frontend when email is first collected (before form fill)
    if (action === 'check-duplicate') {
      const { email, phone } = body;

      if (!email && !phone) {
        return {
          statusCode: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          body: JSON.stringify({ success: false, error: 'Email or phone is required' })
        };
      }

      console.log('Early duplicate check for:', { email, phone });

      const duplicateCheck = await checkDuplicateApplication(email, phone);

      if (duplicateCheck.isDuplicate) {
        const submittedDate = duplicateCheck.submittedAt
          ? new Date(duplicateCheck.submittedAt).toLocaleDateString()
          : 'recently';

        console.log('Duplicate found:', duplicateCheck);

        return {
          statusCode: 200,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            success: true,
            isDuplicate: true,
            matchedBy: duplicateCheck.matchedBy,
            submittedAt: submittedDate,
            message: `You already have an application submitted on ${submittedDate} using this ${duplicateCheck.matchedBy}. Our team is reviewing it and will contact you soon.`
          })
        };
      } else {
        console.log('No duplicate found - user can proceed');
        return {
          statusCode: 200,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            success: true,
            isDuplicate: false,
            message: 'No existing application found. You can proceed with your new application.'
          })
        };
      }
    }

    // ========== ABANDONED FORM TRACKING ENDPOINT ==========
    // Called when user leaves page without submitting (beforeunload)
    if (action === 'save-abandoned-form') {
      const { sessionId, formData, chatState, reason } = body;

      if (!sessionId) {
        return {
          statusCode: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          body: JSON.stringify({ success: false, error: 'Session ID is required' })
        };
      }

      console.log('Saving abandoned form for session:', sessionId);

      const result = await saveAbandonedForm(sessionId, formData, chatState, visitorInfo, clientIP, reason);

      return {
        statusCode: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          success: result.success,
          key: result.key || null,
          error: result.error || null
        })
      };
    }

    // ========== EMAIL PREFERENCES (UNSUBSCRIBE) ==========
    if (action === 'update-email-preferences') {
      const { guid, preferences } = body;

      if (!guid || !preferences) {
        return {
          statusCode: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          body: JSON.stringify({ success: false, error: 'guid and preferences are required' })
        };
      }

      try {
        const { S3Client, GetObjectCommand, PutObjectCommand } = await import('@aws-sdk/client-s3');
        const s3 = new S3Client({ region: S3_REGION });

        // Read existing profile
        let profile = {};
        try {
          const profileResult = await s3.send(new GetObjectCommand({
            Bucket: S3_BUCKET,
            Key: `users/${guid}/profile.json`
          }));
          profile = JSON.parse(await profileResult.Body.transformToString());
        } catch (e) {
          console.warn('No existing profile for', guid);
        }

        // Merge preferences
        profile.emailPreferences = {
          ...(profile.emailPreferences || {}),
          ...preferences
        };
        profile.updatedAt = new Date().toISOString();

        // Save back
        await s3.send(new PutObjectCommand({
          Bucket: S3_BUCKET,
          Key: `users/${guid}/profile.json`,
          Body: JSON.stringify(profile, null, 2),
          ContentType: 'application/json'
        }));

        return {
          statusCode: 200,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          body: JSON.stringify({ success: true, emailPreferences: profile.emailPreferences })
        };
      } catch (error) {
        console.error('Update email preferences error:', error.message);
        return {
          statusCode: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          body: JSON.stringify({ success: false, error: error.message })
        };
      }
    }

    // ========== SCHEDULED EMAIL HANDLERS ==========

    // Session Expiry Reminder (scheduled via EventBridge)
    if (action === 'scheduled-session-expiry') {
      console.log('[Scheduled] Session expiry reminder check started');
      try {
        const { S3Client, ListObjectsV2Command, GetObjectCommand } = await import('@aws-sdk/client-s3');
        const s3 = new S3Client({ region: S3_REGION });

        // List all user directories
        const usersResult = await s3.send(new ListObjectsV2Command({
          Bucket: S3_BUCKET,
          Prefix: 'users/',
          Delimiter: '/'
        }));

        const userPrefixes = (usersResult.CommonPrefixes || []).map(p => p.Prefix);
        let sent = 0;
        const errors = [];

        for (const prefix of userPrefixes) {
          try {
            // Read sessions.json
            const sessionsResult = await s3.send(new GetObjectCommand({
              Bucket: S3_BUCKET,
              Key: `${prefix}sessions.json`
            }));
            const sessions = JSON.parse(await sessionsResult.Body.transformToString());

            // Check if any token expires within 24 hours
            const now = new Date();
            const twentyFourHoursFromNow = new Date(now.getTime() + 24 * 60 * 60 * 1000);
            const expiringToken = (sessions.tokens || []).find(t => {
              const expiresAt = new Date(t.expiresAt);
              return expiresAt > now && expiresAt <= twentyFourHoursFromNow;
            });

            if (expiringToken) {
              // Read profile for name/email
              try {
                const profileResult = await s3.send(new GetObjectCommand({
                  Bucket: S3_BUCKET,
                  Key: `${prefix}profile.json`
                }));
                const profile = JSON.parse(await profileResult.Body.transformToString());

                if (profile.email) {
                  const { html, text, subject } = renderSessionExpiryReminder({
                    name: profile.name || profile.email,
                    expiresAt: expiringToken.expiresAt
                  });
                  await sendTemplatedEmail(profile.email, subject, html, text);
                  sent++;
                }
              } catch (profileErr) {
                errors.push(`Profile read error for ${prefix}: ${profileErr.message}`);
              }
            }
          } catch (e) {
            // No sessions.json for this user, skip
          }
        }

        console.log(`[Scheduled] Session expiry: sent=${sent}, errors=${errors.length}`);
        return {
          statusCode: 200,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          body: JSON.stringify({ success: true, sent, errors })
        };
      } catch (error) {
        console.error('[Scheduled] Session expiry error:', error.message);
        return {
          statusCode: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          body: JSON.stringify({ success: false, error: error.message })
        };
      }
    }

    // Weekly Digest (scheduled via EventBridge)
    if (action === 'scheduled-weekly-digest') {
      console.log('[Scheduled] Weekly digest started');
      try {
        const { S3Client, GetObjectCommand } = await import('@aws-sdk/client-s3');
        const s3 = new S3Client({ region: S3_REGION });

        const allApps = await listApplications();
        const approvedApps = allApps.filter(app => app.status === 'approved' && app.guid);

        let sent = 0;
        let skipped = 0;
        const errors = [];

        for (const app of approvedApps) {
          const email = app.visitorInfo?.email || app.formData?.email;
          const name = app.visitorInfo?.name || app.formData?.name || 'Partner';
          const guid = app.guid;

          if (!email) {
            skipped++;
            continue;
          }

          try {
            // Check email preferences
            let profile = {};
            try {
              const profileResult = await s3.send(new GetObjectCommand({
                Bucket: S3_BUCKET,
                Key: `users/${guid}/profile.json`
              }));
              profile = JSON.parse(await profileResult.Body.transformToString());
            } catch (e) { /* no profile yet */ }

            if (profile.emailPreferences?.weeklyDigest === false) {
              skipped++;
              continue;
            }

            // Get last activity from login history
            let lastActivity = null;
            try {
              const historyResult = await s3.send(new GetObjectCommand({
                Bucket: S3_BUCKET,
                Key: `users/${guid}/login-history.json`
              }));
              const history = JSON.parse(await historyResult.Body.transformToString());
              const entries = history.logins || history;
              if (Array.isArray(entries) && entries.length > 0) {
                lastActivity = entries[entries.length - 1].timestamp || entries[entries.length - 1].loginAt;
              }
            } catch (e) { /* no login history */ }

            // Get deployment status
            let deploymentStatus = null;
            const jobId = app.jobId || app.buildJobId;
            if (jobId) {
              try {
                const progressResult = await s3.send(new GetObjectCommand({
                  Bucket: S3_BUCKET,
                  Key: `progress/${jobId}.json`
                }));
                const progress = JSON.parse(await progressResult.Body.transformToString());
                deploymentStatus = progress.status;
              } catch (e) { /* no progress file */ }
            }

            const { html, text, subject } = renderWeeklyDigest({
              name,
              guid,
              lastActivity,
              deploymentStatus,
              projectName: app.formData?.productIdea?.substring(0, 50) || 'Your Project'
            });
            await sendTemplatedEmail(email, subject, html, text);
            sent++;
          } catch (e) {
            errors.push(`${email}: ${e.message}`);
          }
        }

        console.log(`[Scheduled] Weekly digest: sent=${sent}, skipped=${skipped}, errors=${errors.length}`);
        return {
          statusCode: 200,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          body: JSON.stringify({ success: true, sent, errors, skipped })
        };
      } catch (error) {
        console.error('[Scheduled] Weekly digest error:', error.message);
        return {
          statusCode: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          body: JSON.stringify({ success: false, error: error.message })
        };
      }
    }

    // Re-engagement Email (scheduled via EventBridge)
    if (action === 'scheduled-re-engagement') {
      console.log('[Scheduled] Re-engagement check started');
      try {
        const { S3Client, GetObjectCommand } = await import('@aws-sdk/client-s3');
        const s3 = new S3Client({ region: S3_REGION });

        const allApps = await listApplications();
        const approvedApps = allApps.filter(app => app.status === 'approved' && app.guid);

        let sent = 0;
        let skipped = 0;
        const errors = [];
        const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

        for (const app of approvedApps) {
          const email = app.visitorInfo?.email || app.formData?.email;
          const name = app.visitorInfo?.name || app.formData?.name || 'Partner';
          const guid = app.guid;

          if (!email) {
            skipped++;
            continue;
          }

          try {
            // Check email preferences
            let profile = {};
            try {
              const profileResult = await s3.send(new GetObjectCommand({
                Bucket: S3_BUCKET,
                Key: `users/${guid}/profile.json`
              }));
              profile = JSON.parse(await profileResult.Body.transformToString());
            } catch (e) { /* no profile yet */ }

            if (profile.emailPreferences?.reEngagement === false) {
              skipped++;
              continue;
            }

            // Get last login from login history
            let lastLogin = null;
            try {
              const historyResult = await s3.send(new GetObjectCommand({
                Bucket: S3_BUCKET,
                Key: `users/${guid}/login-history.json`
              }));
              const history = JSON.parse(await historyResult.Body.transformToString());
              const entries = history.logins || history;
              if (Array.isArray(entries) && entries.length > 0) {
                lastLogin = entries[entries.length - 1].timestamp || entries[entries.length - 1].loginAt;
              }
            } catch (e) { /* no login history - never logged in */ }

            // Only send if last login was 30+ days ago or never logged in
            if (lastLogin && new Date(lastLogin) > thirtyDaysAgo) {
              skipped++;
              continue;
            }

            const { html, text, subject } = renderReEngagement({
              name,
              guid,
              lastLogin
            });
            await sendTemplatedEmail(email, subject, html, text);
            sent++;
          } catch (e) {
            errors.push(`${email}: ${e.message}`);
          }
        }

        console.log(`[Scheduled] Re-engagement: sent=${sent}, skipped=${skipped}, errors=${errors.length}`);
        return {
          statusCode: 200,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          body: JSON.stringify({ success: true, sent, errors, skipped })
        };
      } catch (error) {
        console.error('[Scheduled] Re-engagement error:', error.message);
        return {
          statusCode: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          body: JSON.stringify({ success: false, error: error.message })
        };
      }
    }

    // ========== SYNC STATE ENDPOINT ==========
    // Periodically sync localStorage state to S3
    if (action === 'sync-state') {
      const { sessionId, chatState } = body;

      if (!sessionId || !chatState) {
        return {
          statusCode: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          body: JSON.stringify({ success: false, error: 'Session ID and chat state are required' })
        };
      }

      console.log('Syncing state for session:', sessionId);

      const result = await syncLocalStorageToS3(sessionId, chatState, visitorInfo, clientIP);

      return {
        statusCode: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          success: result.success,
          synced: result.synced || false,
          error: result.error || null
        })
      };
    }

    // ========== CHAT ENDPOINT ==========

    if (!messages || !Array.isArray(messages) || messages.length === 0) {
      return {
        statusCode: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'Messages array is required' })
      };
    }

    // Get or generate session ID for chat history tracking
    const sessionId = body.sessionId || generateSessionId();
    const chatSource = visitorInfo.page?.includes('apply') ? 'apply' : 'landing';

    // Use LLM to extract contact info from entire conversation
    const extractedInfo = await extractContactInfoWithLLM(messages);

    const updatedVisitorInfo = {
      ...visitorInfo,
      ...(extractedInfo.name && { name: extractedInfo.name }),
      ...(extractedInfo.email && { email: extractedInfo.email }),
      ...(extractedInfo.phone && { phone: extractedInfo.phone }),
      clientIP,
      page: visitorInfo.page || body.page
    };

    // Check if we have complete contact info
    const hasName = !!(updatedVisitorInfo.name);
    const hasContact = !!(updatedVisitorInfo.phone || updatedVisitorInfo.email);
    const hasCompleteContactInfo = hasName && hasContact;

    // Track if this is the first time we have complete contact info
    const hadContactInfoBefore = visitorInfo.name && (visitorInfo.phone || visitorInfo.email);

    // Check if this is a form submission
    const latestMessage = messages[messages.length - 1]?.content || '';
    const isFormSubmission = latestMessage.includes('PARTNERSHIP APPLICATION SUBMISSION');

    console.log('Contact status:', {
      hasName,
      hasContact,
      hasCompleteContactInfo,
      hadContactInfoBefore,
      isFormSubmission,
      extracted: extractedInfo
    });

    // For form submissions, save to S3 and send email
    if (isFormSubmission) {
      console.log('Form submission detected - checking for duplicates...');

      // Check for duplicate application
      const duplicateCheck = await checkDuplicateApplication(
        updatedVisitorInfo.email,
        updatedVisitorInfo.phone
      );

      if (duplicateCheck.isDuplicate) {
        console.log('Duplicate application detected:', duplicateCheck);
        const submittedDate = duplicateCheck.submittedAt
          ? new Date(duplicateCheck.submittedAt).toLocaleDateString()
          : 'previously';

        return {
          statusCode: 200,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            success: true,
            response: `It looks like you've already submitted an application on ${submittedDate} using the same ${duplicateCheck.matchedBy}. Our team is reviewing it and will contact you soon. If you have updates or questions, please email us at hello@cocreateidea.com`,
            provider: 'system',
            visitorInfo: updatedVisitorInfo,
            hasContactInfo: true,
            formSubmitted: false,
            isDuplicate: true,
            duplicateInfo: {
              matchedBy: duplicateCheck.matchedBy,
              submittedAt: duplicateCheck.submittedAt
            },
            sessionId
          })
        };
      }

      console.log('No duplicate found - saving to S3 and sending emails...');

      // Save to S3 and send emails in parallel (admin notification + applicant confirmation)
      const [s3Result, adminEmailResult, applicantEmailResult] = await Promise.all([
        saveFormToS3(updatedVisitorInfo, latestMessage, clientIP),
        sendFormSubmissionEmail(updatedVisitorInfo, latestMessage, clientIP),
        sendApplicantConfirmationEmail(updatedVisitorInfo, latestMessage)
      ]);

      console.log('S3 save result:', s3Result);
      console.log('Admin email send result:', adminEmailResult);
      console.log('Applicant confirmation email result:', applicantEmailResult);

      // Save chat session and link to application
      const sessionResult = await saveChatSession(sessionId, chatSource, messages, updatedVisitorInfo, 'converted');
      if (s3Result.success) {
        await linkSessionToApplication(sessionId, chatSource, s3Result.key);
      }

      // Create/update client profile
      if (sessionResult.clientId) {
        await getOrCreateClientProfile(sessionResult.clientId, updatedVisitorInfo);
        await updateClientProfile(sessionResult.clientId, {
          ...updatedVisitorInfo,
          status: 'applied',
          addChatSession: sessionId,
          addApplication: s3Result.key,
          timelineEvent: { event: 'application_submitted', ref: s3Result.key }
        });
      }

      return {
        statusCode: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          success: true,
          response: 'Thank you for your application! We will review it and get back to you within 24 hours.',
          provider: 'system',
          visitorInfo: updatedVisitorInfo,
          hasContactInfo: true,
          formSubmitted: true,
          s3Key: s3Result.success ? s3Result.key : null,
          sessionId
        })
      };
    }

    // Get screenshot from request if provided
    const screenshot = body.screenshot || null;

    // Get page context from request
    const pageContext = body.pageContext || null;
    console.log('Page context received:', pageContext);

    // Process attachments (PDF, text files, images)
    const attachments = body.attachments || null;
    let processedAttachments = null;
    if (attachments && Array.isArray(attachments) && attachments.length > 0) {
      console.log('Processing', attachments.length, 'attachment(s)...');
      processedAttachments = await processAttachments(attachments);
      console.log('Processed attachments:', processedAttachments?.map(a => ({ type: a.type, name: a.name })));
    }

    // Get AI response
    let response;
    try {
      response = await chatWithClaude(messages, hasCompleteContactInfo, screenshot, pageContext, processedAttachments);
    } catch (claudeError) {
      console.log('Claude failed, trying OpenAI backup');
      response = await chatWithOpenAI(messages, hasCompleteContactInfo, screenshot);
    }

    // If this is the first time we got complete contact info, send email notification
    if (hasCompleteContactInfo && !hadContactInfoBefore) {
      console.log('Sending email notification for new lead...');
      await sendEmail(updatedVisitorInfo, messages, response.content, clientIP);
    }

    // Save chat session with AI response included
    const messagesWithResponse = [
      ...messages,
      { role: 'assistant', content: response.content, timestamp: new Date().toISOString() }
    ];
    const sessionResult = await saveChatSession(sessionId, chatSource, messagesWithResponse, updatedVisitorInfo);

    // Save session lookup index for phone/email (for returning user session persistence)
    if (hasCompleteContactInfo) {
      await saveSessionLookup(sessionId, updatedVisitorInfo.phone, updatedVisitorInfo.email);
    }

    // Create/update client profile if we have contact info
    if (sessionResult.clientId && hasCompleteContactInfo) {
      await getOrCreateClientProfile(sessionResult.clientId, updatedVisitorInfo);
      await updateClientProfile(sessionResult.clientId, {
        ...updatedVisitorInfo,
        addChatSession: sessionId,
        timelineEvent: { event: 'chat_with_contact', ref: sessionId }
      });
    }

    return {
      statusCode: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        success: true,
        response: response.content,
        provider: response.provider,
        visitorInfo: updatedVisitorInfo,
        hasContactInfo: hasCompleteContactInfo,
        contactStatus: {
          hasName,
          hasContact,
          complete: hasCompleteContactInfo
        },
        usage: response.usage || null,
        sessionId
      })
    };

  } catch (error) {
    console.error('Handler error:', error);
    return {
      statusCode: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        error: 'Failed to process request',
        message: error.message
      })
    };
  }
};
