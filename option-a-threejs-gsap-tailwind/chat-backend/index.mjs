/**
 * CoCreate AI Chat Lambda
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
import dns from 'dns';
import { promisify } from 'util';
import { google } from 'googleapis';

// DNS MX lookup for email validation
const resolveMx = promisify(dns.resolveMx);

// Configuration
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const NOTIFICATION_EMAIL = process.env.NOTIFICATION_EMAIL || 'gopi@sunwaretechnologies.com';

// S3 bucket for storing all data
const S3_BUCKET = 'ai-product-studio-applications';

// ========== SCHEDULER CONFIGURATION ==========
const SCHEDULER_CONFIG = {
  // Days of week (0=Sunday, 1=Monday, ..., 6=Saturday)
  availableDays: [1, 2, 3, 4, 5], // Monday-Friday

  // Hours (24-hour format, in CEO's timezone)
  startHour: 8,   // 8:00 AM
  endHour: 18,    // 6:00 PM

  // Slot duration in minutes
  slotDuration: 30,

  // CEO's timezone
  timezone: 'America/Chicago',

  // Meeting title prefix
  meetingTitle: 'CoCreate Introduction',

  // Calendar ID (CEO's calendar)
  calendarId: process.env.GOOGLE_CALENDAR_ID || 'primary',
};

// Google Service Account credentials (from environment)
const GOOGLE_SERVICE_ACCOUNT_EMAIL = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
const GOOGLE_PRIVATE_KEY = process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, '\n');

// ========== GOOGLE CALENDAR AUTH ==========
let googleCalendar = null;

async function getGoogleCalendar() {
  if (googleCalendar) {
    return googleCalendar;
  }

  if (!GOOGLE_SERVICE_ACCOUNT_EMAIL || !GOOGLE_PRIVATE_KEY) {
    throw new Error('Google Calendar credentials not configured');
  }

  const auth = new google.auth.JWT(
    GOOGLE_SERVICE_ACCOUNT_EMAIL,
    null,
    GOOGLE_PRIVATE_KEY,
    ['https://www.googleapis.com/auth/calendar']
  );

  googleCalendar = google.calendar({ version: 'v3', auth });
  return googleCalendar;
}

// ========== SCHEDULER HELPERS ==========

/**
 * Generate all possible time slots for a given month based on availability rules
 */
