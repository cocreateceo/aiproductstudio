/**
 * Misc domain handlers — extracted from index.mjs (registry router refactor).
 * Houses stragglers that don't fit a dedicated domain:
 *  - get-tmux-projects
 *  - update-email-preferences
 *  - scheduled-session-expiry
 *  - scheduled-weekly-digest
 *  - scheduled-re-engagement
 */

import { getS3 } from '../lib/aws.mjs';
import { S3_BUCKET } from '../lib/config.mjs';
import { corsHeaders } from '../lib/http.mjs';
import { listApplications } from './applications.mjs';
import { renderSessionExpiryReminder, renderWeeklyDigest, renderReEngagement } from '../email-templates.mjs';
import { sendTemplatedEmail } from '../email-service.mjs';

// ---------------------------------------------------------------------------
// handleGetTmuxProjects — action 'get-tmux-projects'
// Fetch deployed projects from Tmux Builder API
// ---------------------------------------------------------------------------
export async function handleGetTmuxProjects(body, event) {
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

// ---------------------------------------------------------------------------
// handleUpdateEmailPreferences — action 'update-email-preferences'
// ---------------------------------------------------------------------------
export async function handleUpdateEmailPreferences(body, event) {
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

// ---------------------------------------------------------------------------
// handleScheduledSessionExpiry — action 'scheduled-session-expiry'
// Session Expiry Reminder (scheduled via EventBridge)
// ---------------------------------------------------------------------------
export async function handleScheduledSessionExpiry(body, event) {
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

// ---------------------------------------------------------------------------
// handleScheduledWeeklyDigest — action 'scheduled-weekly-digest'
// Weekly Digest (scheduled via EventBridge)
// ---------------------------------------------------------------------------
export async function handleScheduledWeeklyDigest(body, event) {
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

// ---------------------------------------------------------------------------
// handleScheduledReEngagement — action 'scheduled-re-engagement'
// Re-engagement Email (scheduled via EventBridge)
// ---------------------------------------------------------------------------
export async function handleScheduledReEngagement(body, event) {
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

// ---------------------------------------------------------------------------
// Routes map
// ---------------------------------------------------------------------------
export const routes = {
  'get-tmux-projects': handleGetTmuxProjects,
  'update-email-preferences': handleUpdateEmailPreferences,
  'scheduled-session-expiry': handleScheduledSessionExpiry,
  'scheduled-weekly-digest': handleScheduledWeeklyDigest,
  'scheduled-re-engagement': handleScheduledReEngagement,
};
