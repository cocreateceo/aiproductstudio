/**
 * Local Worker for MVP Builder with WebSocket + Agent SDK
 *
 * Features:
 * - WebSocket server for real-time progress updates
 * - Agent SDK for streaming tool use (replaces CLI)
 * - Detailed build logging to S3
 * - Build metadata and agent conversation capture
 */

import { S3Client, ListObjectsV2Command, GetObjectCommand, PutObjectCommand, DeleteObjectCommand, CopyObjectCommand } from '@aws-sdk/client-s3';
import { fromIni } from '@aws-sdk/credential-providers';
import { WebSocketServer } from 'ws';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import { MVPBuilderAgent } from './mvp-agent.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load environment variables
dotenv.config({ path: path.join(__dirname, '.env') });

const S3_BUCKET = process.env.S3_BUCKET || 'ai-product-studio-applications';
const S3_REGION = process.env.AWS_REGION || 'ap-south-1';
const AWS_PROFILE = process.env.AWS_PROFILE || 'sunwaretech';
const POLL_INTERVAL = parseInt(process.env.POLL_INTERVAL) || 10000;
const WS_PORT = parseInt(process.env.WS_PORT) || 5001;
const HTTP_PORT = parseInt(process.env.PORT) || 5000;
const MVP_BUILDER_DIR = path.join(__dirname, '../mvp-builder');
const BUILDS_DIR = path.join(__dirname, '../mvp-builder/builds');

const s3 = new S3Client({
  region: S3_REGION,
  credentials: fromIni({ profile: AWS_PROFILE })
});

// WebSocket server for real-time updates
let wss = null;
const wsClients = new Set();

// Build state
let buildLog = [];
const processingJobs = new Set();
let currentBuildState = null;

// Ensure builds directory exists
if (!fs.existsSync(BUILDS_DIR)) {
  fs.mkdirSync(BUILDS_DIR, { recursive: true });
}

function log(message) {
  const timestamp = new Date().toLocaleString('en-US', { timeZone: 'America/New_York' });
  console.log(`[${timestamp}] ${message}`);
}

// Cancellation tracking
let cancelledJobs = new Set();
let currentJobS3Key = null;

// Initialize WebSocket server
function initWebSocket() {
  wss = new WebSocketServer({ port: WS_PORT });

  wss.on('connection', (ws) => {
    log(`📡 WebSocket client connected (total: ${wss.clients.size})`);
    wsClients.add(ws);

    // Send current state to new client
    if (currentBuildState) {
      ws.send(JSON.stringify({ type: 'state', data: currentBuildState }));
    }

    // Handle incoming messages (for cancel)
    ws.on('message', (data) => {
      try {
        const msg = JSON.parse(data.toString());
        if (msg.type === 'cancel' && msg.s3Key) {
          log(`📡 Received cancel request for: ${msg.s3Key}`);
          cancelledJobs.add(msg.s3Key);
          // Broadcast cancellation
          broadcast('build_cancelled', { s3Key: msg.s3Key });
        }
      } catch (e) {
        log(`📡 Message parse error: ${e.message}`);
      }
    });

    ws.on('close', () => {
      wsClients.delete(ws);
      log(`📡 WebSocket client disconnected (total: ${wss.clients.size})`);
    });

    ws.on('error', (error) => {
      log(`📡 WebSocket error: ${error.message}`);
      wsClients.delete(ws);
    });
  });

  log(`📡 WebSocket server started on port ${WS_PORT}`);
}

// Check if job is cancelled
function isJobCancelled(s3Key) {
  return cancelledJobs.has(s3Key);
}

// Broadcast message to all connected clients
function broadcast(type, data) {
  const message = JSON.stringify({ type, data, timestamp: new Date().toISOString() });

  for (const client of wsClients) {
    if (client.readyState === 1) { // OPEN
      try {
        client.send(message);
      } catch (e) {
        log(`📡 Broadcast error: ${e.message}`);
      }
    }
  }
}

