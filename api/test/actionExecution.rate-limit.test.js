const test = require('node:test');
const assert = require('node:assert/strict');

const { executeModerationAction } = require('../src/bot/services/actionExecution');

test('executeModerationAction commits rate-limit receipt after successful action and side effects', async () => {
  let committed = 0;
  let rolledBack = 0;

  const result = await executeModerationAction({
    message: {},
    sendTemplate: async () => {},
    beforePrimaryAction: async () => ({
      commit: async () => {
        committed += 1;
      },
      rollback: async () => {
        rolledBack += 1;
      },
    }),
    primaryAction: async () => {},
  });

  assert.equal(result.ok, true);
  assert.equal(committed, 1);
  assert.equal(rolledBack, 0);
});

test('executeModerationAction rolls back rate-limit receipt when primary action fails', async () => {
  let committed = 0;
  let rolledBack = 0;
  let sentTemplate = null;

  const result = await executeModerationAction({
    message: {},
    sendTemplate: async (templateKey) => {
      sentTemplate = templateKey;
    },
    beforePrimaryAction: async () => ({
      commit: async () => {
        committed += 1;
      },
      rollback: async () => {
        rolledBack += 1;
      },
    }),
    primaryAction: async () => {
      throw new Error('primary_failed');
    },
  });

  assert.equal(result.ok, false);
  assert.equal(sentTemplate, 'systemError');
  assert.equal(committed, 0);
  assert.equal(rolledBack, 1);
});

test('executeModerationAction resolves success context after successful side effects', async () => {
  let caseId = null;
  let sent = null;

  const result = await executeModerationAction({
    message: {},
    sendTemplate: async (templateKey, context) => {
      sent = { templateKey, context };
    },
    primaryAction: async () => {},
    sideEffects: [
      {
        label: 'log kaydi',
        requiredForSuccess: true,
        run: async () => {
          caseId = 191;
        },
      },
    ],
    successContext: () => ({
      caseId: caseId ? `#${caseId}` : '',
    }),
  });

  assert.equal(result.ok, true);
  assert.equal(result.successSent, true);
  assert.equal(sent?.templateKey, 'success');
  assert.equal(sent?.context?.caseId, '#191');
});

test('executeModerationAction keeps success semantics when a post-action side effect fails', async () => {
  const warnings = [];
  let sentTemplate = null;

  const result = await executeModerationAction({
    message: {
      reply: async (payload) => {
        warnings.push(payload);
        return payload;
      },
    },
    sendTemplate: async (templateKey) => {
      sentTemplate = templateKey;
    },
    primaryAction: async () => {},
    sideEffects: [
      {
        label: 'log kaydi',
        requiredForSuccess: true,
        run: async () => {
          throw new Error('log_down');
        },
      },
    ],
    warningPrefix: '@Target susturuldu fakat takip islemleri eksik kaldi',
  });

  assert.equal(result.ok, true);
  assert.equal(result.primaryApplied, true);
  assert.equal(result.successSent, true);
  assert.equal(result.degraded, true);
  assert.equal(sentTemplate, 'success');
  assert.match(String(warnings[0]?.content || ''), /log kaydi/i);
});

test('executeModerationAction commits rate-limit receipt when post-action side effect fails', async () => {
  let committed = 0;
  let rolledBack = 0;

  const result = await executeModerationAction({
    message: {
      reply: async () => ({}),
    },
    sendTemplate: async () => {},
    beforePrimaryAction: async () => ({
      commit: async () => {
        committed += 1;
      },
      rollback: async () => {
        rolledBack += 1;
      },
    }),
    primaryAction: async () => {},
    sideEffects: [
      {
        label: 'log kaydi',
        requiredForSuccess: true,
        run: async () => {
          throw new Error('log_down');
        },
      },
    ],
  });

  assert.equal(result.ok, true);
  assert.equal(committed, 1);
  assert.equal(rolledBack, 0);
});

test('executeModerationAction downgrades success response build failures instead of rethrowing', async () => {
  const warnings = [];

  const result = await executeModerationAction({
    message: {
      reply: async (payload) => {
        warnings.push(payload);
        return payload;
      },
    },
    sendTemplate: async () => {},
    primaryAction: async () => {},
    successContext: async () => {
      throw new Error('context_build_failed');
    },
    warningPrefix: '@Target susturuldu fakat takip islemleri eksik kaldi',
  });

  assert.equal(result.ok, true);
  assert.equal(result.successSent, false);
  assert.equal(result.degraded, true);
  assert.match(String(warnings[0]?.content || ''), /basari bildirimi/i);
});

test('executeModerationAction serializes concurrent runs for the same mutation key', async () => {
  const order = [];

  const runAction = (label, delayMs) =>
    executeModerationAction({
      message: {
        channel: {
          sendTyping: async () => {},
        },
      },
      sendTemplate: async (templateKey) => {
        if (templateKey === 'success') order.push(`success:${label}`);
      },
      mutationKey: 'moderation:guild-1:user-1',
      primaryAction: async () => {
        order.push(`start:${label}`);
        await new Promise((resolve) => setTimeout(resolve, delayMs));
        order.push(`end:${label}`);
      },
    });

  const first = runAction('first', 40);
  await new Promise((resolve) => setTimeout(resolve, 5));
  const second = runAction('second', 0);

  await Promise.all([first, second]);

  assert.deepEqual(order, [
    'start:first',
    'end:first',
    'success:first',
    'start:second',
    'end:second',
    'success:second',
  ]);
});
