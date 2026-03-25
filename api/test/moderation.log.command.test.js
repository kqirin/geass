const test = require('node:test');
const assert = require('node:assert/strict');

function loadLogCommand() {
  const commandPath = require.resolve('../src/bot/commands/log');
  const logsPath = require.resolve('../src/bot/moderation.logs');
  const originalLogsModule = require.cache[logsPath];

  delete require.cache[commandPath];
  require.cache[logsPath] = {
    id: logsPath,
    filename: logsPath,
    loaded: true,
    exports: {
      createLogContent: async () => ({ text: 'ok', totalPages: 0 }),
      buildPaginationRow: () => ({ type: 'row' }),
    },
  };

  const command = require(commandPath);
  return {
    command,
    restore() {
      delete require.cache[commandPath];
      if (originalLogsModule) require.cache[logsPath] = originalLogsModule;
      else delete require.cache[logsPath];
    },
  };
}

test('.log unresolved target uses provided targetId instead of author fallback', async () => {
  const { command, restore } = loadLogCommand();
  const sends = [];

  try {
    await command.run({
      message: {
        author: { id: 'actor-1' },
        guild: { id: 'guild-1' },
        channel: {
          send: async (payload) => {
            sends.push(payload);
            return {
              ...payload,
              delete: async () => {},
              createMessageComponentCollector: () => ({ on: () => {} }),
            };
          },
        },
        reply: async () => {},
      },
      target: null,
      targetId: '1447015808344784956',
      targetMention: '<@1447015808344784956>',
      actionNames: {},
      verifyPermission: async () => ({
        success: true,
        consumeLimit: async () => true,
      }),
    });

    assert.equal(sends.length, 1);
    assert.equal(sends[0].components[0].components[0].data.custom_id, 'view_logs_1447015808344784956');
    assert.match(String(sends[0].content || ''), /1447015808344784956/);
  } finally {
    restore();
  }
});
