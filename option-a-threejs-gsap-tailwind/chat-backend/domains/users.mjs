/**
 * User auth domain handlers
 * Extracted from index.mjs as part of the modular Lambda refactor.
 */

import { getS3 } from '../lib/aws.mjs';
import { S3_BUCKET } from '../lib/config.mjs';
import { corsHeaders } from '../lib/http.mjs';
import { renderUserWelcome, renderPasswordResetLink, renderPasswordChanged, renderNewLoginAlert } from '../email-templates.mjs';
import { sendTemplate, isResetRateLimited } from '../email-service.mjs';
import { listApplications } from './applications.mjs';

// ---------------------------------------------------------------------------
// Module-level helpers (were inner functions inside handler)
// ---------------------------------------------------------------------------

function generateSessionToken() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let token = '';
  for (let i = 0; i < 64; i++) {
    token += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return token;
}

async function validateSession(guid, sessionToken) {
  const { GetObjectCommand } = await import('@aws-sdk/client-s3');
  const s3 = getS3();
  try {
    const result = await s3.send(new GetObjectCommand({
      Bucket: S3_BUCKET,
      Key: `users/${guid}/sessions.json`
    }));
    const sessions = JSON.parse(await result.Body.transformToString());
    const now = new Date();
    const validToken = sessions.tokens?.find(t =>
      t.token === sessionToken && new Date(t.expiresAt) > now
    );
    return !!validToken;
  } catch (e) {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

export async function handleUserCheck(body, event) {
  const { guid } = body;
  if (!guid) {
    return {
      statusCode: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      body: JSON.stringify({ success: false, error: 'GUID is required' })
    };
  }

  try {
    const { GetObjectCommand } = await import('@aws-sdk/client-s3');
    const s3 = getS3();

    // Get application by guid
    const applications = await listApplications();
    const app = applications.find(a => a.guid === guid);
    if (!app) {
      return {
        statusCode: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify({ success: false, exists: false, hasAccount: false, error: 'Invalid session ID' })
      };
    }

    // Check if has account
    let hasAccount = false;
    let profile = { name: app.visitorInfo?.name || app.formData?.fullName || '', email: app.visitorInfo?.email || app.formData?.email || '' };
    try {
      await s3.send(new GetObjectCommand({ Bucket: S3_BUCKET, Key: `users/${guid}/credentials.json` }));
      hasAccount = true;
      const profileResult = await s3.send(new GetObjectCommand({ Bucket: S3_BUCKET, Key: `users/${guid}/profile.json` }));
      profile = JSON.parse(await profileResult.Body.transformToString());
    } catch (e) { /* No account or profile */ }

    return {
      statusCode: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      body: JSON.stringify({ success: true, exists: true, hasAccount, profile, applicationData: app })
    };
  } catch (error) {
    return {
      statusCode: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      body: JSON.stringify({ success: false, error: error.message })
    };
  }
}

export async function handleUserSignup(body, event) {
  const { guid, email, password } = body;
  if (!guid || !email || !password) {
    return {
      statusCode: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      body: JSON.stringify({ success: false, error: 'GUID, email, and password are required' })
    };
  }
  if (password.length < 6) {
    return {
      statusCode: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      body: JSON.stringify({ success: false, error: 'Password must be at least 6 characters' })
    };
  }

  try {
    const { GetObjectCommand, PutObjectCommand } = await import('@aws-sdk/client-s3');
    const bcrypt = (await import('bcryptjs')).default;
    const s3 = getS3();

    // Check if account exists
    try {
      await s3.send(new GetObjectCommand({ Bucket: S3_BUCKET, Key: `users/${guid}/credentials.json` }));
      return {
        statusCode: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify({ success: false, error: 'Account already exists. Please login instead.' })
      };
    } catch (e) { /* Good - no existing account */ }

    // Verify guid exists
    const applications = await listApplications();
    const app = applications.find(a => a.guid === guid);
    if (!app) {
      return {
        statusCode: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify({ success: false, error: 'Invalid session ID' })
      };
    }

    // Hash password and save credentials
    const passwordHash = await bcrypt.hash(password, 10);
    const sessionToken = generateSessionToken();
    const now = new Date();
    const expiresAt = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

    await s3.send(new PutObjectCommand({
      Bucket: S3_BUCKET,
      Key: `users/${guid}/credentials.json`,
      Body: JSON.stringify({ email: email.toLowerCase().trim(), passwordHash, createdAt: now.toISOString() }),
      ContentType: 'application/json'
    }));

    await s3.send(new PutObjectCommand({
      Bucket: S3_BUCKET,
      Key: `users/${guid}/sessions.json`,
      Body: JSON.stringify({ tokens: [{ token: sessionToken, createdAt: now.toISOString(), expiresAt: expiresAt.toISOString() }] }),
      ContentType: 'application/json'
    }));

    await s3.send(new PutObjectCommand({
      Bucket: S3_BUCKET,
      Key: `users/${guid}/profile.json`,
      Body: JSON.stringify({ name: app.visitorInfo?.name || app.formData?.fullName || '', email: email.toLowerCase().trim(), createdAt: now.toISOString() }),
      ContentType: 'application/json'
    }));

    // Send welcome email (fire-and-forget)
    sendTemplate(email, renderUserWelcome, { name: app.visitorInfo?.name || app.formData?.fullName || '', guid }).catch(e => console.error('Welcome email failed:', e.message));

    // Create email-index entry for forgot-password lookup
    const crypto = await import('crypto');
    const emailHash = crypto.createHash('sha256').update(email.toLowerCase().trim()).digest('hex');
    await s3.send(new PutObjectCommand({
      Bucket: S3_BUCKET,
      Key: `email-index/${emailHash}.json`,
      Body: JSON.stringify({ guid, email: email.toLowerCase().trim() }),
      ContentType: 'application/json'
    }));

    return {
      statusCode: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      body: JSON.stringify({ success: true, sessionToken, expiresAt: expiresAt.toISOString() })
    };
  } catch (error) {
    return {
      statusCode: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      body: JSON.stringify({ success: false, error: error.message })
    };
  }
}

export async function handleUserLogin(body, event) {
  const { guid, email, password } = body;
  if (!guid || !email || !password) {
    return {
      statusCode: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      body: JSON.stringify({ success: false, error: 'GUID, email, and password are required' })
    };
  }

  try {
    const { GetObjectCommand, PutObjectCommand } = await import('@aws-sdk/client-s3');
    const bcrypt = (await import('bcryptjs')).default;
    const s3 = getS3();

    // Get credentials
    let credentials;
    try {
      const result = await s3.send(new GetObjectCommand({ Bucket: S3_BUCKET, Key: `users/${guid}/credentials.json` }));
      credentials = JSON.parse(await result.Body.transformToString());
    } catch (e) {
      return {
        statusCode: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify({ success: false, error: 'Account not found. Please sign up first.' })
      };
    }

    // Verify password
    const isValid = await bcrypt.compare(password, credentials.passwordHash);
    if (!isValid || credentials.email !== email.toLowerCase().trim()) {
      return {
        statusCode: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify({ success: false, error: 'Invalid email or password' })
      };
    }

    // Create session
    const sessionToken = generateSessionToken();
    const now = new Date();
    const expiresAt = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

    let sessions = { tokens: [] };
    try {
      const result = await s3.send(new GetObjectCommand({ Bucket: S3_BUCKET, Key: `users/${guid}/sessions.json` }));
      sessions = JSON.parse(await result.Body.transformToString());
    } catch (e) { /* No sessions yet */ }

    sessions.tokens.push({ token: sessionToken, createdAt: now.toISOString(), expiresAt: expiresAt.toISOString() });
    sessions.tokens = sessions.tokens.slice(-5);

    await s3.send(new PutObjectCommand({
      Bucket: S3_BUCKET,
      Key: `users/${guid}/sessions.json`,
      Body: JSON.stringify(sessions),
      ContentType: 'application/json'
    }));

    // Track login IP and send new-login alert if needed (fire-and-forget)
    (async () => {
      try {
        const clientIp = event.requestContext?.http?.sourceIp || event.headers?.['X-Forwarded-For']?.split(',')[0]?.trim() || 'Unknown';
        let loginHistory = { logins: [] };
        try {
          const histResult = await s3.send(new GetObjectCommand({ Bucket: S3_BUCKET, Key: `users/${guid}/login-history.json` }));
          loginHistory = JSON.parse(await histResult.Body.transformToString());
        } catch (e) { /* No login history yet */ }

        const isNewIp = !loginHistory.logins.some(l => l.ip === clientIp);
        const isFirstLogin = loginHistory.logins.length === 0;

        loginHistory.logins.push({ ip: clientIp, timestamp: now.toISOString() });
        loginHistory.logins = loginHistory.logins.slice(-10);

        await s3.send(new PutObjectCommand({
          Bucket: S3_BUCKET,
          Key: `users/${guid}/login-history.json`,
          Body: JSON.stringify(loginHistory),
          ContentType: 'application/json'
        }));

        if (isNewIp && !isFirstLogin) {
          const name = credentials.name || email.split('@')[0];
          sendTemplate(email, renderNewLoginAlert, { name, guid, ip: clientIp, timestamp: now.toISOString() }).catch(e => console.error('New login alert email failed:', e.message));
        }
      } catch (e) {
        console.error('Login IP tracking failed:', e.message);
      }
    })();

    return {
      statusCode: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      body: JSON.stringify({ success: true, sessionToken, expiresAt: expiresAt.toISOString() })
    };
  } catch (error) {
    return {
      statusCode: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      body: JSON.stringify({ success: false, error: error.message })
    };
  }
}

export async function handleUserDashboard(body, event) {
  const { guid, sessionToken } = body;
  if (!guid || !sessionToken) {
    return {
      statusCode: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      body: JSON.stringify({ success: false, error: 'GUID and session token are required' })
    };
  }

  try {
    const isValid = await validateSession(guid, sessionToken);
    if (!isValid) {
      return {
        statusCode: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify({ success: false, error: 'Invalid or expired session' })
      };
    }

    const { GetObjectCommand } = await import('@aws-sdk/client-s3');
    const s3 = getS3();

    // Get profile
    let profile = {};
    try {
      const result = await s3.send(new GetObjectCommand({ Bucket: S3_BUCKET, Key: `users/${guid}/profile.json` }));
      profile = JSON.parse(await result.Body.transformToString());
    } catch (e) { /* No profile */ }

    // Get application
    const applications = await listApplications();
    const app = applications.find(a => a.guid === guid);
    if (!app) {
      return {
        statusCode: 404,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify({ success: false, error: 'Application not found' })
      };
    }

    return {
      statusCode: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        success: true,
        data: {
          user: {
            name: profile.name || app.visitorInfo?.name || app.formData?.fullName || '',
            email: profile.email || app.visitorInfo?.email || app.formData?.email || '',
            avatarUrl: profile.avatarUrl || '',
            theme: profile.theme || 'ember'
          },
          application: {
            status: app.status || 'approved',
            guid: app.guid || guid,
            email: app.visitorInfo?.email || app.formData?.email || '',
            formData: app.formData || {},
            submittedAt: app.submittedAt || app.timestamp,
            reviewedAt: app.reviewedAt || '',
            sessionLink: app.sessionLink || '',
            productIdea: app.formData?.productIdea || app.formData?.product_idea || '',
            targetCustomer: app.formData?.targetCustomer || app.formData?.target_customer || '',
            industry: app.formData?.industry || '',
            timeline: app.formData?.timeline || ''
          },
          buildSession: {
            link: app.sessionLink || ''
          }
        }
      })
    };
  } catch (error) {
    return {
      statusCode: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      body: JSON.stringify({ success: false, error: error.message })
    };
  }
}

