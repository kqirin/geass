const test = require('node:test');
const assert = require('node:assert/strict');

const { createPermissionService } = require('../src/bot/services/permissionService');
const { config } = require('../src/config');

const OWNER_ID = '900000000000000001';
const BOT_ID = '900000000000000002';
const CMD_MUTE_ROLE = '910000000000000001';
const CMD_KICK_ROLE = '910000000000000002';
const CMD_BAN_ROLE = '910000000000000003';
const CMD_LOCK_ROLE = '910000000000000099';

function createRole(id, position) {
  return { id: String(id), position: Number(position || 0) };
}

function createRoleCache(roles = []) {
  const map = new Map(roles.map((role) => [String(role.id), role]));
  return {
    has: (id) => map.has(String(id)),
    some: (predicate) => [...map.values()].some(predicate),
    values: () => map.values(),
    get: (id) => map.get(String(id)) || null,
  };
}

function createGuildRoleStore(roles = []) {
  const map = new Map(roles.map((role) => [String(role.id), role]));
  return {
    cache: {
      get: (id) => map.get(String(id)) || null,
    },
    fetch: async (id) => map.get(String(id)) || null,
  };
}

function createMember(
  id,
  roles = [],
  {
    isBot = false,
    isAdmin = false,
    permissionNames = [],
    manageable = true,
    moderatable = null,
    kickable = true,
    bannable = true,
    voice = null,
  } = {}
) {
  const highestRole = roles.reduce((highest, role) => {
    if (!highest || Number(role.position || 0) > Number(highest.position || 0)) {
      return role;
    }
    return highest;
  }, null);
  const grantedPermissions = new Set(permissionNames.map((perm) => String(perm)));

  return {
    id: String(id),
    user: { id: String(id), bot: Boolean(isBot) },
    roles: {
      cache: createRoleCache(roles),
      highest: highestRole
        ? { id: String(highestRole.id), position: Number(highestRole.position || 0) }
        : { id: null, position: 0 },
      remove: async () => {},
    },
    permissions: {
      has: (permName) => String(permName) === 'Administrator' ? Boolean(isAdmin) : grantedPermissions.has(String(permName)),
    },
    manageable: Boolean(manageable),
    moderatable: moderatable == null ? !isAdmin : Boolean(moderatable),
    kickable: Boolean(kickable),
    bannable: Boolean(bannable),
    voice: voice || { channel: null, channelId: null },
  };
}

function createCommandSettings(bucket, roleId, overrides = {}) {
  return {
    [`${bucket}_enabled`]: true,
    [`${bucket}_role`]: roleId,
    [`${bucket}_limit`]: 10,
    [`${bucket}_safe_list`]: '',
    ...overrides,
  };
}

function createBaseMessage(
  actorMember,
  {
    guildId = '900000000000001000',
    ownerId = OWNER_ID,
    fetchedActorMember = actorMember,
    targetMembers = [],
    botMember = null,
    guildRoles = [],
  } = {}
) {
  const memberMap = new Map();
  memberMap.set(String(fetchedActorMember.id), fetchedActorMember);
  for (const member of targetMembers) {
    memberMap.set(String(member.id), member);
  }
  if (botMember?.id) {
    memberMap.set(String(botMember.id), botMember);
  }

  return {
    guild: {
      id: String(guildId),
      ownerId: String(ownerId),
      members: {
        me: botMember,
        fetchMe: async () => botMember,
        fetch: async (memberId) => memberMap.get(String(memberId)) || null,
      },
      roles: createGuildRoleStore(guildRoles),
    },
    author: {
      id: String(actorMember.id),
    },
    member: actorMember,
    client: {
      user: { id: botMember?.id || BOT_ID },
    },
  };
}

function createMuteExecution(overrides = {}) {
  return {
    requireTargetMember: true,
    requiredBotPermissions: ['ModerateMembers'],
    requireTargetModeratable: true,
    ...overrides,
  };
}