function generatePossibleSlots(year, month, userTimezone) {
  const slots = {};

  // Get first and last day of the month
  const firstDay = new Date(year, month - 1, 1);
  const lastDay = new Date(year, month, 0);

  // Get current time to filter out past slots
  const now = new Date();

  for (let day = 1; day <= lastDay.getDate(); day++) {
    const date = new Date(year, month - 1, day);
    const dayOfWeek = date.getDay();

    // Skip if not an available day (weekend)
    if (!SCHEDULER_CONFIG.availableDays.includes(dayOfWeek)) {
      continue;
    }

    const dateStr = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    slots[dateStr] = [];

    // Generate slots for this day
    for (let hour = SCHEDULER_CONFIG.startHour; hour < SCHEDULER_CONFIG.endHour; hour++) {
      for (let minute = 0; minute < 60; minute += SCHEDULER_CONFIG.slotDuration) {
        // Create datetime in CEO's timezone
        const slotTime = new Date(`${dateStr}T${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:00`);

        // Skip past slots
        if (slotTime <= now) {
          continue;
        }

        const timeStr = `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
        slots[dateStr].push(timeStr);
      }
    }

    // Remove empty dates
    if (slots[dateStr].length === 0) {
      delete slots[dateStr];
    }
  }

  return slots;
}

/**
 * Remove busy times from available slots
 */
function subtractBusyTimes(slots, busyPeriods) {
  const result = { ...slots };

  for (const busy of busyPeriods) {
    const busyStart = new Date(busy.start);
    const busyEnd = new Date(busy.end);

    // Check each date's slots
    for (const dateStr in result) {
      result[dateStr] = result[dateStr].filter(timeStr => {
        const [hour, minute] = timeStr.split(':').map(Number);
        const slotStart = new Date(`${dateStr}T${timeStr}:00`);
        const slotEnd = new Date(slotStart.getTime() + SCHEDULER_CONFIG.slotDuration * 60 * 1000);

        // Keep slot if it doesn't overlap with busy period
        return slotEnd <= busyStart || slotStart >= busyEnd;
      });

      // Remove empty dates
      if (result[dateStr].length === 0) {
        delete result[dateStr];
      }
    }
  }

  return result;
}

/**
 * Convert time from CEO's timezone to user's timezone for display
 */
function convertTimezone(dateStr, timeStr, fromTz, toTz) {
  // Create date in source timezone
  const dateTimeStr = `${dateStr}T${timeStr}:00`;

  // For now, return as-is (timezone conversion can be added later)
  // The frontend will handle display conversion
  return timeStr;
}

// System prompt for the CoCreate AI chat agent with guardrails
const SYSTEM_PROMPT = `You are a concise AI assistant for CoCreate AI - a venture studio that partners with founders to build AI products.

## About Us:
- AI co-founder, not an agency
- Build products in 2 weeks
- 40/40/20 partnership (Tech/Business/Ops)
- $0 upfront - shared risk & reward

## STYLE - BE CONCISE:
- Short responses (2-3 sentences max)
- No filler words or excessive enthusiasm
- Get to the point quickly
- One question at a time

## GUARDRAILS:
Only discuss: partnerships, our model, AI products, business ideas, pricing/timelines.
Decline other topics with: "I'm here to discuss CoCreate partnerships. What AI product idea can I help you explore?"

## INPUT VALIDATION:

### Name: Reject gibberish/test inputs. Accept real names.
### Email: Must have @ and domain. Format: lowercase, trimmed.
### Product Idea: Must be coherent concept, not gibberish.

If invalid, ask again briefly: "Please provide a valid [field]."

## ============================================
## PARTNERSHIP APPLICATION - 4 REQUIRED FIELDS
## ============================================

| Step | Field ID | Question |
|------|----------|----------|
| 1 | fullName + email | "What's your name and email?" (ask together) |
| 2 | productIdea | "What's your product idea?" |
| 3 | targetCustomer | "Who's your target customer?" |
| 4 | timeline | "When do you want to launch?" → asap / 1month / 3months / 6months / exploring |

## OPTIONAL FIELDS (after required):
phone, linkedin, marketValidation, additionalInfo

---

## COLLECTION FLOW:

1. Ask name + email together first
2. Show progress: "✓ [■■□□] 2/4"
3. Ask next field
4. After 4 fields: offer submit or add optional details

---

## TIMELINE VALUES (exact match required):
"asap" | "1month" | "3months" | "6months" | "exploring"

---

## FILE UPLOAD:
Extract data, show what was found, ask for missing fields.

---

## FORM SUBMISSION:

Only submit when all 4 required fields have values.

Summary format:
"**Ready to submit:**
- Name: [fullName]
- Email: [email]
- Idea: [productIdea]
- Customer: [targetCustomer]
- Timeline: [timeline]

Submitting..."

---

## DUPLICATE CHECK:
System auto-checks email. If duplicate, user sees notification. Questions → gopi@sunwaretechnologies.com

---

## CRITICAL - FORM_DATA JSON:

**Include |||FORM_DATA||| in EVERY response with user data.**

Format (at end of response):
|||FORM_DATA|||{"fullName":"","email":"","phone":"","businessStage":"","industry":"","background":"","productIdea":"","targetCustomer":"","timeCommitment":"","timeline":"","linkedin":"","marketValidation":"","additionalInfo":""}|||END_FORM|||

- Fill collected values, empty "" for uncollected
- Always include all 13 fields
- Place at VERY END of response

Example:
User: "I'm John, john@test.com"
Response: "Got it, John! What's your product idea?"
|||FORM_DATA|||{"fullName":"John","email":"john@test.com","phone":"","businessStage":"","industry":"","background":"","productIdea":"","targetCustomer":"","timeCommitment":"","timeline":"","linkedin":"","marketValidation":"","additionalInfo":""}|||END_FORM|||`;

// Initialize Anthropic client
const anthropic = new Anthropic({
  apiKey: ANTHROPIC_API_KEY,
});

// ========== FORM VALIDATION AGENT ==========

const FORM_VALIDATION_PROMPT = `You are a form validation agent. You receive form data as JSON and validate specific fields.

VALIDATION RULES:

1. NAME - Validate for:
   - Must be at least 2 characters
   - No numbers allowed
   - Detect gibberish (asdf, qwerty, aasdjf, xyzabc, random letters)
   - Detect keyboard mashing patterns (asdfgh, zxcvbn, jkl;, fghj)
   - Detect repeated characters (aaaa, abcabc, xxxx)
   - Detect fake names (test, admin, user, none, fake, null, undefined)
   - Detect single words that aren't names (hello, yes, hi)
   ACCEPT: Common names, names with hyphens/apostrophes/spaces (O'Brien, Mary-Jane, José García), uncommon but plausible names
   If invalid: set valid=false, KEEP the original value in "value", provide helpful error message

2. EMAIL - Validate FORMAT only (must be name@domain.com structure).
   If format invalid: set valid=false, KEEP the original value in "value", provide error: "Please provide a valid email address."

   // COMMENTED OUT - Username validation disabled
   // USERNAME (before @) - REJECT if:
   // - Gibberish or random characters (asdf, qwerty, xyz123, aaa)
   // - Test/placeholder inputs (test, fake, admin, user, null, example, demo)
   // - Repeated characters (aaaa, abcabc)

   // COMMENTED OUT - Provider/domain validation disabled
   // PROVIDER/DOMAIN (after @) - REJECT if:
   // - Fake/suspicious domains (fake.com, example.com, test.com)
   // - Disposable/temporary providers (tempmail, guerrillamail, mailinator, 10minutemail, throwaway, etc.)
   // - Unknown/unrecognized domains
   // - ACCEPT ONLY well-known providers (Gmail, Yahoo, Outlook, Hotmail, iCloud, ProtonMail, AOL, Zoho, etc.)
   // - Use your knowledge to identify legitimate email providers
   // - When in doubt, REJECT

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

RESPONSE FORMAT: Return ONLY valid JSON matching this exact structure. No explanation text before or after.

{
  "success": true/false,
  "fields": {
    "name": { "valid": true, "value": "the name" },
    "email": { "valid": true, "value": "the email" },
    "productIdea": { "valid": true, "value": "the idea" },
    "phone": { "value": "the value" },
    ... other fields with just "value"
  }
}

Set "success": true only if ALL 3 validations (name, email, productIdea) pass.`;

// Handle form validation requests
async function handleFormValidation(formData, visitorInfo, clientIP) {
  console.log('Form validation request received:', { formData: Object.keys(formData) });

  // COMMENTED OUT - Using AI validation for email instead of DNS MX lookup
  // Step 1: DNS MX lookup for email (before AI validation)
  // let emailMxResult = { valid: true };
  // if (formData.email) {
  //   emailMxResult = await validateEmail(formData.email);
  //   console.log('Email MX validation result:', formData.email, emailMxResult);
  // }

  // AI validation for name, email, and productIdea
  const userMessage = `Validate this form data and return JSON response:
${JSON.stringify(formData, null, 2)}`;

  try {
    const anthropic = new Anthropic({ apiKey: ANTHROPIC_API_KEY });
    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 800,
      system: FORM_VALIDATION_PROMPT,
      messages: [{ role: 'user', content: userMessage }]
    });

    const responseText = response.content[0].text.trim();
    console.log('AI validation response:', responseText);

    // Parse AI response - extract JSON
    const jsonMatch = responseText.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error('No valid JSON in AI response');
    }

    const validationResult = JSON.parse(jsonMatch[0]);

    // COMMENTED OUT - Using AI validation for email instead of DNS MX lookup
    // Step 3: Add email MX result to validation result
    // if (!emailMxResult.valid) {
    //   validationResult.success = false;
    //   validationResult.fields.email = {
    //     valid: false,
    //     value: formData.email,
    //     error: getEmailValidationMessage(emailMxResult.reason)
    //   };
    // }

    // Return if any validation failed
    if (!validationResult.success) {
      console.log('Validation failed:', validationResult);
      return {
        statusCode: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify(validationResult)
      };
    }

    // All validation passed - save to S3 and send email
    console.log('Validation passed - saving application...');

    // Build visitorInfo from validated data
    const updatedVisitorInfo = {
      ...visitorInfo,
      name: formData.name,
      email: formData.email,
      phone: formData.phone || ''
    };

    // Build the application message in the expected format
    const applicationMessage = `PARTNERSHIP APPLICATION SUBMISSION:

Name: ${formData.name}
Email: ${formData.email}
Phone: ${formData.phone || 'Not provided'}
LinkedIn: ${formData.linkedin || 'Not provided'}

Business Stage: ${formData.businessStage}
Industry: ${formData.industry}
Background: ${formData.background}

Product Idea: ${formData.productIdea}
Target Customer: ${formData.targetCustomer}
Market Validation: ${formData.marketValidation || 'Not provided'}

Time Commitment: ${formData.timeCommitment}
Timeline: ${formData.timeline}
Additional Info: ${formData.additionalInfo || 'None'}`;

    // Check for duplicate
    const duplicateCheck = await checkDuplicateApplication(
      updatedVisitorInfo.email,
      updatedVisitorInfo.phone
    );

    if (duplicateCheck.isDuplicate) {
      console.log('Duplicate application detected:', duplicateCheck);
      return {
        statusCode: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          success: true,
          fields: validationResult.fields,
          message: `You've already submitted an application. Our team will contact you soon.`,
          isDuplicate: true
        })
      };
    }

    // Save to S3 and send email
    const [s3Result, emailResult] = await Promise.all([
      saveFormToS3(updatedVisitorInfo, applicationMessage, clientIP),
      sendFormSubmissionEmail(updatedVisitorInfo, applicationMessage, clientIP)
    ]);

    console.log('S3 save result:', s3Result);
    console.log('Email send result:', emailResult);

    return {
      statusCode: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        success: true,
        fields: validationResult.fields,
        message: 'Application submitted successfully'
      })
    };

  } catch (error) {
    console.error('Form validation error:', error);
    return {
      statusCode: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        success: false,
        error: 'Validation service error. Please try again.'
      })
    };
  }
}

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
      <h2 style="margin: 0;">🚀 New CoCreate AI Lead!</h2>
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
          Data: `🚀 New Lead: ${visitorInfo.name || 'Anonymous'} - CoCreate AI`,
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
      <p style="margin: 10px 0 0 0; opacity: 0.9;">Someone wants to partner with CoCreate AI</p>
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

