const test = require('node:test');
const assert = require('node:assert/strict');

const banCommand = require('../src/bot/commands/ban');
const logCommand = require('../src/bot/commands/log');
const { resolveTarget } = require('../src/bot/moderation.utils');

test('ban command fails closed when target member cannot be resolved', async () => {
  const sentTemplates = [];

  await banCommand.run({
    message: {
      guild: {
        members: {
          fetch: async () => null,
        },
      },
      client: { user: { id: 'bot-1' } },
      author: { id: 'mod-1' },
    },
    target: null,
    targetId: '123456789012345678',
    cleanArgs: ['sebep'],
    targetMention: '<@123456789012345678>',
    argsSummary: '123456789012345678 sebep',
    sendTemplate: async (key) => {
      sentTemplates.push(key);
    },
    verifyPermission: async () => {
      throw new Error('verifyPermission should not run for unresolved ban target');
    },
  });

  assert.deepEqual(sentTemplates, ['userNotFound']);
});

test('ban command aborts when target state changes before action execution', async () => {
  const sentTemplates = [];
  const guild = {
    bans: { fetch: async () => null },
    members: {
      fetchCalls: 0,
      async fetch() {
        this.fetchCalls += 1;
        if (this.fetchCalls === 1) {
          return {
            id: '123456789012345678',
            bannable: true,
            user: { id: '123456789012345678', username: 'target' },
            roles: { cache: { has: () => false } },
          };
        }
        return null;
      },
      async ban() {
        throw new Error('guild.members.ban should not execute after stale recheck');
      },
    },
  };

  await banCommand.run({
    message: {
      guild,
      client: { user: { id: 'bot-1' } },
      author: { id: 'mod-1' },
    },
    target: null,
    targetId: '123456789012345678',
    cleanArgs: ['sebep'],
    targetMention: '<@123456789012345678>',
    argsSummary: '123456789012345678 sebep',
    sendTemplate: async (key) => {
      sentTemplates.push(key);
    },
    verifyPermission: async () => ({
      success: true,
      consumeLimit: async () => ({
        commit: async () => {},
        rollback: async () => {},
      }),
    }),
  });

  assert.deepEqual(sentTemplates, ['operationNotAllowed']);
});

test('resolveTarget marks ambiguous member search instead of picking the first fuzzy result', async () => {
  const result = await resolveTarget(
    null,
    {
      author: { username: 'mod-user' },
      guild: {
        members: {
          fetch: async () => null,
          search: async () =>
            new Map([
              ['1', { id: '1', displayName: 'Kirin', user: { id: '1', username: 'kirin' } }],
              ['2', { id: '2', displayName: 'Kirin', user: { id: '2', username: 'kirin-2' } }],
            ]),
        },
      },
      mentions: {},
    },
    ['Kirin'],
    {
      allowMemberSearch: true,
      allowReplyTarget: false,
    }
  );

  assert.equal(result.target, null);
  assert.equal(result.ambiguous, true);
});

test('log command rejects ambiguous member search results', async () => {
  const replies = [];

  await logCommand.run({
    message: {
      reply: async (payload) => {
        replies.push(payload);
      },
    },
    target: null,
    targetId: null,
    targetMention: '@unknown',
    actionNames: {},
    verifyPermission: async () => ({
      success: true,
      consumeLimit: async () => ({
        commit: async () => {},
        rollback: async () => {},
      }),
    }),
    targetResolution: {
      ambiguous: true,
    },
  });

  assert.match(String(replies[0]?.content || ''), /Birden fazla kullanıcı eşleşti/i);
});
