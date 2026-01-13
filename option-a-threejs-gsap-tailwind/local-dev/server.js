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
import Anthropic from '@anthropic-ai/sdk';
import { S3Client, PutObjectCommand, GetObjectCommand, ListObjectsV2Command } from '@aws-sdk/client-s3';
import { SESClient, SendEmailCommand } from '@aws-sdk/client-ses';
import { fromIni } from '@aws-sdk/credential-providers';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load environment variables
dotenv.config({ path: path.join(__dirname, '.env') });

const app = express();
const PORT = process.env.PORT || 5000;

// Configuration
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const S3_BUCKET = process.env.S3_BUCKET || 'ai-product-studio-applications';
const S3_REGION = process.env.AWS_REGION || 'ap-south-1';
const NOTIFICATION_EMAIL = process.env.NOTIFICATION_EMAIL || 'gopi@sunwaretechnologies.com';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'aiproductstudio2026';
const SKIP_EMAIL = process.env.SKIP_EMAIL === 'true'; // Skip emails in local dev
const AWS_PROFILE = process.env.AWS_PROFILE || 'sunwaretech';
const SES_REGION = process.env.SES_REGION || 'us-east-1';

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
async function chatWithClaude(messages, hasContactInfo) {
  let contextualPrompt = SYSTEM_PROMPT;
  if (hasContactInfo) {
    contextualPrompt += '\n\n## Current Status: Contact info collected. Provide helpful detailed answers.';
  } else {
    contextualPrompt += '\n\n## Current Status: NO CONTACT INFO YET. Ask for name and phone/email first!';
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

// ==================== API ENDPOINTS ====================

// Chat endpoint
app.post('/api/chat', async (req, res) => {
  try {
    const { action, messages, visitorInfo = {}, password, s3Key, status, reviewNotes, jobId } = req.body;
    const clientIP = req.ip || 'localhost';

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
    const updatedVisitorInfo = {
      ...visitorInfo,
      ...(extractedInfo.name && { name: extractedInfo.name }),
      ...(extractedInfo.email && { email: extractedInfo.email }),
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

    // Get AI response
    const response = await chatWithClaude(messages, hasCompleteContactInfo);

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

// Start server
app.listen(PORT, () => {
  console.log('');
  console.log('🚀 AI Product Studio - Local Development Server');
  console.log('================================================');
  console.log(`   Site:    http://localhost:${PORT}/`);
  console.log(`   Apply:   http://localhost:${PORT}/apply.html`);
  console.log(`   Admin:   http://localhost:${PORT}/admin.html`);
  console.log(`   API:     http://localhost:${PORT}/api/chat`);
  console.log(`   Builds:  http://localhost:${PORT}/builds/`);
  console.log('');
  console.log('   S3 Bucket:', S3_BUCKET);
  console.log('   Skip Email:', SKIP_EMAIL);
  console.log('');
});
