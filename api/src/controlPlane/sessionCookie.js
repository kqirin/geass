const crypto = require('node:crypto');

function parseCookieHeader(cookieHeader = '') {
  const parsed = {};
  const raw = String(cookieHeader || '').trim();
  if (!raw) return parsed;

  for (const segment of raw.split(';')) {
    const [rawKey, ...rawValueParts] = segment.split('=');
    const key = String(rawKey || '').trim();
    if (!key) continue;
    const value = rawValueParts.join('=').trim();
    parsed[key] = value;
  }
  return parsed;
}

function timingSafeEqualString(left, right) {
  const leftBuffer = Buffer.from(String(left || ''), 'utf8');
  const rightBuffer = Buffer.from(String(right || ''), 'utf8');
  if (leftBuffer.length !== rightBuffer.length) return false;
  try {
    return crypto.timingSafeEqual(leftBuffer, rightBuffer);
  } catch {
    return false;
  }
}

function normalizeSameSite(value, fallback = 'Lax') {
  const normalized = String(value || '')
    .trim()
    .toLowerCase();
  if (normalized === 'strict') return 'Strict';
  if (normalized === 'none') return 'None';
  if (normalized === 'lax') return 'Lax';
  return fallback;
}

function createSessionCookieManager({
  cookieName = 'cp_session',
  secret = '',
  secure = false,
  sameSite = 'Lax',
  path = '/',
  maxAgeSec = 8 * 60 * 60,
} = {}) {
  const normalizedCookieName = String(cookieName || 'cp_session').trim() || 'cp_session';
  const normalizedSecret = String(secret || '');
  const normalizedPath = String(path || '/').trim() || '/';
  const normalizedSameSite = normalizeSameSite(sameSite, 'Lax');
  const defaultMaxAgeSec = Number.isFinite(Number(maxAgeSec)) && Number(maxAgeSec) > 0 ? Number(maxAgeSec) : 8 * 60 * 60;
  const secureFlag = Boolean(secure);

  function isConfigured() {
    return normalizedSecret.length >= 16;
  }

  function signSessionId(sessionId) {
    return crypto.createHmac('sha256', normalizedSecret).update(String(sessionId || ''), 'utf8').digest('base64url');
  }

  function encodeCookieValue(sessionId) {
    const normalizedSessionId = String(sessionId || '').trim();
    if (!isConfigured() || !normalizedSessionId) return null;
    const signature = signSessionId(normalizedSessionId);
    return `${normalizedSessionId}.${signature}`;
  }

  function decodeCookieValue(cookieValue) {
    if (!isConfigured()) return null;
    const rawValue = String(cookieValue || '').trim();
    if (!rawValue) return null;

    const separatorIndex = rawValue.lastIndexOf('.');
    if (separatorIndex <= 0) return null;

    const sessionId = rawValue.slice(0, separatorIndex);
    const signature = rawValue.slice(separatorIndex + 1);
    if (!sessionId || !signature) return null;

    const expectedSignature = signSessionId(sessionId);
    if (!timingSafeEqualString(signature, expectedSignature)) return null;
    return sessionId;
  }

  function serializeCookie(value, { maxAge = defaultMaxAgeSec, expires = null } = {}) {
    const parts = [
      `${normalizedCookieName}=${String(value || '')}`,
      `Path=${normalizedPath}`,
      'HttpOnly',
      `SameSite=${normalizedSameSite}`,
    ];

    if (Number.isFinite(Number(maxAge))) {
      parts.push(`Max-Age=${Math.max(0, Math.floor(Number(maxAge)))}`);
    }
    if (expires instanceof Date && !Number.isNaN(expires.getTime())) {
      parts.push(`Expires=${expires.toUTCString()}`);
    }
    if (secureFlag) {
      parts.push('Secure');
    }
    return parts.join('; ');
  }

  function createSetCookieHeader(sessionId, { expiresAtMs = null } = {}) {
    const encodedValue = encodeCookieValue(sessionId);
    if (!encodedValue) return null;

    let maxAge = defaultMaxAgeSec;
    let expires = null;
    if (Number.isFinite(Number(expiresAtMs))) {
      const nowMs = Date.now();
      const ttlSec = Math.floor((Number(expiresAtMs) - nowMs) / 1000);
      maxAge = Math.max(0, ttlSec);
      expires = new Date(nowMs + maxAge * 1000);
    }

    return serializeCookie(encodedValue, { maxAge, expires });
  }

  function createClearCookieHeader() {
    return serializeCookie('', {
      maxAge: 0,
      expires: new Date(0),
    });
  }

  function readSessionIdFromRequest(req = null) {
    if (!req || typeof req !== 'object') return null;
    const cookies = parseCookieHeader(req.headers?.cookie);
    const rawCookieValue = cookies[normalizedCookieName];
    return decodeCookieValue(rawCookieValue);
  }

  return {
    cookieName: normalizedCookieName,
    createClearCookieHeader,
    createSetCookieHeader,
    decodeCookieValue,
    encodeCookieValue,
    isConfigured,
    readSessionIdFromRequest,
  };
}

module.exports = {
  createSessionCookieManager,
  parseCookieHeader,
};
