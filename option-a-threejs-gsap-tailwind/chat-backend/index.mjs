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

// Configuration
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const NOTIFICATION_EMAIL = process.env.NOTIFICATION_EMAIL || 'gopi@sunwaretechnologies.com';

// S3 bucket for storing all data
const S3_BUCKET = 'ai-product-studio-applications';

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
- If user has questions about their existing application, refer them to: gopi@sunwaretechnologies.com

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

// Send Email via AWS SES
async function sendEmail(visitorInfo, messages, aiResponse, clientIP) {
  const { SESClient, SendEmailCommand } = await import('@aws-sdk/client-ses');
  const ses = new SESClient({ region: 'us-east-1' });

  // Format conversation
  const conversationHtml = messages.map(m => {
    const role = m.role === 'user' ? '👤 Visitor' : '🤖 AI';
    const bgColor = m.role === 'user' ? '#e3f2fd' : '#f5f5f5';
    return `<div style="background: ${bgColor}; padding: 12px; margin: 8px 0; border-radius: 8px;">
      <strong>${role}:</strong><br/>
      ${m.content.replace(/\n/g, '<br/>')}
    </div>`;
  }).join('');

  const emailHtml = `
<!DOCTYPE html>
<html>
<head>
  <style>
    body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
    .container { max-width: 600px; margin: 0 auto; padding: 20px; }
    .header { background: linear-gradient(135deg, #6366f1, #06b6d4); color: white; padding: 20px; border-radius: 8px 8px 0 0; }
    .content { background: #fff; border: 1px solid #e0e0e0; padding: 20px; border-radius: 0 0 8px 8px; }
    .info-box { background: #f8f9fa; padding: 15px; border-radius: 8px; margin: 15px 0; }
    .label { font-weight: bold; color: #6366f1; }
    .conversation { margin-top: 20px; }
    .ai-response { background: #e8f5e9; padding: 15px; border-radius: 8px; border-left: 4px solid #4caf50; margin-top: 15px; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h2 style="margin: 0;">🚀 New AI Product Studio Lead!</h2>
      <p style="margin: 5px 0 0 0; opacity: 0.9;">Someone is interested in partnering with you</p>
    </div>
    <div class="content">
      <div class="info-box">
        <p><span class="label">👤 Name:</span> ${visitorInfo.name || 'Not provided'}</p>
        <p><span class="label">📧 Email:</span> ${visitorInfo.email || 'Not provided'}</p>
        <p><span class="label">📱 Phone:</span> ${visitorInfo.phone || 'Not provided'}</p>
        <p><span class="label">🌐 Page:</span> ${visitorInfo.page || 'Unknown'}</p>
        <p><span class="label">🖥️ IP:</span> ${clientIP || 'Unknown'}</p>
        <p><span class="label">⏰ Time:</span> ${new Date().toLocaleString('en-US', { timeZone: 'America/New_York' })} EST</p>
      </div>

      <div class="conversation">
        <h3>💬 Full Conversation:</h3>
        ${conversationHtml}
      </div>

      <div class="ai-response">
        <h4 style="margin-top: 0;">🤖 Latest AI Response:</h4>
        ${aiResponse.replace(/\n/g, '<br/>')}
      </div>
    </div>
  </div>
</body>
</html>`;

  const emailText = `
NEW AI PRODUCT STUDIO LEAD!

Name: ${visitorInfo.name || 'Not provided'}
Email: ${visitorInfo.email || 'Not provided'}
Phone: ${visitorInfo.phone || 'Not provided'}
Page: ${visitorInfo.page || 'Unknown'}
IP: ${clientIP || 'Unknown'}
Time: ${new Date().toLocaleString('en-US', { timeZone: 'America/New_York' })} EST

CONVERSATION:
${messages.map(m => `${m.role.toUpperCase()}: ${m.content}`).join('\n\n')}

AI RESPONSE:
${aiResponse}
`;

  try {
    const result = await ses.send(new SendEmailCommand({
      Source: NOTIFICATION_EMAIL,
      Destination: {
        ToAddresses: [NOTIFICATION_EMAIL]
      },
      Message: {
        Subject: {
          Data: `🚀 New Lead: ${visitorInfo.name || 'Anonymous'} - AI Product Studio`,
          Charset: 'UTF-8'
        },
        Body: {
          Html: {
            Data: emailHtml,
            Charset: 'UTF-8'
          },
          Text: {
            Data: emailText,
            Charset: 'UTF-8'
          }
        }
      }
    }));
    console.log('Email sent successfully, MessageId:', result.MessageId);
    return true;
  } catch (error) {
    console.error('Email send error:', error.message);
    return false;
  }
}

