function createRouteError(logError) {
  return function routeError(res, req, context, err, fallbackMessage = 'Internal Server Error', status = 500, extra = {}) {
    logError(context, err, {
      feature: 'http_route',
      requestId: req.requestId,
      path: req.path,
      method: req.method,
      ...extra,
    });
    return res.status(status).json({ error: fallbackMessage, requestId: req.requestId });
  };
}

module.exports = { createRouteError };

