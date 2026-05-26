// domains/builds.mjs — extracted from index.mjs (Phase 2 refactor)
import { S3_BUCKET } from '../lib/config.mjs';
import { getS3 } from '../lib/aws.mjs';

// List all builds with history (for admin)
export async function listBuildHistory(limit = 50) {
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

export async function createBuildJob(applicationData, originalS3Key) {
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
