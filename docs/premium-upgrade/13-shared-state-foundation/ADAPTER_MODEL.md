# Adapter Model

## Abstraction interface
- Shared adapter contract (async):
  - `set(key, value, { ttlMs })`
  - `get(key)`
  - `delete(key)`
  - `getAndDelete(key)`
- Backend metadata:
  - `getSummary()` from selector
  - safe provider/fallback/reason visibility (no secrets)

## Implementations
- Memory adapter: `api/src/sharedState/memoryStore.js`
  - process-local map with TTL pruning
  - always available baseline backend
- Redis adapter: `api/src/sharedState/redisStore.js`
  - optional runtime usage
  - lazy connect
  - `GETDEL` support with safe fallback path
  - optional dependency loading (`redis` module is not required for memory mode)

## Backend selection
- Selector: `api/src/sharedState/stateBackendSelector.js`
- Reads `controlPlane.sharedState` config:
  - `enabled`
  - `provider` (`memory` or `redis`)
  - `redis.url`
  - `redis.keyPrefix`
  - `redis.connectTimeoutMs`
  - `redis.fallbackToMemory`

## Config and feature flags
- `ENABLE_CONTROL_PLANE_SHARED_STATE`
- `CONTROL_PLANE_SHARED_STATE_PROVIDER`
- `CONTROL_PLANE_SHARED_STATE_REDIS_URL`
- `CONTROL_PLANE_SHARED_STATE_REDIS_PREFIX`
- `CONTROL_PLANE_SHARED_STATE_REDIS_CONNECT_TIMEOUT_MS`
- `CONTROL_PLANE_SHARED_STATE_REDIS_FALLBACK_TO_MEMORY`

## Fallback behavior
- Default/unset: memory backend.
- Redis selected but missing/unavailable: explicit memory fallback (when fallback enabled).
- Selector summary exposes:
  - requested provider
  - active provider
  - fallback used
  - safe reason code

## Failure behavior
- Memory mode: unaffected by Redis/module availability.
- Redis mode:
  - connect/runtime failures trigger selector fallback to memory when enabled.
  - auth/session logic remains operational in fallback mode.
- No secret-bearing connection strings are exposed in responses.

## Future extension points
- Add additional adapter capabilities (locks, counters, pub/sub) behind explicit interfaces.
- Add additional backend drivers using the same selector pattern.
- Expand adoption to other bounded domains once safety checks are validated.
