/**
 * Migration Script - Fix Old Data
 *
 * This script:
 * 1. Adds missing GUIDs to approved S3 applications
 * 2. Adds approved users to DynamoDB tmux-deployments table
 * 3. Fixes client_email → email in Tmux status.json files
 *
 * Run: node migrate-old-data.js
 */

import dotenv from 'dotenv';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { S3Client, GetObjectCommand, PutObjectCommand, ListObjectsV2Command } from '@aws-sdk/client-s3';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand, GetCommand } from '@aws-sdk/lib-dynamodb';
import { fromIni } from '@aws-sdk/credential-providers';

dotenv.config();

// Configuration
const AWS_PROFILE = process.env.AWS_PROFILE || 'cocreate';
const S3_BUCKET = process.env.S3_BUCKET || 'cocreate-applications-data';
const S3_REGION = process.env.AWS_REGION || 'us-east-1';
const TMUX_BUILDER_URL = process.env.TMUX_BUILDER_URL || 'https://d3tfeatcbws1ka.cloudfront.net';
const TMUX_SESSIONS_DIR = process.env.TMUX_SESSIONS_DIR || 'C:/Projects/tmux_Builder/tmux-builder/active_sessions';

// Initialize AWS clients
const s3 = new S3Client({
  region: S3_REGION,
  credentials: fromIni({ profile: AWS_PROFILE })
});

const dynamoClient = new DynamoDBClient({
  region: S3_REGION,
  credentials: fromIni({ profile: AWS_PROFILE })
});
const dynamodb = DynamoDBDocumentClient.from(dynamoClient);

// Generate GUID from email (consistent with Tmux Builder)
function generateGuid(email, phone = '') {
  const input = `${email}:${phone}`;
  return crypto.createHash('sha256').update(input).digest('hex');
}

// Stats
const stats = {
  s3AppsScanned: 0,
  s3AppsUpdated: 0,
  dynamoUsersAdded: 0,
  dynamoUsersSkipped: 0,
  tmuxSessionsScanned: 0,
  tmuxSessionsFixed: 0,
  errors: []
};

// ==================== S3 MIGRATION ====================

async function migrateS3Applications() {
  console.log('\n========== MIGRATING S3 APPLICATIONS ==========\n');

  try {
    // List all applications
    const listResult = await s3.send(new ListObjectsV2Command({
      Bucket: S3_BUCKET,
      Prefix: 'applications/'
    }));

    if (!listResult.Contents || listResult.Contents.length === 0) {
      console.log('No applications found in S3');
      return;
    }

    const jsonFiles = listResult.Contents.filter(obj => obj.Key.endsWith('.json'));
    console.log(`Found ${jsonFiles.length} application files\n`);

    for (const obj of jsonFiles) {
      stats.s3AppsScanned++;

      try {
        // Read application
        const getResult = await s3.send(new GetObjectCommand({
          Bucket: S3_BUCKET,
          Key: obj.Key
        }));
        const body = await getResult.Body.transformToString();
        const app = JSON.parse(body);

        // Check if approved and missing GUID
        if (app.status === 'approved') {
          let needsUpdate = false;
          const email = app.visitorInfo?.email || app.formData?.email;
          const phone = app.visitorInfo?.phone || app.formData?.phone || '';

          if (!email) {
            console.log(`⚠ SKIP: ${obj.Key} - No email found`);
            continue;
          }

          // Add GUID if missing
          if (!app.guid) {
            app.guid = generateGuid(email, phone);
            needsUpdate = true;
            console.log(`+ Adding GUID to: ${email}`);
          }

          // Add sessionLink if missing
          if (!app.sessionLink) {
            app.sessionLink = `${TMUX_BUILDER_URL}/client?guid=${app.guid}`;
            needsUpdate = true;
            console.log(`+ Adding sessionLink to: ${email}`);
          }

          // Save updated application
          if (needsUpdate) {
            await s3.send(new PutObjectCommand({
              Bucket: S3_BUCKET,
              Key: obj.Key,
              Body: JSON.stringify(app, null, 2),
              ContentType: 'application/json'
            }));
            stats.s3AppsUpdated++;
            console.log(`✓ Updated: ${obj.Key}\n`);
          } else {
            console.log(`- Already has GUID: ${email}`);
          }

          // Also add to DynamoDB
          await addUserToDynamoDB(email, app.guid, app.formData?.productIdea || app.formData?.product_idea || 'Project');
        }
      } catch (err) {
        console.error(`✗ Error processing ${obj.Key}:`, err.message);
        stats.errors.push({ file: obj.Key, error: err.message });
      }
    }
  } catch (err) {
    console.error('Error listing S3 applications:', err.message);
    stats.errors.push({ stage: 'S3 listing', error: err.message });
  }
}

// ==================== DYNAMODB MIGRATION ====================

