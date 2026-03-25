const test = require('node:test');
const assert = require('node:assert/strict');

const db = require('../src/database');
const penaltyScheduler = require('../src/bot/penaltyScheduler');

test('penalty revoke does not mark row inactive on transient member fetch failure', async () => {
  const originalExecute = db.execute;
  const executed = [];
  db.execute = async (sql, params) => {
    executed.push({ sql, params });
    return [[]];
  };

  try {
    const client = {
      guilds: {
        cache: new Map(),
        fetch: async () => ({
          members: {
            fetch: async () => {
              const err = new Error('temporary_failure');
              err.code = 500;
              throw err;
            },
          },
        }),
      },
    };

    const result = await penaltyScheduler.__internal.applyPenaltyRevoke(client, {
      id: 1,
      guild_id: 'guild-1',
      user_id: 'user-1',
      action_type: 'mute',
      role_id: 'role-1',
    });

    assert.equal(result.ok, false);
    assert.equal(executed.length, 0);
  } finally {
    db.execute = originalExecute;
  }
});

test('penalty revoke marks row inactive when member is definitively missing', async () => {
  const originalExecute = db.execute;
  const executed = [];
  db.execute = async (sql, params) => {
    executed.push({ sql, params });
    return [[]];
  };

  try {
    const client = {
      guilds: {
        cache: new Map(),
        fetch: async () => ({
          members: {
            fetch: async () => {
              const err = new Error('unknown_member');
              err.code = 10007;
              throw err;
            },
          },
        }),
      },
    };

    const result = await penaltyScheduler.__internal.applyPenaltyRevoke(client, {
      id: 2,
      guild_id: 'guild-1',
      user_id: 'user-2',
      action_type: 'mute',
      role_id: 'role-1',
    });

    assert.equal(result.ok, true);
    assert.equal(result.inactiveMarked, true);
    assert.equal(executed.length, 1);
    assert.match(String(executed[0].sql || ''), /UPDATE timed_penalties SET active = FALSE/i);
  } finally {
    db.execute = originalExecute;
  }
});
