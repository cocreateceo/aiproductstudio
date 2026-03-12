/**
 * Automated Cost Report Emails via SES
 *
 * Sends weekly/monthly cost reports to approved users.
 * - Weekly: Every Monday at 10 AM EST (EventBridge cron)
 * - Monthly: Every 1st of month at 11 AM EST (EventBridge cron)
 *
 * Reuses cost calculation logic from costs/index.mjs helpers.
 */

import { getBucket, getDeployedUrl, fetchTmuxDeployments, syncDeploymentsToDynamo, handleAdminCostsSummary } from './index.mjs';

const NOTIFICATION_EMAIL = process.env.NOTIFICATION_EMAIL;
const FROM_EMAIL = process.env.FROM_EMAIL || 'noreply@cocreateidea.com';

/**
 * Compute cost data for a single user (pure data, no HTTP wrapping).
 * Replicates handleUserCosts logic but returns raw data for email templates.
 */
export async function computeUserCostData({ guid, userEmail, S3_REGION, period = 'monthly' }) {
  const { DynamoDBClient } = await import('@aws-sdk/client-dynamodb');
  const { DynamoDBDocumentClient, QueryCommand, PutCommand } = await import('@aws-sdk/lib-dynamodb');
  const { S3Client, ListObjectsV2Command } = await import('@aws-sdk/client-s3');
  const { CloudFrontClient } = await import('@aws-sdk/client-cloudfront');

  const dynamoClient = new DynamoDBClient({ region: S3_REGION });
  const dynamodb = DynamoDBDocumentClient.from(dynamoClient);
  const s3 = new S3Client({ region: S3_REGION });
  const cfClient = new CloudFrontClient({ region: S3_REGION });

  // Fetch real deployments from tmux-builder (source of truth)
  const tmuxDeployments = await fetchTmuxDeployments(guid);

  // Query existing DynamoDB records
  const queryResult = await dynamodb.send(new QueryCommand({
    TableName: 'tmux-deployments',
    KeyConditionExpression: 'userId = :email',
    ExpressionAttributeValues: { ':email': userEmail }
  }));
  const dynamoDeployments = queryResult.Items || [];

  // Auto-sync missing deployments
  let allDeployments = dynamoDeployments;
  if (tmuxDeployments.length > 0) {
    allDeployments = await syncDeploymentsToDynamo({
      guid, userEmail, tmuxDeployments, dynamoDeployments, dynamodb, cfClient, PutCommand
    });
  }

  // Filter to deployments with S3 buckets
  const deploymentsWithResources = allDeployments.filter(dep => getBucket(dep.awsResources));

  // Calculate period
  const now = new Date();
  let periodStart, periodEnd, periodDays, periodLabel;

  if (period === 'weekly') {
    const dayOfWeek = now.getDay();
    periodStart = new Date(now);
    periodStart.setDate(now.getDate() - dayOfWeek);
    periodStart.setHours(0, 0, 0, 0);
    periodEnd = new Date(periodStart);
    periodEnd.setDate(periodStart.getDate() + 6);
    periodEnd.setHours(23, 59, 59, 999);
    periodDays = 7;
    const startStr = periodStart.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    const endStr = periodEnd.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    periodLabel = `${startStr} - ${endStr}`;
  } else {
    periodStart = new Date(now.getFullYear(), now.getMonth(), 1);
    periodEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);
    periodDays = periodEnd.getDate();
    periodLabel = now.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
  }

  const AWS_PRICING = {
    s3StoragePerGBPerMonth: 0.023,
    cloudfrontBasePerMonth: 0.01
  };

  const result = {
    period,
    periodLabel,
    costs: { s3: 0, cloudfront: 0, total: 0 },
    projects: []
  };

  for (const dep of deploymentsWithResources) {
    const bucket = getBucket(dep.awsResources);
    let projectCost = {
      s3: { storage: 0, total: 0 },
      cloudfront: { dataTransfer: 0, total: 0 },
      total: 0,
      metrics: { s3SizeBytes: 0 }
    };

    if (bucket) {
      try {
        let totalSize = 0;
        let continuationToken = undefined;
        do {
          const listResult = await s3.send(new ListObjectsV2Command({
            Bucket: bucket,
            ContinuationToken: continuationToken
          }));
          for (const obj of listResult.Contents || []) {
            totalSize += obj.Size || 0;
          }
          continuationToken = listResult.NextContinuationToken;
        } while (continuationToken);
        const sizeGB = totalSize / (1024 * 1024 * 1024);
        projectCost.metrics.s3SizeBytes = totalSize;

        const dailyS3Rate = (sizeGB * AWS_PRICING.s3StoragePerGBPerMonth) / 30;
        projectCost.s3.storage = dailyS3Rate * periodDays;
        projectCost.s3.total = projectCost.s3.storage;
      } catch (e) {
        console.log('[Email Reports] S3 bucket error for', bucket, ':', e.message);
      }
    }

    const dailyCFRate = AWS_PRICING.cloudfrontBasePerMonth / 30;
    projectCost.cloudfront.total = dailyCFRate * periodDays;
    projectCost.total = projectCost.s3.total + projectCost.cloudfront.total;

    result.projects.push({
      projectId: dep.projectId,
      projectName: dep.projectName || 'Project',
      deployedUrl: getDeployedUrl(dep.awsResources),
      costs: projectCost
    });

    result.costs.s3 += projectCost.s3.total;
    result.costs.cloudfront += projectCost.cloudfront.total;
    result.costs.total += projectCost.total;
  }

  return result;
}

/**
 * Generate HTML email for a cost report.
 */
