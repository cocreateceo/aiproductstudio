/**
 * Clients domain — extracted from index.mjs (Phase 2 modular refactor)
 * Exports: getOrCreateClientProfile, updateClientProfile, listClientProfiles
 */

import { getS3 } from '../lib/aws.mjs';
import { S3_BUCKET } from '../lib/config.mjs';

// Get or create client profile
export async function getOrCreateClientProfile(clientId, visitorInfo) {
  const { GetObjectCommand, PutObjectCommand } = await import('@aws-sdk/client-s3');
  const s3 = getS3();

  const s3Key = `clients/${clientId}.json`;

  // Try to get existing profile
  try {
    const existing = await s3.send(new GetObjectCommand({
      Bucket: S3_BUCKET,
      Key: s3Key
    }));
    const profile = JSON.parse(await existing.Body.transformToString());
    return profile;
  } catch (e) {
    // Create new profile
    const profile = {
      clientId,
      name: visitorInfo.name || null,
      email: visitorInfo.email || null,
      phone: visitorInfo.phone || null,
      company: null,
      createdAt: new Date().toISOString(),
      status: 'prospect', // prospect, applied, approved, building, delivered
      chatSessions: [],
      applications: [],
      builds: [],
      timeline: [{
        event: 'profile_created',
        timestamp: new Date().toISOString()
      }]
    };

    await s3.send(new PutObjectCommand({
      Bucket: S3_BUCKET,
      Key: s3Key,
      Body: JSON.stringify(profile, null, 2),
      ContentType: 'application/json'
    }));
    console.log('Client profile created:', clientId);
    return profile;
  }
}

// Update client profile
export async function updateClientProfile(clientId, updates) {
  const { GetObjectCommand, PutObjectCommand } = await import('@aws-sdk/client-s3');
  const s3 = getS3();

  const s3Key = `clients/${clientId}.json`;

  try {
    const existing = await s3.send(new GetObjectCommand({
      Bucket: S3_BUCKET,
      Key: s3Key
    }));
    const profile = JSON.parse(await existing.Body.transformToString());

    // Apply updates
    if (updates.name) profile.name = updates.name;
    if (updates.email) profile.email = updates.email;
    if (updates.phone) profile.phone = updates.phone;
    if (updates.company) profile.company = updates.company;
    if (updates.status) profile.status = updates.status;

    // Add to arrays
    if (updates.addChatSession && !profile.chatSessions.includes(updates.addChatSession)) {
      profile.chatSessions.push(updates.addChatSession);
    }
    if (updates.addApplication && !profile.applications.includes(updates.addApplication)) {
      profile.applications.push(updates.addApplication);
    }
    if (updates.addBuild && !profile.builds.includes(updates.addBuild)) {
      profile.builds.push(updates.addBuild);
    }

    // Add timeline event
    if (updates.timelineEvent) {
      profile.timeline.push({
        ...updates.timelineEvent,
        timestamp: new Date().toISOString()
      });
    }

    profile.updatedAt = new Date().toISOString();

    await s3.send(new PutObjectCommand({
      Bucket: S3_BUCKET,
      Key: s3Key,
      Body: JSON.stringify(profile, null, 2),
      ContentType: 'application/json'
    }));
    console.log('Client profile updated:', clientId);
    return profile;
  } catch (error) {
    console.error('Update client profile error:', error.message);
    return null;
  }
}

// List all client profiles (for admin)
export async function listClientProfiles(limit = 50) {
  const { ListObjectsV2Command, GetObjectCommand } = await import('@aws-sdk/client-s3');
  const s3 = getS3();

  try {
    const allClients = [];
    const seenEmails = new Set();

    // 1. Get dedicated client profiles from clients/
    const clientsResult = await s3.send(new ListObjectsV2Command({
      Bucket: S3_BUCKET,
      Prefix: 'clients/',
      MaxKeys: limit
    }));
    if (clientsResult.Contents) {
      const profiles = await Promise.all(
        clientsResult.Contents
          .filter(obj => obj.Key.endsWith('.json'))
          .map(async (obj) => {
            try {
              const getResult = await s3.send(new GetObjectCommand({ Bucket: S3_BUCKET, Key: obj.Key }));
              return JSON.parse(await getResult.Body.transformToString());
            } catch (e) { return null; }
          })
      );
      for (const p of profiles.filter(p => p !== null)) {
        allClients.push(p);
        if (p.email) seenEmails.add(p.email.toLowerCase());
      }
    }

    // 2. Also pull from applications/ for clients not yet in clients/
    const appsResult = await s3.send(new ListObjectsV2Command({
      Bucket: S3_BUCKET,
      Prefix: 'applications/',
      MaxKeys: limit * 3
    }));
    if (appsResult.Contents) {
      // Fetch all application data
      const allApps = (await Promise.all(
        appsResult.Contents
          .filter(obj => obj.Key.endsWith('.json'))
          .map(async (obj) => {
            try {
              const getResult = await s3.send(new GetObjectCommand({ Bucket: S3_BUCKET, Key: obj.Key }));
              const app = JSON.parse(await getResult.Body.transformToString());
              return { key: obj.Key, app };
            } catch (e) { return null; }
          })
      )).filter(a => a !== null);

      // Group applications by client email
      const clientApps = {};
      for (const { key, app } of allApps) {
        const email = (app.visitorInfo?.email || app.formData?.email || '').toLowerCase();
        if (!email || seenEmails.has(email)) continue;
        if (!clientApps[email]) clientApps[email] = { apps: [], builds: [] };
        clientApps[email].apps.push({ key, app });
        if (app.jobId) clientApps[email].builds.push(app.jobId);
      }

      // Build one profile per client with correct counts
      for (const [email, data] of Object.entries(clientApps)) {
        seenEmails.add(email);
        // Use the latest application for name/status
        const latest = data.apps.sort((a, b) => new Date(b.app.timestamp || 0) - new Date(a.app.timestamp || 0))[0];
        const app = latest.app;
        allClients.push({
          clientId: email.replace(/[^a-z0-9]/g, '_'),
          name: app.visitorInfo?.name || app.formData?.fullName || app.formData?.full_name || null,
          email: app.visitorInfo?.email || app.formData?.email || null,
          phone: app.visitorInfo?.phone || app.formData?.phone || null,
          company: null,
          createdAt: app.timestamp || new Date().toISOString(),
          submittedAt: app.timestamp || null,
          reviewedAt: app.reviewedAt || null,
          status: app.status || 'applied',
          chatSessions: [],
          applications: data.apps.map(a => a.key),
          builds: data.builds,
          timeline: data.apps.map(a => ({ event: 'application_submitted', timestamp: a.app.timestamp })),
          productIdea: app.formData?.productIdea || app.formData?.product_idea || null,
          guid: app.guid || null,
          source: 'applications'
        });
      }
    }

    // 3. Fetch avatar URLs from user profiles (same pattern as costs/index.mjs)
    await Promise.all(allClients.map(async (client) => {
      if (!client.guid) return;
      try {
        const profileResult = await s3.send(new GetObjectCommand({
          Bucket: S3_BUCKET,
          Key: `users/${client.guid}/profile.json`
        }));
        const profile = JSON.parse(await profileResult.Body.transformToString());
        if (profile.avatarUrl) client.avatarUrl = profile.avatarUrl;
      } catch (e) { /* No profile yet */ }
    }));

    return allClients
      .filter(p => p !== null)
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
      .slice(0, limit);
  } catch (error) {
    console.error('List client profiles error:', error.message);
    return [];
  }
}
