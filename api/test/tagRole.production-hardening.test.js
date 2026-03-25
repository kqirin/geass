const test = require('node:test');
const assert = require('node:assert/strict');

const { createTagRoleFeature } = require('../src/features/tagRole');

const TAG_ROLE_EXEMPT_USER_IDS = Object.freeze([
  '787960730975993896',
  '763898226562564116',
  '1477005738361618565',
]);

function createMember(
  id,
  {
    hasRole = false,
    primaryGuild = null,
    fetchedPrimaryGuild = {
      identityEnabled: true,
      identityGuildId: 'guild-1',
    },
    manageable = true,
    onManageableCheck = null,
    onRoleHas = null,
    onRoleAdd = null,
    onRoleRemove = null,
  } = {}
) {
  let userFetches = 0;
  let manageableChecks = 0;
  let roleHasChecks = 0;
  let roleAdds = 0;
  let roleRemoves = 0;
  const roleIds = new Set(hasRole ? ['role-tag'] : []);
  const member = {
    id: String(id),
    user: {
      id: String(id),
      bot: false,
      primaryGuild,
      fetch: async () => {
        userFetches += 1;
        return {
          id: String(id),
          bot: false,
          primaryGuild: fetchedPrimaryGuild,
        };
      },
    },
    guild: null,
    roles: {
      cache: {
        has: (roleId) => {
          roleHasChecks += 1;
          if (typeof onRoleHas === 'function') return onRoleHas(roleId);
          return roleIds.has(String(roleId));
        },
      },
      add: async () => {
        roleAdds += 1;
        if (typeof onRoleAdd === 'function') return onRoleAdd();
        roleIds.add('role-tag');
      },
      remove: async () => {
        roleRemoves += 1;
        if (typeof onRoleRemove === 'function') return onRoleRemove();
        roleIds.delete('role-tag');
      },
    },
  };
  Object.defineProperty(member, 'manageable', {
    enumerable: true,
    configurable: true,
    get() {
      manageableChecks += 1;
      if (typeof onManageableCheck === 'function') return onManageableCheck();
      return manageable;
    },
  });

  return {
    member,
    getUserFetches: () => userFetches,
    getManageableChecks: () => manageableChecks,
    getRoleHasChecks: () => roleHasChecks,
    getRoleAdds: () => roleAdds,
    getRoleRemoves: () => roleRemoves,
  };
}

function createGuild(members, { memberCount = members.length } = {}) {
  const guild = {
    id: 'guild-1',
    memberCount,
    members: {
      me: {
        permissions: {
          has: (permission) => permission === 'ManageRoles',
        },
        roles: {
          highest: { position: 10 },
        },
      },
      cache: new Map(),
      fetchMe: async function fetchMe() {
        return this.me;
      },
    },
    roles: {
      cache: new Map([
        ['role-tag', { id: 'role-tag', position: 1 }],
      ]),
      fetch: async (id) => guild.roles.cache.get(String(id)) || null,
    },
  };

  for (const entry of members) {
    entry.member.guild = guild;
    guild.members.cache.set(entry.member.id, entry.member);
  }

  return guild;
}

function createClient(guild) {
  return {
    guilds: {
      cache: new Map([[guild.id, guild]]),
      fetch: async (id) => (String(id) === guild.id ? guild : null),
    },
  };
}

test('tag role startup sync avoids forced user fetch for members without current tag role', async () => {
  const first = createMember('1001', { hasRole: false });
  const second = createMember('1002', { hasRole: true });
  const guild = createGuild([first, second], { memberCount: 50 });
  const client = {
    guilds: createClient(guild).guilds,
  };

  const feature = createTagRoleFeature({
    client,
    getTagRoleConfig: () => ({
      enabled: true,
      roleId: 'role-tag',
    }),
  });

  const result = await feature.syncGuild(guild.id, 'startup');

  assert.equal(result.ok, true);
  assert.equal(result.partial, true);
  assert.equal(result.exemptSkipped, 0);
  assert.equal(result.processed, 2);
  assert.equal(first.getUserFetches(), 0);
  assert.equal(second.getUserFetches(), 1);
});

test('tag role guild sync skips exempt users before validation and excludes them from failures', async () => {
  const exemptMembers = TAG_ROLE_EXEMPT_USER_IDS.map((id) =>
    createMember(id, {
      hasRole: true,
      onManageableCheck: () => {
        throw new Error(`manageable should not be checked for exempt user ${id}`);
      },
      onRoleHas: () => {
        throw new Error(`role presence check should not run for exempt user ${id}`);
      },
      onRoleAdd: () => {
        throw new Error(`role add should not run for exempt user ${id}`);
      },
      onRoleRemove: () => {
        throw new Error(`role remove should not run for exempt user ${id}`);
      },
    })
  );
  const regularMember = createMember('9001', { hasRole: true });
  const guild = createGuild([...exemptMembers, regularMember]);
  const infoLogs = [];
  const errorLogs = [];

  const feature = createTagRoleFeature({
    client: createClient(guild),
    getTagRoleConfig: () => ({
      enabled: true,
      roleId: 'role-tag',
    }),
    logSystem: (message, level) => {
      infoLogs.push({ message, level });
    },
    logError: (...args) => {
      errorLogs.push(args);
    },
  });

  const result = await feature.syncGuild(guild.id, 'startup');

  assert.equal(result.ok, true);
  assert.equal(result.scanned, 4);
  assert.equal(result.exemptSkipped, 3);
  assert.equal(result.processed, 1);
  assert.equal(result.failed, 0);
  assert.equal(result.partial, false);
  assert.equal(result.added, 0);
  assert.equal(result.removed, 0);
  assert.equal(errorLogs.length, 0);

  for (const exemptMember of exemptMembers) {
    assert.equal(exemptMember.getUserFetches(), 0);
    assert.equal(exemptMember.getManageableChecks(), 0);
    assert.equal(exemptMember.getRoleHasChecks(), 0);
    assert.equal(exemptMember.getRoleAdds(), 0);
    assert.equal(exemptMember.getRoleRemoves(), 0);
  }

  assert.equal(infoLogs.length, 1);
  assert.equal(infoLogs[0].level, 'INFO');
  assert.match(infoLogs[0].message, /exemptSkipped=3/);
  assert.match(infoLogs[0].message, /processed=1/);
  assert.match(infoLogs[0].message, /failed=0/);
  assert.doesNotMatch(infoLogs[0].message, /skip_member_not_manageable/);
  assert.doesNotMatch(infoLogs[0].message, /failCodes=/);
});

test('tag role sync treats invalid exempt member payload as exempt skip', async () => {
  let configLookups = 0;
  const exemptId = TAG_ROLE_EXEMPT_USER_IDS[0];
  const feature = createTagRoleFeature({
    client: {
      guilds: {
        cache: new Map(),
        fetch: async () => null,
      },
    },
    getTagRoleConfig: () => {
      configLookups += 1;
      return {
        enabled: true,
        roleId: 'role-tag',
      };
    },
  });

  const result = await feature.syncTagRole(
    {
      id: exemptId,
      user: {
        id: exemptId,
        bot: false,
      },
    },
    'userUpdate'
  );

  assert.deepEqual(result, {
    ok: true,
    action: 'exempt_skipped',
    exempt: true,
    userId: exemptId,
  });
  assert.equal(configLookups, 0);
});