async function runPermissionCheck({
  cmdType,
  settings,
  actorMember,
  fetchedActorMember = actorMember,
  targetMember = null,
  fetchedTargetMembers = [],
  targetId = null,
  botMember = null,
  guildRoles = [],
  auditLogger = null,
  execution = null,
  safeListBypassesRoleRestriction = false,
  authoritativeActorRoleCheck = false,
  ownerId = OWNER_ID,
}) {
  const permissionService = createPermissionService({ config, auditLogger });
  const message = createBaseMessage(actorMember, {
    ownerId,
    fetchedActorMember,
    targetMembers: targetMember ? [targetMember, ...fetchedTargetMembers] : fetchedTargetMembers,
    botMember,
    guildRoles,
  });

  return permissionService.verifyPermission({
    message,
    targetMember,
    targetId,
    settings,
    cmdType,
    execution,
    safeListBypassesRoleRestriction,
    authoritativeActorRoleCheck,
    sendTemplate: async () => {},
  });
}

test('actor target ve bot native hierarchy uygunsa moderation izni verilir', async () => {
  const actor = createMember('900000000000010001', [createRole(CMD_MUTE_ROLE, 80)], {
    permissionNames: ['ModerateMembers'],
  });
  const target = createMember('900000000000010002', [createRole('930000000000010001', 20)]);
  const bot = createMember(BOT_ID, [createRole('940000000000010001', 120)], {
    isBot: true,
    permissionNames: ['ModerateMembers'],
  });

  const check = await runPermissionCheck({
    cmdType: 'mute',
    settings: createCommandSettings('mute', CMD_MUTE_ROLE),
    actorMember: actor,
    targetMember: target,
    botMember: bot,
    guildRoles: [createRole(CMD_MUTE_ROLE, 80)],
    execution: createMuteExecution(),
  });

  assert.equal(check.success, true);
  assert.equal(check.context.targetMember.id, target.id);
  assert.equal(check.context.authoritySnapshot.actorHighestRolePosition, 80);
  assert.equal(check.context.authoritySnapshot.targetHighestRolePosition, 20);
  assert.equal(check.context.authoritySnapshot.botHighestRolePosition, 120);
});

test('actor ile target esit highest role position ise hierarchy reddi gelir', async () => {
  const actor = createMember('900000000000020001', [createRole(CMD_MUTE_ROLE, 40)], {
    permissionNames: ['ModerateMembers'],
  });
  const target = createMember('900000000000020002', [createRole('930000000000020001', 40)]);
  const bot = createMember(BOT_ID, [createRole('940000000000020001', 120)], {
    isBot: true,
    permissionNames: ['ModerateMembers'],
  });

  const check = await runPermissionCheck({
    cmdType: 'mute',
    settings: createCommandSettings('mute', CMD_MUTE_ROLE),
    actorMember: actor,
    targetMember: target,
    botMember: bot,
    guildRoles: [createRole(CMD_MUTE_ROLE, 40)],
    execution: createMuteExecution(),
  });

  assert.equal(check.success, false);
  assert.equal(check.reasonCode, 'actor_hierarchy_not_high_enough');
  assert.equal(check.authoritySnapshot.actorHighestRolePosition, 40);
  assert.equal(check.authoritySnapshot.targetHighestRolePosition, 40);
});

test('actor targettan dusukse native hierarchy reddi gelir', async () => {
  const actor = createMember('900000000000030001', [createRole(CMD_MUTE_ROLE, 20)], {
    permissionNames: ['ModerateMembers'],
  });
  const target = createMember('900000000000030002', [createRole('930000000000030001', 50)]);
  const bot = createMember(BOT_ID, [createRole('940000000000030001', 120)], {
    isBot: true,
    permissionNames: ['ModerateMembers'],
  });

  const check = await runPermissionCheck({
    cmdType: 'mute',
    settings: createCommandSettings('mute', CMD_MUTE_ROLE),
    actorMember: actor,
    targetMember: target,
    botMember: bot,
    guildRoles: [createRole(CMD_MUTE_ROLE, 20)],
    execution: createMuteExecution(),
  });

  assert.equal(check.success, false);
  assert.equal(check.reasonCode, 'actor_hierarchy_not_high_enough');
});