export function generateCostReportHtml(userName, userEmail, reportData, reportType, dashboardUrl) {
  const { periodLabel, costs, projects } = reportData;
  const reportTitle = reportType === 'weekly' ? 'Weekly Cost Report' : 'Monthly Cost Report';

  const projectRows = projects.map(p => `
    <tr>
      <td style="padding: 12px 16px; border-bottom: 1px solid #e5e7eb;">
        <strong style="color: #374151;">${p.projectName}</strong>
        ${p.deployedUrl ? `<br><a href="${p.deployedUrl}" style="color: #6366f1; font-size: 13px; text-decoration: none;">${p.deployedUrl}</a>` : ''}
      </td>
      <td style="padding: 12px 16px; border-bottom: 1px solid #e5e7eb; text-align: right; color: #4b5563;">$${p.costs.s3.total.toFixed(4)}</td>
      <td style="padding: 12px 16px; border-bottom: 1px solid #e5e7eb; text-align: right; color: #4b5563;">$${p.costs.cloudfront.total.toFixed(4)}</td>
      <td style="padding: 12px 16px; border-bottom: 1px solid #e5e7eb; text-align: right; font-weight: bold; color: #374151;">$${p.costs.total.toFixed(4)}</td>
    </tr>`).join('');

  return `<!DOCTYPE html>
<html>
<head>
  <style>
    body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; margin: 0; padding: 0; background: #f3f4f6; }
    .container { max-width: 640px; margin: 0 auto; padding: 20px; }
    .header { background: linear-gradient(135deg, #6366f1, #8b5cf6); color: white; padding: 30px; border-radius: 12px 12px 0 0; text-align: center; }
    .header h1 { margin: 0; font-size: 26px; }
    .header p { margin: 8px 0 0 0; opacity: 0.9; font-size: 15px; }
    .content { background: #fff; border: 1px solid #e0e0e0; border-top: none; padding: 30px; border-radius: 0 0 12px 12px; }
    .cost-summary { background: linear-gradient(135deg, #f0fdf4, #ecfdf5); border: 1px solid #bbf7d0; border-radius: 12px; padding: 24px; margin: 20px 0; text-align: center; }
    .cost-total { font-size: 36px; font-weight: bold; color: #059669; margin: 8px 0; }
    .cost-breakdown { display: flex; justify-content: center; gap: 30px; margin-top: 12px; }
    .cost-item { text-align: center; }
    .cost-item-label { font-size: 12px; color: #6b7280; text-transform: uppercase; letter-spacing: 0.5px; }
    .cost-item-value { font-size: 18px; font-weight: 600; color: #374151; }
    .projects-table { width: 100%; border-collapse: collapse; margin: 20px 0; }
    .projects-table th { background: #f9fafb; padding: 12px 16px; text-align: left; font-size: 12px; text-transform: uppercase; letter-spacing: 0.5px; color: #6b7280; border-bottom: 2px solid #e5e7eb; }
    .projects-table th:not(:first-child) { text-align: right; }
    .cta-box { text-align: center; margin: 25px 0; }
    .cta-button { display: inline-block; background: linear-gradient(135deg, #6366f1, #8b5cf6); color: white; padding: 14px 32px; border-radius: 8px; text-decoration: none; font-weight: bold; font-size: 16px; }
    .footer { margin-top: 30px; padding-top: 20px; border-top: 1px solid #e0e0e0; text-align: center; color: #6b7280; font-size: 13px; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>${reportTitle}</h1>
      <p>${periodLabel}</p>
    </div>
    <div class="content">
      <p style="font-size: 16px; color: #374151;">Hi ${userName},</p>
      <p style="color: #4b5563;">Here's your ${reportType} infrastructure cost summary for your CoCreate projects.</p>

      <div class="cost-summary">
        <div style="font-size: 13px; color: #6b7280; text-transform: uppercase; letter-spacing: 0.5px;">Estimated Total</div>
        <div class="cost-total">$${costs.total.toFixed(4)}</div>
        <!--[if mso]><table cellpadding="0" cellspacing="0" align="center"><tr><td style="padding: 0 15px; text-align: center;"><![endif]-->
        <table cellpadding="0" cellspacing="0" align="center" style="margin: 12px auto 0;"><tr>
          <td style="padding: 0 15px; text-align: center;">
            <div class="cost-item-label" style="font-size: 12px; color: #6b7280; text-transform: uppercase; letter-spacing: 0.5px;">S3 Storage</div>
            <div class="cost-item-value" style="font-size: 18px; font-weight: 600; color: #374151;">$${costs.s3.toFixed(4)}</div>
          </td>
          <td style="padding: 0 15px; text-align: center;">
            <div class="cost-item-label" style="font-size: 12px; color: #6b7280; text-transform: uppercase; letter-spacing: 0.5px;">CloudFront</div>
            <div class="cost-item-value" style="font-size: 18px; font-weight: 600; color: #374151;">$${costs.cloudfront.toFixed(4)}</div>
          </td>
        </tr></table>
        <!--[if mso]></td></tr></table><![endif]-->
      </div>

      <h3 style="color: #374151; margin-bottom: 8px;">Project Breakdown</h3>
      <p style="color: #6b7280; font-size: 14px; margin-top: 0;">${projects.length} active project${projects.length !== 1 ? 's' : ''}</p>

      <table class="projects-table">
        <thead>
          <tr>
            <th>Project</th>
            <th>S3</th>
            <th>CloudFront</th>
            <th>Total</th>
          </tr>
        </thead>
        <tbody>
          ${projectRows}
        </tbody>
      </table>

      <div class="cta-box">
        <a href="${dashboardUrl}" class="cta-button">View Full Dashboard</a>
      </div>

      <div class="footer">
        <p>CoCreate - AI Product Studio</p>
        <p>This is an automated cost report for your CoCreate projects.</p>
        <p style="font-size: 12px; margin-top: 10px;">
          You received this email because you have active projects on cocreateidea.com.<br>
          Questions? Reply to this email or contact <a href="mailto:hello@cocreateidea.com" style="color: #6366f1;">hello@cocreateidea.com</a>
        </p>
      </div>
    </div>
  </div>
</body>
</html>`;
}

/**
 * Generate plain text fallback for cost report email.
 */