export async function handleUploadAvatar(body, event) {
  const { guid, sessionToken, image, contentType } = body;
  if (!guid || !sessionToken || !image) {
    return {
      statusCode: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      body: JSON.stringify({ success: false, error: 'Missing required fields' })
    };
  }

  try {
    const isValid = await validateSession(guid, sessionToken);
    if (!isValid) {
      return {
        statusCode: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify({ success: false, error: 'Invalid session' })
      };
    }

    const { S3Client, PutObjectCommand } = await import('@aws-sdk/client-s3');
    const s3 = getS3();

    // Extract base64 data
    const base64Data = image.replace(/^data:image\/\w+;base64,/, '');
    const buffer = Buffer.from(base64Data, 'base64');

    // Determine file extension
    const ext = contentType?.split('/')[1] || 'png';
    const avatarKey = `avatars/${guid}/avatar.${ext}`;

    // Upload to the PUBLIC site bucket (cocreateidea.com) served via CloudFront
    const SITE_BUCKET = 'cocreateidea.com';
    const SITE_REGION = 'ap-south-1';
    const s3Site = new S3Client({ region: SITE_REGION });
    try {
      await s3Site.send(new PutObjectCommand({
        Bucket: SITE_BUCKET,
        Key: avatarKey,
        Body: buffer,
        ContentType: contentType || 'image/png',
        CacheControl: 'no-cache'
      }));
      console.log('[Upload Avatar] Saved to site bucket:', avatarKey);
    } catch (siteErr) {
      console.error('[Upload Avatar] Site bucket upload failed:', siteErr.message);
    }

    // Also save to data bucket as backup (survives site bucket redeploys)
    await s3.send(new PutObjectCommand({
      Bucket: S3_BUCKET,
      Key: `users/${guid}/avatar.${ext}`,
      Body: buffer,
      ContentType: contentType || 'image/png'
    }));

    // URL via CloudFront (public, no pre-signing needed)
    const avatarUrl = `https://www.cocreateidea.com/${avatarKey}?t=${Date.now()}`;

    // Update profile in the private data bucket
    const { GetObjectCommand } = await import('@aws-sdk/client-s3');
    let profile = {};
    try {
      const result = await s3.send(new GetObjectCommand({ Bucket: S3_BUCKET, Key: `users/${guid}/profile.json` }));
      profile = JSON.parse(await result.Body.transformToString());
    } catch (e) { /* No profile yet */ }

    profile.avatarKey = avatarKey;
    profile.avatarUrl = avatarUrl;
    await s3.send(new PutObjectCommand({
      Bucket: S3_BUCKET,
      Key: `users/${guid}/profile.json`,
      Body: JSON.stringify(profile),
      ContentType: 'application/json'
    }));

    return {
      statusCode: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      body: JSON.stringify({ success: true, avatarUrl })
    };
  } catch (error) {
    console.error('[Upload Avatar] Error:', error);
    return {
      statusCode: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      body: JSON.stringify({ success: false, error: error.message })
    };
  }
}

