/**
 * AWS Cost Calculation Handlers
 *
 * Extracted from main index.mjs for better organization.
 * Handles:
 * - admin-costs-summary: All users with total costs (admin only)
 * - user-costs: Current user's projects with costs
 *
 * The user-costs handler uses tmux-builder API as the source of truth
 * for deployments and auto-syncs missing records to DynamoDB.
 */

import crypto from 'crypto';

const TMUX_BUILDER_API = 'https://d3tfeatcbws1ka.cloudfront.net';

/**
 * Get S3 bucket name from a deployment record, handling both camelCase and snake_case keys.
 */
export function getBucket(awsResources) {
  return awsResources?.s3Bucket || awsResources?.s3_bucket || '';
}

/**
 * Get deployed URL from a deployment record, handling all field name variants.
 */
export function getDeployedUrl(awsResources) {
  return awsResources?.deployed_url || awsResources?.cloudFrontUrl || awsResources?.cloudfront_url || '';
}

/**
 * Generate stable projectId from guid + bucket (same logic as ws_server.py).
 */
function getProjectId(guid, s3Bucket) {
  if (s3Bucket) {
    return crypto.createHash('sha256').update(`${guid}:${s3Bucket}`).digest('hex');
  }
  return guid;
}

/**
 * Extract S3 bucket name from a CloudFront distribution origin domain.
 * e.g. "tmux-abc123-shop.s3.amazonaws.com" -> "tmux-abc123-shop"
 *      "tmux-abc123-shop.s3-website-us-east-1.amazonaws.com" -> "tmux-abc123-shop"
 */
function bucketFromOrigin(originDomain) {
  if (!originDomain) return '';
  const match = originDomain.match(/^([^.]+)\./);
  return match ? match[1] : '';
}

/**
 * Fetch real deployments from tmux-builder API for a session GUID.
 * Returns array of { project_name, url, deployed_at, status }.
 */
export async function fetchTmuxDeployments(guid) {
  try {
    const resp = await fetch(`${TMUX_BUILDER_API}/api/deployments?guid=${encodeURIComponent(guid)}`);
    const data = await resp.json();
    if (data.success && data.deployments) {
      return data.deployments;
    }
  } catch (e) {
    console.log('[User Costs] Could not fetch tmux-builder deployments:', e.message);
  }
  return [];
}

/**
 * Look up the S3 bucket for a CloudFront URL by checking the distribution's origin.
 */
async function lookupBucketFromCloudFront(cfClient, cloudfrontUrl) {
  if (!cloudfrontUrl) return '';
  try {
    // Extract domain from URL: "https://d3bsxe90w0wplo.cloudfront.net" -> "d3bsxe90w0wplo.cloudfront.net"
    const domain = cloudfrontUrl.replace('https://', '').replace('http://', '').split('/')[0];

    const { ListDistributionsCommand } = await import('@aws-sdk/client-cloudfront');
    const result = await cfClient.send(new ListDistributionsCommand({}));
    for (const dist of result.DistributionList?.Items || []) {
      if (dist.DomainName === domain) {
        const origin = dist.Origins?.Items?.[0];
        if (origin) {
          return bucketFromOrigin(origin.DomainName);
        }
      }
    }
  } catch (e) {
    console.log('[User Costs] CloudFront lookup error:', e.message);
  }
  return '';
}

/**
 * Sync tmux-builder deployments into DynamoDB.
 * For each deployment from tmux-builder that doesn't exist in DynamoDB, create a record.
 * Returns the full list of deployments (merged: DynamoDB existing + newly created).
 */