// ========== EMAIL VALIDATION ==========

// Validate email format and domain MX records
async function validateEmail(email) {
  if (!email) {
    return { valid: false, reason: 'missing' };
  }

  // 1. Format check
  const formatRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!formatRegex.test(email)) {
    return { valid: false, reason: 'invalid_format' };
  }

  // 2. Extract domain
  const domain = email.split('@')[1].toLowerCase();

  // 3. MX record lookup to verify domain exists
  try {
    const mxRecords = await resolveMx(domain);
    if (!mxRecords || mxRecords.length === 0) {
      console.log(`Email validation: No MX records for domain ${domain}`);
      return { valid: false, reason: 'invalid_domain' };
    }
    console.log(`Email validation: Valid MX records found for ${domain}`);
  } catch (error) {
    console.log(`Email validation: MX lookup failed for ${domain}:`, error.code);
    return { valid: false, reason: 'invalid_domain' };
  }

  return { valid: true };
}

// Get human-readable validation error message
function getEmailValidationMessage(reason) {
  switch (reason) {
    case 'invalid_format':
      return "That email doesn't look quite right. Could you check the format? (e.g., name@company.com)";
    case 'invalid_domain':
      return "I couldn't verify that email domain. Could you double-check the spelling or try a different email?";
    default:
      return "Please provide a valid email address.";
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

// Create external session via CloudFront API
async function createExternalSession(applicationData) {
    const formData = applicationData.formData || {};
    const visitorInfo = applicationData.visitorInfo || {};

    const requestBody = {
        name: visitorInfo.name || formData.name || formData.full_name,
        email: visitorInfo.email || formData.email,
        initial_request: formData.product_idea || formData.productIdea || formData['product/service_idea'] || ''
    };

    // Only include phone if it exists
    const phone = visitorInfo.phone || formData.phone;
    if (phone) {
        requestBody.phone = phone;
    }

    console.log('Creating external session:', { name: requestBody.name, email: requestBody.email });

    try {
        const response = await fetch(
            'https://d3r4k77gnvpmzn.cloudfront.net/api/admin/sessions',
            {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(requestBody)
            }
        );

        const data = await response.json();
        console.log('External session response:', data);
        return data; // { success, guid, link } or { success: false, error }

    } catch (error) {
        console.error('External session error:', error.message);
        return { success: false, error: error.message, guid: null, link: null };
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

    // If approved, create external session
    if (newStatus === 'approved') {
        const sessionResult = await createExternalSession(applicationData);

        if (sessionResult.success) {
            applicationData.guid = sessionResult.guid;
            applicationData.sessionLink = sessionResult.link;
            applicationData.sessionCreatedAt = new Date().toISOString();
            // Clear any previous error
            delete applicationData.sessionError;
            delete applicationData.sessionFailedAt;
            console.log('Session created successfully:', sessionResult.guid);
        } else {
            applicationData.sessionError = sessionResult.error || 'Unknown error';
            applicationData.sessionFailedAt = new Date().toISOString();
            // Clear any previous success data
            delete applicationData.guid;
            delete applicationData.sessionLink;
            delete applicationData.sessionCreatedAt;
            console.log('Session creation failed:', sessionResult.error);
        }

        // Save updated application with session data
        await s3.send(new PutObjectCommand({
            Bucket: S3_BUCKET,
            Key: s3Key,
            Body: JSON.stringify(applicationData, null, 2),
            ContentType: 'application/json'
        }));
    }

    // If rejected, clear session data
    if (newStatus === 'rejected') {
        delete applicationData.guid;
        delete applicationData.sessionLink;
        delete applicationData.sessionCreatedAt;
        delete applicationData.sessionError;
        delete applicationData.sessionFailedAt;

        // Save updated application
        await s3.send(new PutObjectCommand({
            Bucket: S3_BUCKET,
            Key: s3Key,
            Body: JSON.stringify(applicationData, null, 2),
            ContentType: 'application/json'
        }));
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
async function chatWithClaude(messages, hasContactInfo, screenshot = null, pageContext = null, processedAttachments = null, validationErrors = null) {
  try {
    let contextualPrompt = SYSTEM_PROMPT;

    // Add page context so AI knows where the user is
    if (pageContext && pageContext.currentPage) {
      contextualPrompt += `\n\n## CURRENT PAGE CONTEXT:
The user is currently viewing the "${pageContext.currentPage}" page on the CoCreate AI website.
Page URL: ${pageContext.url || 'Unknown'}
If the user asks about "this page" or "where am I", refer to this page context.`;
    }

    if (hasContactInfo) {
      contextualPrompt += '\n\n## Current Status: Contact info collected. Provide helpful detailed answers about CoCreate AI partnerships.';
    } else {
      contextualPrompt += '\n\n## Current Status: NO CONTACT INFO YET. You must ask for name and phone/email before giving detailed answers!';
    }

    // Add validation errors if present - AI should address these
    if (validationErrors && validationErrors.length > 0) {
      contextualPrompt += '\n\n## VALIDATION ERRORS - ADDRESS THESE FIRST:\n';
      contextualPrompt += 'The following validation issues were detected. Please inform the user and ask them to provide valid information:\n';
      for (const error of validationErrors) {
        contextualPrompt += `- ${error}\n`;
      }
      contextualPrompt += '\nDO NOT include invalid data in FORM_DATA. Ask the user to correct these issues.';
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
      contextualPrompt += '\n\n## Current Status: Contact info collected. Provide helpful detailed answers about CoCreate AI partnerships.';
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

    // ========== FORM VALIDATION MODE ==========
    // Handle direct form validation (AI agent validates core fields)
    if (body.mode === 'validate' && body.formData) {
      return await handleFormValidation(body.formData, visitorInfo, clientIP);
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
        const s3 = new S3Client({ region: 'ap-south-1' });

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

    // Validate extracted email if present
    let emailValidation = { valid: true };
    let emailValidationError = null;
    if (extractedInfo.email) {
      emailValidation = await validateEmail(extractedInfo.email);
      if (!emailValidation.valid) {
        emailValidationError = getEmailValidationMessage(emailValidation.reason);
        console.log('Email validation failed:', extractedInfo.email, emailValidation.reason);
      }
    }

    const updatedVisitorInfo = {
      ...visitorInfo,
      ...(extractedInfo.name && { name: extractedInfo.name }),
      // Only include email if validation passed
      ...(extractedInfo.email && emailValidation.valid && { email: extractedInfo.email }),
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

    // Build validation errors array for AI context
    const validationErrors = [];
    if (emailValidationError) {
      validationErrors.push(`Email validation failed: ${emailValidationError}`);
    }

    // Get AI response
    let response;
    try {
      response = await chatWithClaude(messages, hasCompleteContactInfo, screenshot, pageContext, processedAttachments, validationErrors.length > 0 ? validationErrors : null);
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
