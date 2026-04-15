const DIRECT_HTTP_RESPONSE_MARKER = '__controlPlaneDirectHttpResponse';

function createDirectHttpResponse({
  statusCode = 200,
  headers = {},
  body = '',
} = {}) {
  return {
    [DIRECT_HTTP_RESPONSE_MARKER]: true,
    statusCode: Number(statusCode) || 200,
    headers: headers && typeof headers === 'object' ? headers : {},
    body,
  };
}

function createDirectJsonResponse({
  statusCode = 200,
  payload = {},
  headers = {},
} = {}) {
  return createDirectHttpResponse({
    statusCode,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      ...headers,
    },
    body: JSON.stringify(payload || {}),
  });
}

function createDirectRedirectResponse({
  location = '/',
  statusCode = 302,
  headers = {},
} = {}) {
  return createDirectHttpResponse({
    statusCode,
    headers: {
      Location: String(location || '/'),
      ...headers,
    },
    body: '',
  });
}

function isDirectHttpResponse(value) {
  return Boolean(value && typeof value === 'object' && value[DIRECT_HTTP_RESPONSE_MARKER] === true);
}

module.exports = {
  createDirectHttpResponse,
  createDirectJsonResponse,
  createDirectRedirectResponse,
  isDirectHttpResponse,
};
