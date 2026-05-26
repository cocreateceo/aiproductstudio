// Referral helpers — extracted from index.mjs (Phase 1 refactor)
import { REFERRAL_CODES } from './config.mjs';

export function resolveReferral(rawCode) {
  if (!rawCode || typeof rawCode !== 'string') return null;
  const code = rawCode.trim().toUpperCase();
  if (!/^[A-Z0-9_-]+$/.test(code)) return null;
  const match = REFERRAL_CODES[code];
  if (!match || !match.active) return null;
  return { code, ...match };
}
