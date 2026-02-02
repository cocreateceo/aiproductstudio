/**
 * Local Development Server for AI Product Studio
 *
 * Serves static files + API endpoints (same as Lambda)
 * Uses real S3 for storage to maintain parity with production
 */

import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import dns from 'dns';
import { promisify } from 'util';
import Anthropic from '@anthropic-ai/sdk';
import { S3Client, PutObjectCommand, GetObjectCommand, ListObjectsV2Command } from '@aws-sdk/client-s3';
import { SESClient, SendEmailCommand } from '@aws-sdk/client-ses';
import { fromIni } from '@aws-sdk/credential-providers';
import { google } from 'googleapis';

// DNS MX lookup for email validation
const resolveMx = promisify(dns.resolveMx);

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load environment variables
dotenv.config({ path: path.join(__dirname, '.env') });

const app = express();
const PORT = process.env.PORT || 5000;

// Configuration
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const S3_BUCKET = process.env.S3_BUCKET || 'cocreate-applications-data';
const S3_REGION = process.env.AWS_REGION || 'us-east-1';
const NOTIFICATION_EMAIL = process.env.NOTIFICATION_EMAIL || '';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'aiproductstudio2026';
const SKIP_EMAIL = process.env.SKIP_EMAIL === 'true'; // Skip emails in local dev
const AWS_PROFILE = process.env.AWS_PROFILE || 'cocreate';
const SES_REGION = process.env.SES_REGION || 'us-east-1';

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

// Initialize clients
const anthropic = new Anthropic({ apiKey: ANTHROPIC_API_KEY });
const s3 = new S3Client({
  region: S3_REGION,
  credentials: fromIni({ profile: AWS_PROFILE })
});
const ses = new SESClient({
  region: SES_REGION,
  credentials: fromIni({ profile: AWS_PROFILE })
});

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

// Middleware
app.use(cors());
app.use(express.json());

// Serve static files from site directory
app.use(express.static(path.join(__dirname, '../site')));

// Serve MVP builds
app.use('/builds', express.static(path.join(__dirname, '../mvp-builder/builds')));

// System prompt (same as Lambda)
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

## INPUT VALIDATION - Name, Email, and Product Idea:

### Name Validation:
When user provides their name, evaluate if it's a realistic human name.

REJECT names that are:
- Keyboard mashing: "asdfgh", "qwerty", "zxcvbn", "jkl;", "fghj"
- Repeated characters: "aaaa", "abcabc", "xxxx"
- Obvious test inputs: "test", "fake", "none", "na", "xxx", "aaa", "123"
- Single words that aren't names: "hello", "yes", "null", "undefined", "admin"

