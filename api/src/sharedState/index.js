const { createMemoryKeyValueStore } = require('./memoryStore');
const { createRedisKeyValueStore } = require('./redisStore');
const {
  createSharedStateBackendSelector,
  normalizeSharedStateConfig,
} = require('./stateBackendSelector');

module.exports = {
  createMemoryKeyValueStore,
  createRedisKeyValueStore,
  createSharedStateBackendSelector,
  normalizeSharedStateConfig,
};