test('target sunucu sahibi ise actor yuksek olsa bile reddedilir', async () => {
  const actor = createMember('900000000000040001', [createRole(CMD_MUTE_ROLE, 80)], {
    permissionNames: ['ModerateMembers'],
  });
  const target = createMember(OWNER_ID, [createRole('930000000000040001', 5)]);
  const bot = createMember(BOT_ID, [createRole('940000000000040001', 120)], {
    isBot: true,
    permissionNames: ['ModerateMembers'],
  });

  const check = await runPermissionCheck({
    cmdType: 'mute',
    settings: createCommandSettings('mute', CMD_MUTE_ROLE),
    actorMember: actor,
    targetMember: target,
    botMember: bot,
    guildRoles: [createRole(CMD_MUTE_ROLE, 80)],
    execution: createMuteExecution(),
  });

  assert.equal(check.success, false);
  assert.equal(check.reasonCode, 'target_is_owner');
});

test('actor sunucu sahibi ise hierarchy override alir ama command role gate yine korunur', async () => {
  const actor = createMember(OWNER_ID, [createRole(CMD_MUTE_ROLE, 10)], {
    permissionNames: ['ModerateMembers'],
  });
  const target = createMember('900000000000050002', [createRole('930000000000050001', 999)]);
  const bot = createMember(BOT_ID, [createRole('940000000000050001', 1200)], {
    isBot: true,
    permissionNames: ['ModerateMembers'],
  });

  const check = await runPermissionCheck({
    cmdType: 'mute',
    settings: createCommandSettings('mute', CMD_MUTE_ROLE),
    actorMember: actor,
    targetMember: target,
    botMember: bot,
    guildRoles: [createRole(CMD_MUTE_ROLE, 10)],
    execution: createMuteExecution(),
  });

  assert.equal(check.success, true);
  assert.equal(check.context.authoritySnapshot.isActorOwner, true);
});

test('actor yeterli olsa bile bot moderatable degilse bot hierarchy reddi gelir', async () => {
  const actor = createMember('900000000000060001', [createRole(CMD_MUTE_ROLE, 80)], {
    permissionNames: ['ModerateMembers'],
  });
  const target = createMember('900000000000060002', [createRole('930000000000060001', 20)], {
    moderatable: false,
  });
  const bot = createMember(BOT_ID, [createRole('940000000000060001', 120)], {
    isBot: true,
    permissionNames: ['ModerateMembers'],
  });

  const check = await runPermissionCheck({
    cmdType: 'mute',
    settings: createCommandSettings('mute', CMD_MUTE_ROLE),
    actorMember: actor,
    targetMember: target,
    botMember: bot,
    guildRoles: [createRole(CMD_MUTE_ROLE, 80)],
    execution: createMuteExecution(),
  });

  assert.equal(check.success, false);
  assert.equal(check.stage, 'bot_capability');
  assert.equal(check.reasonCode, 'bot_hierarchy_not_high_enough');
});

test('command role varsa bile native hierarchy yetersizse hedefte islem reddedilir', async () => {
  const actor = createMember('900000000000070001', [createRole(CMD_MUTE_ROLE, 15)], {
    permissionNames: ['ModerateMembers'],
  });
  const target = createMember('900000000000070002', [createRole('930000000000070001', 30)]);
  const bot = createMember(BOT_ID, [createRole('940000000000070001', 100)], {
    isBot: true,
    permissionNames: ['ModerateMembers'],
  });

  const check = await runPermissionCheck({
    cmdType: 'mute',
    settings: createCommandSettings('mute', CMD_MUTE_ROLE),
    actorMember: actor,
    targetMember: target,
    botMember: bot,
    guildRoles: [createRole(CMD_MUTE_ROLE, 15)],
    execution: createMuteExecution(),
  });

  assert.equal(check.success, false);
  assert.equal(check.reasonCode, 'actor_hierarchy_not_high_enough');
});

