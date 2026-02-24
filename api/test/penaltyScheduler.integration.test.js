const test = require('node:test');
const assert = require('node:assert/strict');

const db = require('../src/database');
const penaltyScheduler = require('../src/bot/penaltyScheduler');

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitFor(predicate, { timeoutMs = 2000, intervalMs = 15 } = {}) {
  const startedAt = Date.now();
  while (Date.now() - startedAt <= timeoutMs) {
    if (predicate()) return;
    await wait(intervalMs);
  }
  throw new Error('waitFor timeout');
}

function createPenaltyDbMock() {
  const state = {
    nextId: 1,
    penalties: [],
  };

  function clonePenalty(row) {
    return {
      id: Number(row.id),
      guild_id: String(row.guild_id),
      user_id: String(row.user_id),
      action_type: String(row.action_type),
      role_id: row.role_id ? String(row.role_id) : null,
      revoke_at: Number(row.revoke_at),
      reason: row.reason || null,
      active: Number(row.active || 0),
      revoked_at: row.revoked_at ? Number(row.revoked_at) : null,
    };
  }

  function getPenaltyById(id) {
    return state.penalties.find((row) => Number(row.id) === Number(id)) || null;
  }

  function deactivatePenalty(id) {
    const row = getPenaltyById(id);
    if (!row) return;
    row.active = 0;
    row.revoked_at = Date.now();
  }

  function seedPenalty(input) {
    const row = clonePenalty({
      id: input.id || state.nextId++,
      guild_id: input.guildId,
      user_id: input.userId,
      action_type: input.actionType,
      role_id: input.roleId || null,
      revoke_at: input.revokeAt,
      reason: input.reason || null,
      active: input.active ? 1 : 0,
      revoked_at: input.revokedAt || null,
    });
    state.nextId = Math.max(state.nextId, row.id + 1);
    state.penalties.push(row);
    return row.id;
  }

  async function execute(sql, params = []) {
    const query = String(sql || '')
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase();

    if (query.startsWith('insert into timed_penalties')) {
      const [guildId, userId, actionType, roleId, revokeAt, reason] = params;
      const id = state.nextId++;
      state.penalties.push(
        clonePenalty({
          id,
          guild_id: guildId,
          user_id: userId,
          action_type: actionType,
          role_id: roleId || null,
          revoke_at: Number(revokeAt),
          reason: reason || null,
          active: 1,
          revoked_at: null,
        })
      );
      return [{ insertId: id }];
    }

    if (
      query.startsWith(
        'select id from timed_penalties where guild_id = ? and user_id = ? and action_type = ? and active = 1'
      )
    ) {
      const [guildId, userId, actionType] = params;
      const rows = state.penalties
        .filter(
          (row) =>
            row.active === 1 &&
            row.guild_id === String(guildId) &&
            row.user_id === String(userId) &&
            row.action_type === String(actionType)
        )
        .map((row) => ({ id: row.id }));
      return [rows];
    }

    if (
      query.startsWith(
        'update timed_penalties set active = 0, revoked_at = ? where guild_id = ? and user_id = ? and action_type = ? and active = 1'
      )
    ) {
      const [revokedAt, guildId, userId, actionType] = params;
      let affectedRows = 0;
      for (const row of state.penalties) {
        if (
          row.active === 1 &&
          row.guild_id === String(guildId) &&
          row.user_id === String(userId) &&
          row.action_type === String(actionType)
        ) {
          row.active = 0;
          row.revoked_at = Number(revokedAt);
          affectedRows += 1;
        }
      }
      return [{ affectedRows }];
    }

    if (
      query.startsWith('update timed_penalties set active = 0, revoked_at = ? where id = ? and active = 1')
    ) {
      const [revokedAt, id] = params;
      const row = getPenaltyById(id);
      if (row && row.active === 1) {
        row.active = 0;
        row.revoked_at = Number(revokedAt);
        return [{ affectedRows: 1 }];
      }
      return [{ affectedRows: 0 }];
    }

    if (query.startsWith('select active from timed_penalties where id = ? limit 1')) {
      const [id] = params;
      const row = getPenaltyById(id);
      return [[{ active: row ? row.active : 0 }]];
    }

    if (query.startsWith('select * from timed_penalties where id = ? and active = 1')) {
      const [id] = params;
      const row = getPenaltyById(id);
      return [row && row.active === 1 ? [clonePenalty(row)] : []];
    }

    if (query.startsWith('select * from timed_penalties where active = 1 order by revoke_at asc')) {
      const rows = state.penalties
        .filter((row) => row.active === 1)
        .slice()
        .sort((a, b) => Number(a.revoke_at) - Number(b.revoke_at))
        .map((row) => clonePenalty(row));
      return [rows];
    }

    throw new Error(`Unhandled SQL in penalty scheduler integration test: ${sql}`);
  }

  return {
    state,
    execute,
    seedPenalty,
    deactivatePenalty,
    getPenaltyById,
  };
}