export function generateCostReportText(userName, reportData, reportType) {
  const { periodLabel, costs, projects } = reportData;
  const reportTitle = reportType === 'weekly' ? 'Weekly Cost Report' : 'Monthly Cost Report';

  const projectLines = projects.map(p =>
    `  - ${p.projectName}: $${p.costs.total.toFixed(4)} (S3: $${p.costs.s3.total.toFixed(4)}, CF: $${p.costs.cloudfront.total.toFixed(4)})${p.deployedUrl ? `\n    URL: ${p.deployedUrl}` : ''}`
  ).join('\n');

  return `${reportTitle} - ${periodLabel}

Hi ${userName},

Here's your ${reportType} infrastructure cost summary for your CoCreate projects.

ESTIMATED TOTAL: $${costs.total.toFixed(4)}
  S3 Storage:  $${costs.s3.toFixed(4)}
  CloudFront:  $${costs.cloudfront.toFixed(4)}

PROJECT BREAKDOWN (${projects.length} project${projects.length !== 1 ? 's' : ''}):
${projectLines}

View your full dashboard: https://cocreateidea.com/user.html

---
CoCreate - AI Product Studio
This is an automated cost report for your CoCreate projects.
Questions? Reply to this email or contact hello@cocreateidea.com
`;
}

/**
 * Send cost report email via SES.
 */
export async function sendCostReportEmail(ses, sourceEmail, userEmail, userName, reportHtml, reportText, reportType, period) {
  const { SendEmailCommand } = await import('@aws-sdk/client-ses');

  const subjectPrefix = reportType === 'weekly' ? 'Weekly' : 'Monthly';
  const result = await ses.send(new SendEmailCommand({
    Source: sourceEmail,
    Destination: {
      ToAddresses: [userEmail]
    },
    ReplyToAddresses: [sourceEmail],
    Message: {
      Subject: {
        Data: `Your ${subjectPrefix} Cost Report - CoCreate`,
        Charset: 'UTF-8'
      },
      Body: {
        Html: {
          Data: reportHtml,
          Charset: 'UTF-8'
        },
        Text: {
          Data: reportText,
          Charset: 'UTF-8'
        }
      }
    }
  }));

  console.log('[Email Reports] Sent cost report to:', userEmail, 'MessageId:', result.MessageId);
  return result;
}

/**
 * Main orchestrator for scheduled cost report emails.
 * Called by EventBridge or manual trigger.
 */
export async function handleScheduledCostReports({ reportType = 'weekly', S3_REGION, listApplications }) {
  const { SESClient } = await import('@aws-sdk/client-ses');
  const ses = new SESClient({ region: 'us-east-1' });

  const sourceEmail = FROM_EMAIL;
  if (!sourceEmail) {
    console.error('[Email Reports] FROM_EMAIL/NOTIFICATION_EMAIL not set, cannot send reports');
    return { usersProcessed: 0, emailsSent: 0, errors: ['FROM_EMAIL not configured'], skipped: 0 };
  }

  const dashboardUrl = 'https://cocreateidea.com/user.html';

  // Get all approved users with GUIDs
  let approvedApps = [];
  try {
    const allApps = await listApplications();
    const TEST_EMAIL_PATTERNS = ['@example.com', '@testflow.com', '@test.com', '@localhost'];
    approvedApps = allApps.filter(app => app.guid && app.visitorInfo?.email && !TEST_EMAIL_PATTERNS.some(p => app.visitorInfo.email.toLowerCase().includes(p)));
    console.log('[Email Reports] Found', approvedApps.length, 'approved users with GUIDs');
  } catch (e) {
    console.error('[Email Reports] Could not list applications:', e.message);
    return { usersProcessed: 0, emailsSent: 0, errors: [e.message], skipped: 0 };
  }

  let emailsSent = 0;
  let skipped = 0;
  const errors = [];

  for (const app of approvedApps) {
    const guid = app.guid;
    const userEmail = app.visitorInfo.email;
    const userName = app.visitorInfo?.name || userEmail.split('@')[0];

    try {
      // Compute costs for this user
      let reportData = await computeUserCostData({ guid, userEmail, S3_REGION, period: reportType });

      // If no projects, send a $0 report so every user gets an email
      if (!reportData) {
        const now = new Date();
        reportData = {
          period: reportType,
          periodLabel: reportType === 'weekly'
            ? `${now.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} - ${new Date(now.getTime() + 6*86400000).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`
            : now.toLocaleDateString('en-US', { month: 'long', year: 'numeric' }),
          costs: { s3: 0, cloudfront: 0, total: 0 },
          projects: []
        };
      }

      // Generate email content
      const reportHtml = generateCostReportHtml(userName, userEmail, reportData, reportType, dashboardUrl);
      const reportText = generateCostReportText(userName, reportData, reportType);

      // Send email
      await sendCostReportEmail(ses, sourceEmail, userEmail, userName, reportHtml, reportText, reportType, reportData.periodLabel);
      emailsSent++;

      // Rate limit: 100ms delay between sends
      await new Promise(resolve => setTimeout(resolve, 100));
    } catch (e) {
      console.error('[Email Reports] Error processing', userEmail, ':', e.message);
      errors.push(`${userEmail}: ${e.message}`);
    }
  }

  const summary = {
    usersProcessed: approvedApps.length,
    emailsSent,
    errors,
    skipped
  };
  console.log('[Email Reports] Complete:', JSON.stringify(summary));
  return summary;
}

/**
 * Admin API endpoint to manually trigger cost report emails.
 * action: 'send-cost-reports'
 * body: { password, reportType, testEmail? }
 */