// Send Form Submission Email via AWS SES
async function sendFormSubmissionEmail(visitorInfo, formContent, clientIP) {
  const { SESClient, SendEmailCommand } = await import('@aws-sdk/client-ses');
  const ses = new SESClient({ region: 'us-east-1' });

  // Parse form content - it's formatted as key: value pairs
  const formLines = formContent.split('\n').filter(line => line.includes(':'));
  const formDataHtml = formLines.map(line => {
    const [key, ...valueParts] = line.split(':');
    const value = valueParts.join(':').trim();
    if (key && value) {
      return `<tr>
        <td style="padding: 10px; border-bottom: 1px solid #e0e0e0; font-weight: bold; color: #6366f1; width: 200px;">${key.trim()}</td>
        <td style="padding: 10px; border-bottom: 1px solid #e0e0e0;">${value}</td>
      </tr>`;
    }
    return '';
  }).join('');

  const emailHtml = `
<!DOCTYPE html>
<html>
<head>
  <style>
    body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
    .container { max-width: 700px; margin: 0 auto; padding: 20px; }
    .header { background: linear-gradient(135deg, #10b981, #06b6d4); color: white; padding: 25px; border-radius: 8px 8px 0 0; text-align: center; }
    .content { background: #fff; border: 1px solid #e0e0e0; padding: 25px; border-radius: 0 0 8px 8px; }
    .info-table { width: 100%; border-collapse: collapse; margin: 20px 0; }
    .section-title { background: #f8f9fa; padding: 12px; font-weight: bold; color: #374151; border-left: 4px solid #6366f1; margin: 20px 0 10px 0; }
    .footer { margin-top: 25px; padding: 15px; background: #f0fdf4; border-radius: 8px; border-left: 4px solid #10b981; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h2 style="margin: 0;">🎉 New Partnership Application!</h2>
      <p style="margin: 10px 0 0 0; opacity: 0.9;">Someone wants to partner with AI Product Studio</p>
    </div>
    <div class="content">
      <div class="section-title">📋 Application Details</div>
      <table class="info-table">
        ${formDataHtml}
      </table>

      <div class="section-title">📍 Submission Info</div>
      <table class="info-table">
        <tr>
          <td style="padding: 10px; border-bottom: 1px solid #e0e0e0; font-weight: bold; color: #6366f1; width: 200px;">🖥️ IP Address</td>
          <td style="padding: 10px; border-bottom: 1px solid #e0e0e0;">${clientIP || 'Unknown'}</td>
        </tr>
        <tr>
          <td style="padding: 10px; border-bottom: 1px solid #e0e0e0; font-weight: bold; color: #6366f1;">⏰ Submitted At</td>
          <td style="padding: 10px; border-bottom: 1px solid #e0e0e0;">${new Date().toLocaleString('en-US', { timeZone: 'America/New_York' })} EST</td>
        </tr>
        <tr>
          <td style="padding: 10px; border-bottom: 1px solid #e0e0e0; font-weight: bold; color: #6366f1;">🌐 Page</td>
          <td style="padding: 10px; border-bottom: 1px solid #e0e0e0;">${visitorInfo.page || 'Apply Page'}</td>
        </tr>
      </table>

      <div class="footer">
        <strong>✅ Next Steps:</strong><br/>
        Review this application and reach out to the applicant within 24 hours.
      </div>
    </div>
  </div>
</body>
</html>`;

  const emailText = `
NEW PARTNERSHIP APPLICATION!

${formContent}

---
IP: ${clientIP || 'Unknown'}
Time: ${new Date().toLocaleString('en-US', { timeZone: 'America/New_York' })} EST
Page: ${visitorInfo.page || 'Apply Page'}
`;

  try {
    const result = await ses.send(new SendEmailCommand({
      Source: NOTIFICATION_EMAIL,
      Destination: {
        ToAddresses: [NOTIFICATION_EMAIL]
      },
      Message: {
        Subject: {
          Data: `🎉 New Partnership Application: ${visitorInfo.name || 'New Applicant'}`,
          Charset: 'UTF-8'
        },
        Body: {
          Html: {
            Data: emailHtml,
            Charset: 'UTF-8'
          },
          Text: {
            Data: emailText,
            Charset: 'UTF-8'
          }
        }
      }
    }));
    console.log('Form submission email sent, MessageId:', result.MessageId);
    return true;
  } catch (error) {
    console.error('Form submission email error:', error.message);
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
  const s3 = new S3Client({ region: 'ap-south-1' });

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
  const s3 = new S3Client({ region: 'ap-south-1' });

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
  const s3 = new S3Client({ region: 'ap-south-1' });

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
  const s3 = new S3Client({ region: 'ap-south-1' });

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
  const s3 = new S3Client({ region: 'ap-south-1' });

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
  const s3 = new S3Client({ region: 'ap-south-1' });

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
  const s3 = new S3Client({ region: 'ap-south-1' });

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
  const s3 = new S3Client({ region: 'ap-south-1' });

  try {
    const listResult = await s3.send(new ListObjectsV2Command({
      Bucket: S3_BUCKET,
      Prefix: 'clients/',
      MaxKeys: limit
    }));

    if (!listResult.Contents) return [];

    const profiles = await Promise.all(
      listResult.Contents
        .filter(obj => obj.Key.endsWith('.json'))
        .map(async (obj) => {
          try {
            const getResult = await s3.send(new GetObjectCommand({
              Bucket: S3_BUCKET,
              Key: obj.Key
            }));
            return JSON.parse(await getResult.Body.transformToString());
          } catch (e) {
            return null;
          }
        })
    );

    return profiles
      .filter(p => p !== null)
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  } catch (error) {
    console.error('List client profiles error:', error.message);
    return [];
  }
}

// List all builds with history (for admin)
async function listBuildHistory(limit = 50) {
  const { S3Client, ListObjectsV2Command, GetObjectCommand } = await import('@aws-sdk/client-s3');
  const s3 = new S3Client({ region: 'ap-south-1' });

  try {
    const listResult = await s3.send(new ListObjectsV2Command({
      Bucket: S3_BUCKET,
      Prefix: 'builds/',
      MaxKeys: limit * 2 // Account for subdirectories
    }));

    if (!listResult.Contents) return [];

    // Get metadata.json files from each build folder
    const builds = await Promise.all(
      listResult.Contents
        .filter(obj => obj.Key.endsWith('metadata.json'))
        .map(async (obj) => {
          try {
            const getResult = await s3.send(new GetObjectCommand({
              Bucket: S3_BUCKET,
              Key: obj.Key
            }));
            return JSON.parse(await getResult.Body.transformToString());
          } catch (e) {
            return null;
          }
        })
    );

    return builds
      .filter(b => b !== null)
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  } catch (error) {
    console.error('List build history error:', error.message);
    return [];
  }
}

// Check for duplicate application by email or phone
async function checkDuplicateApplication(email, phone) {
  const { S3Client, ListObjectsV2Command, GetObjectCommand } = await import('@aws-sdk/client-s3');
  const s3 = new S3Client({ region: 'ap-south-1' });

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

// Save form submission to S3
async function saveFormToS3(visitorInfo, formContent, clientIP) {
  const { S3Client, PutObjectCommand } = await import('@aws-sdk/client-s3');
  const s3 = new S3Client({ region: 'ap-south-1' });

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
  const s3 = new S3Client({ region: 'ap-south-1' });

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

    // Filter out nulls and sort by date (newest first)
    return applications
      .filter(app => app !== null)
      .sort((a, b) => new Date(b.submittedAt) - new Date(a.submittedAt));
  } catch (error) {
    console.error('List applications error:', error.message);
    throw error;
  }
}

// Update application status in S3
async function updateApplicationStatus(s3Key, newStatus, reviewNotes = '') {
  const { S3Client, GetObjectCommand, PutObjectCommand } = await import('@aws-sdk/client-s3');
  const s3 = new S3Client({ region: 'ap-south-1' });

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

    // Save back to S3
    await s3.send(new PutObjectCommand({
      Bucket: S3_BUCKET,
      Key: s3Key,
      Body: JSON.stringify(applicationData, null, 2),
      ContentType: 'application/json'
    }));

    console.log('Updated application status:', s3Key, newStatus);

    // If approved, trigger MVP build workflow
    if (newStatus === 'approved') {
      const jobId = await createBuildJob(applicationData, s3Key);
      applicationData.jobId = jobId;
      console.log('MVP build job created:', jobId);

      // Save jobId back to application record
      await s3.send(new PutObjectCommand({
        Bucket: S3_BUCKET,
        Key: s3Key,
        Body: JSON.stringify(applicationData, null, 2),
        ContentType: 'application/json'
      }));
      console.log('Updated application with jobId:', jobId);
    }

    return applicationData;
  } catch (error) {
    console.error('Update status error:', error.message);
    throw error;
  }
}

