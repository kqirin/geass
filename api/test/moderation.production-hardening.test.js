const test = require('node:test');
const assert = require('node:assert/strict');

const banCommand = require('../src/bot/commands/ban');
const logCommand = require('../src/bot/commands/log');
const { resolveTarget } = require('../src/bot/moderation.utils');

test('ban command supports ID-only path when target member cannot be resolved', async () => {
  const sentTemplates = [];
  const verifyCalls = [];
  const banCalls = [];
  let banned = false;

  await banCommand.run({
    message: {
      guild: {
        bans: {
          cache: new Map(),
          fetch: async () => {
            if (banned) {
              return {
                user: { id: '123456789012345678', username: 'target' },
              };
            }
            return null;
          },
        },
        members: {
          fetch: async () => null,
          ban: async (id) => {
            banCalls.push(id);
            banned = true;
          },
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
    verifyPermission: async (...args) => {
      verifyCalls.push(args);
      return {
        success: true,
        consumeLimit: async () => ({
          commit: async () => {},
          rollback: async () => {},
        }),
      };
    },
  });

  assert.equal(verifyCalls.length, 1);
  assert.deepEqual(verifyCalls[0], [
    'ban',
    null,
    {
      targetId: '123456789012345678',
      execution: { requiredBotPermissions: ['BanMembers'] },
    },
  ]);
  assert.deepEqual(banCalls, ['123456789012345678']);
  assert.deepEqual(sentTemplates, ['success']);
});

test('ban command can proceed with authoritative ID path when target leaves between checks', async () => {
  const sentTemplates = [];
  const banCalls = [];
  let banned = false;
  const guild = {
    bans: {
      cache: new Map(),
      fetch: async () => {
        if (banned) {
          return {
            user: { id: '123456789012345678', username: 'target' },
          };
        }
        return null;
      },
    },
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
      async ban(id) {
        banCalls.push(id);
        banned = true;
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

  assert.deepEqual(banCalls, ['123456789012345678']);
  assert.deepEqual(sentTemplates, ['success']);
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
