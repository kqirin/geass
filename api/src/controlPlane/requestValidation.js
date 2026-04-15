class RequestValidationError extends Error {
  constructor(
    message,
    {
      statusCode = 400,
      errorCode = 'invalid_request_body',
      details = null,
    } = {}
  ) {
    super(message || 'Request validation failed.');
    this.name = 'RequestValidationError';
    this.statusCode = Number(statusCode) || 400;
    this.errorCode = String(errorCode || 'invalid_request_body');
    this.details = details && typeof details === 'object' ? details : null;
  }
}

function normalizeHeaderValue(value) {
  if (Array.isArray(value)) return String(value[0] || '').trim();
  return String(value || '').trim();
}

function isJsonContentType(contentType = '') {
  return String(contentType || '').toLowerCase().includes('application/json');
}

function isPlainObject(value) {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function assertPlainObject(value, { field = 'body' } = {}) {
  if (isPlainObject(value)) return value;

  throw new RequestValidationError('Request body must be a JSON object.', {
    statusCode: 400,
    errorCode: 'invalid_request_body',
    details: {
      reasonCode: 'invalid_json_type',
      field: String(field || 'body'),
    },
  });
}

async function readRequestBody({ req = null, maxBytes = 8 * 1024 } = {}) {
  if (!req || typeof req !== 'object') {
    throw new RequestValidationError('Request stream is not available.', {
      statusCode: 400,
      errorCode: 'invalid_request_body',
      details: {
        reasonCode: 'request_stream_missing',
      },
    });
  }

  const normalizedMaxBytes = Number(maxBytes);
  const bodyLimitBytes =
    Number.isFinite(normalizedMaxBytes) && normalizedMaxBytes > 0
      ? normalizedMaxBytes
      : 8 * 1024;
  const contentLengthHeader = normalizeHeaderValue(req?.headers?.['content-length']);
  const declaredContentLength = Number(contentLengthHeader);
  if (Number.isFinite(declaredContentLength) && declaredContentLength > bodyLimitBytes) {
    throw new RequestValidationError('Request body exceeds maximum allowed size.', {
      statusCode: 413,
      errorCode: 'payload_too_large',
      details: {
        reasonCode: 'body_too_large',
        maxBytes: bodyLimitBytes,
      },
    });
  }

  return new Promise((resolve, reject) => {
    const chunks = [];
    let totalBytes = 0;
    let tooLarge = false;

    req.on('data', (chunk) => {
      if (tooLarge) return;
      const normalizedChunk = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      totalBytes += normalizedChunk.length;

      if (totalBytes > bodyLimitBytes) {
        tooLarge = true;
        return;
      }

      chunks.push(normalizedChunk);
    });

    req.on('end', () => {
      if (tooLarge) {
        reject(
          new RequestValidationError('Request body exceeds maximum allowed size.', {
            statusCode: 413,
            errorCode: 'payload_too_large',
            details: {
              reasonCode: 'body_too_large',
              maxBytes: bodyLimitBytes,
            },
          })
        );
        return;
      }

      resolve({
        body: Buffer.concat(chunks).toString('utf8'),
        sizeBytes: totalBytes,
      });
    });

    req.on('error', () => {
      reject(
        new RequestValidationError('Failed to read request body.', {
          statusCode: 400,
          errorCode: 'invalid_request_body',
          details: {
            reasonCode: 'request_stream_error',
          },
        })
      );
    });
  });
}

async function parseJsonRequestBody({
  req = null,
  maxBytes = 8 * 1024,
  requireJsonContentType = true,
} = {}) {
  const contentType = normalizeHeaderValue(req?.headers?.['content-type']);
  if (requireJsonContentType && !isJsonContentType(contentType)) {
    throw new RequestValidationError('Content-Type must be application/json.', {
      statusCode: 415,
      errorCode: 'unsupported_media_type',
      details: {
        reasonCode: 'content_type_must_be_application_json',
      },
    });
  }

  const { body } = await readRequestBody({
    req,
    maxBytes,
  });
  if (!String(body || '').trim()) {
    throw new RequestValidationError('Request body is required.', {
      statusCode: 400,
      errorCode: 'invalid_request_body',
      details: {
        reasonCode: 'body_required',
      },
    });
  }

  let parsed;
  try {
    parsed = JSON.parse(body);
  } catch {
    throw new RequestValidationError('Request body must be valid JSON.', {
      statusCode: 400,
      errorCode: 'invalid_request_body',
      details: {
        reasonCode: 'invalid_json',
      },
    });
  }

  return assertPlainObject(parsed, { field: 'body' });
}

module.exports = {
  RequestValidationError,
  assertPlainObject,
  isJsonContentType,
  isPlainObject,
  normalizeHeaderValue,
  parseJsonRequestBody,
  readRequestBody,
};