ACCEPT names that are:
- Common names in any culture/language
- Names with hyphens, apostrophes, spaces (O'Brien, Mary-Jane, José García)
- Uncommon but plausible names

If name seems invalid, DO NOT include it in FORM_DATA. Instead respond:
"That doesn't look like a real name. Could you please provide your actual name so we can personalize your experience?"

### Email Validation:
The system will validate emails before you process them. If an email fails validation, you will receive a validation error. In that case:
- DO NOT include the invalid email in FORM_DATA
- Ask the user to provide a valid email address
- Be helpful: "That email doesn't seem to be valid. Could you double-check it?"

### Product Idea Validation:
When user provides their product idea, evaluate if it's a coherent business/product concept.

REJECT ideas that are:
- Gibberish or random text: "asdfasdf", "test idea", "blah blah", "xyz123"
- Completely off-topic: "I like pizza", "What's the weather", "hello world"
- Empty or placeholder: "TBD", "will fill later", "idea here", "test", "n/a"
- Single unrelated words: "money", "success", "app", "thing"

ACCEPT ideas that are:
- A describable product or service concept
- Related to business/technology/solving a problem
- Brief but coherent: "AI tool for restaurant menu pricing" is fine
- Ambitious but logical: "Platform connecting farmers to restaurants"

If idea seems invalid, DO NOT include it in FORM_DATA. Instead respond:
"I'd love to hear more about your product idea! Could you describe what problem it solves or what it does? Even a brief description like 'an app that helps X do Y' works great."

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

## FORM FILLING MODE:
When a user asks to fill the partnership application form OR provides information about themselves/their idea:

1. INVITE FREE TEXT: Tell them: "Just share whatever information you have about yourself and your business idea in your own words - I'll organize it and help fill the form for you!"

2. WHEN USER PROVIDES INFO: Parse their free text to extract:
   - Personal: name, email, phone, LinkedIn
   - Business: stage (idea/validated/mvp/revenue/scaling), industry, background
   - Product: idea description, target customer, market validation
   - Partnership: time commitment, desired timeline

3. SHOW SUMMARY: After extracting info, show them a clear summary and ask to confirm.

4. IMPORTANT: Include a special JSON block at the END of your response:
   |||FORM_DATA|||{"fullName":"...", "email":"...", ...}|||END_FORM|||

## Important:
- Be conversational and friendly, not pushy
- Show genuine interest in their idea
- Emphasize the win-win partnership model
- Keep responses concise - max 2-3 short paragraphs`;

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

// Validate product idea coherence using AI
async function validateProductIdea(idea) {
  if (!idea || idea.trim().length < 10) {
    return { valid: false, reason: 'too_short', message: 'Please provide more detail about your product idea.' };
  }

  const validationPrompt = `Evaluate if this is a coherent business/product idea. Respond with ONLY a JSON object.

PRODUCT IDEA: "${idea}"

REJECT if the idea is:
- Gibberish or random text (asdfasdf, xyz123)
- Completely off-topic (I like pizza, weather questions)
- Placeholder text (TBD, test, n/a, will fill later)
- Single unrelated words (money, success, app)

ACCEPT if the idea is:
- A describable product or service concept
- Related to solving a problem or business need
- Brief but coherent

Respond with: {"valid": true} or {"valid": false, "reason": "explanation"}`;

  try {
    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 100,
      messages: [{ role: 'user', content: validationPrompt }]
    });

    const responseText = response.content[0].text.trim();
    const jsonMatch = responseText.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const result = JSON.parse(jsonMatch[0]);
      return result.valid ? { valid: true } : { valid: false, reason: 'incoherent', message: result.reason || "Please describe a real product idea." };
    }
    return { valid: true };
  } catch (error) {
    console.error('Product idea validation error:', error.message);
    return { valid: true }; // Don't block on errors
  }
}

// Validate name using pattern detection
function validateNamePatterns(name) {
  if (!name || name.trim().length < 2) {
    return { valid: false, reason: 'too_short', message: 'Name must be at least 2 characters.' };
  }

  const trimmed = name.trim();

  if (/\d/.test(trimmed)) {
    return { valid: false, reason: 'has_numbers', message: 'Name should not contain numbers.' };
  }

  if (!/[a-zA-Z\u00C0-\u024F]/.test(trimmed)) {
    return { valid: false, reason: 'no_letters', message: 'Please enter a valid name.' };
  }

  const keyboardPatterns = /^(asdf|qwer|zxcv|uiop|hjkl|fghj|test|fake|none|null|undefined|admin|user|hello|xxx|aaa|bbb|abc)/i;
  if (keyboardPatterns.test(trimmed.replace(/\s/g, ''))) {
    return { valid: false, reason: 'keyboard_pattern', message: 'Please enter your real name.' };
  }

  if (/(.)\1{3,}/.test(trimmed)) {
    return { valid: false, reason: 'repeated_chars', message: 'Please enter a valid name.' };
  }

  return { valid: true };
}

// Helper: Extract contact info using LLM
async function extractContactInfoWithLLM(messages) {
  const conversationText = messages.map(m => `${m.role}: ${m.content}`).join('\n');

  const extractionPrompt = `Analyze this conversation and extract any contact information the user has provided.

CONVERSATION:
${conversationText}

Extract and return ONLY a JSON object with these fields (use null if not found):
- name: The person's full name
- email: Their email address
- phone: Their phone number

Return ONLY the JSON, no other text.`;

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

// Helper: Chat with Claude
async function chatWithClaude(messages, hasContactInfo, validationErrors = null) {
  let contextualPrompt = SYSTEM_PROMPT;
  if (hasContactInfo) {
    contextualPrompt += '\n\n## Current Status: Contact info collected. Provide helpful detailed answers.';
  } else {
    contextualPrompt += '\n\n## Current Status: NO CONTACT INFO YET. Ask for name and phone/email first!';
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

  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 500,
    system: contextualPrompt,
    messages: messages.map(m => ({ role: m.role, content: m.content }))
  });

  return { content: response.content[0].text, provider: 'claude' };
}

// Helper: Save form to S3
async function saveFormToS3(visitorInfo, formContent, clientIP) {
  const timestamp = new Date().toISOString();
  const dateFolder = timestamp.split('T')[0];

  let userFolder = 'anonymous';
  if (visitorInfo.email) {
    userFolder = visitorInfo.email.toLowerCase().replace(/@/g, '_at_').replace(/\./g, '_').replace(/[^a-z0-9_-]/g, '');
  } else if (visitorInfo.name) {
    userFolder = visitorInfo.name.toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_-]/g, '');
  }

  const randomSuffix = Math.random().toString(36).substring(2, 8);
  const filename = `${timestamp.replace(/[:.]/g, '-')}_${randomSuffix}.json`;
  const s3Key = `applications/${userFolder}/${dateFolder}/${filename}`;

  // Parse form content
  const formData = {};
  const lines = formContent.split('\n');
  for (const line of lines) {
    if (line.includes(':')) {
      const colonIndex = line.indexOf(':');
      const key = line.substring(0, colonIndex).trim();
      const value = line.substring(colonIndex + 1).trim();
      if (key && !key.includes('SUBMISSION')) {
        formData[key.toLowerCase().replace(/\s+/g, '_')] = value;
      }
    }
  }

  const applicationData = {
    submittedAt: timestamp,
    submittedAtEST: new Date().toLocaleString('en-US', { timeZone: 'America/New_York' }),
    status: 'pending',
    visitorInfo: {
      name: visitorInfo.name || null,
      email: visitorInfo.email || null,
      phone: visitorInfo.phone || null
    },
    clientIP: clientIP || 'localhost',
    page: visitorInfo.page || 'Apply Page',
    formData,
    rawContent: formContent
  };

  await s3.send(new PutObjectCommand({
    Bucket: S3_BUCKET,
    Key: s3Key,
    Body: JSON.stringify(applicationData, null, 2),
    ContentType: 'application/json'
  }));

  console.log('📁 Form saved to S3:', s3Key);
  return { success: true, key: s3Key };
}

// Helper: List applications from S3
async function listApplications() {
  const listResult = await s3.send(new ListObjectsV2Command({
    Bucket: S3_BUCKET,
    Prefix: 'applications/'
  }));

  if (!listResult.Contents || listResult.Contents.length === 0) {
    return [];
  }

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
          return { s3Key: obj.Key, ...JSON.parse(body) };
        } catch (e) {
          return null;
        }
      })
  );

  return applications.filter(app => app !== null).sort((a, b) => new Date(b.submittedAt) - new Date(a.submittedAt));
}

// Helper: Update application status
async function updateApplicationStatus(s3Key, newStatus, reviewNotes = '') {
  const getResult = await s3.send(new GetObjectCommand({
    Bucket: S3_BUCKET,
    Key: s3Key
  }));
  const body = await getResult.Body.transformToString();
  const applicationData = JSON.parse(body);

  applicationData.status = newStatus;
  applicationData.reviewedAt = new Date().toISOString();
  applicationData.reviewedAtEST = new Date().toLocaleString('en-US', { timeZone: 'America/New_York' });
  if (reviewNotes) applicationData.reviewNotes = reviewNotes;

  await s3.send(new PutObjectCommand({
    Bucket: S3_BUCKET,
    Key: s3Key,
    Body: JSON.stringify(applicationData, null, 2),
    ContentType: 'application/json'
  }));

  console.log('📝 Updated status:', s3Key, newStatus);

  // If approved, create build job
  if (newStatus === 'approved') {
    const jobId = await createBuildJob(applicationData, s3Key);
    applicationData.jobId = jobId;
    console.log('🚀 Build job created:', jobId);

    // Save jobId back to application record
    await s3.send(new PutObjectCommand({
      Bucket: S3_BUCKET,
      Key: s3Key,
      Body: JSON.stringify(applicationData, null, 2),
      ContentType: 'application/json'
    }));
    console.log('📝 Updated application with jobId:', jobId);
  }

  return applicationData;
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
    return `client-${email.toLowerCase().replace(/[^a-z0-9]/g, '-')}`;
  }
  if (name) {
    return `client-${name.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '')}-${timestamp}`;
  }
  return `client-anon-${timestamp}`;
}

// Save chat session to S3
async function saveChatSession(sessionId, source, messages, visitorInfo, status = 'active') {
  const prefix = source === 'apply' ? 'chats/apply' : 'chats/landing';
  const s3Key = `${prefix}/${sessionId}.json`;

  let sessionData = null;
  try {
    const existing = await s3.send(new GetObjectCommand({ Bucket: S3_BUCKET, Key: s3Key }));
    sessionData = JSON.parse(await existing.Body.transformToString());
  } catch {
    sessionData = {
      sessionId,
      source,
      startedAt: new Date().toISOString(),
      status: 'active',
      clientId: null,
      messages: [],
      metadata: { userAgent: visitorInfo.userAgent || null, convertedToApplication: null, totalMessages: 0 }
    };
  }

  sessionData.messages = messages.map((m, i) => ({ ...m, timestamp: m.timestamp || new Date().toISOString(), index: i }));
  sessionData.lastActivity = new Date().toISOString();
  sessionData.status = status;
  sessionData.metadata.totalMessages = messages.length;

  if (visitorInfo.name || visitorInfo.email || visitorInfo.phone) {
    sessionData.visitorInfo = {
      name: visitorInfo.name || sessionData.visitorInfo?.name,
      email: visitorInfo.email || sessionData.visitorInfo?.email,
      phone: visitorInfo.phone || sessionData.visitorInfo?.phone
    };
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
    console.log('💬 Chat session saved:', s3Key);
    return { success: true, sessionId, clientId: sessionData.clientId };
  } catch (error) {
    console.error('Save chat session error:', error.message);
    return { success: false };
  }
}

// Link chat session to application
async function linkSessionToApplication(sessionId, source, applicationS3Key) {
  const prefix = source === 'apply' ? 'chats/apply' : 'chats/landing';
  const s3Key = `${prefix}/${sessionId}.json`;

  try {
    const existing = await s3.send(new GetObjectCommand({ Bucket: S3_BUCKET, Key: s3Key }));
    const sessionData = JSON.parse(await existing.Body.transformToString());
    sessionData.metadata.convertedToApplication = applicationS3Key;
    sessionData.status = 'converted';
    await s3.send(new PutObjectCommand({
      Bucket: S3_BUCKET,
      Key: s3Key,
      Body: JSON.stringify(sessionData, null, 2),
      ContentType: 'application/json'
    }));
  } catch (error) {
    console.error('Link session error:', error.message);
  }
}

// Update client profile
async function updateClientProfile(clientId, updates) {
  const s3Key = `clients/${clientId}.json`;

  try {
    let profile;
    try {
      const existing = await s3.send(new GetObjectCommand({ Bucket: S3_BUCKET, Key: s3Key }));
      profile = JSON.parse(await existing.Body.transformToString());
    } catch {
      profile = {
        clientId,
        name: updates.name || null,
        email: updates.email || null,
        phone: updates.phone || null,
        company: null,
        createdAt: new Date().toISOString(),
        status: 'prospect',
        chatSessions: [],
        applications: [],
        builds: [],
        timeline: [{ event: 'profile_created', timestamp: new Date().toISOString() }]
      };
    }

    if (updates.name) profile.name = updates.name;
    if (updates.email) profile.email = updates.email;
    if (updates.phone) profile.phone = updates.phone;
    if (updates.status) profile.status = updates.status;
    if (updates.addChatSession && !profile.chatSessions.includes(updates.addChatSession)) {
      profile.chatSessions.push(updates.addChatSession);
    }
    if (updates.addApplication && !profile.applications.includes(updates.addApplication)) {
      profile.applications.push(updates.addApplication);
    }
    if (updates.timelineEvent) {
      profile.timeline.push({ ...updates.timelineEvent, timestamp: new Date().toISOString() });
    }
    profile.updatedAt = new Date().toISOString();

    await s3.send(new PutObjectCommand({
      Bucket: S3_BUCKET,
      Key: s3Key,
      Body: JSON.stringify(profile, null, 2),
      ContentType: 'application/json'
    }));
    console.log('👤 Client profile updated:', clientId);
    return profile;
  } catch (error) {
    console.error('Update client profile error:', error.message);
    return null;
  }
}

// List chat sessions (for admin)
async function listChatSessions(source = 'all', limit = 50) {
  const prefixes = source === 'all' ? ['chats/landing/', 'chats/apply/'] : [`chats/${source}/`];
  const allSessions = [];

  for (const prefix of prefixes) {
    try {
      const listResult = await s3.send(new ListObjectsV2Command({ Bucket: S3_BUCKET, Prefix: prefix, MaxKeys: limit }));
      if (listResult.Contents) {
        for (const obj of listResult.Contents) {
          if (obj.Key.endsWith('.json')) {
            try {
              const getResult = await s3.send(new GetObjectCommand({ Bucket: S3_BUCKET, Key: obj.Key }));
              allSessions.push(JSON.parse(await getResult.Body.transformToString()));
            } catch {}
          }
        }
      }
    } catch {}
  }

  return allSessions.sort((a, b) => new Date(b.lastActivity || b.startedAt) - new Date(a.lastActivity || a.startedAt));
}

// List client profiles (for admin)
async function listClientProfiles(limit = 50) {
  try {
    const listResult = await s3.send(new ListObjectsV2Command({ Bucket: S3_BUCKET, Prefix: 'clients/', MaxKeys: limit }));
    if (!listResult.Contents) return [];

    const profiles = await Promise.all(
      listResult.Contents.filter(obj => obj.Key.endsWith('.json')).map(async (obj) => {
        try {
          const getResult = await s3.send(new GetObjectCommand({ Bucket: S3_BUCKET, Key: obj.Key }));
          return JSON.parse(await getResult.Body.transformToString());
        } catch { return null; }
      })
    );

    return profiles.filter(p => p !== null).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  } catch { return []; }
}

// List build history (for admin)
async function listBuildHistory(limit = 50) {
  try {
    const allBuilds = [];

    // 1. Get completed/failed builds from builds/ folder
    const buildsResult = await s3.send(new ListObjectsV2Command({ Bucket: S3_BUCKET, Prefix: 'builds/', MaxKeys: limit * 2 }));
    if (buildsResult.Contents) {
      const completedBuilds = await Promise.all(
        buildsResult.Contents.filter(obj => obj.Key.endsWith('metadata.json')).map(async (obj) => {
          try {
            const getResult = await s3.send(new GetObjectCommand({ Bucket: S3_BUCKET, Key: obj.Key }));
            return JSON.parse(await getResult.Body.transformToString());
          } catch { return null; }
        })
      );
      allBuilds.push(...completedBuilds.filter(b => b !== null));
    }

    // 2. Get pending jobs from jobs/ folder
    const jobsResult = await s3.send(new ListObjectsV2Command({ Bucket: S3_BUCKET, Prefix: 'jobs/', MaxKeys: limit }));
    if (jobsResult.Contents) {
      const pendingJobs = await Promise.all(
        jobsResult.Contents.filter(obj => obj.Key.endsWith('.json')).map(async (obj) => {
          try {
            const getResult = await s3.send(new GetObjectCommand({ Bucket: S3_BUCKET, Key: obj.Key }));
            const job = JSON.parse(await getResult.Body.transformToString());
            // Convert job to build format
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
          } catch { return null; }
        })
      );
      allBuilds.push(...pendingJobs.filter(b => b !== null));
    }

    // 3. Get in-progress builds from progress/ folder
    const progressResult = await s3.send(new ListObjectsV2Command({ Bucket: S3_BUCKET, Prefix: 'progress/', MaxKeys: limit }));
    if (progressResult.Contents) {
      const inProgressBuilds = await Promise.all(
        progressResult.Contents.filter(obj => obj.Key.endsWith('.json')).map(async (obj) => {
          try {
            const getResult = await s3.send(new GetObjectCommand({ Bucket: S3_BUCKET, Key: obj.Key }));
            const progress = JSON.parse(await getResult.Body.transformToString());
            // Only include if not already in builds (still in progress)
            if (progress.status === 'in_progress') {
              // Check if this build already exists in allBuilds
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
          } catch { return null; }
        })
      );
      allBuilds.push(...inProgressBuilds.filter(b => b !== null));
    }

    // Remove duplicates (prefer completed builds over pending/in-progress)
    const uniqueBuilds = [];
    const seenIds = new Set();
    // Sort by createdAt first so completed builds come before pending ones
    allBuilds.sort((a, b) => {
      // Prioritize: completed > building > pending
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
    console.error('Error listing build history:', error);
    return [];
  }
}

// Helper: Create build job
async function createBuildJob(applicationData, originalS3Key) {
  const timestamp = Date.now();
  const randomSuffix = Math.random().toString(36).substring(2, 8);
  const jobId = `job-${timestamp}-${randomSuffix}`;

  const formData = applicationData.formData || {};
  const visitorInfo = applicationData.visitorInfo || {};

  const jobData = {
    jobId,
    createdAt: new Date().toISOString(),
    createdAtEST: new Date().toLocaleString('en-US', { timeZone: 'America/New_York' }),
    status: 'pending',
    applicationS3Key: originalS3Key,
    client: {
      name: visitorInfo.name || formData.full_name || 'Unknown Client',
      email: visitorInfo.email || formData.email || null,
      phone: visitorInfo.phone || formData.phone || null
    },
    business: {
      idea: formData.product_idea || formData['product/service_idea'] || applicationData.rawContent || '',
      industry: formData.industry || 'other',
      stage: formData.business_stage || 'idea',
      targetCustomer: formData.target_customer || '',
      marketValidation: formData.market_validation || '',
      background: formData.professional_background || ''
    },
    preferences: {
      timeline: formData.desired_timeline || 'asap',
      techStack: 'threejs-gsap-tailwind',
      deployment: process.env.LOCAL_MODE === 'true' ? 'local' : 'cloudfront'
    }
  };

  await s3.send(new PutObjectCommand({
    Bucket: S3_BUCKET,
    Key: `jobs/${jobId}.json`,
    Body: JSON.stringify(jobData, null, 2),
    ContentType: 'application/json'
  }));

  // Create initial progress
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
    logs: [{ timestamp: new Date().toISOString(), message: 'Job created and queued' }],
    createdAt: new Date().toISOString()
  };

  await s3.send(new PutObjectCommand({
    Bucket: S3_BUCKET,
    Key: `progress/${jobId}.json`,
    Body: JSON.stringify(progressData, null, 2),
    ContentType: 'application/json'
  }));

  return jobId;
}

// ==================== FORM VALIDATION (AI Agent) ====================

// System prompt for AI form validation agent
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
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1000,
      system: FORM_VALIDATION_PROMPT,
      messages: [{ role: 'user', content: userMessage }]
    });

    // Parse AI response
    const responseText = response.content[0].text.trim();
    let validationResult;

    try {
      // Try to extract JSON from response
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
      // Return validation errors - don't save
      console.log('Form validation failed:', validationResult.fields);
      return {
        success: false,
        fields: validationResult.fields
      };
    }

    // Validation passed → check for duplicate, save to S3, send email
    console.log('Form validation passed, saving application...');

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

    // Send email notification (skip in local dev if configured)
    if (!SKIP_EMAIL) {
      try {
        const emailBody = `New Partnership Application (Direct Form)

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
Additional Info: ${formData.additionalInfo || 'None'}

