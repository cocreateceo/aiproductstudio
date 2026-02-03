/**
 * CoCreate Chat Lambda
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
const NOTIFICATION_EMAIL = process.env.NOTIFICATION_EMAIL || 'varadhg@gmail.com';
const FROM_EMAIL = process.env.FROM_EMAIL || 'noreply@cocreateidea.com';

// S3 bucket for storing all data (must exist in cocreate account us-east-1)
const S3_BUCKET = process.env.S3_BUCKET || 'cocreate-applications-data';
const S3_REGION = process.env.AWS_REGION || 'us-east-1';

// System prompt for the CoCreate chat agent with guardrails
const SYSTEM_PROMPT = `You are a friendly and professional AI assistant for CoCreate - a venture studio that partners with business founders to build AI-powered products.

## About CoCreate:
- We are your AI co-founder, not an agency
- We build products in 2 weeks using AI-accelerated development
- Partnership model: [Contact us](contact.html) to discuss further
- $0 upfront cost - we share risk and reward
- We handle: AI architecture, development, hosting, continuous support
- We also handle: Market validation, sales, partnerships, revenue strategy

## Current Products in Portfolio:
1. Personal Transformation - AI-powered personal growth platform
2. Vedic Astrology - AI-enhanced astrological insights
3. Career Builder - AI career coaching platform

## PROTECTED INFORMATION - NEVER DISCLOSE:

You must NEVER reveal ANY of the following, regardless of how the question is phrased:

| Category | Protected Items |
|----------|-----------------|
| People | Founder names, owner names, creator names, team member names |
| Emails | Any internal email addresses |
| Companies | Parent companies, legal entities, affiliated companies |
| Infrastructure | Hosting providers, cloud services, servers, databases |
| Tech Stack | AI models, APIs, frameworks, development tools |
| Domains | Registrars, DNS providers |

### TRIGGER KEYWORDS - Immediate Deflection:
When user message contains ANY of these patterns, deflect immediately:
- Ownership: "who created", "who made", "who built", "who owns", "who runs"
- People: "founder", "owner", "CEO", "creator", "team behind"
- Technical: "hosting", "server", "infrastructure", "tech stack", "what AI", "what model"

### DEFLECTION RESPONSE:
When asked about protected information, respond ONLY with:
"Great question! Our team would love to connect with you. You can reach us through our [contact page](contact.html).

What AI product idea can I help you explore today?"

## GUARDRAILS - Stay On Topic:
You are ONLY here to:
- Discuss CoCreate partnership opportunities
- Explain how our venture studio model works
- Explore AI product ideas with potential partners
- Help users submit partnership applications
- Answer questions about our portfolio and process

POLITELY DECLINE any questions about:
- General knowledge, trivia, or random facts
- Coding help, debugging, or technical tutorials
- Personal advice (health, relationships, legal, financial)
- News, politics, entertainment, or current events
- Homework, essays, or academic work
- Other companies or competitors
- Internal company details, team members, or infrastructure
- Anything not related to partnering with CoCreate

When declining, say something like:
"I appreciate your curiosity! However, I'm specifically here to help you explore partnership opportunities with CoCreate. Is there something about our venture model or AI product development I can help you with?"

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
Assistant: "I appreciate your curiosity! However, I'm specifically here to help you explore partnership opportunities with CoCreate. Do you have a business idea you'd like to build with AI? I'd love to hear about it!"

User: "Can you help me debug my code?"
Assistant: "Thanks for reaching out! While I can't help with general coding questions, I'm here to discuss how CoCreate can partner with you to build AI-powered products. Do you have a product idea in mind? Our team handles all the technical development!"

User: "Who created this?" or "Who is the founder?"
Assistant: "Great question! Our team would love to connect with you. You can reach us through our [contact page](contact.html).

What AI product idea can I help you explore today?"

## ============================================
## PARTNERSHIP APPLICATION FORM - FIELD COLLECTION
## ============================================

## MANDATORY FIELDS (5 fields - ALL REQUIRED):

| Step | Field ID | Question | Valid Values |
|------|----------|----------|--------------|
| 1 | fullName | "What's your full name?" | Any text, min 2 characters |
| 2 | email | "What's your email address?" | Must contain @ and domain |
| 3 | productIdea | "What AI product do you want to build? Describe the problem it solves." | Any text, min 20 characters |
| 4 | targetCustomer | "Who is your target customer? Describe their pain points." | Any text, min 10 characters |
| 5 | timeline | "When do you want to launch?" | asap / 1month / 3months / 6months / exploring |

## OPTIONAL FIELDS (Ask after mandatory if user wants):

| Field ID | Question |
|----------|----------|
| phone | "What's your phone number? (Optional)" |
| businessStage | "What's your current business stage?" (idea/validated/mvp/revenue/scaling) |
| industry | "What industry are you targeting?" (healthcare/fintech/ecommerce/education/saas/consumer/other) |
| background | "Tell me about your background and experience" |
| timeCommitment | "What's your time commitment?" (fulltime/parttime/sidehustle/minimal) |
| linkedin | "What's your LinkedIn profile URL?" |
| marketValidation | "Have you done any market validation? Talked to customers?" |
| additionalInfo | "Anything else you'd like us to know?" |

---

## COLLECTION FLOW - STEP BY STEP:

### STEP 1: Show progress after EACH answer
Format: "✓ Got it! Progress: [■■■□□] 3/5 required fields"

### STEP 2: Ask ONE question at a time
- Acknowledge previous answer
- Show progress bar (5 boxes for 5 mandatory fields)
- Ask next question

### STEP 3: After ALL 5 mandatory fields collected
Ask: "All required fields complete! Would you like to:
1. **Submit now** - Your application is ready
2. **Add optional details** - Phone, background, industry, etc."

### STEP 4: Based on user choice
- If "submit" or "1" → Submit with mandatory fields only
- If "optional" or "2" → Ask the optional questions, then submit

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

**CRITICAL: Use ONLY these exact values for dropdown fields.**

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
- If user has questions about their existing application, refer them to our [contact page](contact.html)

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
      <h2 style="margin: 0;">🚀 New CoCreate Lead!</h2>
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
NEW COCREATE LEAD!

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
      Source: FROM_EMAIL,
      Destination: {
        ToAddresses: [NOTIFICATION_EMAIL]
      },
      Message: {
        Subject: {
          Data: `🚀 New Lead: ${visitorInfo.name || 'Anonymous'} - CoCreate`,
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

// Send Notification Email to Admin via AWS SES
async function sendNotificationEmail(subject, body, replyToEmail) {
  const { SESClient, SendEmailCommand } = await import('@aws-sdk/client-ses');
  const ses = new SESClient({ region: 'us-east-1' });

  try {
    const result = await ses.send(new SendEmailCommand({
      Source: FROM_EMAIL,
      Destination: {
        ToAddresses: [NOTIFICATION_EMAIL]
      },
      ReplyToAddresses: replyToEmail ? [replyToEmail] : [],
      Message: {
        Subject: {
          Data: subject,
          Charset: 'UTF-8'
        },
        Body: {
          Text: {
            Data: body,
            Charset: 'UTF-8'
          },
          Html: {
            Data: `<pre style="font-family: sans-serif; white-space: pre-wrap;">${body}</pre>`,
            Charset: 'UTF-8'
          }
        }
      }
    }));
    console.log('Notification email sent successfully, MessageId:', result.MessageId);
    return true;
  } catch (error) {
    console.error('Notification email send error:', error.message);
    return false;
  }
}

// Send Build Session Email to Customer via AWS SES
async function sendBuildSessionEmail(customerName, customerEmail, sessionLink) {
  const { SESClient, SendEmailCommand } = await import('@aws-sdk/client-ses');
  const ses = new SESClient({ region: 'us-east-1' });

  // Extract GUID from session link to create dashboard link
  const guidMatch = sessionLink.match(/guid=([^&]+)/);
  const guid = guidMatch ? guidMatch[1] : '';
  const dashboardLink = guid ? `https://www.cocreateidea.com/user.id=${guid}` : '';

  const htmlBody = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background-color: #1a0a00;">
  <div style="max-width: 600px; margin: 0 auto; padding: 40px 20px;">
    <div style="background: linear-gradient(135deg, #2d1810 0%, #1a0a00 100%); border-radius: 16px; padding: 40px; border: 1px solid #3d2820;">

      <div style="text-align: center; margin-bottom: 30px;">
        <h1 style="color: #fc2a0d; margin: 0; font-size: 28px;">🎉 Your Build Session is Ready!</h1>
      </div>

      <p style="color: #e8d5c4; font-size: 16px; line-height: 1.6; margin-bottom: 20px;">
        Hi ${customerName},
      </p>

      <p style="color: #e8d5c4; font-size: 16px; line-height: 1.6; margin-bottom: 20px;">
        Great news! Your CoCreate application has been approved! You now have access to your personalized build environment and dashboard.
      </p>

      <h2 style="color: #fc2a0d; font-size: 18px; margin: 30px 0 15px 0;">🔨 Build Session</h2>
      <p style="color: #e8d5c4; font-size: 14px; line-height: 1.6; margin-bottom: 15px;">
        Watch your AI-powered product come to life:
      </p>
      <div style="text-align: center; margin: 20px 0;">
        <a href="${sessionLink}" target="_blank" style="display: inline-block; background: linear-gradient(135deg, #fc2a0d, #fd6c71); color: white; text-decoration: none; padding: 14px 32px; border-radius: 8px; font-weight: 600; font-size: 14px;">
          Access Build Session
        </a>
      </div>

      ${dashboardLink ? `
      <h2 style="color: #fc2a0d; font-size: 18px; margin: 30px 0 15px 0;">📊 Your Dashboard</h2>
      <p style="color: #e8d5c4; font-size: 14px; line-height: 1.6; margin-bottom: 15px;">
        Create your account to track progress, view project details, and manage your build:
      </p>
      <div style="text-align: center; margin: 20px 0;">
        <a href="${dashboardLink}" target="_blank" style="display: inline-block; background: linear-gradient(135deg, #2d1810, #3d2820); color: #fc2a0d; text-decoration: none; padding: 14px 32px; border-radius: 8px; font-weight: 600; font-size: 14px; border: 1px solid #fc2a0d;">
          Set Up Dashboard Account
        </a>
      </div>
      ` : ''}

      <div style="background: #2d1810; padding: 16px; border-radius: 8px; margin: 25px 0;">
        <p style="color: #a89080; font-size: 12px; margin: 0 0 8px 0;">Build Session Link:</p>
        <p style="margin: 0; word-break: break-all;">
          <a href="${sessionLink}" style="color: #fc2a0d; text-decoration: none; font-size: 12px;">${sessionLink}</a>
        </p>
        ${dashboardLink ? `
        <p style="color: #a89080; font-size: 12px; margin: 12px 0 8px 0;">Dashboard Link:</p>
        <p style="margin: 0; word-break: break-all;">
          <a href="${dashboardLink}" style="color: #fc2a0d; text-decoration: none; font-size: 12px;">${dashboardLink}</a>
        </p>
        ` : ''}
      </div>

      <p style="color: #e8d5c4; font-size: 14px; line-height: 1.6; margin-bottom: 20px;">
        This is your personal workspace where we'll build your AI-powered product together. Feel free to explore and let us know if you have any questions!
      </p>

      <hr style="border: none; border-top: 1px solid #3d2820; margin: 30px 0;">

      <p style="color: #a89080; font-size: 14px; text-align: center;">
        Questions? Reply to this email or reach out at <a href="mailto:hello@cocreateidea.com" style="color: #fc2a0d;">hello@cocreateidea.com</a>
      </p>

      <div style="text-align: center; margin-top: 20px;">
        <a href="https://cocreate-app.com" style="color: #a89080; text-decoration: none; font-size: 12px;">cocreate-app.com</a>
      </div>
    </div>
  </div>
</body>
</html>`;

  const textBody = `Hi ${customerName},

Great news! Your CoCreate application has been approved!

BUILD SESSION
Watch your AI-powered product come to life:
${sessionLink}

${dashboardLink ? `YOUR DASHBOARD
Create your account to track progress and manage your build:
${dashboardLink}
` : ''}
This is your personal workspace where we'll build your AI-powered product together.

Questions? Reply to this email or reach out at hello@cocreateidea.com

- The CoCreate Team`;

  try {
    const result = await ses.send(new SendEmailCommand({
      Source: FROM_EMAIL,
      Destination: {
        ToAddresses: [customerEmail]
      },
      ReplyToAddresses: ['hello@cocreateidea.com'],
      Message: {
        Subject: {
          Data: '🎉 Your CoCreate Build Session is Ready!',
          Charset: 'UTF-8'
        },
        Body: {
          Text: {
            Data: textBody,
            Charset: 'UTF-8'
          },
          Html: {
            Data: htmlBody,
            Charset: 'UTF-8'
          }
        }
      }
    }));
    console.log('Build session email sent successfully, MessageId:', result.MessageId);
    return true;
  } catch (error) {
    console.error('Build session email send error:', error.message);
    throw error;
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
      <p style="margin: 10px 0 0 0; opacity: 0.9;">Someone wants to partner with CoCreate</p>
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
      Source: FROM_EMAIL,
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

// Send Confirmation Email to Applicant via AWS SES
async function sendApplicantConfirmationEmail(visitorInfo, formContent) {
  const { SESClient, SendEmailCommand } = await import('@aws-sdk/client-ses');
  const ses = new SESClient({ region: 'us-east-1' });

  const applicantEmail = visitorInfo.email;
  if (!applicantEmail) {
    console.log('No applicant email provided, skipping confirmation email');
    return false;
  }

  const applicantName = visitorInfo.name || 'Partner';
  const schedulerUrl = 'https://cocreate-app.com/scheduler.html';

  const emailHtml = `
<!DOCTYPE html>
<html>
<head>
  <style>
    body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; margin: 0; padding: 0; }
    .container { max-width: 600px; margin: 0 auto; padding: 20px; }
    .header { background: linear-gradient(135deg, #6366f1, #8b5cf6); color: white; padding: 30px; border-radius: 12px 12px 0 0; text-align: center; }
    .header h1 { margin: 0; font-size: 28px; }
    .header p { margin: 10px 0 0 0; opacity: 0.9; font-size: 16px; }
    .content { background: #fff; border: 1px solid #e0e0e0; border-top: none; padding: 30px; border-radius: 0 0 12px 12px; }
    .welcome { font-size: 18px; color: #374151; margin-bottom: 20px; }
    .cta-box { background: linear-gradient(135deg, #10b981, #059669); color: white; padding: 25px; border-radius: 12px; text-align: center; margin: 25px 0; }
    .cta-box h2 { margin: 0 0 10px 0; font-size: 22px; }
    .cta-box p { margin: 0 0 20px 0; opacity: 0.9; }
    .cta-button { display: inline-block; background: white; color: #059669; padding: 14px 32px; border-radius: 8px; text-decoration: none; font-weight: bold; font-size: 16px; }
    .cta-button:hover { background: #f0fdf4; }
    .steps { background: #f8f9fa; padding: 20px; border-radius: 8px; margin: 20px 0; }
    .steps h3 { margin: 0 0 15px 0; color: #374151; }
    .step { display: flex; align-items: flex-start; margin: 12px 0; }
    .step-number { background: #6366f1; color: white; width: 28px; height: 28px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-weight: bold; margin-right: 12px; flex-shrink: 0; }
    .step-text { color: #4b5563; }
    .footer { margin-top: 30px; padding-top: 20px; border-top: 1px solid #e0e0e0; text-align: center; color: #6b7280; font-size: 14px; }
    .social-links { margin: 15px 0; }
    .social-links a { color: #6366f1; text-decoration: none; margin: 0 10px; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>Welcome to CoCreate!</h1>
      <p>Your application has been received</p>
    </div>
    <div class="content">
      <p class="welcome">Hi ${applicantName},</p>

      <p>Thank you for applying to partner with CoCreate! We're excited about the possibility of building something amazing together.</p>

      <p>Your application has been received and our team will review it within <strong>24 hours</strong>.</p>

      <div class="cta-box">
        <h2>📅 Schedule Your Discovery Call</h2>
        <p>Want to fast-track your application? Book a call with our founding team!</p>
        <a href="${schedulerUrl}" class="cta-button">Book Your Call Now</a>
      </div>

      <div class="steps">
        <h3>What happens next?</h3>
        <div class="step">
          <div class="step-number">1</div>
          <div class="step-text"><strong>Application Review</strong> - Our team reviews your application (24 hours)</div>
        </div>
        <div class="step">
          <div class="step-number">2</div>
          <div class="step-text"><strong>Discovery Call</strong> - We schedule a call to discuss your vision</div>
        </div>
        <div class="step">
          <div class="step-number">3</div>
          <div class="step-text"><strong>Partnership Agreement</strong> - We finalize terms and kick off your build</div>
        </div>
        <div class="step">
          <div class="step-number">4</div>
          <div class="step-text"><strong>Product Launch</strong> - Your AI product goes live in 2 weeks!</div>
        </div>
      </div>

      <p>If you have any questions in the meantime, simply reply to this email or visit our <a href="https://cocreate-app.com/contact.html">contact page</a>.</p>

      <p>We look forward to building with you!</p>

      <p><strong>The CoCreate Team</strong></p>

      <div class="footer">
        <p>CoCreate</p>
        <p>Building AI products in 2 weeks</p>
        <div class="social-links">
          <a href="https://cocreate-app.com">Website</a> |
          <a href="https://cocreate-app.com/about.html">About Us</a> |
          <a href="${schedulerUrl}">Book a Call</a>
        </div>
        <p style="font-size: 12px; margin-top: 15px;">
          You received this email because you submitted a partnership application at cocreate-app.com
        </p>
      </div>
    </div>
  </div>
</body>
</html>`;

  const emailText = `
Hi ${applicantName},

Thank you for applying to partner with CoCreate! We're excited about the possibility of building something amazing together.

Your application has been received and our team will review it within 24 hours.

📅 SCHEDULE YOUR DISCOVERY CALL
Want to fast-track your application? Book a call with our founding team:
${schedulerUrl}

WHAT HAPPENS NEXT?
1. Application Review - Our team reviews your application (24 hours)
2. Discovery Call - We schedule a call to discuss your vision
3. Partnership Agreement - We finalize terms and kick off your build
4. Product Launch - Your AI product goes live in 2 weeks!

If you have any questions, reply to this email or visit our contact page at https://cocreate-app.com/contact.html

We look forward to building with you!

The CoCreate Team
---
CoCreate
Building AI products in 2 weeks
https://cocreate-app.com
`;

  try {
    const result = await ses.send(new SendEmailCommand({
      Source: FROM_EMAIL,
      Destination: {
        ToAddresses: [applicantEmail]
      },
      ReplyToAddresses: [NOTIFICATION_EMAIL],
      Message: {
        Subject: {
          Data: `Welcome to CoCreate! Your Application is Received`,
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
    console.log('Applicant confirmation email sent to:', applicantEmail, 'MessageId:', result.MessageId);
    return true;
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
  const s3 = new S3Client({ region: S3_REGION });

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
  const mandatoryFields = ['fullName', 'email', 'productIdea', 'targetCustomer', 'timeline'];
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

    // Filter out nulls and sort by date (newest first)
    return applications
      .filter(app => app !== null)
      .sort((a, b) => new Date(b.submittedAt || b.timestamp) - new Date(a.submittedAt || a.timestamp));
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

    // Save back to S3
    await s3.send(new PutObjectCommand({
      Bucket: S3_BUCKET,
      Key: s3Key,
      Body: JSON.stringify(applicationData, null, 2),
      ContentType: 'application/json'
    }));

    console.log('Updated application status:', s3Key, newStatus);

    // If approved, trigger external build system
    if (newStatus === 'approved') {
      const buildResult = await triggerExternalBuild(applicationData);

      if (buildResult.success) {
        applicationData.guid = buildResult.guid;
        applicationData.sessionLink = buildResult.link;
        console.log('External build triggered:', buildResult.guid);

        // Save build info back to application record
        await s3.send(new PutObjectCommand({
          Bucket: S3_BUCKET,
          Key: s3Key,
          Body: JSON.stringify(applicationData, null, 2),
          ContentType: 'application/json'
        }));
        console.log('Updated application with build link:', buildResult.link);

        // Send session link to customer email
        const customerEmail = applicationData.visitorInfo?.email || applicationData.formData?.email;
        const customerName = applicationData.visitorInfo?.name || applicationData.formData?.fullName || 'there';
        if (customerEmail) {
          try {
            await sendBuildSessionEmail(customerName, customerEmail, buildResult.link);
            console.log('Session email sent to:', customerEmail);
          } catch (emailError) {
            console.error('Failed to send session email:', emailError.message);
          }
        }
      } else {
        console.error('External build failed:', buildResult.error);
        applicationData.sessionError = buildResult.error;
      }
    }

    return applicationData;
  } catch (error) {
    console.error('Update status error:', error.message);
    throw error;
  }
}

// ========== USER DASHBOARD FUNCTIONS ==========

// Generate random session token
function generateSessionToken() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let token = '';
  for (let i = 0; i < 64; i++) {
    token += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return token;
}

// Check if user account exists
async function checkUserExists(guid) {
  const { S3Client, GetObjectCommand } = await import('@aws-sdk/client-s3');
  const s3 = new S3Client({ region: S3_REGION });

  try {
    // First check if this guid has an application
    const applications = await listApplications();
    const app = applications.find(a => a.guid === guid);

    if (!app) {
      return { success: false, exists: false, hasAccount: false, error: 'Invalid session ID' };
    }

    // Fetch profile data
    let profile = null;
    try {
      const profileResult = await s3.send(new GetObjectCommand({
        Bucket: S3_BUCKET,
        Key: `users/${guid}/profile.json`
      }));
      profile = JSON.parse(await profileResult.Body.transformToString());
    } catch (e) {
      // Profile may not exist yet, use data from application
      profile = {
        name: app.visitorInfo?.name || app.formData?.fullName || '',
        email: app.visitorInfo?.email || app.formData?.email || ''
      };
    }

    // Check if user has created an account (has credentials)
    let hasAccount = false;
    try {
      await s3.send(new GetObjectCommand({
        Bucket: S3_BUCKET,
        Key: `users/${guid}/credentials.json`
      }));
      hasAccount = true;
    } catch (e) {
      // No account yet
    }

    return {
      success: true,
      exists: true,
      hasAccount,
      profile: {
        name: profile.name || '',
        email: profile.email || ''
      },
      applicationData: app
    };
  } catch (error) {
    console.error('Check user exists error:', error.message);
    return { success: false, error: error.message };
  }
}

// User signup (uses email as identifier)
async function userSignup(guid, email, password) {
  const { S3Client, GetObjectCommand, PutObjectCommand } = await import('@aws-sdk/client-s3');
  const bcrypt = (await import('bcryptjs')).default;
  const s3 = new S3Client({ region: S3_REGION });

  try {
    // Check if account already exists
    try {
      await s3.send(new GetObjectCommand({
        Bucket: S3_BUCKET,
        Key: `users/${guid}/credentials.json`
      }));
      return { success: false, error: 'Account already exists. Please login instead.' };
    } catch (e) {
      // Good - no existing account
    }

    // Get application data for this guid
    const applications = await listApplications();
    const app = applications.find(a => a.guid === guid);

    if (!app) {
      return { success: false, error: 'Invalid session ID' };
    }

    // Verify email matches the application
    const appEmail = app.visitorInfo?.email || app.formData?.email || '';
    if (email.toLowerCase().trim() !== appEmail.toLowerCase().trim()) {
      return { success: false, error: 'Email does not match application' };
    }

    // Hash password
    const saltRounds = 10;
    const passwordHash = await bcrypt.hash(password, saltRounds);

    // Create session token
    const sessionToken = generateSessionToken();
    const now = new Date();
    const expiresAt = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000); // 7 days

    // Save credentials (using email as identifier)
    const credentials = {
      email: email.toLowerCase().trim(),
      passwordHash,
      createdAt: now.toISOString()
    };

    await s3.send(new PutObjectCommand({
      Bucket: S3_BUCKET,
      Key: `users/${guid}/credentials.json`,
      Body: JSON.stringify(credentials, null, 2),
      ContentType: 'application/json'
    }));

    // Save session
    const sessions = {
      tokens: [{
        token: sessionToken,
        createdAt: now.toISOString(),
        expiresAt: expiresAt.toISOString()
      }]
    };

    await s3.send(new PutObjectCommand({
      Bucket: S3_BUCKET,
      Key: `users/${guid}/sessions.json`,
      Body: JSON.stringify(sessions, null, 2),
      ContentType: 'application/json'
    }));

    // Save/update profile
    const profile = {
      name: app.visitorInfo?.name || app.formData?.fullName || '',
      email: email.toLowerCase().trim(),
      phone: app.visitorInfo?.phone || app.formData?.phone || '',
      createdAt: now.toISOString()
    };

    await s3.send(new PutObjectCommand({
      Bucket: S3_BUCKET,
      Key: `users/${guid}/profile.json`,
      Body: JSON.stringify(profile, null, 2),
      ContentType: 'application/json'
    }));

    // Send credentials email
    try {
      await sendUserCredentialsEmail(profile.name, profile.email, email, password, app.sessionLink, guid);
    } catch (emailError) {
      console.error('Failed to send credentials email:', emailError.message);
    }

    console.log('User signup successful:', guid, email);

    return {
      success: true,
      sessionToken,
      expiresAt: expiresAt.toISOString(),
      message: 'Account created successfully'
    };
  } catch (error) {
    console.error('User signup error:', error.message);
    return { success: false, error: error.message };
  }
}

// User login (uses email as identifier)
async function userLogin(guid, email, password) {
  const { S3Client, GetObjectCommand, PutObjectCommand } = await import('@aws-sdk/client-s3');
  const bcrypt = (await import('bcryptjs')).default;
  const s3 = new S3Client({ region: S3_REGION });

  try {
    // Get credentials
    let credentials;
    try {
      const result = await s3.send(new GetObjectCommand({
        Bucket: S3_BUCKET,
        Key: `users/${guid}/credentials.json`
      }));
      credentials = JSON.parse(await result.Body.transformToString());
    } catch (e) {
      return { success: false, error: 'Account not found. Please sign up first.' };
    }

    // Verify email (support both old username and new email format)
    const storedIdentifier = credentials.email || credentials.username;
    if (storedIdentifier !== email.toLowerCase().trim()) {
      return { success: false, error: 'Invalid email or password' };
    }

    // Verify password
    const isValid = await bcrypt.compare(password, credentials.passwordHash);
    if (!isValid) {
      return { success: false, error: 'Invalid email or password' };
    }

    // Create new session token
    const sessionToken = generateSessionToken();
    const now = new Date();
    const expiresAt = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000); // 7 days

    // Get existing sessions and add new one
    let sessions = { tokens: [] };
    try {
      const result = await s3.send(new GetObjectCommand({
        Bucket: S3_BUCKET,
        Key: `users/${guid}/sessions.json`
      }));
      sessions = JSON.parse(await result.Body.transformToString());
    } catch (e) {
      // No sessions file yet
    }

    // Add new token, keep last 5 sessions
    sessions.tokens.push({
      token: sessionToken,
      createdAt: now.toISOString(),
      expiresAt: expiresAt.toISOString()
    });
    sessions.tokens = sessions.tokens.slice(-5);

    await s3.send(new PutObjectCommand({
      Bucket: S3_BUCKET,
      Key: `users/${guid}/sessions.json`,
      Body: JSON.stringify(sessions, null, 2),
      ContentType: 'application/json'
    }));

    console.log('User login successful:', guid, email);

    return {
      success: true,
      sessionToken,
      expiresAt: expiresAt.toISOString(),
      message: 'Login successful'
    };
  } catch (error) {
    console.error('User login error:', error.message);
    return { success: false, error: error.message };
  }
}

// Validate session token
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
    const validToken = sessions.tokens.find(t =>
      t.token === sessionToken && new Date(t.expiresAt) > now
    );

    return !!validToken;
  } catch (error) {
    return false;
  }
}

// Get project history for a user
async function getProjectHistory(guid) {
  const { S3Client, ListObjectsV2Command, GetObjectCommand } = await import('@aws-sdk/client-s3');
  const s3 = new S3Client({ region: S3_REGION });

  try {
    const listResult = await s3.send(new ListObjectsV2Command({
      Bucket: S3_BUCKET,
      Prefix: `users/${guid}/deployments/`
    }));

    if (!listResult.Contents || listResult.Contents.length === 0) {
      return [];
    }

    const projects = [];
    for (const obj of listResult.Contents) {
      try {
        const result = await s3.send(new GetObjectCommand({
          Bucket: S3_BUCKET,
          Key: obj.Key
        }));
        const projectData = JSON.parse(await result.Body.transformToString());
        projects.push(projectData);
      } catch (e) {
        // Skip invalid files
      }
    }

    // Sort by creation date, newest first
    projects.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    return projects;
  } catch (error) {
    console.error('Get project history error:', error.message);
    return [];
  }
}

// Save project deployment (called by webhook from build system)
async function saveProjectDeployment(guid, deploymentData) {
  const { S3Client, PutObjectCommand } = await import('@aws-sdk/client-s3');
  const s3 = new S3Client({ region: S3_REGION });

  const deploymentId = `deploy-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;

  const deployment = {
    id: deploymentId,
    guid: guid,
    projectName: deploymentData.projectName || 'Untitled Project',
    description: deploymentData.description || '',
    urls: {
      cloudfront: deploymentData.cloudfrontUrl || '',
      s3: deploymentData.s3Url || '',
      custom: deploymentData.customDomain || ''
    },
    status: deploymentData.status || 'deployed',
    createdAt: new Date().toISOString(),
    createdAtEST: new Date().toLocaleString('en-US', { timeZone: 'America/New_York' }),
    activity: deploymentData.activity || [],
    metadata: deploymentData.metadata || {}
  };

  await s3.send(new PutObjectCommand({
    Bucket: S3_BUCKET,
    Key: `users/${guid}/deployments/${deploymentId}.json`,
    Body: JSON.stringify(deployment, null, 2),
    ContentType: 'application/json'
  }));

  console.log(`Saved deployment ${deploymentId} for user ${guid}`);
  return { success: true, deployment };
}

// Save activity from Tmux Builder
async function saveActivity(guid, activity) {
  const { S3Client, GetObjectCommand, PutObjectCommand } = await import('@aws-sdk/client-s3');
  const s3 = new S3Client({ region: S3_REGION });

  try {
    // Get or create activities file
    let activities = [];
    try {
      const result = await s3.send(new GetObjectCommand({
        Bucket: S3_BUCKET,
        Key: `users/${guid}/activities.json`
      }));
      activities = JSON.parse(await result.Body.transformToString());
    } catch (e) {
      // No existing activities file
    }

    // Add new activity
    const newActivity = {
      id: `act-${Date.now()}`,
      message: activity.message || activity,
      status: activity.status || 'done',
      time: activity.time || new Date().toISOString(),
      type: activity.type || 'general'
    };

    activities.push(newActivity);

    // Keep last 100 activities
    if (activities.length > 100) {
      activities = activities.slice(-100);
    }

    // Save activities
    await s3.send(new PutObjectCommand({
      Bucket: S3_BUCKET,
      Key: `users/${guid}/activities.json`,
      Body: JSON.stringify(activities, null, 2),
      ContentType: 'application/json'
    }));

    console.log(`Saved activity for user ${guid}: ${newActivity.message}`);
    return { success: true, activity: newActivity };
  } catch (error) {
    console.error('Save activity error:', error.message);
    return { success: false, error: error.message };
  }
}

// Get activities for a user
async function getActivities(guid) {
  const { S3Client, GetObjectCommand } = await import('@aws-sdk/client-s3');
  const s3 = new S3Client({ region: S3_REGION });

  try {
    const result = await s3.send(new GetObjectCommand({
      Bucket: S3_BUCKET,
      Key: `users/${guid}/activities.json`
    }));
    const activities = JSON.parse(await result.Body.transformToString());
    return activities.reverse(); // Newest first
  } catch (error) {
    return [];
  }
}

// Get user dashboard data
async function getUserDashboard(guid, sessionToken) {
  const { S3Client, GetObjectCommand } = await import('@aws-sdk/client-s3');
  const s3 = new S3Client({ region: S3_REGION });

  try {
    // Validate session
    const isValid = await validateSession(guid, sessionToken);
    if (!isValid) {
      return { success: false, error: 'Invalid or expired session' };
    }

    // Get profile
    let profile = {};
    try {
      const result = await s3.send(new GetObjectCommand({
        Bucket: S3_BUCKET,
        Key: `users/${guid}/profile.json`
      }));
      profile = JSON.parse(await result.Body.transformToString());
    } catch (e) {
      // No profile
    }

    // Get application data
    const applications = await listApplications();
    const app = applications.find(a => a.guid === guid);

    if (!app) {
      return { success: false, error: 'Application not found' };
    }

    // Get chat history if available
    let chatHistory = [];
    if (app.s3Key) {
      try {
        const result = await s3.send(new GetObjectCommand({
          Bucket: S3_BUCKET,
          Key: app.s3Key
        }));
        const appData = JSON.parse(await result.Body.transformToString());
        // Extract chat messages if available
        if (appData.chatHistory) {
          chatHistory = appData.chatHistory;
        }
      } catch (e) {
        // No chat history
      }
    }

    // Build dashboard data (matching frontend expected structure)
    const dashboardData = {
      user: {
        name: profile.name || app.visitorInfo?.name || app.formData?.fullName || '',
        email: profile.email || app.visitorInfo?.email || app.formData?.email || '',
        phone: profile.phone || app.visitorInfo?.phone || app.formData?.phone || '',
        username: profile.username || ''
      },
      application: {
        status: app.status || 'approved',
        guid: app.guid || guid,
        email: profile.email || app.visitorInfo?.email || app.formData?.email || '',
        submittedAt: app.submittedAt || app.timestamp || '',
        productIdea: app.formData?.productIdea || app.formData?.product_idea || '',
        targetCustomer: app.formData?.targetCustomer || app.formData?.target_customer || '',
        industry: app.formData?.industry || '',
        timeline: app.formData?.timeline || ''
      },
      buildSession: {
        link: app.sessionLink || '',
        guid: app.guid || guid
      },
      buildProgress: app.buildProgress || {
        architect: 'pending',
        developer: 'pending',
        deployer: 'pending'
      },
      chatHistory: chatHistory,
      projectHistory: await getProjectHistory(guid),
      activities: await getActivities(guid)
    };

    return { success: true, data: dashboardData };
  } catch (error) {
    console.error('Get user dashboard error:', error.message);
    return { success: false, error: error.message };
  }
}

// User change password
async function userChangePassword(guid, sessionToken, oldPassword, newPassword) {
  const { S3Client, GetObjectCommand, PutObjectCommand } = await import('@aws-sdk/client-s3');
  const bcrypt = (await import('bcryptjs')).default;
  const s3 = new S3Client({ region: S3_REGION });

  try {
    // Validate session
    const isValid = await validateSession(guid, sessionToken);
    if (!isValid) {
      return { success: false, error: 'Invalid or expired session' };
    }

    // Get credentials
    let credentials;
    try {
      const result = await s3.send(new GetObjectCommand({
        Bucket: S3_BUCKET,
        Key: `users/${guid}/credentials.json`
      }));
      credentials = JSON.parse(await result.Body.transformToString());
    } catch (e) {
      return { success: false, error: 'Account not found' };
    }

    // Verify old password
    const isOldValid = await bcrypt.compare(oldPassword, credentials.passwordHash);
    if (!isOldValid) {
      return { success: false, error: 'Current password is incorrect' };
    }

    // Hash new password
    const saltRounds = 10;
    const newPasswordHash = await bcrypt.hash(newPassword, saltRounds);

    // Update credentials
    credentials.passwordHash = newPasswordHash;
    credentials.updatedAt = new Date().toISOString();

    await s3.send(new PutObjectCommand({
      Bucket: S3_BUCKET,
      Key: `users/${guid}/credentials.json`,
      Body: JSON.stringify(credentials, null, 2),
      ContentType: 'application/json'
    }));

    console.log('Password changed for user:', guid);

    return { success: true, message: 'Password changed successfully' };
  } catch (error) {
    console.error('Change password error:', error.message);
    return { success: false, error: error.message };
  }
}

// Check if username is globally unique
async function checkUsernameAvailable(username, excludeGuid = null) {
  const { S3Client, ListObjectsV2Command, GetObjectCommand } = await import('@aws-sdk/client-s3');
  const s3 = new S3Client({ region: S3_REGION });

  try {
    const normalizedUsername = username.toLowerCase().trim();

    // List all user folders
    const listResult = await s3.send(new ListObjectsV2Command({
      Bucket: S3_BUCKET,
      Prefix: 'users/',
      Delimiter: '/'
    }));

    const userFolders = listResult.CommonPrefixes || [];

    for (const folder of userFolders) {
      const guid = folder.Prefix.replace('users/', '').replace('/', '');

      // Skip the current user's guid if provided
      if (excludeGuid && guid === excludeGuid) continue;

      try {
        const result = await s3.send(new GetObjectCommand({
          Bucket: S3_BUCKET,
          Key: `users/${guid}/credentials.json`
        }));
        const credentials = JSON.parse(await result.Body.transformToString());

        if (credentials.username === normalizedUsername) {
          return { available: false, error: 'Username already taken' };
        }
      } catch (e) {
        // No credentials file, skip
      }
    }

    return { available: true };
  } catch (error) {
    console.error('Check username error:', error.message);
    return { available: true }; // Allow on error to not block signup
  }
}

// Forgot password - generate reset token and send email
async function forgotPassword(email) {
  const { S3Client, ListObjectsV2Command, GetObjectCommand, PutObjectCommand } = await import('@aws-sdk/client-s3');
  const s3 = new S3Client({ region: S3_REGION });

  try {
    const normalizedEmail = email.toLowerCase().trim();

    // Find user by email in applications
    const applications = await listApplications();
    const app = applications.find(a => {
      const appEmail = (a.visitorInfo?.email || a.formData?.email || '').toLowerCase().trim();
      return appEmail === normalizedEmail && a.guid;
    });

    if (!app || !app.guid) {
      // Don't reveal if email exists or not for security
      return { success: true, message: 'If an account exists with this email, a reset link has been sent.' };
    }

    // Check if user has an account
    let credentials;
    try {
      const result = await s3.send(new GetObjectCommand({
        Bucket: S3_BUCKET,
        Key: `users/${app.guid}/credentials.json`
      }));
      credentials = JSON.parse(await result.Body.transformToString());
    } catch (e) {
      // No account exists
      return { success: true, message: 'If an account exists with this email, a reset link has been sent.' };
    }

    // Generate reset token
    const resetToken = generateSessionToken();
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000); // 1 hour

    // Save reset token
    const resetData = {
      token: resetToken,
      guid: app.guid,
      email: normalizedEmail,
      createdAt: new Date().toISOString(),
      expiresAt: expiresAt.toISOString()
    };

    await s3.send(new PutObjectCommand({
      Bucket: S3_BUCKET,
      Key: `users/${app.guid}/reset-token.json`,
      Body: JSON.stringify(resetData, null, 2),
      ContentType: 'application/json'
    }));

    // Send reset email
    const customerName = app.visitorInfo?.name || app.formData?.fullName || 'User';
    await sendPasswordResetEmail(customerName, normalizedEmail, app.guid, resetToken);

    console.log('Password reset email sent for:', normalizedEmail);
    return { success: true, message: 'If an account exists with this email, a reset link has been sent.' };
  } catch (error) {
    console.error('Forgot password error:', error.message);
    return { success: false, error: error.message };
  }
}

// Reset password with token
async function resetPassword(guid, resetToken, newPassword) {
  const { S3Client, GetObjectCommand, PutObjectCommand, DeleteObjectCommand } = await import('@aws-sdk/client-s3');
  const bcrypt = (await import('bcryptjs')).default;
  const s3 = new S3Client({ region: S3_REGION });

  try {
    // Verify reset token
    let resetData;
    try {
      const result = await s3.send(new GetObjectCommand({
        Bucket: S3_BUCKET,
        Key: `users/${guid}/reset-token.json`
      }));
      resetData = JSON.parse(await result.Body.transformToString());
    } catch (e) {
      return { success: false, error: 'Invalid or expired reset link' };
    }

    // Check token matches and not expired
    if (resetData.token !== resetToken) {
      return { success: false, error: 'Invalid reset link' };
    }

    if (new Date(resetData.expiresAt) < new Date()) {
      return { success: false, error: 'Reset link has expired. Please request a new one.' };
    }

    // Get current credentials
    let credentials;
    try {
      const result = await s3.send(new GetObjectCommand({
        Bucket: S3_BUCKET,
        Key: `users/${guid}/credentials.json`
      }));
      credentials = JSON.parse(await result.Body.transformToString());
    } catch (e) {
      return { success: false, error: 'Account not found' };
    }

    // Hash new password
    const saltRounds = 10;
    const newPasswordHash = await bcrypt.hash(newPassword, saltRounds);

    // Update credentials
    credentials.passwordHash = newPasswordHash;
    credentials.updatedAt = new Date().toISOString();

    await s3.send(new PutObjectCommand({
      Bucket: S3_BUCKET,
      Key: `users/${guid}/credentials.json`,
      Body: JSON.stringify(credentials, null, 2),
      ContentType: 'application/json'
    }));

    // Delete reset token
    await s3.send(new DeleteObjectCommand({
      Bucket: S3_BUCKET,
      Key: `users/${guid}/reset-token.json`
    }));

    console.log('Password reset successful for:', guid);

    return { success: true, message: 'Password reset successfully. You can now login.' };
  } catch (error) {
    console.error('Reset password error:', error.message);
    return { success: false, error: error.message };
  }
}

// Send password reset email
async function sendPasswordResetEmail(name, email, guid, resetToken) {
  const { SESClient, SendEmailCommand } = await import('@aws-sdk/client-ses');
  const ses = new SESClient({ region: 'us-east-1' });

  const resetLink = `https://www.cocreateidea.com/user.id=${guid}&reset=${resetToken}`;

  const htmlBody = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background-color: #1a0a00;">
  <div style="max-width: 600px; margin: 0 auto; padding: 40px 20px;">
    <div style="background: linear-gradient(135deg, #2d1810 0%, #1a0a00 100%); border-radius: 16px; padding: 40px; border: 1px solid #3d2820;">

      <div style="text-align: center; margin-bottom: 30px;">
        <h1 style="color: #fc2a0d; margin: 0; font-size: 28px;">🔐 Reset Your Password</h1>
      </div>

      <p style="color: #e8d5c4; font-size: 16px; line-height: 1.6; margin-bottom: 20px;">
        Hi ${name},
      </p>

      <p style="color: #e8d5c4; font-size: 16px; line-height: 1.6; margin-bottom: 20px;">
        We received a request to reset your CoCreate dashboard password. Click the button below to set a new password:
      </p>

      <div style="text-align: center; margin: 30px 0;">
        <a href="${resetLink}" target="_blank" style="display: inline-block; background: linear-gradient(135deg, #fc2a0d, #fd6c71); color: white; text-decoration: none; padding: 16px 40px; border-radius: 8px; font-weight: 600; font-size: 16px;">
          Reset Password
        </a>
      </div>

      <p style="color: #a89080; font-size: 14px; line-height: 1.6; margin-bottom: 10px;">
        Or copy this link:
      </p>
      <p style="background: #2d1810; padding: 12px; border-radius: 8px; word-break: break-all; margin-bottom: 20px;">
        <a href="${resetLink}" style="color: #fc2a0d; text-decoration: none; font-size: 14px;">${resetLink}</a>
      </p>

      <p style="color: #a89080; font-size: 14px; line-height: 1.6;">
        This link expires in 1 hour. If you didn't request this, you can safely ignore this email.
      </p>

      <hr style="border: none; border-top: 1px solid #3d2820; margin: 30px 0;">

      <p style="color: #a89080; font-size: 14px; text-align: center;">
        Questions? Contact us at <a href="mailto:hello@cocreateidea.com" style="color: #fc2a0d;">hello@cocreateidea.com</a>
      </p>
    </div>
  </div>
</body>
</html>`;

  const textBody = `Hi ${name},

We received a request to reset your CoCreate dashboard password.

Reset your password here:
${resetLink}

This link expires in 1 hour. If you didn't request this, you can safely ignore this email.

- The CoCreate Team`;

  await ses.send(new SendEmailCommand({
    Source: FROM_EMAIL,
    Destination: { ToAddresses: [email] },
    ReplyToAddresses: ['hello@cocreateidea.com'],
    Message: {
      Subject: { Data: '🔐 Reset Your CoCreate Password', Charset: 'UTF-8' },
      Body: {
        Text: { Data: textBody, Charset: 'UTF-8' },
        Html: { Data: htmlBody, Charset: 'UTF-8' }
      }
    }
  }));
}

// Send Build Completion Email to Customer
async function sendBuildCompletionEmail(customerName, customerEmail, guid, prototypeUrl) {
  const { SESClient, SendEmailCommand } = await import('@aws-sdk/client-ses');
  const ses = new SESClient({ region: 'us-east-1' });

  const dashboardLink = `https://www.cocreateidea.com/user.id=${guid}`;

  const htmlBody = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background-color: #1a0a00;">
  <div style="max-width: 600px; margin: 0 auto; padding: 40px 20px;">
    <div style="background: linear-gradient(135deg, #2d1810 0%, #1a0a00 100%); border-radius: 16px; padding: 40px; border: 1px solid #3d2820;">

      <div style="text-align: center; margin-bottom: 30px;">
        <h1 style="color: #fc2a0d; margin: 0; font-size: 28px;">🎉 Your Prototype is Ready!</h1>
      </div>

      <p style="color: #e8d5c4; font-size: 16px; line-height: 1.6; margin-bottom: 20px;">
        Hi ${customerName},
      </p>

      <p style="color: #e8d5c4; font-size: 16px; line-height: 1.6; margin-bottom: 20px;">
        Great news! Your AI-powered prototype has been completed and is ready for you to explore!
      </p>

      <div style="text-align: center; margin: 30px 0;">
        <a href="${prototypeUrl}" target="_blank" style="display: inline-block; background: linear-gradient(135deg, #22c55e, #16a34a); color: white; text-decoration: none; padding: 16px 40px; border-radius: 8px; font-weight: 600; font-size: 16px;">
          View Your Prototype
        </a>
      </div>

      <p style="color: #a89080; font-size: 14px; line-height: 1.6; margin-bottom: 10px;">
        Prototype URL:
      </p>
      <p style="background: #2d1810; padding: 12px; border-radius: 8px; word-break: break-all; margin-bottom: 20px;">
        <a href="${prototypeUrl}" style="color: #22c55e; text-decoration: none; font-size: 14px;">${prototypeUrl}</a>
      </p>

      <div style="background: rgba(34, 197, 94, 0.1); padding: 20px; border-radius: 12px; border: 1px solid rgba(34, 197, 94, 0.3); margin: 20px 0;">
        <h3 style="color: #22c55e; margin: 0 0 10px 0; font-size: 16px;">What's Next?</h3>
        <ul style="color: #e8d5c4; margin: 0; padding-left: 20px; font-size: 14px;">
          <li>Explore your prototype and test all features</li>
          <li>Share feedback with our team</li>
          <li>Schedule a review call to discuss next steps</li>
        </ul>
      </div>

      <div style="text-align: center; margin: 20px 0;">
        <a href="${dashboardLink}" target="_blank" style="display: inline-block; background: rgba(252, 42, 13, 0.2); color: #fc2a0d; text-decoration: none; padding: 12px 24px; border-radius: 8px; font-weight: 500; font-size: 14px; border: 1px solid #fc2a0d;">
          Go to Dashboard
        </a>
      </div>

      <hr style="border: none; border-top: 1px solid #3d2820; margin: 30px 0;">

      <p style="color: #a89080; font-size: 14px; text-align: center;">
        Questions? Reply to this email or reach out at <a href="mailto:hello@cocreateidea.com" style="color: #fc2a0d;">hello@cocreateidea.com</a>
      </p>
    </div>
  </div>
</body>
</html>`;

  const textBody = `Hi ${customerName},

Great news! Your AI-powered prototype has been completed and is ready!

View your prototype here:
${prototypeUrl}

Dashboard: ${dashboardLink}

What's Next?
- Explore your prototype and test all features
- Share feedback with our team
- Schedule a review call to discuss next steps

Questions? Reply to this email or reach out at hello@cocreateidea.com

- The CoCreate Team`;

  try {
    await ses.send(new SendEmailCommand({
      Source: FROM_EMAIL,
      Destination: { ToAddresses: [customerEmail] },
      ReplyToAddresses: ['hello@cocreateidea.com'],
      Message: {
        Subject: { Data: '🎉 Your CoCreate Prototype is Ready!', Charset: 'UTF-8' },
        Body: {
          Text: { Data: textBody, Charset: 'UTF-8' },
          Html: { Data: htmlBody, Charset: 'UTF-8' }
        }
      }
    }));
    console.log('Build completion email sent to:', customerEmail);
    return true;
  } catch (error) {
    console.error('Build completion email error:', error.message);
    return false;
  }
}

// Handle Build Completion Webhook
async function handleBuildCompletion(guid, prototypeUrl, status) {
  const { S3Client, GetObjectCommand, PutObjectCommand } = await import('@aws-sdk/client-s3');
  const s3 = new S3Client({ region: S3_REGION });

  try {
    // Find the application by guid
    const applications = await listApplications();
    const app = applications.find(a => a.guid === guid);

    if (!app) {
      console.error('Build completion: Application not found for guid:', guid);
      return { success: false, error: 'Application not found' };
    }

    // Update application with prototype URL and status
    const s3Key = app.s3Key;
    const result = await s3.send(new GetObjectCommand({
      Bucket: S3_BUCKET,
      Key: s3Key
    }));
    const appData = JSON.parse(await result.Body.transformToString());

    appData.prototypeUrl = prototypeUrl;
    appData.buildStatus = status || 'completed';
    appData.buildCompletedAt = new Date().toISOString();

    await s3.send(new PutObjectCommand({
      Bucket: S3_BUCKET,
      Key: s3Key,
      Body: JSON.stringify(appData, null, 2),
      ContentType: 'application/json'
    }));

    // Send email to customer
    const customerName = app.visitorInfo?.name || app.formData?.fullName || 'Partner';
    const customerEmail = app.visitorInfo?.email || app.formData?.email;

    if (customerEmail) {
      await sendBuildCompletionEmail(customerName, customerEmail, guid, prototypeUrl);
    }

    console.log('Build completion processed for:', guid);
    return { success: true, message: 'Build completion processed' };
  } catch (error) {
    console.error('Build completion error:', error.message);
    return { success: false, error: error.message };
  }
}

// Verify Google OAuth Access Token
async function verifyGoogleAccessToken(accessToken) {
  try {
    // Verify the access token with Google's userinfo endpoint
    const response = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
      headers: { 'Authorization': `Bearer ${accessToken}` }
    });

    if (!response.ok) {
      return { valid: false, error: 'Invalid access token' };
    }

    const data = await response.json();

    if (data.error) {
      return { valid: false, error: data.error_description || data.error };
    }

    return {
      valid: true,
      email: data.email,
      name: data.name,
      picture: data.picture,
      googleId: data.sub
    };
  } catch (error) {
    console.error('Google token verification error:', error.message);
    return { valid: false, error: error.message };
  }
}

// Google SSO Login/Signup
async function googleLogin(guid, accessToken, userInfo) {
  const { S3Client, GetObjectCommand, PutObjectCommand } = await import('@aws-sdk/client-s3');
  const s3 = new S3Client({ region: S3_REGION });

  try {
    // Verify Google access token to ensure it's valid
    const googleData = await verifyGoogleAccessToken(accessToken);
    if (!googleData.valid) {
      return { success: false, error: googleData.error || 'Invalid Google token' };
    }

    // Use verified data from Google, not frontend userInfo (security)
    const verifiedUserInfo = googleData;

    // Check if this guid has an application
    const applications = await listApplications();
    const app = applications.find(a => a.guid === guid);

    if (!app) {
      return { success: false, error: 'Invalid session ID' };
    }

    // Check if user already has an account
    let existingCredentials = null;
    try {
      const result = await s3.send(new GetObjectCommand({
        Bucket: S3_BUCKET,
        Key: `users/${guid}/credentials.json`
      }));
      existingCredentials = JSON.parse(await result.Body.transformToString());
    } catch (e) {
      // No existing account
    }

    const now = new Date();
    const sessionToken = generateSessionToken();
    const expiresAt = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000); // 7 days

    let isNewUser = false;

    if (existingCredentials) {
      // Existing user - verify Google ID matches or link account
      if (existingCredentials.googleId && existingCredentials.googleId !== verifiedUserInfo.googleId) {
        return { success: false, error: 'This account is linked to a different Google account' };
      }

      // Update Google ID if not set
      if (!existingCredentials.googleId) {
        existingCredentials.googleId = verifiedUserInfo.googleId;
        existingCredentials.updatedAt = now.toISOString();

        await s3.send(new PutObjectCommand({
          Bucket: S3_BUCKET,
          Key: `users/${guid}/credentials.json`,
          Body: JSON.stringify(existingCredentials, null, 2),
          ContentType: 'application/json'
        }));
      }
    } else {
      // New user - create account with Google
      isNewUser = true;
      const username = verifiedUserInfo.email.split('@')[0].toLowerCase().replace(/[^a-z0-9]/g, '');

      // Check username availability and make unique if needed
      let finalUsername = username;
      let counter = 1;
      while (!(await checkUsernameAvailable(finalUsername)).available) {
        finalUsername = `${username}${counter}`;
        counter++;
      }

      const credentials = {
        username: finalUsername,
        googleId: verifiedUserInfo.googleId,
        googleEmail: verifiedUserInfo.email,
        authMethod: 'google',
        createdAt: now.toISOString()
      };

      await s3.send(new PutObjectCommand({
        Bucket: S3_BUCKET,
        Key: `users/${guid}/credentials.json`,
        Body: JSON.stringify(credentials, null, 2),
        ContentType: 'application/json'
      }));

      // Save profile
      const profile = {
        name: verifiedUserInfo.name || app.visitorInfo?.name || app.formData?.fullName || '',
        email: verifiedUserInfo.email,
        phone: app.visitorInfo?.phone || app.formData?.phone || '',
        username: finalUsername,
        picture: verifiedUserInfo.picture,
        createdAt: now.toISOString()
      };

      await s3.send(new PutObjectCommand({
        Bucket: S3_BUCKET,
        Key: `users/${guid}/profile.json`,
        Body: JSON.stringify(profile, null, 2),
        ContentType: 'application/json'
      }));
    }

    // Create/update session
    const sessions = {
      tokens: [{
        token: sessionToken,
        createdAt: now.toISOString(),
        expiresAt: expiresAt.toISOString(),
        authMethod: 'google'
      }]
    };

    await s3.send(new PutObjectCommand({
      Bucket: S3_BUCKET,
      Key: `users/${guid}/sessions.json`,
      Body: JSON.stringify(sessions, null, 2),
      ContentType: 'application/json'
    }));

    console.log('Google login successful for guid:', guid, 'isNewUser:', isNewUser);

    return {
      success: true,
      sessionToken,
      expiresAt: expiresAt.toISOString(),
      isNewUser,
      user: {
        name: verifiedUserInfo.name,
        email: verifiedUserInfo.email,
        picture: verifiedUserInfo.picture
      }
    };
  } catch (error) {
    console.error('Google login error:', error.message);
    return { success: false, error: error.message };
  }
}

// Send user credentials email
async function sendUserCredentialsEmail(name, email, username, password, sessionLink, guid) {
  const { SESClient, SendEmailCommand } = await import('@aws-sdk/client-ses');
  const ses = new SESClient({ region: 'us-east-1' });

  // Extract guid from sessionLink if not provided directly
  let userGuid = guid;
  if (!userGuid && sessionLink) {
    const match = sessionLink.match(/guid=([^&]+)/);
    userGuid = match ? match[1] : '';
  }
  const dashboardLink = `https://www.cocreateidea.com/user.id=${userGuid}`;

  const htmlBody = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background-color: #1a0a00;">
  <div style="max-width: 600px; margin: 0 auto; padding: 40px 20px;">
    <div style="background: linear-gradient(135deg, #2d1810 0%, #1a0a00 100%); border-radius: 16px; padding: 40px; border: 1px solid #3d2820;">

      <div style="text-align: center; margin-bottom: 30px;">
        <h1 style="color: #fc2a0d; margin: 0; font-size: 28px;">🔐 Your Dashboard Credentials</h1>
      </div>

      <p style="color: #e8d5c4; font-size: 16px; line-height: 1.6; margin-bottom: 20px;">
        Hi ${name || 'there'},
      </p>

      <p style="color: #e8d5c4; font-size: 16px; line-height: 1.6; margin-bottom: 20px;">
        Your CoCreate dashboard account has been created. Here are your login credentials:
      </p>

      <div style="background: #2d1810; padding: 20px; border-radius: 12px; margin: 20px 0;">
        <p style="color: #a89080; margin: 0 0 10px 0; font-size: 14px;">Username:</p>
        <p style="color: #fc2a0d; margin: 0 0 20px 0; font-size: 18px; font-weight: bold;">${username}</p>

        <p style="color: #a89080; margin: 0 0 10px 0; font-size: 14px;">Password:</p>
        <p style="color: #fc2a0d; margin: 0; font-size: 18px; font-weight: bold;">${password}</p>
      </div>

      <p style="color: #fbbf24; font-size: 14px; line-height: 1.6; margin-bottom: 20px;">
        ⚠️ For security, we recommend changing your password after your first login.
      </p>

      <div style="text-align: center; margin: 30px 0;">
        <a href="${dashboardLink}" target="_blank" style="display: inline-block; background: linear-gradient(135deg, #fc2a0d, #fd6c71); color: white; text-decoration: none; padding: 16px 40px; border-radius: 8px; font-weight: 600; font-size: 16px;">
          Access Your Dashboard
        </a>
      </div>

      <hr style="border: none; border-top: 1px solid #3d2820; margin: 30px 0;">

      <p style="color: #a89080; font-size: 14px; text-align: center;">
        Questions? Reply to this email or reach out at <a href="mailto:hello@cocreateidea.com" style="color: #fc2a0d;">hello@cocreateidea.com</a>
      </p>
    </div>
  </div>
</body>
</html>`;

  const textBody = `Hi ${name || 'there'},

Your CoCreate dashboard account has been created. Here are your login credentials:

Username: ${username}
Password: ${password}

⚠️ For security, we recommend changing your password after your first login.

Access your dashboard: ${dashboardLink}

Questions? Reply to this email or reach out at hello@cocreateidea.com

- The CoCreate Team`;

  try {
    const result = await ses.send(new SendEmailCommand({
      Source: FROM_EMAIL,
      Destination: {
        ToAddresses: [email]
      },
      ReplyToAddresses: ['hello@cocreateidea.com'],
      Message: {
        Subject: {
          Data: '🔐 Your CoCreate Dashboard Credentials',
          Charset: 'UTF-8'
        },
        Body: {
          Text: {
            Data: textBody,
            Charset: 'UTF-8'
          },
          Html: {
            Data: htmlBody,
            Charset: 'UTF-8'
          }
        }
      }
    }));
    console.log('Credentials email sent successfully, MessageId:', result.MessageId);
    return true;
  } catch (error) {
    console.error('Credentials email send error:', error.message);
    throw error;
  }
}

// Trigger external build system via API
async function triggerExternalBuild(applicationData) {
  const EXTERNAL_BUILD_API = 'https://d3r4k77gnvpmzn.cloudfront.net/api/admin/sessions';

  const formData = applicationData.formData || {};
  const visitorInfo = applicationData.visitorInfo || {};

  // Map application data to external API format
  const requestBody = {
    name: visitorInfo.name || formData.fullName || formData.full_name || 'Unknown',
    email: visitorInfo.email || formData.email || '',
    phone: visitorInfo.phone || formData.phone || '',
    initial_request: formData.productIdea || formData.product_idea || applicationData.rawContent || '',
    created_at: applicationData.submittedAt || new Date().toISOString()
  };

  console.log('Triggering external build:', requestBody.name, requestBody.email);

  try {
    const response = await fetch(EXTERNAL_BUILD_API, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(requestBody)
    });

    const result = await response.json();

    if (result.success) {
      console.log('External build success:', result.guid);
      return {
        success: true,
        guid: result.guid,
        link: result.link
      };
    } else {
      console.error('External build API error:', result.error);
      return {
        success: false,
        error: result.error || 'Unknown error from build API',
        guid: null,
        link: null
      };
    }
  } catch (error) {
    console.error('External build request failed:', error.message);
    return {
      success: false,
      error: error.message,
      guid: null,
      link: null
    };
  }
}

// Create MVP build job in S3 for EC2 worker to pick up (DEPRECATED - kept for reference)
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
The user is currently viewing the "${pageContext.currentPage}" page on the CoCreate website.
Page URL: ${pageContext.url || 'Unknown'}
If the user asks about "this page" or "where am I", refer to this page context.`;
    }

    if (hasContactInfo) {
      contextualPrompt += '\n\n## Current Status: Contact info collected. Provide helpful detailed answers about CoCreate partnerships.';
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
      contextualPrompt += '\n\n## Current Status: Contact info collected. Provide helpful detailed answers about CoCreate partnerships.';
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

    // ========== USER DASHBOARD ENDPOINTS ==========

    // Check if user account exists
    if (action === 'user-check') {
      const { guid } = body;

      if (!guid) {
        return {
          statusCode: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          body: JSON.stringify({ success: false, error: 'GUID is required' })
        };
      }

      const result = await checkUserExists(guid);
      return {
        statusCode: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify(result)
      };
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

      const result = await userSignup(guid, email, password);
      return {
        statusCode: result.success ? 200 : 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify(result)
      };
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

      const result = await userLogin(guid, email, password);
      return {
        statusCode: result.success ? 200 : 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify(result)
      };
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

      const result = await getUserDashboard(guid, sessionToken);
      return {
        statusCode: result.success ? 200 : 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify(result)
      };
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

      if (newPassword.length < 6) {
        return {
          statusCode: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          body: JSON.stringify({ success: false, error: 'New password must be at least 6 characters' })
        };
      }

      const result = await userChangePassword(guid, sessionToken, oldPassword, newPassword);
      return {
        statusCode: result.success ? 200 : 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify(result)
      };
    }

    // Check username availability
    if (action === 'check-username') {
      const { username, excludeGuid } = body;

      if (!username) {
        return {
          statusCode: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          body: JSON.stringify({ success: false, error: 'Username is required' })
        };
      }

      const result = await checkUsernameAvailable(username, excludeGuid);
      return {
        statusCode: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify({ success: true, ...result })
      };
    }

    // Forgot password - send reset link
    if (action === 'forgot-password') {
      const { email } = body;

      if (!email) {
        return {
          statusCode: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          body: JSON.stringify({ success: false, error: 'Email is required' })
        };
      }

      const result = await forgotPassword(email);
      return {
        statusCode: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify(result)
      };
    }

    // Reset password with token
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

      const result = await resetPassword(guid, resetToken, newPassword);
      return {
        statusCode: result.success ? 200 : 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify(result)
      };
    }

    // Webhook: Save project deployment (called by external build system)
    if (action === 'webhook-deployment') {
      const { guid, apiKey, projectName, description, cloudfrontUrl, s3Url, customDomain, status, activity, metadata } = body;

      // Simple API key validation (can be enhanced)
      const WEBHOOK_API_KEY = process.env.WEBHOOK_API_KEY || 'cocreate-webhook-key-2026';
      if (apiKey !== WEBHOOK_API_KEY) {
        return {
          statusCode: 401,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          body: JSON.stringify({ success: false, error: 'Invalid API key' })
        };
      }

      if (!guid) {
        return {
          statusCode: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          body: JSON.stringify({ success: false, error: 'GUID is required' })
        };
      }

      const result = await saveProjectDeployment(guid, {
        projectName, description, cloudfrontUrl, s3Url, customDomain, status, activity, metadata
      });

      return {
        statusCode: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify(result)
      };
    }

    // Get project history (public endpoint for dashboard)
    if (action === 'get-project-history') {
      const { guid, sessionToken } = body;

      if (!guid || !sessionToken) {
        return {
          statusCode: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          body: JSON.stringify({ success: false, error: 'GUID and session token are required' })
        };
      }

      const isValid = await validateSession(guid, sessionToken);
      if (!isValid) {
        return {
          statusCode: 401,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          body: JSON.stringify({ success: false, error: 'Invalid or expired session' })
        };
      }

      const projectHistory = await getProjectHistory(guid);
      return {
        statusCode: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify({ success: true, projectHistory })
      };
    }

    // Webhook: Receive activity updates from Tmux Builder
    if (action === 'webhook-activity') {
      const { guid, apiKey, activity } = body;

      const WEBHOOK_API_KEY = process.env.WEBHOOK_API_KEY || 'cocreate-webhook-key-2026';
      if (apiKey !== WEBHOOK_API_KEY) {
        return {
          statusCode: 401,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          body: JSON.stringify({ success: false, error: 'Invalid API key' })
        };
      }

      if (!guid || !activity) {
        return {
          statusCode: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          body: JSON.stringify({ success: false, error: 'GUID and activity are required' })
        };
      }

      const result = await saveActivity(guid, activity);
      return {
        statusCode: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify(result)
      };
    }

    // Proxy: Fetch project details from Tmux Builder (avoids CORS)
    if (action === 'get-tmux-projects') {
      const { guid } = body;

      if (!guid) {
        return {
          statusCode: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          body: JSON.stringify({ success: false, error: 'GUID is required' })
        };
      }

      try {
        const response = await fetch(`https://d3r4k77gnvpmzn.cloudfront.net/api/admin/sessions/${guid}`);
        if (!response.ok) {
          return {
            statusCode: 200,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            body: JSON.stringify({ success: false, error: 'Session not found', projects: [], activities: [] })
          };
        }

        const data = await response.json();
        const statusJson = data.files?.['status.json'] || {};
        const activityLog = data.files?.['activity_log.jsonl'] || [];
        const chatHistory = data.files?.['chat_history.jsonl'] || [];

        // Extract deployed URL from chat history (look for CloudFront or localhost URLs)
        let deployedUrl = null;
        for (const msg of chatHistory) {
          if (msg.role === 'assistant' && msg.content) {
            // Look for CloudFront URL
            const cfMatch = msg.content.match(/https?:\/\/[a-z0-9]+\.cloudfront\.net[^\s\)"]*/i);
            if (cfMatch) deployedUrl = cfMatch[0];
            // Look for localhost deployment
            const localMatch = msg.content.match(/http:\/\/184\.73\.78\.154:\d+[^\s\)"]*/);
            if (localMatch) deployedUrl = localMatch[0];
          }
        }

        // Build project info
        const project = {
          guid: data.guid,
          title: statusJson.user_request?.substring(0, 60) || 'Website Project',
          description: statusJson.user_request || '',
          status: statusJson.state === 'ready' ? 'completed' : statusJson.state || 'pending',
          progress: statusJson.progress || 0,
          deployedUrl: deployedUrl,
          createdAt: statusJson.created_at || data.created_at,
          updatedAt: statusJson.updated_at || data.updated_at,
          clientName: statusJson.client_name
        };

        // Map activities
        const activities = activityLog
          .filter(act => act.data || act.type === 'done')
          .map(act => ({
            message: act.data || (act.type === 'done' ? 'Task completed' : act.type),
            status: act.type,
            time: act.timestamp,
            type: act.type
          }));

        return {
          statusCode: 200,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          body: JSON.stringify({ success: true, project, activities })
        };
      } catch (error) {
        return {
          statusCode: 200,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          body: JSON.stringify({ success: false, error: error.message, projects: [], activities: [] })
        };
      }
    }

    // Google SSO Login
    if (action === 'google-login') {
      const { guid, googleAccessToken, googleUserInfo } = body;

      if (!guid || !googleAccessToken || !googleUserInfo) {
        return {
          statusCode: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          body: JSON.stringify({ success: false, error: 'GUID, Google access token, and user info are required' })
        };
      }

      const result = await googleLogin(guid, googleAccessToken, googleUserInfo);
      return {
        statusCode: result.success ? 200 : 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify(result)
      };
    }

    // Build Completion Webhook (called by external build system)
    if (action === 'build-complete') {
      const { guid, prototypeUrl, status, apiKey } = body;

      // Simple API key check for webhook security
      const WEBHOOK_API_KEY = process.env.WEBHOOK_API_KEY || 'cocreate-webhook-2026';
      if (apiKey !== WEBHOOK_API_KEY) {
        return {
          statusCode: 401,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          body: JSON.stringify({ success: false, error: 'Invalid API key' })
        };
      }

      if (!guid || !prototypeUrl) {
        return {
          statusCode: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          body: JSON.stringify({ success: false, error: 'GUID and prototype URL are required' })
        };
      }

      const result = await handleBuildCompletion(guid, prototypeUrl, status);
      return {
        statusCode: result.success ? 200 : 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify(result)
      };
    }

    // ========== FORM VALIDATION ENDPOINT ==========
    // Called when user submits the application form
    if (action === 'validate' || body.mode === 'validate') {
      const { formData } = body;

      if (!formData) {
        return {
          statusCode: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          body: JSON.stringify({ success: false, error: 'Form data is required' })
        };
      }

      console.log('Validating form data:', formData);

      // Validate fields
      const fields = {};
      let allValid = true;

      // Name validation
      if (!formData.name || formData.name.trim().length < 2) {
        fields.name = { valid: false, error: 'Please enter your full name (at least 2 characters)' };
        allValid = false;
      } else {
        fields.name = { valid: true };
      }

      // Email validation
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!formData.email || !emailRegex.test(formData.email.trim())) {
        fields.email = { valid: false, error: 'Please enter a valid email address' };
        allValid = false;
      } else {
        fields.email = { valid: true };
      }

      // Product idea validation
      if (!formData.productIdea || formData.productIdea.trim().length < 20) {
        fields.productIdea = { valid: false, error: 'Please describe your idea in at least 20 characters' };
        allValid = false;
      } else {
        fields.productIdea = { valid: true };
      }

      // If validation passed, save the application
      if (allValid) {
        try {
          // Save to S3
          const { S3Client, PutObjectCommand } = await import('@aws-sdk/client-s3');
          const s3 = new S3Client({ region: S3_REGION });

          const timestamp = new Date().toISOString();
          const dateFolder = timestamp.split('T')[0];
          const userEmail = formData.email.toLowerCase().replace(/[^a-z0-9]/g, '_');
          const s3Key = `applications/${userEmail}/${dateFolder}/form-${Date.now()}.json`;

          const applicationData = {
            timestamp,
            submittedAt: timestamp,
            submittedAtEST: new Date().toLocaleString('en-US', { timeZone: 'America/New_York' }),
            source: 'apply-form',
            clientIP,
            formData: {
              fullName: formData.name,
              email: formData.email,
              productIdea: formData.productIdea
            },
            visitorInfo: {
              name: formData.name,
              email: formData.email
            },
            status: 'pending'
          };

          await s3.send(new PutObjectCommand({
            Bucket: S3_BUCKET,
            Key: s3Key,
            Body: JSON.stringify(applicationData, null, 2),
            ContentType: 'application/json'
          }));

          console.log('Application saved to S3:', s3Key);

          // Send notification email
          try {
            await sendNotificationEmail(
              `New CoCreate Application: ${formData.name}`,
              `Name: ${formData.name}\nEmail: ${formData.email}\n\nProduct Idea:\n${formData.productIdea}`,
              formData.email
            );
          } catch (emailError) {
            console.error('Failed to send notification email:', emailError);
          }

          // Send confirmation email to applicant
          try {
            await sendApplicantConfirmationEmail(formData.name, formData.email);
          } catch (emailError) {
            console.error('Failed to send confirmation email:', emailError);
          }

        } catch (saveError) {
          console.error('Failed to save application:', saveError);
          // Continue anyway - don't block the user
        }
      }

      return {
        statusCode: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          success: allValid,
          fields,
          message: allValid ? 'Validation passed' : 'Please fix the highlighted fields'
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
            response: `It looks like you've already submitted an application on ${submittedDate} using the same ${duplicateCheck.matchedBy}. Our team is reviewing it and will contact you soon. If you have updates or questions, please visit our contact page.`,
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