export async function handleSaveTheme(body, event) {
  const { guid, sessionToken, theme } = body;
  if (!guid || !sessionToken || !theme) {
    return {
      statusCode: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      body: JSON.stringify({ success: false, error: 'Missing required fields' })
    };
  }

  // Validate theme
  const validThemes = ['ember', 'coral', 'sunset', 'aurora', 'legacy', 'sandstone', 'champagne', 'zoom'];
  if (!validThemes.includes(theme)) {
    return {
      statusCode: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      body: JSON.stringify({ success: false, error: 'Invalid theme' })
    };
  }

  try {
    const isValid = await validateSession(guid, sessionToken);
    if (!isValid) {
      return {
        statusCode: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify({ success: false, error: 'Invalid session' })
      };
    }

    const { GetObjectCommand, PutObjectCommand } = await import('@aws-sdk/client-s3');
    const s3 = getS3();

    // Get existing profile
    let profile = {};
    try {
      const result = await s3.send(new GetObjectCommand({ Bucket: S3_BUCKET, Key: `users/${guid}/profile.json` }));
      profile = JSON.parse(await result.Body.transformToString());
    } catch (e) { /* No profile yet */ }

    // Update theme
    profile.theme = theme;
    await s3.send(new PutObjectCommand({
      Bucket: S3_BUCKET,
      Key: `users/${guid}/profile.json`,
      Body: JSON.stringify(profile),
      ContentType: 'application/json'
    }));

    return {
      statusCode: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      body: JSON.stringify({ success: true, theme })
    };
  } catch (error) {
    console.error('[Save Theme] Error:', error);
    return {
      statusCode: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      body: JSON.stringify({ success: false, error: error.message })
    };
  }
}