async function addUserToDynamoDB(email, guid, projectName) {
  try {
    // Check if user already exists
    const existing = await dynamodb.send(new GetCommand({
      TableName: 'tmux-deployments',
      Key: {
        userId: email,
        projectId: guid
      }
    }));

    if (existing.Item) {
      console.log(`- DynamoDB: Already exists: ${email}`);
      stats.dynamoUsersSkipped++;
      return;
    }

    // Add user to DynamoDB
    await dynamodb.send(new PutCommand({
      TableName: 'tmux-deployments',
      Item: {
        userId: email,
        projectId: guid,
        email: email,
        projectName: projectName.substring(0, 100) || 'Project',
        awsResources: {},
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        migratedAt: new Date().toISOString()
      }
    }));

    console.log(`✓ DynamoDB: Added user: ${email}`);
    stats.dynamoUsersAdded++;
  } catch (err) {
    console.error(`✗ DynamoDB error for ${email}:`, err.message);
    stats.errors.push({ user: email, error: err.message });
  }
}

// ==================== TMUX STATUS.JSON MIGRATION ====================

async function migrateTmuxSessions() {
  console.log('\n========== MIGRATING TMUX STATUS.JSON FILES ==========\n');

  if (!fs.existsSync(TMUX_SESSIONS_DIR)) {
    console.log(`Tmux sessions directory not found: ${TMUX_SESSIONS_DIR}`);
    return;
  }

  try {
    const sessions = fs.readdirSync(TMUX_SESSIONS_DIR);
    console.log(`Found ${sessions.length} session directories\n`);

    for (const sessionDir of sessions) {
      const statusPath = path.join(TMUX_SESSIONS_DIR, sessionDir, 'status.json');

      if (!fs.existsSync(statusPath)) {
        continue;
      }

      stats.tmuxSessionsScanned++;

      try {
        const statusContent = fs.readFileSync(statusPath, 'utf-8');
        const status = JSON.parse(statusContent);
        let needsUpdate = false;

        // Fix client_email → email
        if (status.client_email && !status.email) {
          status.email = status.client_email;
          needsUpdate = true;
          console.log(`+ Fixing client_email → email: ${sessionDir}`);
        }

        // Fix client_phone → phone
        if (status.client_phone && !status.phone) {
          status.phone = status.client_phone;
          needsUpdate = true;
        }

        // Fix client_name → name
        if (status.client_name && !status.name) {
          status.name = status.client_name;
          needsUpdate = true;
        }

        // Add initial_request from user_request
        if (status.user_request && !status.initial_request) {
          status.initial_request = status.user_request;
          needsUpdate = true;
        }

        if (needsUpdate) {
          status.migratedAt = new Date().toISOString();
          fs.writeFileSync(statusPath, JSON.stringify(status, null, 2));
          stats.tmuxSessionsFixed++;
          console.log(`✓ Fixed: ${sessionDir}`);

          // Also update DynamoDB if email exists
          if (status.email) {
            await addUserToDynamoDB(
              status.email,
              sessionDir, // GUID is the directory name
              status.initial_request || status.user_request || 'Project'
            );
          }
        } else {
          console.log(`- Already OK: ${sessionDir}`);
        }
      } catch (err) {
        console.error(`✗ Error processing ${sessionDir}:`, err.message);
        stats.errors.push({ session: sessionDir, error: err.message });
      }
    }
  } catch (err) {
    console.error('Error reading Tmux sessions directory:', err.message);
    stats.errors.push({ stage: 'Tmux sessions', error: err.message });
  }
}

// ==================== MAIN ====================

async function main() {
  console.log('╔════════════════════════════════════════════════════════════╗');
  console.log('║           DATA MIGRATION SCRIPT                            ║');
  console.log('║  Fixing old data for ai-product-studio + tmux-builder      ║');
  console.log('╚════════════════════════════════════════════════════════════╝');
  console.log(`\nConfiguration:`);
  console.log(`  S3 Bucket: ${S3_BUCKET}`);
  console.log(`  AWS Profile: ${AWS_PROFILE}`);
  console.log(`  Tmux Builder URL: ${TMUX_BUILDER_URL}`);
  console.log(`  Tmux Sessions Dir: ${TMUX_SESSIONS_DIR}`);

  // Run migrations
  await migrateS3Applications();
  await migrateTmuxSessions();

  // Print summary
  console.log('\n╔════════════════════════════════════════════════════════════╗');
  console.log('║                    MIGRATION SUMMARY                       ║');
  console.log('╚════════════════════════════════════════════════════════════╝');
  console.log(`\n  S3 Applications:`);
  console.log(`    Scanned: ${stats.s3AppsScanned}`);
  console.log(`    Updated: ${stats.s3AppsUpdated}`);
  console.log(`\n  DynamoDB Users:`);
  console.log(`    Added: ${stats.dynamoUsersAdded}`);
  console.log(`    Skipped (already exist): ${stats.dynamoUsersSkipped}`);
  console.log(`\n  Tmux Sessions:`);
  console.log(`    Scanned: ${stats.tmuxSessionsScanned}`);
  console.log(`    Fixed: ${stats.tmuxSessionsFixed}`);

  if (stats.errors.length > 0) {
    console.log(`\n  ⚠ Errors: ${stats.errors.length}`);
    stats.errors.forEach(e => console.log(`    - ${JSON.stringify(e)}`));
  } else {
    console.log(`\n  ✓ No errors!`);
  }

  console.log('\n✓ Migration complete!\n');
}

main().catch(err => {
  console.error('Migration failed:', err);
  process.exit(1);
});