export async function handleManualCostReportTrigger({ body, corsHeaders, S3_REGION, ADMIN_PASSWORD, listApplications }) {
  const { password, reportType = 'weekly', testEmail } = body;

  if (password !== ADMIN_PASSWORD) {
    return {
      statusCode: 401,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      body: JSON.stringify({ success: false, error: 'Unauthorized' })
    };
  }

  try {
    if (testEmail) {
      // Send to a single test user
      const { SESClient } = await import('@aws-sdk/client-ses');
      const ses = new SESClient({ region: 'us-east-1' });
      const sourceEmail = FROM_EMAIL;

      if (!sourceEmail) {
        return {
          statusCode: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          body: JSON.stringify({ success: false, error: 'FROM_EMAIL not configured' })
        };
      }

      // Find the user by email
      const allApps = await listApplications();
      const app = allApps.find(a => a.visitorInfo?.email === testEmail && a.guid);

      if (!app) {
        return {
          statusCode: 404,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          body: JSON.stringify({ success: false, error: `No approved user found with email: ${testEmail}` })
        };
      }

      const guid = app.guid;
      const userName = app.visitorInfo?.name || testEmail.split('@')[0];
      const dashboardUrl = 'https://cocreateidea.com/user.html';

      let reportData = await computeUserCostData({ guid, userEmail: testEmail, S3_REGION, period: reportType });

      if (!reportData) {
        const now = new Date();
        reportData = {
          period: reportType,
          periodLabel: reportType === 'weekly'
            ? `${now.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} - ${new Date(now.getTime() + 6*86400000).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`
            : now.toLocaleDateString('en-US', { month: 'long', year: 'numeric' }),
          costs: { s3: 0, cloudfront: 0, total: 0 },
          projects: []
        };
      }

      const reportHtml = generateCostReportHtml(userName, testEmail, reportData, reportType, dashboardUrl);
      const reportText = generateCostReportText(userName, reportData, reportType);
      await sendCostReportEmail(ses, sourceEmail, testEmail, userName, reportHtml, reportText, reportType, reportData.periodLabel);

      return {
        statusCode: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          success: true,
          message: `Test cost report sent to ${testEmail}`,
          reportType,
          period: reportData.periodLabel,
          projectCount: reportData.projects.length,
          totalCost: reportData.costs.total
        })
      };
    }

    // Full run: send to all approved users
    const result = await handleScheduledCostReports({ reportType, S3_REGION, listApplications });

    return {
      statusCode: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      body: JSON.stringify({ success: true, reportType, ...result })
    };
  } catch (error) {
    console.error('[Email Reports] Manual trigger error:', error);
    return {
      statusCode: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      body: JSON.stringify({ success: false, error: error.message })
    };
  }
}

/**
 * Load previous cost snapshot from S3 for comparison.
 */
async function loadPreviousSnapshot(s3, bucket) {
  const { GetObjectCommand } = await import('@aws-sdk/client-s3');
  try {
    const result = await s3.send(new GetObjectCommand({
      Bucket: bucket,
      Key: 'cost-snapshots/admin-summary-latest.json'
    }));
    const body = await result.Body.transformToString();
    return JSON.parse(body);
  } catch (e) {
    console.log('[Admin Summary] No previous snapshot found:', e.message);
    return null;
  }
}

/**
 * Save current cost snapshot to S3 for future comparison.
 */
async function saveCurrentSnapshot(s3, bucket, snapshot) {
  const { PutObjectCommand } = await import('@aws-sdk/client-s3');
  try {
    await s3.send(new PutObjectCommand({
      Bucket: bucket,
      Key: 'cost-snapshots/admin-summary-latest.json',
      Body: JSON.stringify(snapshot, null, 2),
      ContentType: 'application/json'
    }));
    console.log('[Admin Summary] Saved cost snapshot for future comparison');
  } catch (e) {
    console.log('[Admin Summary] Failed to save snapshot:', e.message);
  }
}

/**
 * Compute admin summary data: all users + infrastructure costs for both projects.
 * Includes previous period comparison data loaded from S3 snapshot.
 */