function createMuteClientFixture({ guildId = '1', userId = '100', roleId = '900' } = {}) {
  const roleState = new Set([String(roleId)]);
  let roleRemoveCalls = 0;

  const member = {
    roles: {
      cache: {
        has: (id) => roleState.has(String(id)),
      },
      remove: async (id) => {
        if (roleState.has(String(id))) {
          roleState.delete(String(id));
          roleRemoveCalls += 1;
        }
      },
    },
    voice: {
      serverMute: false,
      setMute: async () => {},
    },
  };

  const guild = {
    id: String(guildId),
    members: {
      fetch: async (id) => (String(id) === String(userId) ? member : null),
    },
  };

  const client = {
    guilds: {
      cache: new Map([[String(guildId), guild]]),
    },
  };

  return {
    client,
    getRoleRemoveCalls: () => roleRemoveCalls,
  };
}

test('penalty scheduler integration: manual cancel prevents timed revoke', async () => {
  penaltyScheduler.shutdown();

  const dbMock = createPenaltyDbMock();
  const originalExecute = db.execute;
  db.execute = dbMock.execute;

  const { client, getRoleRemoveCalls } = createMuteClientFixture({
    guildId: '1',
    userId: '101',
    roleId: '901',
  });

  try {
    const penaltyId = await penaltyScheduler.schedulePenalty(client, {
      guildId: '1',
      userId: '101',
      actionType: 'mute',
      roleId: '901',
      revokeAt: Date.now() + 100,
      reason: 'race-test',
    });

    setTimeout(() => {
      void penaltyScheduler.cancelPenalty('1', '101', 'mute');
    }, 30);

    await wait(220);

    assert.equal(getRoleRemoveCalls(), 0);
    assert.equal(dbMock.getPenaltyById(penaltyId)?.active, 0);
  } finally {
    penaltyScheduler.shutdown();
    db.execute = originalExecute;
  }
});

test('penalty scheduler integration: inactive record before timeout should skip revoke', async () => {
  penaltyScheduler.shutdown();

  const dbMock = createPenaltyDbMock();
  const originalExecute = db.execute;
  db.execute = dbMock.execute;

  const { client, getRoleRemoveCalls } = createMuteClientFixture({
    guildId: '2',
    userId: '201',
    roleId: '902',
  });

  try {
    const penaltyId = await penaltyScheduler.schedulePenalty(client, {
      guildId: '2',
      userId: '201',
      actionType: 'mute',
      roleId: '902',
      revokeAt: Date.now() + 90,
      reason: 'inactive-before-timeout',
    });

    setTimeout(() => {
      dbMock.deactivatePenalty(penaltyId);
    }, 25);

    await wait(220);

    assert.equal(getRoleRemoveCalls(), 0);
    assert.equal(dbMock.getPenaltyById(penaltyId)?.active, 0);
  } finally {
    penaltyScheduler.shutdown();
    db.execute = originalExecute;
  }
});

test('penalty scheduler integration: bootstrap reconciles expired penalty', async () => {
  penaltyScheduler.shutdown();

  const dbMock = createPenaltyDbMock();
  const originalExecute = db.execute;
  db.execute = dbMock.execute;

  const { client, getRoleRemoveCalls } = createMuteClientFixture({
    guildId: '3',
    userId: '301',
    roleId: '903',
  });

  try {
    const penaltyId = dbMock.seedPenalty({
      guildId: '3',
      userId: '301',
      actionType: 'mute',
      roleId: '903',
      revokeAt: Date.now() - 1000,
      active: true,
    });

    await penaltyScheduler.bootstrap(client);
    await waitFor(() => getRoleRemoveCalls() === 1);

    assert.equal(dbMock.getPenaltyById(penaltyId)?.active, 0);
  } finally {
    penaltyScheduler.shutdown();
    db.execute = originalExecute;
  }
});

test('penalty scheduler integration: repeated bootstrap should not duplicate revoke', async () => {
  penaltyScheduler.shutdown();

  const dbMock = createPenaltyDbMock();
  const originalExecute = db.execute;
  db.execute = dbMock.execute;

  const { client, getRoleRemoveCalls } = createMuteClientFixture({
    guildId: '4',
    userId: '401',
    roleId: '904',
  });

  try {
    const penaltyId = dbMock.seedPenalty({
      guildId: '4',
      userId: '401',
      actionType: 'mute',
      roleId: '904',
      revokeAt: Date.now() + 120,
      active: true,
    });

    await penaltyScheduler.bootstrap(client);
    await penaltyScheduler.bootstrap(client);

    await waitFor(() => dbMock.getPenaltyById(penaltyId)?.active === 0);
    assert.equal(getRoleRemoveCalls(), 1);
  } finally {
    penaltyScheduler.shutdown();
    db.execute = originalExecute;
  }
});