// Update progress in S3 and broadcast
async function updateProgress(jobId, phase, status, message, extra = {}) {
  try {
    let progressData;

    try {
      const getResult = await s3.send(new GetObjectCommand({
        Bucket: S3_BUCKET,
        Key: `progress/${jobId}.json`
      }));
      progressData = JSON.parse(await getResult.Body.transformToString());
    } catch {
      progressData = {
        jobId,
        phases: { architect: {}, developer: {}, deployer: {} },
        logs: []
      };
    }

    const now = new Date().toISOString();

    progressData.currentPhase = phase;
    progressData.status = (status === 'completed' && phase === 'deployer') ? 'completed' : (status === 'failed' ? 'failed' : 'in_progress');
    progressData.phases[phase] = { status, message, updatedAt: now, ...extra };
    progressData.updatedAt = now;
    progressData.logs = progressData.logs || [];
    progressData.logs.push({ timestamp: now, phase, status, message });

    // Add extra data
    if (extra.percent !== undefined) progressData.percent = extra.percent;
    if (extra.iteration !== undefined) progressData.iteration = extra.iteration;
    if (extra.filesCreated) progressData.filesCreated = extra.filesCreated;

    await s3.send(new PutObjectCommand({
      Bucket: S3_BUCKET,
      Key: `progress/${jobId}.json`,
      Body: JSON.stringify(progressData, null, 2),
      ContentType: 'application/json'
    }));

    // Update current state and broadcast
    currentBuildState = {
      jobId,
      phase,
      status,
      message,
      percent: extra.percent || 0,
      ...extra
    };
    broadcast('progress', currentBuildState);

    log(`   📍 Progress: ${phase} - ${status} - ${message} ${extra.percent ? `(${extra.percent}%)` : ''}`);
  } catch (error) {
    log(`   Error updating progress: ${error.message}`);
  }
}

// Add log entry
function addBuildLogEntry(phase, type, content) {
  const entry = {
    timestamp: new Date().toISOString(),
    phase,
    type,
    content: typeof content === 'string' ? content.substring(0, 5000) : JSON.stringify(content).substring(0, 5000)
  };
  buildLog.push(entry);

  // Broadcast log entry
  broadcast('log', entry);
}

// Save build metadata to S3
async function saveBuildMetadata(jobId, jobData, buildDir, status, mvpUrl = null) {
  const metadata = {
    buildId: jobId,
    clientId: jobData.clientId || null,
    applicationId: jobData.applicationS3Key || null,
    client: jobData.client,
    business: jobData.business,
    status,
    timestamps: {
      created: jobData.createdAt,
      started: new Date().toISOString(),
      completed: status === 'completed' || status === 'failed' ? new Date().toISOString() : null
    },
    phases: {
      architect: { status: 'completed' },
      developer: { status: status === 'completed' ? 'completed' : 'in_progress' },
      deployer: { status: status === 'completed' ? 'completed' : 'pending' }
    },
    mvpUrl,
    localPath: buildDir,
    mode: 'local',
    filesCreated: []
  };

  // List files created
  const outputDir = path.join(buildDir, 'output');
  if (fs.existsSync(outputDir)) {
    const listFiles = (dir, prefix = '') => {
      const files = fs.readdirSync(dir);
      for (const file of files) {
        const filePath = path.join(dir, file);
        const relativePath = prefix ? `${prefix}/${file}` : file;
        if (fs.statSync(filePath).isDirectory()) {
          listFiles(filePath, relativePath);
        } else {
          metadata.filesCreated.push(relativePath);
        }
      }
    };
    listFiles(outputDir);
  }

  try {
    await s3.send(new PutObjectCommand({
      Bucket: S3_BUCKET,
      Key: `builds/${jobId}/metadata.json`,
      Body: JSON.stringify(metadata, null, 2),
      ContentType: 'application/json'
    }));
    log(`   Saved build metadata to S3`);
  } catch (error) {
    log(`   Error saving build metadata: ${error.message}`);
  }

  return metadata;
}

