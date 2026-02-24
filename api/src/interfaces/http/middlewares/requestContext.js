const crypto = require('crypto');

function attachRequestContext({ isProd }) {
  return (req, res, next) => {
    req.requestId = crypto.randomUUID ? crypto.randomUUID() : crypto.randomBytes(12).toString('hex');
    res.setHeader('X-Request-Id', req.requestId);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('Permissions-Policy', 'geolocation=(), microphone=(), camera=()');
    if (isProd) {
      res.setHeader('Strict-Transport-Security', 'max-age=15552000; includeSubDomains');
    }
    next();
  };
}

module.exports = { attachRequestContext };