export async function syncDeploymentsToDynamo({ guid, userEmail, tmuxDeployments, dynamoDeployments, dynamodb, cfClient, PutCommand }) {
  // Build a set of CloudFront URLs already in DynamoDB
  const existingUrls = new Set();
  for (const dep of dynamoDeployments) {
    const url = getDeployedUrl(dep.awsResources);
    if (url) existingUrls.add(url);
  }

  const newRecords = [];

  for (const tmuxDep of tmuxDeployments) {
    const cfUrl = tmuxDep.url;
    if (!cfUrl || existingUrls.has(cfUrl)) continue;

    // This deployment is missing from DynamoDB — look up its S3 bucket
    const bucket = await lookupBucketFromCloudFront(cfClient, cfUrl);
    if (!bucket) {
      console.log('[User Costs] Could not find S3 bucket for', cfUrl, '— skipping');
      continue;
    }

    // Extract CloudFront distribution ID
    let cfId = '';
    try {
      const domain = cfUrl.replace('https://', '').split('/')[0];
      const { ListDistributionsCommand } = await import('@aws-sdk/client-cloudfront');
      const result = await cfClient.send(new ListDistributionsCommand({}));
      for (const dist of result.DistributionList?.Items || []) {
        if (dist.DomainName === domain) { cfId = dist.Id; break; }
      }
    } catch (e) { /* ignore */ }

    const projectId = getProjectId(guid, bucket);
    const newItem = {
      userId: userEmail,
      projectId,
      projectName: tmuxDep.project_name || 'Project',
      email: userEmail,
      awsResources: {
        s3Bucket: bucket,
        cloudFrontUrl: cfUrl,
        deployed_url: cfUrl,
        region: 'us-east-1',
        ...(cfId && { cloudFrontId: cfId })
      },
      createdAt: tmuxDep.deployed_at || new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      autoSynced: true
    };

    console.log('[User Costs] Auto-syncing deployment to DynamoDB:', tmuxDep.project_name, '→ bucket:', bucket);

    try {
      await dynamodb.send(new PutCommand({ TableName: 'tmux-deployments', Item: newItem }));
      newRecords.push(newItem);
    } catch (e) {
      console.log('[User Costs] Failed to backfill DynamoDB record:', e.message);
    }
  }

  return [...dynamoDeployments, ...newRecords];
}


/**
 * Handle admin-costs-summary action.
 * Auto-syncs ALL users' deployments from tmux-builder, then calculates costs.
 * This is the global solution — works for all users regardless of whether
 * they've visited their user dashboard.
 */
