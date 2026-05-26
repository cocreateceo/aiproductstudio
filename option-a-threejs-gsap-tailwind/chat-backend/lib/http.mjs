// HTTP helpers — extracted from index.mjs (Phase 1 refactor)

export const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

// Alias: index.mjs uses `corsHeaders` — export under that name too to avoid mass-rename
export const corsHeaders = CORS;

export function respond(data, statusCode = 200) {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json', ...CORS },
    body: typeof data === 'string' ? data : JSON.stringify(data),
  };
}