---
S3 Key: ${s3Key}
Submitted: ${applicationData.submittedAtEST} EST`;

        await ses.send(new SendEmailCommand({
          Destination: { ToAddresses: [NOTIFICATION_EMAIL] },
          Message: {
            Subject: { Data: `New Application: ${formData.name} - ${formData.industry}` },
            Body: { Text: { Data: emailBody } }
          },
          Source: NOTIFICATION_EMAIL
        }));
        console.log('Email notification sent');
      } catch (emailError) {
        console.error('Email notification failed:', emailError.message);
        // Don't fail the request if email fails
      }
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

// ==================== API ENDPOINTS ====================

// Chat endpoint
app.post('/api/chat', async (req, res) => {
  try {
    const { action, messages, visitorInfo = {}, password, s3Key, status, reviewNotes, jobId } = req.body;
    const clientIP = req.ip || 'localhost';

    // ========== FORM VALIDATION MODE ==========
    // Handle direct form validation (AI agent validates core fields)
    if (req.body.mode === 'validate' && req.body.formData) {
      const result = await handleFormValidation(req.body.formData, visitorInfo, clientIP);
      if (result.success) {
        return res.json(result);
      } else if (result.error && !result.fields) {
        return res.status(500).json(result);
      } else {
        return res.status(400).json(result);
      }
    }

    // Admin Login
    if (action === 'admin-login') {
      if (password === ADMIN_PASSWORD) {
        return res.json({ success: true, message: 'Login successful' });
      }
      return res.status(401).json({ success: false, error: 'Invalid password' });
    }

    // Admin List Applications
    if (action === 'admin-list') {
      if (password !== ADMIN_PASSWORD) {
        return res.status(401).json({ success: false, error: 'Unauthorized' });
      }
      const applications = await listApplications();
      return res.json({ success: true, applications });
    }

    // Admin Update Status
    if (action === 'admin-update') {
      if (password !== ADMIN_PASSWORD) {
        return res.status(401).json({ success: false, error: 'Unauthorized' });
      }
      const updatedApp = await updateApplicationStatus(s3Key, status, reviewNotes);
      return res.json({ success: true, application: updatedApp });
    }

    // Admin Get Progress
    if (action === 'admin-progress') {
      if (password !== ADMIN_PASSWORD) {
        return res.status(401).json({ success: false, error: 'Unauthorized' });
      }
      try {
        const progressResult = await s3.send(new GetObjectCommand({
          Bucket: S3_BUCKET,
          Key: `progress/${jobId}.json`
        }));
        const progressData = JSON.parse(await progressResult.Body.transformToString());
        return res.json({ success: true, progress: progressData });
      } catch {
        return res.status(404).json({ success: false, error: 'Progress not found' });
      }
    }

    // Admin List Chat Sessions
    if (action === 'admin-chats') {
      if (password !== ADMIN_PASSWORD) {
        return res.status(401).json({ success: false, error: 'Unauthorized' });
      }
      const sessions = await listChatSessions(req.body.source || 'all', req.body.limit || 50);
      return res.json({ success: true, sessions });
    }

    // Admin List Client Profiles
    if (action === 'admin-clients') {
      if (password !== ADMIN_PASSWORD) {
        return res.status(401).json({ success: false, error: 'Unauthorized' });
      }
      const clients = await listClientProfiles(req.body.limit || 50);
      return res.json({ success: true, clients });
    }

    // Admin List Build History
    if (action === 'admin-builds') {
      if (password !== ADMIN_PASSWORD) {
        return res.status(401).json({ success: false, error: 'Unauthorized' });
      }
      const builds = await listBuildHistory(req.body.limit || 50);
      return res.json({ success: true, builds });
    }

    // Admin Get Chat Session Detail
    if (action === 'admin-chat-detail') {
      if (password !== ADMIN_PASSWORD) {
        return res.status(401).json({ success: false, error: 'Unauthorized' });
      }
      const { sessionId, source } = req.body;
      const prefixes = source ? [`chats/${source}/`] : ['chats/landing/', 'chats/apply/'];
      for (const prefix of prefixes) {
        try {
          const result = await s3.send(new GetObjectCommand({ Bucket: S3_BUCKET, Key: `${prefix}${sessionId}.json` }));
          return res.json({ success: true, session: JSON.parse(await result.Body.transformToString()) });
        } catch {}
      }
      return res.status(404).json({ success: false, error: 'Session not found' });
    }

    // Admin Get Client Profile Detail
    if (action === 'admin-client-detail') {
      if (password !== ADMIN_PASSWORD) {
        return res.status(401).json({ success: false, error: 'Unauthorized' });
      }
      try {
        const result = await s3.send(new GetObjectCommand({ Bucket: S3_BUCKET, Key: `clients/${req.body.clientId}.json` }));
        return res.json({ success: true, client: JSON.parse(await result.Body.transformToString()) });
      } catch {
        return res.status(404).json({ success: false, error: 'Client not found' });
      }
    }

    // Admin Get Build Detail with Agent Log
    if (action === 'admin-build-detail') {
      if (password !== ADMIN_PASSWORD) {
        return res.status(401).json({ success: false, error: 'Unauthorized' });
      }
      try {
        const metadataResult = await s3.send(new GetObjectCommand({ Bucket: S3_BUCKET, Key: `builds/${req.body.buildId}/metadata.json` }));
        const metadata = JSON.parse(await metadataResult.Body.transformToString());
        let agentLog = null;
        try {
          const logResult = await s3.send(new GetObjectCommand({ Bucket: S3_BUCKET, Key: `builds/${req.body.buildId}/agent-log.json` }));
          agentLog = JSON.parse(await logResult.Body.transformToString());
        } catch {}
        return res.json({ success: true, build: { ...metadata, agentLog } });
      } catch {
        return res.status(404).json({ success: false, error: 'Build not found' });
      }
    }

    // Admin Restart Failed Build
    if (action === 'admin-restart-build') {
      if (password !== ADMIN_PASSWORD) {
        return res.status(401).json({ success: false, error: 'Unauthorized' });
      }
      try {
        const buildId = req.body.buildId;

        // Get original build metadata
        const metadataResult = await s3.send(new GetObjectCommand({
          Bucket: S3_BUCKET,
          Key: `builds/${buildId}/metadata.json`
        }));
        const metadata = JSON.parse(await metadataResult.Body.transformToString());

        if (metadata.status !== 'failed') {
          return res.status(400).json({ success: false, error: 'Can only restart failed builds' });
        }

        // Create a new job with the same data
        const newJobId = `job-${Date.now()}-retry`;
        const newJobData = {
          jobId: newJobId,
          originalJobId: buildId,
          createdAt: new Date().toISOString(),
          createdAtEST: new Date().toLocaleString('en-US', { timeZone: 'America/New_York' }),
          status: 'pending',
          applicationS3Key: metadata.applicationId,
          client: metadata.client,
          business: metadata.business,
          preferences: {
            timeline: 'asap',
            techStack: 'threejs-gsap-tailwind',
            deployment: 'local'
          },
          retryOf: buildId,
          retryCount: (metadata.retryCount || 0) + 1
        };

        // Save new job to S3
        await s3.send(new PutObjectCommand({
          Bucket: S3_BUCKET,
          Key: `jobs/${newJobId}.json`,
          Body: JSON.stringify(newJobData, null, 2),
          ContentType: 'application/json'
        }));

        console.log(`🔄 Build restart: ${buildId} -> ${newJobId}`);

        return res.json({
          success: true,
          newJobId,
          message: 'Build job created. Worker will pick it up shortly.'
        });
      } catch (error) {
        console.error('Error restarting build:', error);
        return res.status(500).json({ success: false, error: error.message });
      }
    }

    // Trigger Build (direct from admin)
    if (action === 'trigger-build') {
      if (password !== ADMIN_PASSWORD) {
        return res.status(401).json({ success: false, error: 'Unauthorized' });
      }
      try {
        const s3Key = req.body.s3Key;
        const rebuild = req.body.rebuild || false;

        // Get application data
        const appResult = await s3.send(new GetObjectCommand({
          Bucket: S3_BUCKET,
          Key: s3Key
        }));
        const appData = JSON.parse(await appResult.Body.transformToString());

        // Create job
        const jobId = `job-${Date.now()}${rebuild ? '-rebuild' : ''}`;
        const jobData = {
          jobId,
          createdAt: new Date().toISOString(),
          createdAtEST: new Date().toLocaleString('en-US', { timeZone: 'America/New_York' }),
          status: 'pending',
          applicationS3Key: s3Key,
          client: {
            name: appData.visitorInfo?.name || 'Unknown',
            email: appData.visitorInfo?.email || '',
            phone: appData.visitorInfo?.phone || ''
          },
          business: {
            idea: appData.formData?.product_idea || appData.formData?.productIdea || '',
            industry: appData.formData?.industry || '',
            targetCustomer: appData.formData?.target_market || appData.formData?.targetMarket || ''
          },
          preferences: {
            timeline: 'asap',
            techStack: 'threejs-gsap-tailwind',
            deployment: 'local'
          },
          rebuild
        };

        await s3.send(new PutObjectCommand({
          Bucket: S3_BUCKET,
          Key: `jobs/${jobId}.json`,
          Body: JSON.stringify(jobData, null, 2),
          ContentType: 'application/json'
        }));

        console.log(`🚀 Build triggered: ${jobId} for ${s3Key}`);

        return res.json({
          success: true,
          jobId,
          message: 'Build job created. Worker will pick it up shortly.'
        });
      } catch (error) {
        console.error('Error triggering build:', error);
        return res.status(500).json({ success: false, error: error.message });
      }
    }

    // Cancel Build
    if (action === 'cancel-build') {
      if (password !== ADMIN_PASSWORD) {
        return res.status(401).json({ success: false, error: 'Unauthorized' });
      }
      try {
        const s3Key = req.body.s3Key;

        // Write cancel signal to S3 that worker will check
        await s3.send(new PutObjectCommand({
          Bucket: S3_BUCKET,
          Key: `signals/cancel-${s3Key.replace(/\//g, '_')}.json`,
          Body: JSON.stringify({
            s3Key,
            cancelledAt: new Date().toISOString(),
            reason: 'User cancelled from admin'
          }),
          ContentType: 'application/json'
        }));

        console.log(`⏹ Build cancel signal sent for: ${s3Key}`);

        return res.json({
          success: true,
          message: 'Cancel signal sent. Build will stop shortly.'
        });
      } catch (error) {
        console.error('Error cancelling build:', error);
        return res.status(500).json({ success: false, error: error.message });
      }
    }

    // Chat endpoint
    if (!messages || !Array.isArray(messages) || messages.length === 0) {
      return res.status(400).json({ error: 'Messages array is required' });
    }

    // Get or generate session ID for chat history tracking
    const sessionId = req.body.sessionId || generateSessionId();
    const chatSource = visitorInfo.page?.includes('apply') ? 'apply' : 'landing';

    // Extract contact info
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
      clientIP
    };

    const hasName = !!updatedVisitorInfo.name;
    const hasContact = !!(updatedVisitorInfo.phone || updatedVisitorInfo.email);
    const hasCompleteContactInfo = hasName && hasContact;

    // Check for form submission
    const latestMessage = messages[messages.length - 1]?.content || '';
    const isFormSubmission = latestMessage.includes('PARTNERSHIP APPLICATION SUBMISSION');

    if (isFormSubmission) {
      console.log('📋 Form submission detected');

      // Parse form data from the submission message
      const formLines = latestMessage.split('\n');
      const parsedFormData = {};
      for (const line of formLines) {
        if (line.includes(':')) {
          const colonIndex = line.indexOf(':');
          const key = line.substring(0, colonIndex).trim().toLowerCase().replace(/\s+/g, '_');
          const value = line.substring(colonIndex + 1).trim();
          if (key && value && !key.includes('submission')) {
            parsedFormData[key] = value;
          }
        }
      }

      // Extract fields for validation
      const formName = parsedFormData.full_name || parsedFormData.name || updatedVisitorInfo.name;
      const formEmail = parsedFormData.email || updatedVisitorInfo.email;
      const formProductIdea = parsedFormData.product_idea || parsedFormData['product/service_idea'] || parsedFormData.productidea;

      // Validate all fields
      const formValidationErrors = [];

      // Validate name
      if (formName) {
        const nameValidation = validateNamePatterns(formName);
        if (!nameValidation.valid) {
          formValidationErrors.push({ field: 'name', message: nameValidation.message });
          console.log('Name validation failed:', formName, nameValidation.reason);
        }
      }

      // Validate email
      if (formEmail) {
        const formEmailValidation = await validateEmail(formEmail);
        if (!formEmailValidation.valid) {
          formValidationErrors.push({ field: 'email', message: getEmailValidationMessage(formEmailValidation.reason) });
          console.log('Email validation failed:', formEmail, formEmailValidation.reason);
        }
      }

      // Validate product idea
      if (formProductIdea) {
        const ideaValidation = await validateProductIdea(formProductIdea);
        if (!ideaValidation.valid) {
          formValidationErrors.push({ field: 'productIdea', message: ideaValidation.message });
          console.log('Product idea validation failed:', formProductIdea, ideaValidation.reason);
        }
      }

      // If validation errors, return 400
      if (formValidationErrors.length > 0) {
        console.log('📋 Form validation failed:', formValidationErrors);
        return res.status(400).json({
          success: false,
          error: 'Validation failed',
          validationErrors: formValidationErrors,
          sessionId
        });
      }

      const s3Result = await saveFormToS3(updatedVisitorInfo, latestMessage, clientIP);

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

      return res.json({
        success: true,
        response: 'Thank you for your application! We will review it and get back to you within 24 hours.',
        provider: 'system',
        visitorInfo: updatedVisitorInfo,
        hasContactInfo: true,
        formSubmitted: true,
        s3Key: s3Result.key,
        sessionId
      });
    }

    // Build validation errors array for AI context
    const validationErrors = [];
    if (emailValidationError) {
      validationErrors.push(`Email validation failed: ${emailValidationError}`);
    }

    // Get AI response
    const response = await chatWithClaude(messages, hasCompleteContactInfo, validationErrors.length > 0 ? validationErrors : null);

    // Save chat session with AI response included
    const messagesWithResponse = [
      ...messages,
      { role: 'assistant', content: response.content, timestamp: new Date().toISOString() }
    ];
    const sessionResult = await saveChatSession(sessionId, chatSource, messagesWithResponse, updatedVisitorInfo);

    // Create/update client profile if we have contact info
    if (sessionResult.clientId && hasCompleteContactInfo) {
      await updateClientProfile(sessionResult.clientId, {
        ...updatedVisitorInfo,
        addChatSession: sessionId,
        timelineEvent: { event: 'chat_with_contact', ref: sessionId }
      });
    }

    return res.json({
      success: true,
      response: response.content,
      provider: response.provider,
      visitorInfo: updatedVisitorInfo,
      hasContactInfo: hasCompleteContactInfo,
      sessionId
    });

  } catch (error) {
    console.error('API Error:', error);
    res.status(500).json({ error: 'Failed to process request', message: error.message });
  }
});

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', mode: 'local', timestamp: new Date().toISOString() });
});