export async function handleAdminCostsSummary({ body, corsHeaders, S3_REGION, ADMIN_PASSWORD, listApplications }) {
  const { password } = body;
  if (password !== ADMIN_PASSWORD) {
    return {
      statusCode: 401,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      body: JSON.stringify({ success: false, error: 'Unauthorized' })
    };
  }

  try {
    const { DynamoDBClient } = await import('@aws-sdk/client-dynamodb');
    const { DynamoDBDocumentClient, ScanCommand, QueryCommand, PutCommand } = await import('@aws-sdk/lib-dynamodb');
    const { S3Client, ListObjectsV2Command } = await import('@aws-sdk/client-s3');
    const { CloudFrontClient } = await import('@aws-sdk/client-cloudfront');

    const dynamoClient = new DynamoDBClient({ region: S3_REGION });
    const dynamodb = DynamoDBDocumentClient.from(dynamoClient);
    const s3 = new S3Client({ region: S3_REGION });
    const cfClient = new CloudFrontClient({ region: S3_REGION });

    // Step 1: Get all applications from S3 to find approved users with GUIDs
    let approvedApps = [];
    try {
      const allApps = await listApplications();
      approvedApps = allApps.filter(app => app.guid && app.visitorInfo?.email);
      console.log('[Admin Costs] Found', approvedApps.length, 'approved apps with GUIDs');
    } catch (e) {
      console.log('[Admin Costs] Could not list applications:', e.message);
    }

    // Step 2: Auto-sync each approved user's deployments from tmux-builder
    for (const app of approvedApps) {
      const guid = app.guid;
      const email = app.visitorInfo?.email;
      try {
        const tmuxDeps = await fetchTmuxDeployments(guid);
        if (tmuxDeps.length === 0) continue;

        // Check existing DynamoDB records for this user
        const queryResult = await dynamodb.send(new QueryCommand({
          TableName: 'tmux-deployments',
          KeyConditionExpression: 'userId = :email',
          ExpressionAttributeValues: { ':email': email }
        }));
        const existingDeps = queryResult.Items || [];

        // Sync missing deployments
        await syncDeploymentsToDynamo({
          guid, userEmail: email, tmuxDeployments: tmuxDeps,
          dynamoDeployments: existingDeps, dynamodb, cfClient, PutCommand
        });
      } catch (e) {
        console.log('[Admin Costs] Sync error for', email, ':', e.message);
      }
    }

    // Step 3: Scan all deployments from DynamoDB (now includes auto-synced records)
    const scanResult = await dynamodb.send(new ScanCommand({
      TableName: 'tmux-deployments'
    }));
    const deployments = scanResult.Items || [];
    console.log('[Admin Costs] Total DynamoDB records after sync:', deployments.length);

    // Group by user — only include records that have actual S3 buckets
    // Filter out test/example domains permanently
    const TEST_EMAIL_PATTERNS = ['@example.com', '@testflow.com', '@test.com', '@localhost'];
    const isTestUser = (email) => !email || TEST_EMAIL_PATTERNS.some(p => email.toLowerCase().includes(p));

    const userMap = {};
    for (const dep of deployments) {
      const bucket = getBucket(dep.awsResources);
      if (!bucket) continue; // Skip records without S3 buckets

      const userId = dep.userId || dep.email || 'unknown';
      if (isTestUser(userId)) continue; // Skip test users permanently
      if (!userMap[userId]) {
        userMap[userId] = {
          userId,
          email: dep.email || userId,
          projectCount: 0,
          projects: [],
          costs: { s3: 0, cloudfront: 0, total: 0 }
        };
      }
      userMap[userId].projectCount++;
      userMap[userId].projects.push({
        projectId: dep.projectId,
        projectName: dep.projectName || 'Project',
        awsResources: dep.awsResources || {},
        deployedUrl: getDeployedUrl(dep.awsResources),
        createdAt: dep.createdAt
      });
    }

    // Step 3b: Ensure ALL approved users appear (even with zero projects)
    for (const app of approvedApps) {
      const email = app.visitorInfo?.email;
      if (!email || isTestUser(email)) continue;
      if (!userMap[email]) {
        userMap[email] = {
          userId: email,
          email,
          name: app.visitorInfo?.name || email,
          guid: app.guid,
          projectCount: 0,
          projects: [],
          costs: { s3: 0, cloudfront: 0, total: 0 },
          status: app.status || 'approved',
          approvedAt: app.reviewedAt || null,
          sessionLink: app.sessionLink || null,
          productIdea: app.formData?.productIdea || app.formData?.product_idea || ''
        };
      } else {
        // Enrich existing entry with application data
        userMap[email].name = app.visitorInfo?.name || userMap[email].name || email;
        userMap[email].guid = app.guid;
        userMap[email].status = app.status || 'approved';
        userMap[email].approvedAt = app.reviewedAt || null;
        userMap[email].sessionLink = app.sessionLink || null;
        userMap[email].productIdea = app.formData?.productIdea || app.formData?.product_idea || '';
      }
    }

    // Step 3c: Fetch avatar URLs from user profiles in S3
    const { GetObjectCommand } = await import('@aws-sdk/client-s3');
    const DATA_BUCKET = 'cocreate-applications-data';
    await Promise.all(Object.values(userMap).map(async (user) => {
      if (!user.guid) return;
      try {
        const profileResult = await s3.send(new GetObjectCommand({
          Bucket: DATA_BUCKET,
          Key: `users/${user.guid}/profile.json`
        }));
        const profile = JSON.parse(await profileResult.Body.transformToString());
        if (profile.avatarUrl) user.avatarUrl = profile.avatarUrl;
        if (profile.name && !user.name) user.name = profile.name;
      } catch (e) {
        // No profile yet — keep default
      }
    }));

    // Step 4: Calculate costs for each user's projects
    const AWS_PRICING = { s3StoragePerGBPerMonth: 0.023, cloudfrontBasePerMonth: 0.01 };

    for (const userId in userMap) {
      const user = userMap[userId];
      for (const project of user.projects) {
        const bucket = getBucket(project.awsResources);
        let projectCost = { s3: { storage: 0, total: 0 }, cloudfront: { dataTransfer: 0, requests: 0, total: 0 }, total: 0, metrics: { s3SizeBytes: 0, cloudfrontRequests: 0 } };

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
            projectCost.s3.storage = sizeGB * AWS_PRICING.s3StoragePerGBPerMonth;
            projectCost.s3.total = projectCost.s3.storage;
          } catch (e) {
            console.log('[Admin Costs] S3 bucket error for', bucket, ':', e.message);
          }
        }

        projectCost.cloudfront.dataTransfer = AWS_PRICING.cloudfrontBasePerMonth;
        projectCost.cloudfront.total = projectCost.cloudfront.dataTransfer;
        projectCost.total = projectCost.s3.total + projectCost.cloudfront.total;

        project.costs = projectCost;
        user.costs.s3 += projectCost.s3.total;
        user.costs.cloudfront += projectCost.cloudfront.total;
        user.costs.total += projectCost.total;
      }
    }

    const users = Object.values(userMap);
    const totals = {
      estimated: users.reduce((sum, u) => sum + u.costs.total, 0),
      s3: users.reduce((sum, u) => sum + u.costs.s3, 0),
      cloudfront: users.reduce((sum, u) => sum + u.costs.cloudfront, 0),
      projectCount: users.reduce((sum, u) => sum + u.projectCount, 0),
      userCount: users.length,
      activeUsers: users.filter(u => u.projectCount > 0).length
    };

    return {
      statusCode: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      body: JSON.stringify({ success: true, totals, users, lastUpdated: new Date().toISOString() })
    };
  } catch (error) {
    console.error('[Admin Costs] Error:', error);
    return {
      statusCode: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      body: JSON.stringify({ success: false, error: error.message })
    };
  }
}