// Save agent log to S3
async function saveAgentLog(jobId) {
  if (buildLog.length === 0) return;

  const agentLogData = {
    buildId: jobId,
    capturedAt: new Date().toISOString(),
    totalEntries: buildLog.length,
    entries: buildLog
  };

  try {
    await s3.send(new PutObjectCommand({
      Bucket: S3_BUCKET,
      Key: `builds/${jobId}/agent-log.json`,
      Body: JSON.stringify(agentLogData, null, 2),
      ContentType: 'application/json'
    }));
    log(`   Saved agent log (${buildLog.length} entries) to S3`);
  } catch (error) {
    log(`   Error saving agent log: ${error.message}`);
  }
}

// Update client profile with build info
async function updateClientWithBuild(jobData, jobId, status, mvpUrl) {
  const clientEmail = jobData.client?.email;
  if (!clientEmail) return;

  const clientId = `client-${clientEmail.toLowerCase().replace(/[^a-z0-9]/g, '-')}`;

  try {
    let profile;
    try {
      const getResult = await s3.send(new GetObjectCommand({
        Bucket: S3_BUCKET,
        Key: `clients/${clientId}.json`
      }));
      profile = JSON.parse(await getResult.Body.transformToString());
    } catch {
      log(`   No client profile found for ${clientId}`);
      return;
    }

    if (!profile.builds.includes(jobId)) {
      profile.builds.push(jobId);
    }
    profile.status = status === 'completed' ? 'delivered' : 'building';
    profile.timeline.push({
      event: status === 'completed' ? 'mvp_delivered' : 'build_started',
      timestamp: new Date().toISOString(),
      ref: jobId,
      url: mvpUrl
    });
    profile.updatedAt = new Date().toISOString();

    await s3.send(new PutObjectCommand({
      Bucket: S3_BUCKET,
      Key: `clients/${clientId}.json`,
      Body: JSON.stringify(profile, null, 2),
      ContentType: 'application/json'
    }));
    log(`   Updated client profile: ${clientId}`);
  } catch (error) {
    log(`   Error updating client profile: ${error.message}`);
  }
}