// ========== SCHEDULER ENDPOINTS ==========

// Get available slots for a month
app.post('/scheduler/slots', async (req, res) => {
  try {
    const { month, timezone } = req.body;

    if (!month || !/^\d{4}-\d{2}$/.test(month)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid month format. Use YYYY-MM'
      });
    }

    const [year, monthNum] = month.split('-').map(Number);
    const userTimezone = timezone || 'America/Chicago';

    // Generate all possible slots based on availability rules
    const possibleSlots = generatePossibleSlots(year, monthNum, userTimezone);

    // Get busy times from Google Calendar
    const calendar = await getGoogleCalendar();
    const timeMin = new Date(year, monthNum - 1, 1).toISOString();
    const timeMax = new Date(year, monthNum, 0, 23, 59, 59).toISOString();

    const freeBusyResponse = await calendar.freebusy.query({
      requestBody: {
        timeMin,
        timeMax,
        timeZone: SCHEDULER_CONFIG.timezone,
        items: [{ id: SCHEDULER_CONFIG.calendarId }]
      }
    });

    const busyPeriods = freeBusyResponse.data.calendars[SCHEDULER_CONFIG.calendarId]?.busy || [];

    // Subtract busy times from possible slots
    const availableSlots = subtractBusyTimes(possibleSlots, busyPeriods);

    return res.json({
      success: true,
      month,
      timezone: userTimezone,
      ceoTimezone: SCHEDULER_CONFIG.timezone,
      slotDuration: SCHEDULER_CONFIG.slotDuration,
      slots: availableSlots
    });

  } catch (error) {
    console.error('Scheduler slots error:', error);
    return res.status(500).json({
      success: false,
      error: 'Unable to fetch available slots. Please try again.'
    });
  }
});