export async function handleUserChangePassword(body, event) {
  const { guid, sessionToken, oldPassword, newPassword } = body;
  if (!guid || !sessionToken || !oldPassword || !newPassword) {
    return {
      statusCode: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      body: JSON.stringify({ success: false, error: 'All fields are required' })
    };
  }

  try {
    const isValid = await validateSession(guid, sessionToken);
    if (!isValid) {
      return {
        statusCode: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify({ success: false, error: 'Invalid or expired session' })
      };
    }

    const { GetObjectCommand, PutObjectCommand } = await import('@aws-sdk/client-s3');
    const bcrypt = (await import('bcryptjs')).default;
    const s3 = getS3();

    const credResult = await s3.send(new GetObjectCommand({ Bucket: S3_BUCKET, Key: `users/${guid}/credentials.json` }));
    const credentials = JSON.parse(await credResult.Body.transformToString());

    const isOldValid = await bcrypt.compare(oldPassword, credentials.passwordHash);
    if (!isOldValid) {
      return {
        statusCode: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify({ success: false, error: 'Current password is incorrect' })
      };
    }

    credentials.passwordHash = await bcrypt.hash(newPassword, 10);
    await s3.send(new PutObjectCommand({
      Bucket: S3_BUCKET,
      Key: `users/${guid}/credentials.json`,
      Body: JSON.stringify(credentials),
      ContentType: 'application/json'
    }));

    // Send password-changed confirmation (fire-and-forget)
    const name = credentials.name || credentials.email?.split('@')[0] || '';
    sendTemplate(credentials.email, renderPasswordChanged, { name }).catch(e => console.error('Password changed email failed:', e.message));

    return {
      statusCode: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      body: JSON.stringify({ success: true })
    };
  } catch (error) {
    return {
      statusCode: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      body: JSON.stringify({ success: false, error: error.message })
    };
  }
}