// Process a single job using Agent SDK
async function processJob(jobKey, jobData) {
  const jobId = jobData.jobId;
  const s3Key = jobData.applicationS3Key;
  currentJobS3Key = s3Key; // Track current job for cancellation

  // Check if already processing
  if (processingJobs.has(jobId)) {
    log(`   ⏳ Job ${jobId} already being processed, skipping...`);
    return false;
  }

  // Check if already cancelled
  if (isJobCancelled(s3Key)) {
    log(`   ⏹ Job ${jobId} was cancelled, skipping...`);
    cancelledJobs.delete(s3Key);
    return false;
  }

  // Lock the job
  processingJobs.add(jobId);
  log(`   🔒 Locked job ${jobId} for processing`);

  const clientName = jobData.client?.name || 'unknown';
  const sanitizedName = clientName.toLowerCase().replace(/[^a-z0-9]/g, '-').substring(0, 30);
  const buildDir = path.join(BUILDS_DIR, `${sanitizedName}-${jobId.split('-')[1]}`);

  // Reset build log
  buildLog = [];
  addBuildLogEntry('system', 'action', `Starting build for job ${jobId}`);

  log(`📦 Processing job: ${jobId}`);
  log(`   Client: ${clientName}`);
  log(`   Idea: ${jobData.business?.idea?.substring(0, 100)}...`);

  // Create build directory
  fs.mkdirSync(path.join(buildDir, 'output', 'js'), { recursive: true });

  // Write input.json
  fs.writeFileSync(path.join(buildDir, 'input.json'), JSON.stringify(jobData, null, 2));

  // Update client profile
  await updateClientWithBuild(jobData, jobId, 'building', null);

  // Broadcast build started with s3Key
  broadcast('build_started', { jobId, s3Key, client: jobData.client, business: jobData.business });

  await updateProgress(jobId, 'architect', 'in_progress', 'Starting MVP build with Agent SDK...', { percent: 5 });

  try {
    log(`   🤖 Starting Agent SDK...`);

    // Create the agent with progress callbacks
    const agent = new MVPBuilderAgent({
      workingDir: buildDir,
      apiKey: process.env.ANTHROPIC_API_KEY,

      // Cancellation checker - returns true if job should stop
      shouldCancel: () => {
        if (isJobCancelled(s3Key)) {
          log(`   ⏹ Cancellation detected for ${jobId}`);
          return true;
        }
        return false;
      },

      onProgress: (progress) => {
        // Check for cancellation on each progress update
        if (isJobCancelled(s3Key)) {
          throw new Error('Build cancelled by user');
        }
        updateProgress(jobId, progress.phase, 'in_progress', progress.message, {
          percent: progress.percent,
          iteration: progress.iteration,
          s3Key
        });
        addBuildLogEntry(progress.phase, 'progress', progress.message);
      },

      onThinking: (thinking) => {
        // Log thinking but don't spam
        if (thinking.content.length > 50) {
          addBuildLogEntry('agent', 'thinking', thinking.content.substring(0, 200) + '...');
        }
        broadcast('thinking', { content: thinking.content.substring(0, 500) });
      },

      onToolUse: (tool) => {
        // Check for cancellation before tool execution
        if (isJobCancelled(s3Key)) {
          throw new Error('Build cancelled by user');
        }
        log(`   🔧 Tool: ${tool.tool} - ${JSON.stringify(tool.input).substring(0, 100)}`);
        addBuildLogEntry('agent', 'tool_use', `${tool.tool}: ${JSON.stringify(tool.input).substring(0, 500)}`);
        broadcast('tool_use', tool);
      },

      onMessage: (msg) => {
        if (msg.content) {
          addBuildLogEntry('agent', 'message', msg.content.substring(0, 500));
        }
      },

      onError: (error) => {
        log(`   ❌ Agent error: ${error.message}`);
        addBuildLogEntry('agent', 'error', error.message);
        broadcast('error', error);
      }
    });

    // Run the build
    const result = await agent.build(jobData);

    // Check if index.html was created
    const indexPath = path.join(buildDir, 'output', 'index.html');

    if (fs.existsSync(indexPath)) {
      log(`   ✅ MVP generated successfully!`);

      // Create deployed.json
      const deployedData = {
        jobId,
        status: 'deployed',
        deployedAt: new Date().toISOString(),
        localPath: buildDir,
        localUrl: `http://localhost:${HTTP_PORT}/builds/${path.basename(buildDir)}/output/index.html`,
        mode: 'local',
        filesCreated: result.filesCreated,
        duration: result.duration,
        tokens: result.tokens
      };

      fs.writeFileSync(path.join(buildDir, 'output', 'deployed.json'), JSON.stringify(deployedData, null, 2));

      await updateProgress(jobId, 'deployer', 'completed', `MVP ready!`, {
        percent: 100,
        mvpUrl: deployedData.localUrl,
        filesCreated: result.filesCreated
      });

      addBuildLogEntry('system', 'action', `MVP deployed at ${deployedData.localUrl}`);
      await saveBuildMetadata(jobId, jobData, buildDir, 'completed', deployedData.localUrl);
      await saveAgentLog(jobId);
      await updateClientWithBuild(jobData, jobId, 'completed', deployedData.localUrl);

      // Broadcast completion
      broadcast('build_completed', {
        jobId,
        mvpUrl: deployedData.localUrl,
        filesCreated: result.filesCreated,
        duration: result.duration
      });

      // Update progress with URL
      try {
        const progressResult = await s3.send(new GetObjectCommand({
          Bucket: S3_BUCKET,
          Key: `progress/${jobId}.json`
        }));
        const progressData = JSON.parse(await progressResult.Body.transformToString());
        progressData.result = {
          mvpUrl: deployedData.localUrl,
          localPath: buildDir,
          mode: 'local'
        };
        await s3.send(new PutObjectCommand({
          Bucket: S3_BUCKET,
          Key: `progress/${jobId}.json`,
          Body: JSON.stringify(progressData, null, 2),
          ContentType: 'application/json'
        }));
      } catch (e) {
        log(`   Warning: Could not update progress with URL: ${e.message}`);
      }

    } else {
      log(`   ❌ MVP generation failed - no index.html created`);
      addBuildLogEntry('system', 'error', 'MVP generation failed - no index.html created');
      await saveBuildMetadata(jobId, jobData, buildDir, 'failed', null);
      await saveAgentLog(jobId);
      await updateProgress(jobId, 'developer', 'failed', 'Failed to generate MVP files');
      broadcast('build_failed', { jobId, error: 'No index.html created' });
    }

  } catch (error) {
    log(`   ❌ Build error: ${error.message}`);
    addBuildLogEntry('system', 'error', error.message);
    await saveBuildMetadata(jobId, jobData, buildDir, 'failed', null);
    await saveAgentLog(jobId);
    await updateProgress(jobId, 'architect', 'failed', `Error: ${error.message}`);
    broadcast('build_failed', { jobId, error: error.message });
  }

  // Move job to processed
  try {
    await s3.send(new CopyObjectCommand({
      Bucket: S3_BUCKET,
      CopySource: `${S3_BUCKET}/${jobKey}`,
      Key: jobKey.replace('jobs/', 'processed/')
    }));
    await s3.send(new DeleteObjectCommand({
      Bucket: S3_BUCKET,
      Key: jobKey
    }));
    log(`   Moved job to processed/`);
  } catch (e) {
    log(`   Warning: Could not move job: ${e.message}`);
  }

  // Release lock
  processingJobs.delete(jobId);
  currentBuildState = null;
  log(`   🔓 Released lock for job ${jobId}`);

  return true;
}

