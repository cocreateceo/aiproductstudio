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
import crypto from 'crypto';
import { handleAdminCostsSummary, handleUserCosts } from './costs/index.mjs';
import { handleScheduledCostReports, handleManualCostReportTrigger, handleSendAdminSummaryReport, computeAdminSummaryData } from './costs/email-reports.mjs';
import { handleAwsCostSummary, handleAwsCostDaily, handleAwsCostDailyByService, handleAwsCostForecast, handleAwsCostServiceDetail, handleAwsProjectCosts, handleAwsProjectCostsDynamic, handleAwsCostDailyByProject, handleAwsUnusedResources, handleAwsDeleteResource, handleAwsS3Browse, handleAwsS3Delete, handleAwsS3Analysis, handleAwsActivityLog, handleAwsActivityEmailReport, handleAwsCostDashboardBatch, handleAwsCostStorageBatch } from './aws-costs/index.mjs';

// Shared lib imports (Phase 1 refactor)
import { ANTHROPIC_API_KEY, OPENAI_API_KEY, NOTIFICATION_EMAIL, CLAUDE_MODEL, OPENAI_MODEL, LLM_PRICING, S3_BUCKET, S3_REGION, REFERRAL_CODES, SYSTEM_PROMPT } from './lib/config.mjs';
import { getS3 } from './lib/aws.mjs';
import { CORS, corsHeaders, respond } from './lib/http.mjs';
import { generateSessionId, generateClientId } from './lib/ids.mjs';
import { resolveReferral } from './lib/referral.mjs';
import { sendEmail, extractContactInfoWithLLM, extractTextFromPDF, extractTextFromDOCX, processAttachments, chatWithClaude, chatWithOpenAI } from './domains/chat.mjs';
import { getOrCreateClientProfile, updateClientProfile, listClientProfiles } from './domains/clients.mjs';
import { saveChatSession, saveSessionLookup, lookupSessionByContact, linkSessionToApplication, listChatSessions } from './domains/sessions.mjs';

import { EMAIL_CONFIG, ADMIN_EMAILS, renderAdminNewApplication, renderApplicantAcknowledgment, renderApplicantApproved, renderApplicantRejected, renderUserWelcome, renderPasswordResetLink, renderPasswordChanged, renderNewLoginAlert, renderProjectDeployed, renderBuildFailedUser, renderBuildFailedAdmin, renderAccountDeactivated, renderSessionExpiryReminder, renderWeeklyDigest, renderReEngagement, renderEventRegistrationConfirmation, renderEventRegistrationAdminNotification } from './email-templates.mjs';
import { sendTemplatedEmail, sendToAdmins, sendTemplate, sendTemplateToAdmins, isResetRateLimited } from './email-service.mjs';

// Initialize Anthropic client
const anthropic = new Anthropic({
  apiKey: ANTHROPIC_API_KEY,
});

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

// List all builds with history (for admin)
async function listBuildHistory(limit = 50) {
  const { ListObjectsV2Command, GetObjectCommand } = await import('@aws-sdk/client-s3');
  const s3 = getS3();

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
  const { ListObjectsV2Command, GetObjectCommand } = await import('@aws-sdk/client-s3');
  const s3 = getS3();

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
  const { PutObjectCommand } = await import('@aws-sdk/client-s3');
  const s3 = getS3();

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
  const { GetObjectCommand, PutObjectCommand } = await import('@aws-sdk/client-s3');
  const s3 = getS3();

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
  const { PutObjectCommand } = await import('@aws-sdk/client-s3');
  const s3 = getS3();

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
  const { ListObjectsV2Command, GetObjectCommand } = await import('@aws-sdk/client-s3');
  const s3 = getS3();

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
  const { GetObjectCommand, PutObjectCommand } = await import('@aws-sdk/client-s3');
  const s3 = getS3();

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
  const { PutObjectCommand } = await import('@aws-sdk/client-s3');
  const s3 = getS3();

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

    const { ListObjectsV2Command, PutObjectCommand } = await import('@aws-sdk/client-s3');
    const s3 = getS3();

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

    // Resolve referral code (if any) to known partner — attribution stays internal.
    const referral = resolveReferral(formData.referralCode);
    if (referral) {
      console.log('Referral applied:', referral.code, '→', referral.referredBy);
    } else if (formData.referralCode) {
      console.log('Unknown referral code submitted:', formData.referralCode);
    }

    const applicationData = {
      submittedAt: timestamp,
      submittedAtEST: new Date().toLocaleString('en-US', { timeZone: 'America/New_York' }),
      status: 'pending',
      source: referral ? `referral:${referral.code}` : 'direct-form',
      referral: referral || null,
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
        source: referral ? `Referral (${referral.referredBy} · ${referral.code})` : 'Direct Form',
        referral: referral || null,
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

// Computes the active Saturday's eventId in America/Chicago.
// Mirrors /event.html: if Sat before 11 AM CT, today; otherwise upcoming Saturday.
function currentWeekEventId() {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Chicago',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', hour12: false, weekday: 'short'
  }).formatToParts(new Date());
  const get = (t) => parts.find(p => p.type === t).value;
  const year = +get('year'), month = +get('month'), day = +get('day');
  const hour = +get('hour') % 24;
  const weekday = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].indexOf(get('weekday'));
  let satOffset;
  if (weekday === 6 && hour < 11) satOffset = 0;
  else if (weekday === 6) satOffset = 7;
  else satOffset = (6 - weekday + 7) % 7;
  const d = new Date(Date.UTC(year, month - 1, day + satOffset));
  return 'build-product-2hrs-' + d.toISOString().slice(0, 10);
}

