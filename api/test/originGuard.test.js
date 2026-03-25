const test = require('node:test');
const assert = require('node:assert/strict');

const { createOriginGuard } = require('../src/interfaces/http/middlewares/originGuard');

function runGuard(middleware, req) {
  let nextCalled = false;
  let statusCode = 200;
  let jsonBody = null;

  const res = {
    status(code) {
      statusCode = code;
      return this;
    },
    json(body) {
      jsonBody = body;
      return this;
    },
  };

  middleware(req, res, () => {
    nextCalled = true;
  });

  return { nextCalled, statusCode, jsonBody };
}

function buildReq({ method = 'POST', origin = null, referer = null } = {}) {
  return {
    method,
    requestId: 'req-1',
    get(name) {
      if (name === 'origin') return origin;
      if (name === 'referer') return referer;
      return undefined;
    },
  };
}

test('origin guard blocks referer prefix spoofing', () => {
  const middleware = createOriginGuard({
    allowedOrigins: ['https://panel.example.com'],
    allowedOriginSet: new Set(['https://panel.example.com']),
  });

  const result = runGuard(
    middleware,
    buildReq({
      method: 'POST',
      referer: 'https://panel.example.com.evil.tld/dashboard',
    })
  );

  assert.equal(result.nextCalled, false);
  assert.equal(result.statusCode, 403);
  assert.equal(result.jsonBody?.error, 'Forbidden origin');
});

test('origin guard allows exact referer origin match', () => {
  const middleware = createOriginGuard({
    allowedOrigins: ['https://panel.example.com'],
    allowedOriginSet: new Set(['https://panel.example.com']),
  });

  const result = runGuard(
    middleware,
    buildReq({
      method: 'POST',
      referer: 'https://panel.example.com/dashboard?tab=moderation',
    })
  );

  assert.equal(result.nextCalled, true);
  assert.equal(result.statusCode, 200);
});

test('origin guard allows exact origin header match', () => {
  const middleware = createOriginGuard({
    allowedOrigins: ['https://panel.example.com'],
    allowedOriginSet: new Set(['https://panel.example.com']),
  });

  const result = runGuard(
    middleware,
    buildReq({
      method: 'POST',
      origin: 'https://panel.example.com',
    })
  );

  assert.equal(result.nextCalled, true);
  assert.equal(result.statusCode, 200);
});

