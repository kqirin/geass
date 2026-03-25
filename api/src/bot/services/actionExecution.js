'use strict';

const logger = require('../../logger');

const logPrimaryFailure =
  typeof logger.logError === 'function' ? logger.logError : () => {};
const logFollowUpFailure =
  typeof logger.logStructuredError === 'function'
    ? logger.logStructuredError
    : (context, err, extra = {}) => logPrimaryFailure(context, err, extra);

const TARGET_MUTATION_LOCKS = new Set();
const TARGET_MUTATION_LOCK_TIMEOUT_MS = 10_000;

function getDiscordErrorCode(err) {
  return Number(err?.code || err?.rawError?.code || 0);
}

async function sendWarningReply(message, text) {
  const payload = {
    content: text,
    allowedMentions: { parse: [] },
  };

  if (typeof message?.reply === 'function') {
    await message.reply(payload).catch(() => {});
    return;
  }

  if (typeof message?.channel?.send === 'function') {
    await message.channel.send(payload).catch(() => {});
  }
}

function normalizeMutationKey(value) {
  const key = String(value || '').trim();
  return key || null;
}

async function waitForTargetMutationLock(mutationKey, logContext, baseLogContext) {
  const key = normalizeMutationKey(mutationKey);
  if (!key) return null;

  const startedAt = Date.now();
  while (TARGET_MUTATION_LOCKS.has(key)) {
    if (Date.now() - startedAt >= TARGET_MUTATION_LOCK_TIMEOUT_MS) {
      const err = new Error('moderation_action_busy');
      err.code = 'MODERATION_ACTION_BUSY';
      logPrimaryFailure(`${logContext}_mutation_lock_timeout`, err, {
        mutationKey: key,
        timeoutMs: TARGET_MUTATION_LOCK_TIMEOUT_MS,
        waitedMs: Date.now() - startedAt,
        ...baseLogContext,
      });
      throw err;
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }

  TARGET_MUTATION_LOCKS.add(key);
  return key;
}

function releaseTargetMutationLock(mutationKey) {
  const key = normalizeMutationKey(mutationKey);
  if (key) TARGET_MUTATION_LOCKS.delete(key);
}

async function runWithTargetMutationLock(mutationKey, logContext, baseLogContext, fn) {
  const key = await waitForTargetMutationLock(mutationKey, logContext, baseLogContext);
  try {
    return await fn();
  } finally {
    releaseTargetMutationLock(key);
  }
}

async function resolveDeferredValue(value, fallback = {}) {
  if (typeof value === 'function') {
    const resolved = await value();
    return resolved && typeof resolved === 'object' ? resolved : fallback;
  }
  return value && typeof value === 'object' ? value : fallback;
}

async function resolveDeferredScalar(value, fallback = null) {
  if (typeof value === 'function') {
    const resolved = await value();
    return resolved ?? fallback;
  }
  return value ?? fallback;
}

async function commitExecutionReceipt(receipt) {
  if (!receipt?.commit) return;
  await receipt.commit();
}

async function executeModerationAction({
  message,
  sendTemplate,
  beforePrimaryAction = null,
  primaryAction,
  primaryErrorHandler = null,
  successContext = {},
  successOptions = {},
  operationNotAllowedContext = successContext,
  operationNotAllowedOptions = successOptions,
  systemErrorContext = successContext,
  systemErrorOptions = successOptions,
  sideEffects = [],
  warningPrefix = 'İşlem uygulandı ancak bazı takip işlemleri tamamlanamadı',
  logContext = 'moderation_action',
  mutationKey = null,
  busyMessage = 'Bu hedef üzerinde başka bir işlem çalışıyor. Lütfen tekrar deneyin. ୭ ˚. !!',
} = {}) {
  const baseLogContext = {
    guildId: message?.guild?.id || null,
    actorId: message?.author?.id || null,
  };

  const runExecution = async () => {
    let executionReceipt = null;
    let receiptCommitted = false;
    const failedSideEffects = [];
    const failedRequiredSideEffects = [];
    const failedLabels = new Set();

    const recordFollowUpFailure = async (label, err, extra = {}) => {
      const resolvedLabel = label || 'yan_islem';
      if (!failedLabels.has(resolvedLabel)) {
        failedLabels.add(resolvedLabel);
        failedSideEffects.push(resolvedLabel);
      }
      if (extra.requiredForSuccess === true && !failedRequiredSideEffects.includes(resolvedLabel)) {
        failedRequiredSideEffects.push(resolvedLabel);
      }

      logFollowUpFailure(
        `${logContext}_${extra.eventSuffix || 'post_action_failed'}`,
        err,
        {
          label: resolvedLabel,
          phase: extra.phase || 'post_action',
          ...baseLogContext,
          ...(extra.logExtra || {}),
        },
        extra.level || 'WARN'
      );
    };

    const runSideEffectList = async (entries) => {
      for (const sideEffect of entries) {
        try {
          await sideEffect.run();
        } catch (err) {
          await recordFollowUpFailure(sideEffect.label || 'yan_islem', err, {
            eventSuffix: 'side_effect_failed',
            phase: 'side_effect',
            requiredForSuccess: sideEffect.requiredForSuccess === true,
          });
        }
      }
    };

    try {
      if (typeof beforePrimaryAction === 'function') {
        const beforeResult = await beforePrimaryAction();
        if (beforeResult === false) {
          return { ok: false, primaryApplied: false, handled: true, preflightBlocked: true };
        }
        if (beforeResult && typeof beforeResult === 'object') {
          executionReceipt = beforeResult;
        }
      }
      await primaryAction();
    } catch (err) {
      if (executionReceipt?.rollback) {
        await executionReceipt.rollback().catch(() => {});
        executionReceipt = null;
      }

      if (typeof primaryErrorHandler === 'function') {
        const handled = await primaryErrorHandler(err);
        if (handled) return { ok: false, primaryApplied: false, handled: true };
      }

      if (getDiscordErrorCode(err) === 50013) {
        await sendTemplate('operationNotAllowed', operationNotAllowedContext, operationNotAllowedOptions);
        return { ok: false, primaryApplied: false, handled: true };
      }

      logPrimaryFailure(`${logContext}_primary_action_failed`, err, baseLogContext);

      await sendTemplate('systemError', systemErrorContext, systemErrorOptions);
      return { ok: false, primaryApplied: false, handled: true };
    }

    if (!receiptCommitted && executionReceipt) {
      try {
        await commitExecutionReceipt(executionReceipt);
        receiptCommitted = true;
        executionReceipt = null;
      } catch (err) {
        await recordFollowUpFailure('limit commit', err, {
          eventSuffix: 'receipt_commit_failed',
          phase: 'receipt_commit',
        });
      }
    }

    const requiredSideEffects = [];
    const optionalSideEffects = [];
    for (const sideEffect of Array.isArray(sideEffects) ? sideEffects : []) {
      if (sideEffect?.requiredForSuccess === true) requiredSideEffects.push(sideEffect);
      else optionalSideEffects.push(sideEffect);
    }

    await runSideEffectList(requiredSideEffects);

    let successSent = false;
    try {
      const resolvedSuccessContext = await resolveDeferredValue(successContext);
      const resolvedSuccessOptions = await resolveDeferredValue(successOptions);
      await sendTemplate('success', resolvedSuccessContext, resolvedSuccessOptions);
      successSent = true;
    } catch (err) {
      await recordFollowUpFailure('basari bildirimi', err, {
        eventSuffix: 'success_response_failed',
        phase: 'success_response',
      });
    }

    await runSideEffectList(optionalSideEffects);

    if (failedSideEffects.length > 0) {
      const labels = failedSideEffects.join(', ');
      await sendWarningReply(message, `${warningPrefix}: ${labels}. ୭ ˚. !!`);
    }

    return {
      ok: true,
      primaryApplied: true,
      degraded: failedSideEffects.length > 0,
      failedSideEffects,
      failedRequiredSideEffects,
      successSent,
    };
  };

  if (typeof message?.channel?.sendTyping === 'function') {
    await Promise.resolve(message.channel.sendTyping()).catch(() => {});
  }

  const resolvedMutationKey = normalizeMutationKey(
    await resolveDeferredScalar(mutationKey, null)
  );
  if (!resolvedMutationKey) {
    return runExecution();
  }

  try {
    return await runWithTargetMutationLock(
      resolvedMutationKey,
      logContext,
      {
        ...baseLogContext,
        mutationKey: resolvedMutationKey,
      },
      runExecution
    );
  } catch (err) {
    if (String(err?.code || '') === 'MODERATION_ACTION_BUSY') {
      await sendWarningReply(message, busyMessage);
      return { ok: false, primaryApplied: false, handled: true, busy: true };
    }
    throw err;
  }
}

module.exports = {
  TARGET_MUTATION_LOCKS,
  executeModerationAction,
  getDiscordErrorCode,
};
