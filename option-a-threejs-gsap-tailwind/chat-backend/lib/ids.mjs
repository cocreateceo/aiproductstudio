// ID generators — extracted from index.mjs (Phase 1 refactor)
import crypto from 'crypto';

// Generate unique session ID
export function generateSessionId() {
  const timestamp = Date.now();
  const random = Math.random().toString(36).substring(2, 10);
  return `sess-${timestamp}-${random}`;
}

// Generate unique client ID from email or name
export function generateClientId(email, name) {
  const timestamp = Date.now();
  if (email) {
    const sanitized = email.toLowerCase().replace(/[^a-z0-9]/g, '-');
    return `client-${sanitized}`;
  }
  if (name) {
    const sanitized = name.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
    return `client-${sanitized}-${timestamp}`;
  }
  return `client-anon-${timestamp}`;
}