// Create MVP build job in S3 for EC2 worker to pick up
async function createBuildJob(applicationData, originalS3Key) {
  const { S3Client, PutObjectCommand } = await import('@aws-sdk/client-s3');
  const s3 = new S3Client({ region: 'ap-south-1' });

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
      model: 'claude-sonnet-4-20250514',
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
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1000, // Increased for attachment analysis
      system: fullSystemPrompt,
      messages: apiMessages
    });

    // Calculate token usage and estimated cost (Claude Sonnet pricing)
    const inputTokens = response.usage?.input_tokens || 0;
    const outputTokens = response.usage?.output_tokens || 0;
    const totalTokens = inputTokens + outputTokens;
    const inputCost = (inputTokens / 1000) * 0.003;
    const outputCost = (outputTokens / 1000) * 0.015;
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
        model: 'gpt-4o-mini',
        messages: apiMessages,
        max_tokens: 500,
        temperature: 0.7
      })
    });

    if (!response.ok) {
      throw new Error(`OpenAI API error: ${response.status}`);
    }

    const data = await response.json();

    // Calculate token usage and estimated cost (GPT-4o-mini pricing)
    const inputTokens = data.usage?.prompt_tokens || 0;
    const outputTokens = data.usage?.completion_tokens || 0;
    const totalTokens = data.usage?.total_tokens || 0;
    const inputCost = (inputTokens / 1000) * 0.00015;
    const outputCost = (outputTokens / 1000) * 0.0006;
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
    const body = JSON.parse(event.body || '{}');
    const { action, messages, visitorInfo = {} } = body;

    // Get client IP from request context
    const clientIP = event.requestContext?.http?.sourceIp ||
                     event.headers?.['x-forwarded-for']?.split(',')[0] ||
                     'Unknown';

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
        const s3 = new S3Client({ region: 'ap-south-1' });

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
        const s3 = new S3Client({ region: 'ap-south-1' });

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
        const s3 = new S3Client({ region: 'ap-south-1' });

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
        const s3 = new S3Client({ region: 'ap-south-1' });

        // Get metadata
        const metadataResult = await s3.send(new GetObjectCommand({
          Bucket: S3_BUCKET,
          Key: `builds/${buildId}/metadata.json`
        }));
        const metadata = JSON.parse(await metadataResult.Body.transformToString());

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

        return {
          statusCode: 200,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          body: JSON.stringify({ success: true, build: { ...metadata, agentLog } })
        };
      } catch (error) {
        return {
          statusCode: 404,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          body: JSON.stringify({ success: false, error: 'Build not found' })
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
            response: `It looks like you've already submitted an application on ${submittedDate} using the same ${duplicateCheck.matchedBy}. Our team is reviewing it and will contact you soon. If you have updates or questions, please email us at gopi@sunwaretechnologies.com`,
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

      console.log('No duplicate found - saving to S3 and sending email...');

      // Save to S3 and send email in parallel
      const [s3Result, emailResult] = await Promise.all([
        saveFormToS3(updatedVisitorInfo, latestMessage, clientIP),
        sendFormSubmissionEmail(updatedVisitorInfo, latestMessage, clientIP)
      ]);

      console.log('S3 save result:', s3Result);
      console.log('Email send result:', emailResult);

      // Save chat session and link to application
      const sessionResult = await saveChatSession(sessionId, chatSource, messages, updatedVisitorInfo, 'converted');
      if (s3Result.success) {
        await linkSessionToApplication(sessionId, chatSource, s3Result.key);
      }

      // Create/update client profile
      if (sessionResult.clientId) {
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
