const counters = {
  httpRequestsTotal: 0,
  httpRequestErrors: 0,
  httpRateLimitHits: 0,
};

const routeCounters = new Map();
const routeLatencyTotals = new Map();
const MAX_ROUTE_KEYS = 500;

function pruneRouteMaps() {
  for (const map of [routeCounters, routeLatencyTotals]) {
    if (map.size <= MAX_ROUTE_KEYS) continue;
    const overflow = map.size - MAX_ROUTE_KEYS;
    const iter = map.keys();
    for (let i = 0; i < overflow; i++) {
      const { value, done } = iter.next();
      if (done) break;
      map.delete(value);
    }
  }
}

function incRouteCounter(method, path, statusCode) {
  const key = `${method} ${path} ${statusCode}`;
  routeCounters.set(key, (routeCounters.get(key) || 0) + 1);
}

function addRouteLatency(method, path, latencyMs) {
  const key = `${method} ${path}`;
  routeLatencyTotals.set(key, (routeLatencyTotals.get(key) || 0) + latencyMs);
}

function attachHttpMetrics() {
  return (req, res, next) => {
    const startedAt = Date.now();
    counters.httpRequestsTotal += 1;

    res.on('finish', () => {
      const latency = Date.now() - startedAt;
      if (res.statusCode >= 400) counters.httpRequestErrors += 1;
      incRouteCounter(req.method, req.path, res.statusCode);
      addRouteLatency(req.method, req.path, latency);
      pruneRouteMaps();
    });

    next();
  };
}

function recordRateLimitHit() {
  counters.httpRateLimitHits += 1;
}

function escapeLabel(value) {
  return String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

function renderPrometheus() {
  pruneRouteMaps();
  const lines = [];
  lines.push('# HELP http_requests_total Total HTTP requests');
  lines.push('# TYPE http_requests_total counter');
  lines.push(`http_requests_total ${counters.httpRequestsTotal}`);
  lines.push('# HELP http_request_errors_total Total HTTP requests with status >= 400');
  lines.push('# TYPE http_request_errors_total counter');
  lines.push(`http_request_errors_total ${counters.httpRequestErrors}`);
  lines.push('# HELP http_rate_limit_hits_total Total HTTP rate-limit rejections');
  lines.push('# TYPE http_rate_limit_hits_total counter');
  lines.push(`http_rate_limit_hits_total ${counters.httpRateLimitHits}`);

  lines.push('# HELP http_route_requests_total Requests per route/status');
  lines.push('# TYPE http_route_requests_total counter');
  for (const [key, count] of routeCounters.entries()) {
    const [method, path, status] = key.split(' ');
    lines.push(
      `http_route_requests_total{method="${escapeLabel(method)}",path="${escapeLabel(path)}",status="${escapeLabel(status)}"} ${count}`
    );
  }

  lines.push('# HELP http_route_latency_ms_total Summed latency (ms) per route');
  lines.push('# TYPE http_route_latency_ms_total counter');
  for (const [key, sum] of routeLatencyTotals.entries()) {
    const [method, path] = key.split(' ');
    lines.push(
      `http_route_latency_ms_total{method="${escapeLabel(method)}",path="${escapeLabel(path)}"} ${sum}`
    );
  }

  return `${lines.join('\n')}\n`;
}

module.exports = {
  attachHttpMetrics,
  recordRateLimitHit,
  renderPrometheus,
};
