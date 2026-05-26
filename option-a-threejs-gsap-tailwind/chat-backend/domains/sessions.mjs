/**
 * Sessions domain — extracted from index.mjs (Phase 2 modular refactor)
 * Exports: saveChatSession, saveSessionLookup, lookupSessionByContact,
 *          linkSessionToApplication, listChatSessions
 */

import { getS3 } from '../lib/aws.mjs';
import { S3_BUCKET } from '../lib/config.mjs';
import { corsHeaders } from '../lib/http.mjs';
import { generateClientId } from '../lib/ids.mjs';

// Save chat session to S3
export async function saveChatSession(sessionId, source, messages, visitorInfo, status = 'active') {
  const { GetObjectCommand, PutObjectCommand } = await import('@aws-sdk/client-s3');
  const s3 = getS3();

  const prefix = source === 'apply' ? 'chats/apply' : 'chats/landing';
  const s3Key = `${prefix}/${sessionId}.json`;

  // Try to get existing session
  let sessionData = null;
  try {
    const existing = await s3.send(new GetObjectCommand({
      Bucket: S3_BUCKET,
      Key: s3Key
    }));
    sessionData = JSON.parse(await existing.Body.transformToString());
  } catch (e) {
    // New session
    sessionData = {
      sessionId,
      source,
      startedAt: new Date().toISOString(),
      status: 'active',
      clientId: null,
      messages: [],
      metadata: {
        userAgent: visitorInfo.userAgent || null,
        convertedToApplication: null,
        totalMessages: 0
      }
    };
  }

  // Update session
  sessionData.messages = messages.map((m, i) => ({
    ...m,
    timestamp: m.timestamp || new Date().toISOString(),
    index: i
  }));
  sessionData.lastActivity = new Date().toISOString();
  sessionData.status = status;
  sessionData.metadata.totalMessages = messages.length;

  // Update visitor info if available
  if (visitorInfo.name || visitorInfo.email || visitorInfo.phone) {
    sessionData.visitorInfo = {
      name: visitorInfo.name || sessionData.visitorInfo?.name,
      email: visitorInfo.email || sessionData.visitorInfo?.email,
      phone: visitorInfo.phone || sessionData.visitorInfo?.phone
    };

    // Generate/update client ID if we have identifying info
    if (!sessionData.clientId && (visitorInfo.email || visitorInfo.name)) {
      sessionData.clientId = generateClientId(visitorInfo.email, visitorInfo.name);
    }
  }

  try {
    await s3.send(new PutObjectCommand({
      Bucket: S3_BUCKET,
      Key: s3Key,
      Body: JSON.stringify(sessionData, null, 2),
      ContentType: 'application/json'
    }));
    console.log('Chat session saved:', s3Key);
    return { success: true, sessionId, clientId: sessionData.clientId };
  } catch (error) {
    console.error('Save chat session error:', error.message);
    return { success: false, error: error.message };
  }
}

// Save session lookup index (maps phone/email to sessionId)
export async function saveSessionLookup(sessionId, phone, email) {
  const { GetObjectCommand, PutObjectCommand } = await import('@aws-sdk/client-s3');
  const s3 = getS3();

  // Normalize phone and email for lookup
  const normalizedPhone = phone ? phone.replace(/[^0-9]/g, '') : null;
  const normalizedEmail = email ? email.toLowerCase().trim() : null;

  if (!normalizedPhone && !normalizedEmail) {
    console.log('No phone or email to create session lookup');
    return;
  }

  const s3Key = 'session-lookups/index.json';

  // Get existing index or create new one
  let lookupIndex = {};
  try {
    const existing = await s3.send(new GetObjectCommand({
      Bucket: S3_BUCKET,
      Key: s3Key
    }));
    lookupIndex = JSON.parse(await existing.Body.transformToString());
  } catch (e) {
    // Index doesn't exist yet, start with empty object
    lookupIndex = { byPhone: {}, byEmail: {} };
  }

  // Update index with this session
  const sessionRef = {
    sessionId,
    lastActivity: new Date().toISOString()
  };

  if (normalizedPhone) {
    lookupIndex.byPhone[normalizedPhone] = sessionRef;
    console.log('Session lookup added for phone:', normalizedPhone, '->', sessionId);
  }
  if (normalizedEmail) {
    lookupIndex.byEmail[normalizedEmail] = sessionRef;
    console.log('Session lookup added for email:', normalizedEmail, '->', sessionId);
  }

  // Save updated index
  try {
    await s3.send(new PutObjectCommand({
      Bucket: S3_BUCKET,
      Key: s3Key,
      Body: JSON.stringify(lookupIndex, null, 2),
      ContentType: 'application/json'
    }));
    console.log('Session lookup index updated');
  } catch (error) {
    console.error('Failed to save session lookup:', error.message);
  }
}