/**
 * Handle user-costs action.
 *
 * Uses tmux-builder API as source of truth for the deployment list.
 * Auto-syncs any missing deployments to DynamoDB (global self-healing).
 * Then calculates costs from S3 bucket sizes.
 */
export async function handleUserCosts({ body, corsHeaders, S3_REGION, listApplications }) {
  try {
    const { guid, email: requestEmail, period = 'monthly' } = body;
    if (!guid) {
      return {
        statusCode: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify({ success: false, error: 'guid is required' })
      };
    }

    const { DynamoDBClient } = await import('@aws-sdk/client-dynamodb');
    const { DynamoDBDocumentClient, QueryCommand, PutCommand } = await import('@aws-sdk/lib-dynamodb');
    const { S3Client, ListObjectsV2Command } = await import('@aws-sdk/client-s3');
    const { CloudFrontClient } = await import('@aws-sdk/client-cloudfront');

    const dynamoClient = new DynamoDBClient({ region: S3_REGION });
    const dynamodb = DynamoDBDocumentClient.from(dynamoClient);
    const s3 = new S3Client({ region: S3_REGION });
    const cfClient = new CloudFrontClient({ region: S3_REGION });

    // Resolve user email
    let userEmail = requestEmail;
    if (!userEmail) {
      try {
        const applications = await listApplications();
        const app = applications.find(a => a.guid === guid);
        userEmail = app?.visitorInfo?.email || app?.formData?.email || null;
        console.log('[User Costs] Resolved email from S3 application:', userEmail);
      } catch (e) {
        console.log('[User Costs] Could not resolve email from S3:', e.message);
      }
    }

    if (!userEmail) {
      console.log('[User Costs] No email found for guid:', guid);
      return {
        statusCode: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          success: true,
          costs: {
            period,
            periodLabel: '',
            periodStart: new Date().toISOString(),
            periodEnd: new Date().toISOString(),
            costs: { s3: 0, cloudfront: 0, total: 0 },
            projects: []
          }
        })
      };
    }

    console.log('[User Costs] Processing costs for', userEmail, 'guid:', guid);

    // Step 1: Fetch real deployments from tmux-builder (source of truth)
    const tmuxDeployments = await fetchTmuxDeployments(guid);
    console.log('[User Costs] Tmux-builder reports', tmuxDeployments.length, 'deployments');

    // Step 2: Query existing DynamoDB records
    const queryResult = await dynamodb.send(new QueryCommand({
      TableName: 'tmux-deployments',
      KeyConditionExpression: 'userId = :email',
      ExpressionAttributeValues: { ':email': userEmail }
    }));
    const dynamoDeployments = queryResult.Items || [];
    console.log('[User Costs] DynamoDB has', dynamoDeployments.length, 'records');

    // Step 3: Auto-sync — backfill any missing deployments to DynamoDB
    let allDeployments = dynamoDeployments;
    if (tmuxDeployments.length > 0) {
      allDeployments = await syncDeploymentsToDynamo({
        guid, userEmail, tmuxDeployments, dynamoDeployments, dynamodb, cfClient, PutCommand
      });
      console.log('[User Costs] After sync:', allDeployments.length, 'total deployments');
    }

    // Filter: only include deployments that have actual AWS resources (S3 bucket)
    const deploymentsWithResources = allDeployments.filter(dep => getBucket(dep.awsResources));
    console.log('[User Costs]', deploymentsWithResources.length, 'deployments have S3 buckets');

    // Calculate calendar-based period
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
      periodStart: periodStart.toISOString(),
      periodEnd: periodEnd.toISOString(),
      costs: { s3: 0, cloudfront: 0, total: 0 },
      projects: []
    };

    // Calculate costs only for deployments with actual S3 buckets
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
          console.log('[User Costs] S3 bucket error for', bucket, ':', e.message);
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

    return {
      statusCode: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      body: JSON.stringify({ success: true, costs: result })
    };
  } catch (error) {
    console.error('[User Costs] Error:', error);
    return {
      statusCode: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      body: JSON.stringify({ success: false, error: error.message })
    };
  }
}
