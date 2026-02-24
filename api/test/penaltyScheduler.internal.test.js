const test = require('node:test');
const assert = require('node:assert/strict');

const penaltyScheduler = require('../src/bot/penaltyScheduler');

test('filterRestorableRoleIds should skip managed/everyone/jail/too-high roles', () => {
  const roleMap = new Map([
    ['everyone', { id: 'everyone', managed: false, position: 0 }],
    ['jail', { id: 'jail', managed: false, position: 1 }],
    ['managed', { id: 'managed', managed: true, position: 2 }],
    ['safe', { id: 'safe', managed: false, position: 3 }],
    ['tooHigh', { id: 'tooHigh', managed: false, position: 50 }],
  ]);

  const guild = {
    id: 'everyone',
    members: {
      me: {
        roles: {
          highest: { position: 10 },
        },
      },
    },
    roles: {
      cache: {
        get: (id) => roleMap.get(id) || null,
      },
    },
  };

  const input = ['everyone', 'jail', 'managed', 'safe', 'tooHigh'];
  const output = penaltyScheduler.__internal.filterRestorableRoleIds(guild, input, 'jail');

  assert.deepEqual(output, ['safe']);
});
