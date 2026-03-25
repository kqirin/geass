const test = require('node:test');
const assert = require('node:assert/strict');

function loadCommandWithHelper(commandFile, helperStub) {
  const helperPath = require.resolve('../src/bot/commands/channelLock.helpers');
  const commandPath = require.resolve(`../src/bot/commands/${commandFile}`);
  const originalHelper = require.cache[helperPath];

  delete require.cache[commandPath];
  require.cache[helperPath] = {
    id: helperPath,
    filename: helperPath,
    loaded: true,
    exports: helperStub,
  };

  const command = require(commandPath);
  return {
    command,
    restore() {
      delete require.cache[commandPath];
      if (originalHelper) require.cache[helperPath] = originalHelper;
      else delete require.cache[helperPath];
    },
  };
}

test('lock command uses permission service and rolls back consumed limit on helper failure', async () => {
  let committed = 0;
  let rolledBack = 0;
  let helperCalls = 0;
  let skipActorPermission = false;

  const loaded = loadCommandWithHelper('lock', {
    runLockCommand: async (_ctx, options = {}) => {
      helperCalls += 1;
      skipActorPermission = options.skipActorPermission === true;
      return { ok: false };
    },
  });

  try {
    await loaded.command.run({
      settings: { lock_enabled: true },
      verifyPermission: async () => ({
        success: true,
        consumeLimit: async () => ({
          commit: async () => {
            committed += 1;
          },
          rollback: async () => {
            rolledBack += 1;
          },
        }),
      }),
    });

    assert.equal(helperCalls, 1);
    assert.equal(skipActorPermission, true);
    assert.equal(committed, 0);
    assert.equal(rolledBack, 1);
  } finally {
    loaded.restore();
  }
});

test('lock command skips dashboard policy when lock policy is disabled', async () => {
  let helperCalls = 0;
  let verifyCalls = 0;
  let skipActorPermission = null;

  const loaded = loadCommandWithHelper('lock', {
    runLockCommand: async (_ctx, options = {}) => {
      helperCalls += 1;
      skipActorPermission = options.skipActorPermission === true;
      return { ok: true };
    },
  });

  try {
    await loaded.command.run({
      settings: { lock_enabled: false },
      verifyPermission: async () => {
        verifyCalls += 1;
        return { success: false };
      },
    });

    assert.equal(verifyCalls, 0);
    assert.equal(helperCalls, 1);
    assert.equal(skipActorPermission, false);
  } finally {
    loaded.restore();
  }
});

test('lock command commits consumed limit after successful helper execution', async () => {
  let committed = 0;
  let rolledBack = 0;
  let helperCalls = 0;
  let skipActorPermission = false;

  const loaded = loadCommandWithHelper('lock', {
    runLockCommand: async (_ctx, options = {}) => {
      helperCalls += 1;
      skipActorPermission = options.skipActorPermission === true;
      return { ok: true };
    },
  });

  try {
    await loaded.command.run({
      settings: { lock_enabled: true },
      verifyPermission: async () => ({
        success: true,
        consumeLimit: async () => ({
          commit: async () => {
            committed += 1;
          },
          rollback: async () => {
            rolledBack += 1;
          },
        }),
      }),
    });

    assert.equal(helperCalls, 1);
    assert.equal(skipActorPermission, true);
    assert.equal(committed, 1);
    assert.equal(rolledBack, 0);
  } finally {
    loaded.restore();
  }
});

test('unlock command does not run helper when application policy denies access', async () => {
  let helperCalls = 0;
  const loaded = loadCommandWithHelper('unlock', {
    runUnlockCommand: async () => {
      helperCalls += 1;
      return { ok: true };
    },
  });

  try {
    await loaded.command.run({
      settings: { lock_enabled: true },
      verifyPermission: async () => ({
        success: false,
      }),
    });

    assert.equal(helperCalls, 0);
  } finally {
    loaded.restore();
  }
});
