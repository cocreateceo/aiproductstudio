// domains/applications.mjs — extracted from index.mjs (Phase 2 refactor)
import Anthropic from '@anthropic-ai/sdk';
import crypto from 'crypto';
import { ANTHROPIC_API_KEY, CLAUDE_MODEL, S3_BUCKET } from '../lib/config.mjs';
import { getS3 } from '../lib/aws.mjs';
import { corsHeaders } from '../lib/http.mjs';
import { resolveReferral } from '../lib/referral.mjs';
import { renderAdminNewApplication, renderApplicantAcknowledgment } from '../email-templates.mjs';
import { sendTemplatedEmail, sendToAdmins, sendTemplate, sendTemplateToAdmins } from '../email-service.mjs';
import { createBuildJob } from './builds.mjs';

const anthropic = new Anthropic({
  apiKey: ANTHROPIC_API_KEY,
});

// Send Form Submission Email via AWS SES
export async function sendFormSubmissionEmail(visitorInfo, formContent, clientIP) {
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
export async function sendApplicantConfirmationEmail(visitorInfo, formContent) {
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

// Check for duplicate application by email or phone
export async function checkDuplicateApplication(email, phone) {
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
export async function saveAbandonedForm(sessionId, formData, chatState, visitorInfo, clientIP, reason) {
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
export async function syncLocalStorageToS3(sessionId, chatState, visitorInfo, clientIP) {
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
export async function saveFormToS3(visitorInfo, formContent, clientIP) {
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

// List all applications from S3
export async function listApplications() {
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
export async function updateApplicationStatus(s3Key, newStatus, reviewNotes = '') {
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
export async function handleFormValidation(formData, visitorInfo, clientIP) {
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

// ---------------------------------------------------------------------------
// handleCheckDuplicate — action 'check-duplicate'
// Called by frontend when email is first collected (before form fill)
// ---------------------------------------------------------------------------
export async function handleCheckDuplicate(body, event) {
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

// ---------------------------------------------------------------------------
// handleSaveAbandonedForm — action 'save-abandoned-form'
// Called when user leaves page without submitting (beforeunload)
// ---------------------------------------------------------------------------
export async function handleSaveAbandonedForm(body, event) {
  const { visitorInfo = {} } = body;
  const clientIP = event.requestContext?.http?.sourceIp ||
                   event.headers?.['x-forwarded-for']?.split(',')[0] ||
                   'Unknown';
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

// ---------------------------------------------------------------------------
// handleSyncState — action 'sync-state'
// Periodically sync localStorage state to S3
// ---------------------------------------------------------------------------
export async function handleSyncState(body, event) {
  const { visitorInfo = {} } = body;
  const clientIP = event.requestContext?.http?.sourceIp ||
                   event.headers?.['x-forwarded-for']?.split(',')[0] ||
                   'Unknown';
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

// ---------------------------------------------------------------------------
// Routes map
// ---------------------------------------------------------------------------
export const routes = {
  'check-duplicate': handleCheckDuplicate,
  'save-abandoned-form': handleSaveAbandonedForm,
  'sync-state': handleSyncState,
};