export async function handleForgotPassword(body, event) {
  const { email } = body;
  const successResponse = {
    statusCode: 200,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    body: JSON.stringify({ success: true, message: 'If an account exists with that email, a reset link has been sent.' })
  };

  if (!email) return successResponse;

  try {
    if (await isResetRateLimited(email)) return successResponse;

    const { GetObjectCommand, PutObjectCommand } = await import('@aws-sdk/client-s3');
    const crypto = await import('crypto');
    const s3 = getS3();

    // Look up GUID from email-index
    const emailHash = crypto.createHash('sha256').update(email.toLowerCase().trim()).digest('hex');
    let emailIndex;
    try {
      const result = await s3.send(new GetObjectCommand({ Bucket: S3_BUCKET, Key: `email-index/${emailHash}.json` }));
      emailIndex = JSON.parse(await result.Body.transformToString());
    } catch (e) {
      return successResponse; // Email not found, return success anyway
    }

    const guid = emailIndex.guid;

    // Generate reset token
    const resetToken = crypto.randomBytes(32).toString('hex');
    const now = new Date();
    const expiresAt = new Date(now.getTime() + 60 * 60 * 1000); // 1 hour

    await s3.send(new PutObjectCommand({
      Bucket: S3_BUCKET,
      Key: `users/${guid}/reset-token.json`,
      Body: JSON.stringify({ token: resetToken, email: email.toLowerCase().trim(), createdAt: now.toISOString(), expiresAt: expiresAt.toISOString() }),
      ContentType: 'application/json'
    }));

    // Get user name for the email
    let name = '';
    try {
      const profileResult = await s3.send(new GetObjectCommand({ Bucket: S3_BUCKET, Key: `users/${guid}/profile.json` }));
      const profile = JSON.parse(await profileResult.Body.transformToString());
      name = profile.name || '';
    } catch (e) { /* No profile */ }

    // Send reset email (fire-and-forget)
    sendTemplate(email, renderPasswordResetLink, { name, guid, resetToken }).catch(e => console.error('Reset email failed:', e.message));

    return successResponse;
  } catch (error) {
    console.error('Forgot password error:', error.message);
    return successResponse; // Always return success
  }
}