// Poll for jobs
async function pollForJobs() {
  try {
    const listResult = await s3.send(new ListObjectsV2Command({
      Bucket: S3_BUCKET,
      Prefix: 'jobs/'
    }));

    const jobs = (listResult.Contents || []).filter(obj => obj.Key.endsWith('.json'));

    if (jobs.length > 0) {
      log(`📋 Found ${jobs.length} pending job(s)`);

      for (const job of jobs) {
        try {
          const getResult = await s3.send(new GetObjectCommand({
            Bucket: S3_BUCKET,
            Key: job.Key
          }));
          const jobData = JSON.parse(await getResult.Body.transformToString());
          await processJob(job.Key, jobData);
        } catch (error) {
          log(`❌ Error processing ${job.Key}: ${error.message}`);
        }
      }
    }
  } catch (error) {
    log(`❌ Poll error: ${error.message}`);
  }
}

// Main loop
async function main() {
  console.log('');
  console.log('🔨 AI Product Studio - Local MVP Builder Worker');
  console.log('================================================');
  console.log(`   S3 Bucket: ${S3_BUCKET}`);
  console.log(`   Poll Interval: ${POLL_INTERVAL / 1000}s`);
  console.log(`   WebSocket Port: ${WS_PORT}`);
  console.log(`   Builds Dir: ${BUILDS_DIR}`);
  console.log('');

  // Start WebSocket server
  initWebSocket();

  console.log('   Waiting for approved applications...');
  console.log('');

  // Initial poll
  await pollForJobs();

  // Poll loop
  setInterval(pollForJobs, POLL_INTERVAL);
}

main().catch(console.error);