// Book a scheduler slot
app.post('/scheduler/book', async (req, res) => {
  try {
    const { date, time, timezone, name, email, productIdea, notes } = req.body;

    // Validate required fields
    if (!date || !time || !name || !email) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields: date, time, name, email'
      });
    }

    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid email format'
      });
    }

    // Validate date format (YYYY-MM-DD)
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return res.status(400).json({
        success: false,
        error: 'invalid_date',
        message: 'Invalid date format. Use YYYY-MM-DD'
      });
    }

    // Validate time format (HH:MM)
    if (!/^\d{2}:\d{2}$/.test(time)) {
      return res.status(400).json({
        success: false,
        error: 'invalid_time',
        message: 'Invalid time format. Use HH:MM'
      });
    }

    const calendar = await getGoogleCalendar();

    // Convert selected time to CEO's timezone for the event
    const userTimezone = timezone || 'America/Chicago';
    const slotStart = new Date(`${date}T${time}:00`);
    const slotEnd = new Date(slotStart.getTime() + SCHEDULER_CONFIG.slotDuration * 60 * 1000);

    // Prevent booking past slots
    if (slotStart <= new Date()) {
      return res.status(400).json({
        success: false,
        error: 'past_slot',
        message: 'Cannot book a time slot in the past'
      });
    }

    // Validate slot is within allowed days and hours
    const dayOfWeek = slotStart.getDay();
    const hour = slotStart.getHours();

    if (!SCHEDULER_CONFIG.availableDays.includes(dayOfWeek)) {
      return res.status(400).json({
        success: false,
        error: 'invalid_day',
        message: 'Bookings are only available Monday through Friday'
      });
    }

    if (hour < SCHEDULER_CONFIG.startHour || hour >= SCHEDULER_CONFIG.endHour) {
      return res.status(400).json({
        success: false,
        error: 'invalid_hour',
        message: `Bookings are only available between ${SCHEDULER_CONFIG.startHour}:00 and ${SCHEDULER_CONFIG.endHour}:00`
      });
    }

    // Re-verify slot is still available (prevent race conditions)
    const freeBusyResponse = await calendar.freebusy.query({
      requestBody: {
        timeMin: slotStart.toISOString(),
        timeMax: slotEnd.toISOString(),
        timeZone: SCHEDULER_CONFIG.timezone,
        items: [{ id: SCHEDULER_CONFIG.calendarId }]
      }
    });

    const busyPeriods = freeBusyResponse.data.calendars[SCHEDULER_CONFIG.calendarId]?.busy || [];
    if (busyPeriods.length > 0) {
      return res.status(409).json({
        success: false,
        error: 'slot_unavailable',
        message: 'This time slot is no longer available. Please select another time.'
      });
    }

    // Build event description
    let description = `Introduction call with ${name}\n\nEmail: ${email}`;
    if (productIdea) {
      description += `\n\nProduct Idea:\n${productIdea}`;
    }
    if (notes) {
      description += `\n\nAdditional Notes:\n${notes}`;
    }

    // Create Google Calendar event with Google Meet
    const event = {
      summary: `CoCreate Introduction - ${name}`,
      description,
      start: {
        dateTime: slotStart.toISOString(),
        timeZone: SCHEDULER_CONFIG.timezone
      },
      end: {
        dateTime: slotEnd.toISOString(),
        timeZone: SCHEDULER_CONFIG.timezone
      },
      attendees: [{ email }],
      conferenceData: {
        createRequest: {
          requestId: `cocreate-${Date.now()}`,
          conferenceSolutionKey: { type: 'hangoutsMeet' }
        }
      },
      reminders: {
        useDefault: false,
        overrides: [
          { method: 'email', minutes: 60 },
          { method: 'popup', minutes: 15 }
        ]
      }
    };

    const createdEvent = await calendar.events.insert({
      calendarId: SCHEDULER_CONFIG.calendarId,
      requestBody: event,
      conferenceDataVersion: 1,
      sendUpdates: 'all'
    });

    // Extract Meet link
    const meetLink = createdEvent.data.conferenceData?.entryPoints?.find(
      ep => ep.entryPointType === 'video'
    )?.uri;

    console.log('Meeting booked:', {
      eventId: createdEvent.data.id,
      name,
      email,
      date,
      time,
      meetLink
    });

    // Format endTime as HH:MM
    const endTime = slotEnd.toTimeString().slice(0, 5);

    return res.json({
      success: true,
      booking: {
        eventId: createdEvent.data.id,
        title: event.summary,
        date,
        time,
        endTime,
        duration: `${SCHEDULER_CONFIG.slotDuration} minutes`,
        timezone: timezone || SCHEDULER_CONFIG.timezone,
        meetLink,
        htmlLink: createdEvent.data.htmlLink
      }
    });

  } catch (error) {
    console.error('Scheduler booking error:', error);
    return res.status(500).json({
      success: false,
      error: 'Unable to book the meeting. Please try again.'
    });
  }
});

// Start server
app.listen(PORT, () => {
  console.log('');
  console.log('🚀 CoCreate AI - Local Development Server');
  console.log('================================================');
  console.log(`   Site:      http://localhost:${PORT}/`);
  console.log(`   Apply:     http://localhost:${PORT}/apply.html`);
  console.log(`   Schedule:  http://localhost:${PORT}/schedule.html`);
  console.log(`   Admin:     http://localhost:${PORT}/admin.html`);
  console.log(`   API:       http://localhost:${PORT}/api/chat`);
  console.log(`   Scheduler: http://localhost:${PORT}/scheduler/slots`);
  console.log(`   Builds:    http://localhost:${PORT}/builds/`);
  console.log('');
  console.log('   S3 Bucket:', S3_BUCKET);
  console.log('   Skip Email:', SKIP_EMAIL);
  console.log('   Google Calendar:', GOOGLE_SERVICE_ACCOUNT_EMAIL ? 'Configured' : 'Not configured');
  console.log('');
});
