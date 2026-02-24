const crypto = require('crypto');

function createSessionSigner(secret) {
  if (!secret || typeof secret !== 'string' || secret.length < 16) {
    throw new Error('SESSION_SECRET gerekli (en az 16 karakter)');
  }

  function sign(value) {
    return crypto.createHmac('sha256', secret).update(value).digest('base64url');
  }

  function pack(payloadObj, ttlMs) {
    const now = Date.now();
    const exp = now + Number(ttlMs || 0);
    const payloadData = {
      ...payloadObj,
      iat: now,
      exp,
      v: 1,
    };

    const payload = Buffer.from(JSON.stringify(payloadData), 'utf8').toString('base64url');
    return `${payload}.${sign(payload)}`;
  }

  function unpack(raw) {
    if (!raw || typeof raw !== 'string') return null;
    const dot = raw.lastIndexOf('.');
    if (dot < 1) return null;

    const payload = raw.slice(0, dot);
    const signature = raw.slice(dot + 1);
    const expected = sign(payload);

    const a = Buffer.from(signature);
    const b = Buffer.from(expected);
    if (a.length !== b.length) return null;
    if (!crypto.timingSafeEqual(a, b)) return null;

    try {
      const parsed = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
      if (!parsed || typeof parsed !== 'object') return null;
      if (!Number.isFinite(parsed.exp)) return null;
      if (Date.now() > parsed.exp) return null;
      return parsed;
    } catch {
      return null;
    }
  }

  return { pack, unpack };
}

module.exports = { createSessionSigner };