test('target cachede yoksa authoritative fetch ile resolve edilir', async () => {
  const actor = createMember('900000000000080001', [createRole(CMD_MUTE_ROLE, 80)], {
    permissionNames: ['ModerateMembers'],
  });
  const fetchedTarget = createMember('900000000000080002', [createRole('930000000000080001', 10)]);
  const bot = createMember(BOT_ID, [createRole('940000000000080001', 120)], {
    isBot: true,
    permissionNames: ['ModerateMembers'],
  });

  const check = await runPermissionCheck({
    cmdType: 'mute',
    settings: createCommandSettings('mute', CMD_MUTE_ROLE),
    actorMember: actor,
    targetMember: null,
    fetchedTargetMembers: [fetchedTarget],
    targetId: fetchedTarget.id,
    botMember: bot,
    guildRoles: [createRole(CMD_MUTE_ROLE, 80)],
    execution: createMuteExecution(),
    ownerId: OWNER_ID,
  });

  assert.equal(check.success, true);
  assert.equal(check.context.targetMember.id, fetchedTarget.id);
});

test('timeout native moderatable reddi admin hedefte dedicated reasonCode ile doner', async () => {
  const actor = createMember('900000000000090001', [createRole(CMD_MUTE_ROLE, 90)], {
    permissionNames: ['ModerateMembers'],
  });
  const target = createMember('900000000000090002', [createRole('930000000000090001', 10)], {
    isAdmin: true,
    moderatable: false,
  });
  const bot = createMember(BOT_ID, [createRole('940000000000090001', 120)], {
    isBot: true,
    permissionNames: ['ModerateMembers'],
  });

  const check = await runPermissionCheck({
    cmdType: 'mute',
    settings: createCommandSettings('mute', CMD_MUTE_ROLE),
    actorMember: actor,
    targetMember: target,
    botMember: bot,
    guildRoles: [createRole(CMD_MUTE_ROLE, 90)],
    execution: createMuteExecution({
      targetModeratableDeniedReasonCode: 'target_timeout_protected',
      targetModeratableDeniedTemplate: 'timeoutProtectedTarget',
    }),
  });

  assert.equal(check.success, false);
  assert.equal(check.reasonCode, 'target_timeout_protected');
  assert.equal(check.details.targetIsAdministrator, true);
});

test('kick ve ban native kickable bannable durumlariyla uyumlu fail-closed calisir', async () => {
  const actor = createMember('900000000000100001', [
    createRole(CMD_KICK_ROLE, 90),
    createRole(CMD_BAN_ROLE, 90),
  ], {
    permissionNames: ['KickMembers', 'BanMembers'],
  });
  const kickTarget = createMember('900000000000100002', [createRole('930000000000100001', 10)], {
    kickable: false,
  });
  const banTarget = createMember('900000000000100003', [createRole('930000000000100002', 10)], {
    bannable: false,
  });
  const bot = createMember(BOT_ID, [createRole('940000000000100001', 120)], {
    isBot: true,
    permissionNames: ['KickMembers', 'BanMembers'],
  });

  const kickCheck = await runPermissionCheck({
    cmdType: 'kick',
    settings: createCommandSettings('kick', CMD_KICK_ROLE),
    actorMember: actor,
    targetMember: kickTarget,
    botMember: bot,
    guildRoles: [createRole(CMD_KICK_ROLE, 90), createRole(CMD_BAN_ROLE, 90)],
    execution: {
      requireTargetMember: true,
      requiredBotPermissions: ['KickMembers'],
      requireTargetKickable: true,
    },
  });
  const banCheck = await runPermissionCheck({
    cmdType: 'ban',
    settings: createCommandSettings('ban', CMD_BAN_ROLE),
    actorMember: actor,
    targetMember: banTarget,
    botMember: bot,
    guildRoles: [createRole(CMD_KICK_ROLE, 90), createRole(CMD_BAN_ROLE, 90)],
    execution: {
      requireTargetMember: true,
      requiredBotPermissions: ['BanMembers'],
      requireTargetBannable: true,
    },
  });

  assert.equal(kickCheck.success, false);
  assert.equal(kickCheck.reasonCode, 'bot_hierarchy_not_high_enough');
  assert.equal(banCheck.success, false);
  assert.equal(banCheck.reasonCode, 'bot_hierarchy_not_high_enough');
});

