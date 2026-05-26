/**
 * Admin domain handlers
 * Extracted from index.mjs as part of the modular Lambda refactor.
 */

import { getS3 } from '../lib/aws.mjs';
import { S3_BUCKET } from '../lib/config.mjs';
import { corsHeaders } from '../lib/http.mjs';
import { listApplications, updateApplicationStatus } from './applications.mjs';
import { listChatSessions } from './sessions.mjs';
import { listClientProfiles } from './clients.mjs';
import { listBuildHistory } from './builds.mjs';
import { computeAdminSummaryData } from '../costs/email-reports.mjs';
import {
  renderApplicantApproved,
  renderApplicantRejected,
  renderAccountDeactivated,
  renderProjectDeployed,
  renderBuildFailedUser,
  renderBuildFailedAdmin,
} from '../email-templates.mjs';
import { sendTemplate, sendTemplatedEmail, sendToAdmins } from '../email-service.mjs';

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'aiproductstudio2026';

// ---------------------------------------------------------------------------
// handleAdminLogin
// ---------------------------------------------------------------------------
export async function handleAdminLogin(body, event) {
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

// ---------------------------------------------------------------------------
// handleAdminList
// ---------------------------------------------------------------------------
export async function handleAdminList(body, event) {
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

// ---------------------------------------------------------------------------
// handleAdminUpdate
// ---------------------------------------------------------------------------
export async function handleAdminUpdate(body, event) {
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

// ---------------------------------------------------------------------------
// handleAdminProgress
// ---------------------------------------------------------------------------
export async function handleAdminProgress(body, event) {
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

// ---------------------------------------------------------------------------
// handleAdminChats
// ---------------------------------------------------------------------------
export async function handleAdminChats(body, event) {
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

// ---------------------------------------------------------------------------
// handleAdminClients
// ---------------------------------------------------------------------------
export async function handleAdminClients(body, event) {
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

// ---------------------------------------------------------------------------
// handleAdminBuilds
// ---------------------------------------------------------------------------
export async function handleAdminBuilds(body, event) {
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

// ---------------------------------------------------------------------------
// handleAdminChatDetail
// ---------------------------------------------------------------------------
export async function handleAdminChatDetail(body, event) {
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

// ---------------------------------------------------------------------------
// handleAdminClientDetail
// ---------------------------------------------------------------------------
export async function handleAdminClientDetail(body, event) {
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

// ---------------------------------------------------------------------------
// handleAdminBuildDetail
// ---------------------------------------------------------------------------
export async function handleAdminBuildDetail(body, event) {
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

// ---------------------------------------------------------------------------
// handleAdminDeleteChats
// ---------------------------------------------------------------------------
export async function handleAdminDeleteChats(body, event) {
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

// ---------------------------------------------------------------------------
// handleUpdateBuildStatus
// ---------------------------------------------------------------------------
export async function handleUpdateBuildStatus(body, event) {
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

// ---------------------------------------------------------------------------
// handleGetAdminSummary
// ---------------------------------------------------------------------------
export async function handleGetAdminSummary(body, event) {
  if (body.password !== ADMIN_PASSWORD) {
    return { statusCode: 401, headers: corsHeaders, body: JSON.stringify({ success: false, error: 'Unauthorized' }) };
  }
  const data = await computeAdminSummaryData({ S3_REGION: process.env.AWS_REGION || 'us-east-1', ADMIN_PASSWORD, listApplications });
  return { statusCode: 200, headers: corsHeaders, body: JSON.stringify({ success: true, ...data }) };
}

// ---------------------------------------------------------------------------
// Route map
// ---------------------------------------------------------------------------
export const routes = {
  'admin-login': handleAdminLogin,
  'admin-list': handleAdminList,
  'admin-update': handleAdminUpdate,
  'admin-progress': handleAdminProgress,
  'admin-chats': handleAdminChats,
  'admin-clients': handleAdminClients,
  'admin-builds': handleAdminBuilds,
  'admin-chat-detail': handleAdminChatDetail,
  'admin-client-detail': handleAdminClientDetail,
  'admin-build-detail': handleAdminBuildDetail,
  'admin-delete-chats': handleAdminDeleteChats,
  'update-build-status': handleUpdateBuildStatus,
  'get-admin-summary': handleGetAdminSummary,
};
