const { createMemorySchedulerBackend } = require('./memoryScheduler');
const {
  createHardenedSchedulerBackend,
  normalizeHardenedSchedulerConfig,
} = require('./hardenedScheduler');

function normalizeSchedulerProvider(provider = 'memory') {
  const normalized = String(provider || '').trim().toLowerCase();
  if (!normalized) return 'memory';
  return normalized;
}

function normalizeSchedulerConfig(schedulerConfig = {}) {
  const source =
    schedulerConfig && typeof schedulerConfig === 'object' ? schedulerConfig : {};
  const adoption =
    source.adoption && typeof source.adoption === 'object' ? source.adoption : {};

  return {
    enabled: Boolean(source.enabled),
    provider: normalizeSchedulerProvider(source.provider),
    fallbackToMemory: source.fallbackToMemory !== false,
    adoption: {
      authExpiryCleanupEnabled: Boolean(adoption.authExpiryCleanupEnabled),
    },
    hardened: normalizeHardenedSchedulerConfig(source.hardened),
  };
}

function createSchedulerBackendSelector({
  config = {},
  schedulerConfig = null,
  nowFn = Date.now,
  sharedStateRedisClientFactory = null,
} = {}) {
  const resolvedConfig = normalizeSchedulerConfig(
    schedulerConfig || config?.controlPlane?.scheduler || {}
  );
  const memoryBackend = createMemorySchedulerBackend({ nowFn });

  let activeProvider = 'memory';
  let fallbackUsed = false;
  let fallbackReasonCode = null;

  if (!resolvedConfig.enabled) {
    fallbackReasonCode = 'scheduler_disabled';
  }

  if (resolvedConfig.enabled && resolvedConfig.provider !== 'memory' && resolvedConfig.provider !== 'hardened') {
    fallbackReasonCode = 'scheduler_provider_not_supported';
    fallbackUsed = true;
  }

  const hardenedBackend =
    resolvedConfig.enabled && resolvedConfig.provider === 'hardened'
      ? createHardenedSchedulerBackend({
          hardenedConfig: resolvedConfig.hardened,
          nowFn,
          redisClientFactory: sharedStateRedisClientFactory,
        })
      : null;

  if (hardenedBackend) {
    activeProvider = 'hardened';
  }

  function getActiveBackend() {
    if (activeProvider === 'hardened' && hardenedBackend) return hardenedBackend;
    return memoryBackend;
  }

  async function executeWithOptionalFallback(operationName, args = []) {
    const activeBackend = getActiveBackend();
    const handler = activeBackend?.[operationName];
    if (typeof handler !== 'function') {
      throw new Error('scheduler_backend_operation_unsupported');
    }

    try {
      return await handler(...args);
    } catch (error) {
      if (activeProvider !== 'hardened' || !resolvedConfig.fallbackToMemory) {
        throw error;
      }

      fallbackUsed = true;
      fallbackReasonCode =
        String(error?.reasonCode || '').trim() || 'scheduler_hardened_runtime_failed';
      activeProvider = 'memory';
      return memoryBackend[operationName](...args);
    }
  }

  async function close() {
    await memoryBackend.close();
    if (hardenedBackend) {
      await hardenedBackend.close();
    }
  }

  function getSummary() {
    const hardenedStatus =
      typeof hardenedBackend?.getStatus === 'function'
        ? hardenedBackend.getStatus()
        : null;
    const activeStatus =
      typeof getActiveBackend()?.getStatus === 'function'
        ? getActiveBackend().getStatus()
        : null;

    return {
      enabled: resolvedConfig.enabled,
      requestedProvider: resolvedConfig.provider,
      activeProvider,
      fallbackToMemory: Boolean(resolvedConfig.fallbackToMemory),
      fallbackUsed,
      reasonCode: fallbackReasonCode || null,
      adoption: {
        authExpiryCleanupEnabled: Boolean(
          resolvedConfig.adoption.authExpiryCleanupEnabled
        ),
      },
      hardened: hardenedStatus
        ? {
            configured: Boolean(hardenedStatus.configured),
            connected: Boolean(hardenedStatus.connected),
            activeStoreProvider: String(
              hardenedStatus.activeStoreProvider || 'memory'
            ),
            requestedStoreProvider: String(
              hardenedStatus.requestedStoreProvider || 'redis'
            ),
            fallbackUsed: Boolean(hardenedStatus.fallbackUsed),
            reasonCode:
              hardenedStatus.reasonCode === undefined ||
              hardenedStatus.reasonCode === null
                ? null
                : String(hardenedStatus.reasonCode || '') || null,
          }
        : null,
      backendStatus: activeStatus
        ? {
            provider: String(activeStatus.provider || activeProvider),
            configured: Boolean(activeStatus.configured),
            connected: Boolean(activeStatus.connected),
            reasonCode:
              activeStatus.reasonCode === undefined ||
              activeStatus.reasonCode === null
                ? null
                : String(activeStatus.reasonCode || '') || null,
          }
        : null,
    };
  }

  function isAdoptionEnabled(adoptionName = '') {
    const normalizedName = String(adoptionName || '').trim();
    if (!normalizedName) return false;
    if (normalizedName === 'auth_expiry_cleanup') {
      return Boolean(resolvedConfig.adoption.authExpiryCleanupEnabled);
    }
    return false;
  }

  return {
    backend: {
      async upsertJobRecord(...args) {
        return executeWithOptionalFallback('upsertJobRecord', args);
      },
      async getJobRecord(...args) {
        return executeWithOptionalFallback('getJobRecord', args);
      },
      async deleteJobRecord(...args) {
        return executeWithOptionalFallback('deleteJobRecord', args);
      },
    },
    close,
    getSummary,
    isAdoptionEnabled,
  };
}

module.exports = {
  createSchedulerBackendSelector,
  normalizeSchedulerConfig,
};