// Weekly "Build Your Product in 2 Hours" event resolver.
// Accepts eventId = "build-product-2hrs-YYYY-MM-DD" where the date is a Saturday.
// Static workshop details — only the date varies week to week.
function resolveWeeklyEvent(eventId) {
  if (typeof eventId !== 'string') return null;
  const match = eventId.match(/^build-product-2hrs-(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  const [, y, m, d] = match;
  const year = +y, month = +m, day = +d;
  const dt = new Date(Date.UTC(year, month - 1, day));
  if (dt.getUTCFullYear() !== year || dt.getUTCMonth() !== month - 1 || dt.getUTCDate() !== day) return null;
  if (dt.getUTCDay() !== 6) return null; // must be Saturday
  const dateLabel = dt.toLocaleDateString('en-US', {
    weekday: 'long', month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC'
  });
  return {
    title: 'Build Your Product in Less Than 2 Hours',
    date: dateLabel,                                        // e.g. "Saturday, April 25, 2026"
    time: '9:00 AM - 11:00 AM CST (Chicago)',
    zoomLink: 'https://us06web.zoom.us/j/2245204604?pwd=Yk9ReE42K080LzRoUXBPdzFNRFlvUT09',
    zoomMeetingId: '224 520 4604',
    zoomPasscode: '1234',
  };
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
        const { GetObjectCommand } = await import('@aws-sdk/client-s3');
        const s3 = getS3();

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

    // ========== EVENT REGISTRATION ==========
    if (action === 'event-register') {
      try {
        const { name, email, phone, productIdea, eventId } = body;

        if (!name || !email) {
          return {
            statusCode: 400,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            body: JSON.stringify({ success: false, error: 'Name and email are required' })
          };
        }

        // Event configuration (timezone: America/Chicago)
        // eventId format: build-product-2hrs-YYYY-MM-DD (must be a Saturday)
        // Static workshop details; only the date varies week to week.
        const eventConfig = resolveWeeklyEvent(eventId);
        if (!eventConfig) {
          return {
            statusCode: 400,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            body: JSON.stringify({ success: false, error: 'Invalid event' })
          };
        }

        const { PutObjectCommand, ListObjectsV2Command } = await import('@aws-sdk/client-s3');
        const s3 = getS3();

        // ── Store registration in S3 ──
        const timestamp = new Date().toISOString();
        const registrationData = {
          name, email, phone, productIdea, eventId,
          registeredAt: timestamp,
          ip: clientIP,
        };

        const s3Key = `events/${eventId}/registrations/${email.toLowerCase().replace(/[^a-z0-9]/g, '_')}.json`;
        await s3.send(new PutObjectCommand({
          Bucket: S3_BUCKET,
          Key: s3Key,
          Body: JSON.stringify(registrationData, null, 2),
          ContentType: 'application/json',
        }));

        // Count total registrations
        let totalRegistrations = 'N/A';
        try {
          const listResult = await s3.send(new ListObjectsV2Command({
            Bucket: S3_BUCKET,
            Prefix: `events/${eventId}/registrations/`,
          }));
          totalRegistrations = String(listResult.KeyCount || 0);
        } catch (e) { /* ignore count errors */ }

        // ── Send confirmation email with Zoom link ──
        const confirmationEmail = renderEventRegistrationConfirmation({
          name, email,
          eventTitle: eventConfig.title,
          eventDate: eventConfig.date,
          eventTime: eventConfig.time,
          zoomLink: eventConfig.zoomLink,
          zoomMeetingId: eventConfig.zoomMeetingId,
          zoomPasscode: eventConfig.zoomPasscode,
        });

        await sendTemplatedEmail(
          email,
          confirmationEmail.subject,
          confirmationEmail.html,
          confirmationEmail.text
        );

        // ── Notify admins ──
        const adminEmail = renderEventRegistrationAdminNotification({
          name, email, phone, productIdea,
          eventTitle: eventConfig.title,
          eventId,
          totalRegistrations,
        });

        await sendToAdmins(
          adminEmail.subject,
          adminEmail.html,
          adminEmail.text
        );

        return {
          statusCode: 200,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          body: JSON.stringify({ success: true, message: 'Registration successful' })
        };
      } catch (error) {
        console.error('Event registration error:', error);
        return {
          statusCode: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          body: JSON.stringify({ success: false, error: 'Registration failed. Please try again.' })
        };
      }
    }

    // ========== LIST EVENT REGISTRATIONS (Admin) ==========
    if (action === 'event-list-registrations') {
      try {
        const { password, eventId } = body;
        if (password !== ADMIN_PASSWORD) {
          return {
            statusCode: 401,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            body: JSON.stringify({ success: false, error: 'Unauthorized' })
          };
        }

        const targetEventId = eventId || currentWeekEventId();
        const { ListObjectsV2Command, GetObjectCommand } = await import('@aws-sdk/client-s3');
        const s3 = getS3();

        const prefix = `events/${targetEventId}/registrations/`;
        const listResult = await s3.send(new ListObjectsV2Command({
          Bucket: S3_BUCKET,
          Prefix: prefix,
        }));

        const registrations = [];
        if (listResult.Contents) {
          for (const obj of listResult.Contents) {
            try {
              const data = await s3.send(new GetObjectCommand({
                Bucket: S3_BUCKET,
                Key: obj.Key,
              }));
              const record = JSON.parse(await data.Body.transformToString());
              registrations.push(record);
            } catch (e) { /* skip bad records */ }
          }
        }

        // Sort by registration time (newest first)
        registrations.sort((a, b) => new Date(b.registeredAt) - new Date(a.registeredAt));

        return {
          statusCode: 200,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            success: true,
            eventId: targetEventId,
            total: registrations.length,
            registrations
          })
        };
      } catch (error) {
        console.error('Event list error:', error);
        return {
          statusCode: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          body: JSON.stringify({ success: false, error: 'Failed to load registrations' })
        };
      }
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
      const { GetObjectCommand } = await import('@aws-sdk/client-s3');
      const s3 = getS3();
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
        const { GetObjectCommand } = await import('@aws-sdk/client-s3');
        const s3 = getS3();

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
        const { GetObjectCommand, PutObjectCommand } = await import('@aws-sdk/client-s3');
        const bcrypt = (await import('bcryptjs')).default;
        const s3 = getS3();

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
        const { GetObjectCommand, PutObjectCommand } = await import('@aws-sdk/client-s3');
        const bcrypt = (await import('bcryptjs')).default;
        const s3 = getS3();

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

        const { GetObjectCommand } = await import('@aws-sdk/client-s3');
        const s3 = getS3();

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
        const s3 = getS3();

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

        const { GetObjectCommand, PutObjectCommand } = await import('@aws-sdk/client-s3');
        const s3 = getS3();

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

        const { GetObjectCommand, PutObjectCommand } = await import('@aws-sdk/client-s3');
        const bcrypt = (await import('bcryptjs')).default;
        const s3 = getS3();

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

        const { GetObjectCommand, PutObjectCommand } = await import('@aws-sdk/client-s3');
        const crypto = await import('crypto');
        const s3 = getS3();

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
        const { GetObjectCommand, PutObjectCommand, DeleteObjectCommand } = await import('@aws-sdk/client-s3');
        const bcrypt = (await import('bcryptjs')).default;
        const s3 = getS3();

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
        const { GetObjectCommand } = await import('@aws-sdk/client-s3');
        const s3 = getS3();

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
        const { GetObjectCommand } = await import('@aws-sdk/client-s3');
        const s3 = getS3();

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
        const { GetObjectCommand } = await import('@aws-sdk/client-s3');
        const s3 = getS3();

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
        const { GetObjectCommand, PutObjectCommand } = await import('@aws-sdk/client-s3');
        const s3 = getS3();

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
        const { DeleteObjectCommand } = await import('@aws-sdk/client-s3');
        const s3 = getS3();

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
        const { GetObjectCommand, PutObjectCommand } = await import('@aws-sdk/client-s3');
        const s3 = getS3();

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
        const { ListObjectsV2Command, GetObjectCommand } = await import('@aws-sdk/client-s3');
        const s3 = getS3();

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
        const { GetObjectCommand } = await import('@aws-sdk/client-s3');
        const s3 = getS3();

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
        const { GetObjectCommand } = await import('@aws-sdk/client-s3');
        const s3 = getS3();

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

// Exposed for the routing test (populated by the registry in a later refactor task).
export const ROUTES = {};