test('audit log native hierarchy alanlarini dolu ve actorLevelsiz uretir', async () => {
  const auditEvents = [];
  const actor = createMember('900000000000110001', [createRole(CMD_MUTE_ROLE, 20)], {
    permissionNames: ['ModerateMembers'],
  });
  const target = createMember('900000000000110002', [createRole('930000000000110001', 40)]);
  const bot = createMember(BOT_ID, [createRole('940000000000110001', 120)], {
    isBot: true,
    permissionNames: ['ModerateMembers'],
  });

  const check = await runPermissionCheck({
    cmdType: 'mute',
    settings: createCommandSettings('mute', CMD_MUTE_ROLE),
    actorMember: actor,
    targetMember: target,
    botMember: bot,
    guildRoles: [createRole(CMD_MUTE_ROLE, 20)],
    execution: createMuteExecution(),
    auditLogger: (event) => auditEvents.push(event),
  });

  assert.equal(check.success, false);
  assert.equal(auditEvents.length, 1);
  assert.equal(auditEvents[0].guildId, '900000000000001000');
  assert.equal(auditEvents[0].actorId, actor.id);
  assert.equal(auditEvents[0].targetId, target.id);
  assert.equal(auditEvents[0].command, 'mute');
  assert.equal(auditEvents[0].reasonCode, 'actor_hierarchy_not_high_enough');
  assert.equal(auditEvents[0].actorHighestRoleId, CMD_MUTE_ROLE);
  assert.equal(auditEvents[0].actorHighestRolePosition, 20);
  assert.equal(auditEvents[0].targetHighestRoleId, '930000000000110001');
  assert.equal(auditEvents[0].targetHighestRolePosition, 40);
  assert.equal(auditEvents[0].botHighestRoleId, '940000000000110001');
  assert.equal(auditEvents[0].botHighestRolePosition, 120);
  assert.equal(auditEvents[0].isActorOwner, false);
  assert.equal(auditEvents[0].isTargetOwner, false);
  assert.equal(auditEvents[0].actionType, 'mute');
  assert.equal(auditEvents[0].source, 'command');
  assert.equal(auditEvents[0].stage, 'hierarchy');
  assert.equal(Object.prototype.hasOwnProperty.call(auditEvents[0], 'actorLevel'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(auditEvents[0], 'targetLevel'), false);
});

test('native snapshot no-role hedefte null authority yerine zero-position alanlari verir', async () => {
  const auditEvents = [];
  const actor = createMember('900000000000120001', [createRole(CMD_MUTE_ROLE, 0)], {
    permissionNames: ['ModerateMembers'],
  });
  const target = createMember('900000000000120002', []);
  const bot = createMember(BOT_ID, [createRole('940000000000120001', 120)], {
    isBot: true,
    permissionNames: ['ModerateMembers'],
  });

  const check = await runPermissionCheck({
    cmdType: 'mute',
    settings: createCommandSettings('mute', CMD_MUTE_ROLE),
    actorMember: actor,
    targetMember: target,
    botMember: bot,
    guildRoles: [createRole(CMD_MUTE_ROLE, 0)],
    execution: createMuteExecution(),
    auditLogger: (event) => auditEvents.push(event),
  });

  assert.equal(check.success, false);
  assert.equal(check.reasonCode, 'actor_hierarchy_not_high_enough');
  assert.equal(auditEvents[0].actorHighestRolePosition, 0);
  assert.equal(auditEvents[0].targetHighestRolePosition, 0);
  assert.equal(auditEvents[0].targetHighestRoleId, null);
});

test('lock role silinmisse command gate fail-open yerine reddeder', async () => {
  const actor = createMember('900000000000130001', [createRole(CMD_LOCK_ROLE, 50)]);

  const permissionService = createPermissionService({ config });
  const message = createBaseMessage(actor, {
    guildRoles: [],
  });

  let sentTemplate = null;
  const check = await permissionService.verifyPermission({
    message,
    targetMember: null,
    settings: createCommandSettings('lock', CMD_LOCK_ROLE),
    cmdType: 'lock',
    authoritativeActorRoleCheck: true,
    safeListBypassesRoleRestriction: true,
    sendTemplate: async (templateKey) => {
      sentTemplate = templateKey;
    },
  });

  assert.equal(check.success, false);
  assert.equal(check.reasonCode, 'missing_command_permission');
  assert.equal(sentTemplate, 'roleNotConfigured');
});
