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
import { listBuildHistory, createBuildJob } from './domains/builds.mjs';
import { currentWeekEventId, resolveWeeklyEvent } from './domains/events.mjs';
import { sendFormSubmissionEmail, sendApplicantConfirmationEmail, checkDuplicateApplication, saveAbandonedForm, syncLocalStorageToS3, saveFormToS3, listApplications, updateApplicationStatus, handleFormValidation } from './domains/applications.mjs';
import { handleUserCheck, handleUserSignup, handleUserLogin, handleUserDashboard, handleUploadAvatar, handleSaveTheme, handleUserChangePassword, handleForgotPassword, handleResetPassword } from './domains/users.mjs';
import { handleAdminLogin, handleAdminList, handleAdminUpdate, handleAdminProgress, handleAdminChats, handleAdminClients, handleAdminBuilds, handleAdminChatDetail, handleAdminClientDetail, handleAdminBuildDetail, handleAdminDeleteChats, handleUpdateBuildStatus, handleGetAdminSummary } from './domains/admin.mjs';

// Route maps (action → handler) from each domain module
import { routes as sessionRoutes } from './domains/sessions.mjs';
import { routes as applicationRoutes } from './domains/applications.mjs';
import { routes as eventRoutes } from './domains/events.mjs';
import { routes as userRoutes } from './domains/users.mjs';
import { routes as adminRoutes } from './domains/admin.mjs';
import { routes as miscRoutes } from './domains/misc.mjs';

import { EMAIL_CONFIG, ADMIN_EMAILS, renderAdminNewApplication, renderApplicantAcknowledgment, renderApplicantApproved, renderApplicantRejected, renderUserWelcome, renderPasswordResetLink, renderPasswordChanged, renderNewLoginAlert, renderProjectDeployed, renderBuildFailedUser, renderBuildFailedAdmin, renderAccountDeactivated, renderSessionExpiryReminder, renderWeeklyDigest, renderReEngagement, renderEventRegistrationConfirmation, renderEventRegistrationAdminNotification } from './email-templates.mjs';
import { sendTemplatedEmail, sendToAdmins, sendTemplate, sendTemplateToAdmins, isResetRateLimited } from './email-service.mjs';

// Admin password (simple auth for now)
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'aiproductstudio2026';

// ---------------------------------------------------------------------------
// Cost / AWS delegation routes.
// Each entry mirrors EXACTLY how the former inline `if (action===...)` block
// invoked its imported handler (same args, same return — direct, not wrapped).
// ---------------------------------------------------------------------------
const costRoutes = {
  // ── User / admin cost summaries (costs/index.mjs, costs/email-reports.mjs) ──
  'admin-costs-summary': (body, event) => handleAdminCostsSummary({ body, corsHeaders, S3_REGION, ADMIN_PASSWORD, listApplications }),
  'user-costs': (body, event) => handleUserCosts({ body, corsHeaders, S3_REGION, listApplications }),
  'send-cost-reports': (body, event) => handleManualCostReportTrigger({ body, corsHeaders, S3_REGION, ADMIN_PASSWORD, listApplications }),
  'send-all-reports': (body, event) => {
    body.reportType = body.period || 'weekly';
    return handleManualCostReportTrigger({ body, corsHeaders, S3_REGION, ADMIN_PASSWORD, listApplications });
  },
  'send-admin-report': (body, event) => handleSendAdminSummaryReport({ body, corsHeaders, S3_REGION, ADMIN_PASSWORD, listApplications }),

  // ── AWS Batch endpoints (merged calls for dashboard performance) ──
  'aws-cost-dashboard-batch': (body, event) => handleAwsCostDashboardBatch({ body, corsHeaders, ADMIN_PASSWORD }),
  'aws-cost-storage-batch': (body, event) => handleAwsCostStorageBatch({ body, corsHeaders, ADMIN_PASSWORD }),

  // ── AWS account-wide cost endpoints (aws-costs/index.mjs) ──
  'aws-cost-summary': (body, event) => handleAwsCostSummary({ body, corsHeaders, ADMIN_PASSWORD }),
  'aws-cost-daily': (body, event) => handleAwsCostDaily({ body, corsHeaders, ADMIN_PASSWORD }),
  'aws-cost-daily-by-service': (body, event) => handleAwsCostDailyByService({ body, corsHeaders, ADMIN_PASSWORD }),
  'aws-cost-forecast': (body, event) => handleAwsCostForecast({ body, corsHeaders, ADMIN_PASSWORD }),
  'aws-cost-service-detail': (body, event) => handleAwsCostServiceDetail({ body, corsHeaders, ADMIN_PASSWORD }),
  'aws-project-costs': (body, event) => handleAwsProjectCosts({ body, corsHeaders, ADMIN_PASSWORD }),
  'aws-project-costs-dynamic': (body, event) => handleAwsProjectCostsDynamic({ body, corsHeaders, ADMIN_PASSWORD }),
  'aws-cost-daily-by-project': (body, event) => handleAwsCostDailyByProject({ body, corsHeaders, ADMIN_PASSWORD }),
  'aws-unused-resources': (body, event) => handleAwsUnusedResources({ body, corsHeaders, ADMIN_PASSWORD }),
  'aws-delete-resource': (body, event) => handleAwsDeleteResource({ body, corsHeaders, ADMIN_PASSWORD }),
  'aws-s3-browse': (body, event) => handleAwsS3Browse({ body, corsHeaders, ADMIN_PASSWORD }),
  'aws-s3-delete': (body, event) => handleAwsS3Delete({ body, corsHeaders, ADMIN_PASSWORD }),
  'aws-s3-analysis': (body, event) => handleAwsS3Analysis({ body, corsHeaders, ADMIN_PASSWORD }),
  'aws-activity-log': (body, event) => handleAwsActivityLog({ body, corsHeaders, ADMIN_PASSWORD }),
  'aws-activity-email-report': (body, event) => handleAwsActivityEmailReport({ body, corsHeaders, ADMIN_PASSWORD }),
};

// Merged action → handler registry. Each handler is invoked as fn(body, event).
const ROUTES_REGISTRY = {
  ...sessionRoutes,
  ...applicationRoutes,
  ...eventRoutes,
  ...userRoutes,
  ...adminRoutes,
  ...miscRoutes,
  ...costRoutes,
};

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

    // ========== REGISTRY DISPATCH (all 55 named actions) ==========
    // Every `action === 'X'` branch is now a registry entry. The default
    // (no/unknown action) chat path continues below this block, unchanged.
    if (action) {
      const fn = ROUTES_REGISTRY[action];
      if (fn) {
        try {
          return await fn(body, event);
        } catch (err) {
          console.error(`[${action}]`, err);
          return respond({ error: err.message || 'internal error' }, 500);
        }
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

// Exposed for the routing test — the merged action → handler registry.
export const ROUTES = ROUTES_REGISTRY;