export async function computeAdminSummaryData({ S3_REGION, ADMIN_PASSWORD, listApplications }) {
  const { S3Client, ListObjectsV2Command } = await import('@aws-sdk/client-s3');
  const { LambdaClient, GetFunctionCommand } = await import('@aws-sdk/client-lambda');
  const { CloudWatchClient, GetMetricStatisticsCommand } = await import('@aws-sdk/client-cloudwatch');

  const s3 = new S3Client({ region: S3_REGION });
  const lambda = new LambdaClient({ region: S3_REGION });
  const cloudwatch = new CloudWatchClient({ region: S3_REGION });

  // Load previous snapshot for comparison
  const SNAPSHOT_BUCKET = 'cocreate-applications-data';
  const previousSnapshot = await loadPreviousSnapshot(s3, SNAPSHOT_BUCKET);

  // Get user costs via handleAdminCostsSummary
  const adminResult = await handleAdminCostsSummary({
    body: { password: ADMIN_PASSWORD },
    corsHeaders: {},
    S3_REGION,
    ADMIN_PASSWORD,
    listApplications
  });

  const adminData = JSON.parse(adminResult.body);
  const users = adminData.success ? adminData.users || [] : [];
  const userTotals = adminData.success ? adminData.totals : { estimated: 0, s3: 0, cloudfront: 0, projectCount: 0 };

  // Enrich users with name from applications + add weekly cost
  let allApps = [];
  try {
    allApps = await listApplications();
  } catch (e) {
    console.log('[Admin Summary] Could not list applications for names:', e.message);
  }
  for (const user of users) {
    const app = allApps.find(a => a.visitorInfo?.email === user.email);
    user.name = app?.visitorInfo?.name || user.email.split('@')[0];
    user.weeklyCost = user.costs.total / 30 * 7;

    // Find previous data for this user
    const prevUser = previousSnapshot?.users?.find(pu => pu.email === user.email);
    user.prevWeeklyCost = prevUser?.weeklyCost ?? null;
    user.prevMonthlyCost = prevUser?.monthlyCost ?? null;
    user.monthlyCost = user.costs.total;
  }

  // Add weekly totals
  userTotals.weeklyEstimated = userTotals.estimated / 30 * 7;
  userTotals.prevWeeklyEstimated = previousSnapshot?.userTotals?.weeklyEstimated ?? null;
  userTotals.prevEstimated = previousSnapshot?.userTotals?.estimated ?? null;

  // Helper: get S3 bucket total size
  async function getBucketSizeBytes(bucket) {
    try {
      let totalSize = 0;
      let continuationToken = undefined;
      do {
        const result = await s3.send(new ListObjectsV2Command({
          Bucket: bucket,
          ContinuationToken: continuationToken
        }));
        for (const obj of result.Contents || []) {
          totalSize += obj.Size || 0;
        }
        continuationToken = result.NextContinuationToken;
      } while (continuationToken);
      return totalSize;
    } catch (e) {
      console.log('[Admin Summary] S3 size error for', bucket, ':', e.message);
      return 0;
    }
  }

  // Helper: compute S3 monthly cost from bytes
  function s3MonthlyCost(bytes) {
    const gb = bytes / (1024 * 1024 * 1024);
    return gb * 0.023;
  }

  // Helper: format bytes for display
  function formatBytes(bytes) {
    if (bytes === 0) return '0 B';
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    if (bytes < 1024 * 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
    return (bytes / (1024 * 1024 * 1024)).toFixed(2) + ' GB';
  }

  // Helper: find previous infra cost by resource key
  function getPrevInfraCost(prevCosts, resource) {
    if (!prevCosts) return null;
    const prev = prevCosts.find(c => c.resource === resource);
    return prev?.monthlyCost ?? null;
  }

  // --- AI Product Studio Infrastructure ---
  const aiProductStudioCosts = [];
  const prevAiCosts = previousSnapshot?.aiProductStudioCosts || null;

  // S3: cocreateidea.com
  const cocreateSize = await getBucketSizeBytes('cocreateidea.com');
  aiProductStudioCosts.push({
    service: 'S3',
    resource: 'cocreateidea.com',
    details: formatBytes(cocreateSize),
    monthlyCost: s3MonthlyCost(cocreateSize),
    prevMonthlyCost: getPrevInfraCost(prevAiCosts, 'cocreateidea.com')
  });

  // S3: cocreate-applications-data
  const appsDataSize = await getBucketSizeBytes('cocreate-applications-data');
  aiProductStudioCosts.push({
    service: 'S3',
    resource: 'cocreate-applications-data',
    details: formatBytes(appsDataSize),
    monthlyCost: s3MonthlyCost(appsDataSize),
    prevMonthlyCost: getPrevInfraCost(prevAiCosts, 'cocreate-applications-data')
  });

  // CloudFront: E1M06FXCRKZHF3 (site CDN)
  aiProductStudioCosts.push({
    service: 'CloudFront',
    resource: 'E1M06FXCRKZHF3 (site CDN)',
    details: 'Base distribution fee',
    monthlyCost: 0.01,
    prevMonthlyCost: getPrevInfraCost(prevAiCosts, 'E1M06FXCRKZHF3 (site CDN)')
  });

  // Lambda: ai-product-studio-chat
  let lambdaCodeSize = 0;
  let lambdaInvocations = 0;
  try {
    const fnResult = await lambda.send(new GetFunctionCommand({ FunctionName: 'ai-product-studio-chat' }));
    lambdaCodeSize = fnResult.Configuration?.CodeSize || 0;
  } catch (e) {
    console.log('[Admin Summary] Lambda GetFunction error:', e.message);
  }

  try {
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const cwResult = await cloudwatch.send(new GetMetricStatisticsCommand({
      Namespace: 'AWS/Lambda',
      MetricName: 'Invocations',
      Dimensions: [{ Name: 'FunctionName', Value: 'ai-product-studio-chat' }],
      StartTime: startOfMonth,
      EndTime: now,
      Period: 86400 * 31,
      Statistics: ['Sum']
    }));
    lambdaInvocations = cwResult.Datapoints?.[0]?.Sum || 0;
  } catch (e) {
    console.log('[Admin Summary] CloudWatch Lambda metrics error:', e.message);
  }

  // Lambda pricing: first 1M requests free, then $0.20/1M. Compute: $0.0000166667/GB-sec
  const lambdaRequestCost = Math.max(0, lambdaInvocations - 1000000) * 0.0000002;
  // Estimate ~500ms avg duration, 256MB memory
  const lambdaComputeCost = lambdaInvocations * 0.5 * (256 / 1024) * 0.0000166667;
  const lambdaTotalCost = lambdaRequestCost + lambdaComputeCost;

  aiProductStudioCosts.push({
    service: 'Lambda',
    resource: 'ai-product-studio-chat',
    details: `${Math.round(lambdaInvocations).toLocaleString()} invocations, code: ${formatBytes(lambdaCodeSize)}`,
    monthlyCost: lambdaTotalCost,
    prevMonthlyCost: getPrevInfraCost(prevAiCosts, 'ai-product-studio-chat')
  });

  // API Gateway: estimate from Lambda invocations ($3.50/million requests)
  const apiGatewayCost = lambdaInvocations * 0.0000035;
  aiProductStudioCosts.push({
    service: 'API Gateway',
    resource: 'cocreate-chat-api',
    details: `~${Math.round(lambdaInvocations).toLocaleString()} requests`,
    monthlyCost: apiGatewayCost,
    prevMonthlyCost: getPrevInfraCost(prevAiCosts, 'cocreate-chat-api')
  });

  // DynamoDB: on-demand pricing
  aiProductStudioCosts.push({
    service: 'DynamoDB',
    resource: 'cocreate-projects',
    details: 'On-demand pricing',
    monthlyCost: 0.00,
    prevMonthlyCost: getPrevInfraCost(prevAiCosts, 'cocreate-projects')
  });

  aiProductStudioCosts.push({
    service: 'DynamoDB',
    resource: 'tmux-deployments',
    details: 'On-demand pricing',
    monthlyCost: 0.00,
    prevMonthlyCost: getPrevInfraCost(prevAiCosts, 'tmux-deployments')
  });

  // --- Tmux Builder Infrastructure ---
  const tmuxBuilderCosts = [];
  const prevTmuxCosts = previousSnapshot?.tmuxBuilderCosts || null;

  // EC2: t3.medium
  tmuxBuilderCosts.push({
    service: 'EC2',
    resource: 't3.medium (tmux-builder-cocreateceo)',
    details: '2 vCPU, 4 GB RAM, on-demand',
    monthlyCost: 30.37,
    prevMonthlyCost: getPrevInfraCost(prevTmuxCosts, 't3.medium (tmux-builder-cocreateceo)')
  });

  // S3: tmux-builder-websites-248825820556
  const tmuxS3Size = await getBucketSizeBytes('tmux-builder-websites-248825820556');
  tmuxBuilderCosts.push({
    service: 'S3',
    resource: 'tmux-builder-websites-248825820556',
    details: formatBytes(tmuxS3Size),
    monthlyCost: s3MonthlyCost(tmuxS3Size),
    prevMonthlyCost: getPrevInfraCost(prevTmuxCosts, 'tmux-builder-websites-248825820556')
  });

  // CloudFront: E2FOQ8U2IQP3GC (tmux-builder CDN)
  tmuxBuilderCosts.push({
    service: 'CloudFront',
    resource: 'E2FOQ8U2IQP3GC (tmux-builder CDN)',
    details: 'Base distribution fee',
    monthlyCost: 0.01,
    prevMonthlyCost: getPrevInfraCost(prevTmuxCosts, 'E2FOQ8U2IQP3GC (tmux-builder CDN)')
  });

  const aiProductStudioTotal = aiProductStudioCosts.reduce((sum, c) => sum + c.monthlyCost, 0);
  const tmuxBuilderTotal = tmuxBuilderCosts.reduce((sum, c) => sum + c.monthlyCost, 0);
  const infraTotal = aiProductStudioTotal + tmuxBuilderTotal;
  const grandTotal = userTotals.estimated + infraTotal;

  const prevAiTotal = previousSnapshot?.aiProductStudioTotal ?? null;
  const prevTmuxTotal = previousSnapshot?.tmuxBuilderTotal ?? null;
  const prevInfraTotal = previousSnapshot?.infraTotal ?? null;
  const prevGrandTotal = previousSnapshot?.grandTotal ?? null;

  const summaryData = {
    users,
    userTotals,
    aiProductStudioCosts,
    aiProductStudioTotal,
    prevAiProductStudioTotal: prevAiTotal,
    tmuxBuilderCosts,
    tmuxBuilderTotal,
    prevTmuxBuilderTotal: prevTmuxTotal,
    infraTotal,
    prevInfraTotal,
    grandTotal,
    prevGrandTotal,
    previousSnapshotDate: previousSnapshot?.generatedAt || null,
    generatedAt: new Date().toISOString()
  };

  // Save current snapshot for next comparison
  await saveCurrentSnapshot(s3, SNAPSHOT_BUCKET, summaryData);

  return summaryData;
}

/**
 * Generate HTML email for the admin summary report with period comparison.
 */
export function generateAdminSummaryHtml(summaryData) {
  const {
    users, userTotals,
    aiProductStudioCosts, aiProductStudioTotal, prevAiProductStudioTotal,
    tmuxBuilderCosts, tmuxBuilderTotal, prevTmuxBuilderTotal,
    infraTotal, prevInfraTotal,
    grandTotal, prevGrandTotal,
    previousSnapshotDate, generatedAt
  } = summaryData;

  const now = new Date(generatedAt);
  const dateLabel = now.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
  const hasPrev = previousSnapshotDate !== null;
  const prevDateLabel = hasPrev
    ? new Date(previousSnapshotDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
    : null;

  // Delta badge helper: red for increase, green for decrease
  function deltaBadge(current, previous) {
    if (previous === null || previous === undefined) return '<span style="color: #9ca3af; font-size: 11px;">NEW</span>';
    const diff = current - previous;
    if (Math.abs(diff) < 0.00005) return '<span style="color: #9ca3af; font-size: 11px;">--</span>';
    const sign = diff > 0 ? '+' : '-';
    const color = diff > 0 ? '#dc2626' : '#16a34a';
    const bg = diff > 0 ? '#fef2f2' : '#f0fdf4';
    return `<span style="color: ${color}; background: ${bg}; padding: 2px 6px; border-radius: 4px; font-size: 11px; font-weight: 600; white-space: nowrap;">${sign}$${Math.abs(diff).toFixed(4)}</span>`;
  }

  // Users table rows with weekly + monthly + deltas
  const userRows = users.map(u => `
    <tr>
      <td style="padding: 8px 10px; border-bottom: 1px solid #e5e7eb; color: #374151; font-weight: 500;">${u.name}</td>
      <td style="padding: 8px 10px; border-bottom: 1px solid #e5e7eb; color: #6b7280; font-size: 12px;">${u.email}</td>
      <td style="padding: 8px 10px; border-bottom: 1px solid #e5e7eb; text-align: center; color: #4b5563;">${u.projectCount}</td>
      <td style="padding: 8px 10px; border-bottom: 1px solid #e5e7eb; text-align: right; color: #4b5563;">$${u.weeklyCost.toFixed(4)}</td>
      <td style="padding: 8px 10px; border-bottom: 1px solid #e5e7eb; text-align: right;">${deltaBadge(u.weeklyCost, u.prevWeeklyCost)}</td>
      <td style="padding: 8px 10px; border-bottom: 1px solid #e5e7eb; text-align: right; font-weight: 600; color: #374151;">$${u.monthlyCost.toFixed(4)}</td>
      <td style="padding: 8px 10px; border-bottom: 1px solid #e5e7eb; text-align: right;">${deltaBadge(u.monthlyCost, u.prevMonthlyCost)}</td>
    </tr>`).join('');

  const userTotalRow = `
    <tr style="background: #f0fdf4;">
      <td colspan="3" style="padding: 10px; font-weight: bold; color: #059669;">Total (${users.length} users, ${userTotals.projectCount} projects)</td>
      <td style="padding: 10px; text-align: right; font-weight: bold; color: #059669;">$${userTotals.weeklyEstimated.toFixed(4)}</td>
      <td style="padding: 10px; text-align: right;">${deltaBadge(userTotals.weeklyEstimated, userTotals.prevWeeklyEstimated)}</td>
      <td style="padding: 10px; text-align: right; font-weight: bold; color: #059669;">$${userTotals.estimated.toFixed(4)}</td>
      <td style="padding: 10px; text-align: right;">${deltaBadge(userTotals.estimated, userTotals.prevEstimated)}</td>
    </tr>`;

  // Infrastructure table helper with comparison
  function infraRows(costs) {
    return costs.map(c => `
      <tr>
        <td style="padding: 8px 10px; border-bottom: 1px solid #e5e7eb; font-weight: 500; color: #374151;">${c.service}</td>
        <td style="padding: 8px 10px; border-bottom: 1px solid #e5e7eb; color: #4b5563; font-size: 12px;">${c.resource}</td>
        <td style="padding: 8px 10px; border-bottom: 1px solid #e5e7eb; color: #6b7280; font-size: 12px;">${c.details}</td>
        <td style="padding: 8px 10px; border-bottom: 1px solid #e5e7eb; text-align: right; font-weight: 600; color: #374151;">$${c.monthlyCost.toFixed(4)}</td>
        <td style="padding: 8px 10px; border-bottom: 1px solid #e5e7eb; text-align: right;">${deltaBadge(c.monthlyCost, c.prevMonthlyCost)}</td>
      </tr>`).join('');
  }

  function infraTotalRow(label, total, prevTotal) {
    return `
      <tr style="background: #f0fdf4;">
        <td colspan="3" style="padding: 10px; font-weight: bold; color: #059669;">${label}</td>
        <td style="padding: 10px; text-align: right; font-weight: bold; color: #059669;">$${total.toFixed(4)}</td>
        <td style="padding: 10px; text-align: right;">${deltaBadge(total, prevTotal)}</td>
      </tr>`;
  }

  const comparedTo = hasPrev
    ? `<p style="color: #6b7280; font-size: 12px; margin: 0 0 16px 0;">Compared to previous report (${prevDateLabel}). <span style="color: #dc2626; font-weight: 600;">Red = increase</span>, <span style="color: #16a34a; font-weight: 600;">Green = decrease</span></p>`
    : `<p style="color: #6b7280; font-size: 12px; margin: 0 0 16px 0;">First report - no comparison data yet. Deltas will show from next report onward.</p>`;

  // Grand total delta
  const grandTotalDelta = prevGrandTotal !== null
    ? (() => {
        const diff = grandTotal - prevGrandTotal;
        if (Math.abs(diff) < 0.005) return '';
        const sign = diff > 0 ? '+' : '-';
        const color = diff > 0 ? '#fca5a5' : '#86efac';
        return `<div style="font-size: 16px; margin-top: 6px; color: ${color};">${sign}$${Math.abs(diff).toFixed(2)} vs previous</div>`;
      })()
    : '';

  return `<!DOCTYPE html>
<html>
<head>
  <style>
    body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; margin: 0; padding: 0; background: #f3f4f6; }
    .container { max-width: 820px; margin: 0 auto; padding: 20px; }
    .header { background: linear-gradient(135deg, #1e1b4b, #4338ca); color: white; padding: 30px; border-radius: 12px 12px 0 0; text-align: center; }
    .header h1 { margin: 0; font-size: 24px; }
    .header p { margin: 8px 0 0 0; opacity: 0.85; font-size: 14px; }
    .content { background: #fff; border: 1px solid #e0e0e0; border-top: none; padding: 30px; border-radius: 0 0 12px 12px; }
    .section-title { font-size: 18px; font-weight: bold; color: #1e1b4b; margin: 28px 0 8px 0; padding-bottom: 8px; border-bottom: 2px solid #e5e7eb; }
    .section-title:first-of-type { margin-top: 0; }
    .summary-table { width: 100%; border-collapse: collapse; margin: 0 0 20px 0; font-size: 13px; }
    .summary-table th { background: #f9fafb; padding: 8px 10px; text-align: left; font-size: 10px; text-transform: uppercase; letter-spacing: 0.5px; color: #6b7280; border-bottom: 2px solid #e5e7eb; }
    .summary-table th.right { text-align: right; }
    .summary-table th.center { text-align: center; }
    .grand-total { background: linear-gradient(135deg, #1e1b4b, #4338ca); color: white; border-radius: 12px; padding: 24px; margin: 24px 0; text-align: center; }
    .grand-total-label { font-size: 13px; text-transform: uppercase; letter-spacing: 1px; opacity: 0.85; }
    .grand-total-value { font-size: 36px; font-weight: bold; margin: 8px 0; }
    .grand-total-breakdown { font-size: 14px; opacity: 0.8; }
    .footer { margin-top: 30px; padding-top: 20px; border-top: 1px solid #e0e0e0; text-align: center; color: #6b7280; font-size: 13px; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>Admin Cost Summary</h1>
      <p>${dateLabel}</p>
    </div>
    <div class="content">

      ${comparedTo}

      <div class="section-title">1. Users Overview</div>
      <table class="summary-table">
        <thead>
          <tr>
            <th>User</th>
            <th>Email</th>
            <th class="center">Projects</th>
            <th class="right">This Week</th>
            <th class="right">vs Last</th>
            <th class="right">This Month</th>
            <th class="right">vs Last</th>
          </tr>
        </thead>
        <tbody>
          ${userRows}
          ${userTotalRow}
        </tbody>
      </table>

      <div class="section-title">2. AI Product Studio Infrastructure</div>
      <table class="summary-table">
        <thead>
          <tr>
            <th>Service</th>
            <th>Resource</th>
            <th>Details</th>
            <th class="right">Monthly Est.</th>
            <th class="right">vs Last</th>
          </tr>
        </thead>
        <tbody>
          ${infraRows(aiProductStudioCosts)}
          ${infraTotalRow('AI Product Studio Subtotal', aiProductStudioTotal, prevAiProductStudioTotal)}
        </tbody>
      </table>

      <div class="section-title">3. Tmux Builder Infrastructure</div>
      <table class="summary-table">
        <thead>
          <tr>
            <th>Service</th>
            <th>Resource</th>
            <th>Details</th>
            <th class="right">Monthly Est.</th>
            <th class="right">vs Last</th>
          </tr>
        </thead>
        <tbody>
          ${infraRows(tmuxBuilderCosts)}
          ${infraTotalRow('Tmux Builder Subtotal', tmuxBuilderTotal, prevTmuxBuilderTotal)}
        </tbody>
      </table>

      <div class="grand-total">
        <div class="grand-total-label">Estimated Monthly Grand Total</div>
        <div class="grand-total-value">$${grandTotal.toFixed(2)}</div>
        ${grandTotalDelta}
        <div class="grand-total-breakdown">
          User projects: $${userTotals.estimated.toFixed(4)} &nbsp;|&nbsp;
          Infrastructure: $${infraTotal.toFixed(2)} &nbsp;
          (AI Studio: $${aiProductStudioTotal.toFixed(2)}, Tmux: $${tmuxBuilderTotal.toFixed(2)})
        </div>
      </div>

      <div class="footer">
        <p>CoCreate - Admin Cost Summary</p>
        <p>Generated ${now.toLocaleString('en-US', { timeZone: 'America/New_York' })} EST</p>
        <p style="font-size: 12px; margin-top: 10px;">
          This is an automated admin report from cocreateidea.com
        </p>
      </div>
    </div>
  </div>
</body>
</html>`;
}

/**
 * Generate plain text fallback for the admin summary email with comparison.
 */
export function generateAdminSummaryText(summaryData) {
  const {
    users, userTotals,
    aiProductStudioCosts, aiProductStudioTotal, prevAiProductStudioTotal,
    tmuxBuilderCosts, tmuxBuilderTotal, prevTmuxBuilderTotal,
    infraTotal, prevInfraTotal,
    grandTotal, prevGrandTotal,
    previousSnapshotDate, generatedAt
  } = summaryData;

  const now = new Date(generatedAt);
  const dateLabel = now.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
  const hasPrev = previousSnapshotDate !== null;

  function deltaStr(current, previous) {
    if (previous === null || previous === undefined) return '(NEW)';
    const diff = current - previous;
    if (Math.abs(diff) < 0.00005) return '(no change)';
    const sign = diff > 0 ? '+' : '-';
    return `(${sign}$${Math.abs(diff).toFixed(4)})`;
  }

  const userLines = users.map(u =>
    `  ${u.name.padEnd(18)} ${u.email.padEnd(28)} ${String(u.projectCount).padStart(2)}proj  Wk:$${u.weeklyCost.toFixed(4)} ${deltaStr(u.weeklyCost, u.prevWeeklyCost).padEnd(14)}  Mo:$${u.monthlyCost.toFixed(4)} ${deltaStr(u.monthlyCost, u.prevMonthlyCost)}`
  ).join('\n');

  function infraLines(costs) {
    return costs.map(c =>
      `  ${c.service.padEnd(14)} ${c.resource.padEnd(38)} $${c.monthlyCost.toFixed(4)}/mo ${deltaStr(c.monthlyCost, c.prevMonthlyCost)}`
    ).join('\n');
  }

  const comparedNote = hasPrev
    ? `Compared to previous report (${new Date(previousSnapshotDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })})`
    : 'First report - no comparison data yet';

  return `ADMIN COST SUMMARY - ${dateLabel}
${'='.repeat(70)}
${comparedNote}

1. USERS OVERVIEW
${'-'.repeat(70)}
${userLines}
${'-'.repeat(70)}
  TOTAL: ${users.length} users, ${userTotals.projectCount} projects
  Weekly:  $${userTotals.weeklyEstimated.toFixed(4)} ${deltaStr(userTotals.weeklyEstimated, userTotals.prevWeeklyEstimated)}
  Monthly: $${userTotals.estimated.toFixed(4)} ${deltaStr(userTotals.estimated, userTotals.prevEstimated)}

2. AI PRODUCT STUDIO INFRASTRUCTURE
${'-'.repeat(70)}
${infraLines(aiProductStudioCosts)}
${'-'.repeat(70)}
  Subtotal: $${aiProductStudioTotal.toFixed(4)}/mo ${deltaStr(aiProductStudioTotal, prevAiProductStudioTotal)}

3. TMUX BUILDER INFRASTRUCTURE
${'-'.repeat(70)}
${infraLines(tmuxBuilderCosts)}
${'-'.repeat(70)}
  Subtotal: $${tmuxBuilderTotal.toFixed(4)}/mo ${deltaStr(tmuxBuilderTotal, prevTmuxBuilderTotal)}

${'='.repeat(70)}
GRAND TOTAL (MONTHLY): $${grandTotal.toFixed(2)} ${prevGrandTotal !== null ? deltaStr(grandTotal, prevGrandTotal) : ''}
  User projects:  $${userTotals.estimated.toFixed(4)}
  Infrastructure: $${infraTotal.toFixed(2)} ${prevInfraTotal !== null ? deltaStr(infraTotal, prevInfraTotal) : ''}
    AI Product Studio: $${aiProductStudioTotal.toFixed(2)}
    Tmux Builder:      $${tmuxBuilderTotal.toFixed(2)}
${'='.repeat(70)}

Generated ${now.toLocaleString('en-US', { timeZone: 'America/New_York' })} EST
CoCreate - Admin Cost Summary
`;
}

/**
 * Send the admin summary email via SES.
 */
export async function handleSendAdminSummaryReport({ body, corsHeaders, S3_REGION, ADMIN_PASSWORD, listApplications }) {
  const { password } = body;

  if (password !== ADMIN_PASSWORD) {
    return {
      statusCode: 401,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      body: JSON.stringify({ success: false, error: 'Unauthorized' })
    };
  }

  try {
    const { SESClient, SendEmailCommand } = await import('@aws-sdk/client-ses');
    const ses = new SESClient({ region: 'us-east-1' });
    const adminEmails = ['CEO@cocreateidea.com', 'COO@cocreateidea.com', 'CTO@cocreateidea.com'];
    const ccEmail = 'info@cocreateidea.com';

    const summaryData = await computeAdminSummaryData({ S3_REGION, ADMIN_PASSWORD, listApplications });
    const html = generateAdminSummaryHtml(summaryData);
    const text = generateAdminSummaryText(summaryData);

    const result = await ses.send(new SendEmailCommand({
      Source: 'noreply@cocreateidea.com',
      Destination: { ToAddresses: adminEmails, CcAddresses: [ccEmail] },
      ReplyToAddresses: ['CEO@cocreateidea.com'],
      Message: {
        Subject: {
          Data: `Admin Cost Summary - ${new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`,
          Charset: 'UTF-8'
        },
        Body: {
          Html: { Data: html, Charset: 'UTF-8' },
          Text: { Data: text, Charset: 'UTF-8' }
        }
      }
    }));

    console.log('[Admin Summary] Sent admin summary to:', adminEmails.join(', '), '+ CC:', ccEmail, 'MessageId:', result.MessageId);

    return {
      statusCode: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        success: true,
        message: `Admin summary sent to ${adminEmail} and ${ccEmail}`,
        userCount: summaryData.users.length,
        grandTotal: summaryData.grandTotal,
        messageId: result.MessageId
      })
    };
  } catch (error) {
    console.error('[Admin Summary] Error:', error);
    return {
      statusCode: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      body: JSON.stringify({ success: false, error: error.message })
    };
  }
}
