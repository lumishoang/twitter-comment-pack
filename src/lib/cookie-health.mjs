import fs from 'fs';
import { searchUserTweets, searchTimeline } from './twitter-http.mjs';

function hasCookie(cookies, name) {
  return cookies.some((c) => c && c.name === name && String(c.value || '').trim());
}

export function validateCookieFile(cookiesFilePath) {
  if (!fs.existsSync(cookiesFilePath)) {
    return { ok: false, code: 'MISSING_FILE', detail: `cookies file not found: ${cookiesFilePath}` };
  }
  try {
    const raw = JSON.parse(fs.readFileSync(cookiesFilePath, 'utf-8'));
    const cookies = raw?.cookies || [];
    if (!Array.isArray(cookies) || cookies.length === 0) {
      return { ok: false, code: 'INVALID_FORMAT', detail: 'cookies[]. missing or empty' };
    }
    if (!hasCookie(cookies, 'auth_token')) {
      return { ok: false, code: 'MISSING_AUTH_TOKEN', detail: 'auth_token cookie missing' };
    }
    if (!hasCookie(cookies, 'ct0')) {
      return { ok: false, code: 'MISSING_CT0', detail: 'ct0 cookie missing' };
    }
    return { ok: true, code: 'OK', detail: 'format valid' };
  } catch (e) {
    return { ok: false, code: 'INVALID_JSON', detail: e.message };
  }
}

function classifyError(message = '') {
  if (/401/.test(message) || /SESSION_EXPIRED/i.test(message)) return 'EXPIRED';
  if (/403/.test(message)) return 'CHALLENGED_OR_FORBIDDEN';
  if (/RATE_LIMITED|429/.test(message)) return 'RATE_LIMITED';
  return 'UNKNOWN_ERROR';
}

export async function checkCookieHealth(cookiesFilePath) {
  const format = validateCookieFile(cookiesFilePath);
  if (!format.ok) return format;

  try {
    await searchTimeline('from:twitter', cookiesFilePath, null, 'Latest');
    return { ok: true, code: 'OK', detail: 'auth check passed' };
  } catch (e) {
    const code = classifyError(e?.message || '');
    return { ok: false, code, detail: e.message || 'health check failed' };
  }
}