export async function handleResetPassword(body, event) {
  const { guid, resetToken, newPassword } = body;
  if (!guid || !resetToken || !newPassword) {
    return {
      statusCode: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      body: JSON.stringify({ success: false, error: 'All fields are required' })
    };
  }
  if (newPassword.length < 6) {
    return {
      statusCode: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      body: JSON.stringify({ success: false, error: 'Password must be at least 6 characters' })
    };
  }

  try {
    const { GetObjectCommand, PutObjectCommand, DeleteObjectCommand } = await import('@aws-sdk/client-s3');
    const bcrypt = (await import('bcryptjs')).default;
    const s3 = getS3();

    // Read and verify reset token
    let storedToken;
    try {
      const result = await s3.send(new GetObjectCommand({ Bucket: S3_BUCKET, Key: `users/${guid}/reset-token.json` }));
      storedToken = JSON.parse(await result.Body.transformToString());
    } catch (e) {
      return {
        statusCode: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify({ success: false, error: 'Invalid or expired reset token' })
      };
    }

    if (storedToken.token !== resetToken || new Date(storedToken.expiresAt) < new Date()) {
      return {
        statusCode: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify({ success: false, error: 'Invalid or expired reset token' })
      };
    }

    // Update password
    const credResult = await s3.send(new GetObjectCommand({ Bucket: S3_BUCKET, Key: `users/${guid}/credentials.json` }));
    const credentials = JSON.parse(await credResult.Body.transformToString());
    credentials.passwordHash = await bcrypt.hash(newPassword, 10);

    await s3.send(new PutObjectCommand({
      Bucket: S3_BUCKET,
      Key: `users/${guid}/credentials.json`,
      Body: JSON.stringify(credentials),
      ContentType: 'application/json'
    }));

    // Delete reset token (single-use)
    await s3.send(new DeleteObjectCommand({
      Bucket: S3_BUCKET,
      Key: `users/${guid}/reset-token.json`
    }));

    // Send password-changed confirmation (fire-and-forget)
    let name = '';
    try {
      const profileResult = await s3.send(new GetObjectCommand({ Bucket: S3_BUCKET, Key: `users/${guid}/profile.json` }));
      const profile = JSON.parse(await profileResult.Body.transformToString());
      name = profile.name || '';
    } catch (e) { /* No profile */ }

    sendTemplate(storedToken.email, renderPasswordChanged, { name }).catch(e => console.error('Password changed email failed:', e.message));

    return {
      statusCode: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      body: JSON.stringify({ success: true })
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
// Routes map
// ---------------------------------------------------------------------------

export const routes = {
  'user-check': handleUserCheck,
  'user-signup': handleUserSignup,
  'user-login': handleUserLogin,
  'user-dashboard': handleUserDashboard,
  'upload-avatar': handleUploadAvatar,
  'save-theme': handleSaveTheme,
  'user-change-password': handleUserChangePassword,
  'forgot-password': handleForgotPassword,
  'reset-password': handleResetPassword,
};