// Lookup session by phone or email
export async function lookupSessionByContact(phone, email) {
  const { GetObjectCommand } = await import('@aws-sdk/client-s3');
  const s3 = getS3();

  const normalizedPhone = phone ? phone.replace(/[^0-9]/g, '') : null;
  const normalizedEmail = email ? email.toLowerCase().trim() : null;

  if (!normalizedPhone && !normalizedEmail) {
    return { found: false, reason: 'No phone or email provided' };
  }

  const s3Key = 'session-lookups/index.json';

  try {
    const indexResult = await s3.send(new GetObjectCommand({
      Bucket: S3_BUCKET,
      Key: s3Key
    }));
    const lookupIndex = JSON.parse(await indexResult.Body.transformToString());

    // Try to find by phone first, then email
    let sessionRef = null;
    let matchedBy = null;

    if (normalizedPhone && lookupIndex.byPhone && lookupIndex.byPhone[normalizedPhone]) {
      sessionRef = lookupIndex.byPhone[normalizedPhone];
      matchedBy = 'phone';
    } else if (normalizedEmail && lookupIndex.byEmail && lookupIndex.byEmail[normalizedEmail]) {
      sessionRef = lookupIndex.byEmail[normalizedEmail];
      matchedBy = 'email';
    }

    if (!sessionRef) {
      return { found: false, reason: 'No existing session found' };
    }

    // Now fetch the actual session data
    // Try both landing and apply prefixes
    const prefixes = ['chats/landing/', 'chats/apply/'];
    for (const prefix of prefixes) {
      try {
        const sessionResult = await s3.send(new GetObjectCommand({
          Bucket: S3_BUCKET,
          Key: `${prefix}${sessionRef.sessionId}.json`
        }));
        const sessionData = JSON.parse(await sessionResult.Body.transformToString());

        console.log('Found existing session:', sessionRef.sessionId, 'matched by:', matchedBy);

        return {
          found: true,
          sessionId: sessionRef.sessionId,
          matchedBy,
          session: sessionData,
          messages: sessionData.messages || [],
          visitorInfo: sessionData.visitorInfo || {}
        };
      } catch (e) {
        // Session file not found in this prefix, try next
      }
    }

    return { found: false, reason: 'Session file not found' };

  } catch (error) {
    console.error('Session lookup error:', error.message);
    return { found: false, reason: error.message };
  }
}

// Link chat session to application
export async function linkSessionToApplication(sessionId, source, applicationS3Key) {
  const { GetObjectCommand, PutObjectCommand } = await import('@aws-sdk/client-s3');
  const s3 = getS3();

  const prefix = source === 'apply' ? 'chats/apply' : 'chats/landing';
  const s3Key = `${prefix}/${sessionId}.json`;

  try {
    const existing = await s3.send(new GetObjectCommand({
      Bucket: S3_BUCKET,
      Key: s3Key
    }));
    const sessionData = JSON.parse(await existing.Body.transformToString());

    sessionData.metadata.convertedToApplication = applicationS3Key;
    sessionData.status = 'converted';

    await s3.send(new PutObjectCommand({
      Bucket: S3_BUCKET,
      Key: s3Key,
      Body: JSON.stringify(sessionData, null, 2),
      ContentType: 'application/json'
    }));
    console.log('Chat session linked to application:', sessionId, '->', applicationS3Key);
  } catch (error) {
    console.error('Link session error:', error.message);
  }
}

// List all chat sessions (for admin)
export async function listChatSessions(source = 'all', limit = 50) {
  const { ListObjectsV2Command, GetObjectCommand } = await import('@aws-sdk/client-s3');
  const s3 = getS3();

  const prefixes = source === 'all'
    ? ['chats/landing/', 'chats/apply/']
    : [`chats/${source}/`];

  const allSessions = [];

  for (const prefix of prefixes) {
    try {
      const listResult = await s3.send(new ListObjectsV2Command({
        Bucket: S3_BUCKET,
        Prefix: prefix,
        MaxKeys: limit
      }));

      if (listResult.Contents) {
        for (const obj of listResult.Contents) {
          if (obj.Key.endsWith('.json')) {
            try {
              const getResult = await s3.send(new GetObjectCommand({
                Bucket: S3_BUCKET,
                Key: obj.Key
              }));
              const session = JSON.parse(await getResult.Body.transformToString());
              allSessions.push(session);
            } catch (e) {
              console.error('Error reading session:', obj.Key);
            }
          }
        }
      }
    } catch (e) {
      console.error('Error listing sessions:', prefix, e.message);
    }
  }

  // Sort by last activity, newest first
  return allSessions.sort((a, b) =>
    new Date(b.lastActivity || b.startedAt) - new Date(a.lastActivity || a.startedAt)
  );
}

// ---------------------------------------------------------------------------
// handleLookupSession — action 'lookup-session'
// Lookup existing session by phone or email (for returning users)
// ---------------------------------------------------------------------------
export async function handleLookupSession(body, event) {
  const { phone, email } = body;

  if (!phone && !email) {
    return {
      statusCode: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      body: JSON.stringify({ success: false, error: 'Phone or email is required' })
    };
  }

  const result = await lookupSessionByContact(phone, email);

  if (result.found) {
    return {
      statusCode: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        success: true,
        found: true,
        sessionId: result.sessionId,
        matchedBy: result.matchedBy,
        messages: result.messages,
        visitorInfo: result.visitorInfo,
        lastActivity: result.session.lastActivity
      })
    };
  } else {
    return {
      statusCode: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        success: true,
        found: false,
        reason: result.reason
      })
    };
  }
}

// ---------------------------------------------------------------------------
// Routes map
// ---------------------------------------------------------------------------
export const routes = {
  'lookup-session': handleLookupSession,
};
