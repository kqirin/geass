const test = require('node:test');
const assert = require('node:assert/strict');

const { parseTime, evaluateModerationHierarchy, resolveTarget } = require('../src/bot/moderation.utils');

test('parseTime should parse valid duration tokens', () => {
  assert.equal(parseTime('10s'), 10_000);
  assert.equal(parseTime('5m'), 5 * 60_000);
  assert.equal(parseTime('2h'), 2 * 60 * 60_000);
  assert.equal(parseTime('3d'), 3 * 24 * 60 * 60_000);
});

test('parseTime should reject invalid duration tokens', () => {
  assert.equal(parseTime(''), null);
  assert.equal(parseTime('0m'), null);
  assert.equal(parseTime('99x'), null);
  assert.equal(parseTime('abc'), null);
});

function createResolveMessage({
  fetchMember = async () => null,
  searchMembers = async () => null,
  reference = null,
  repliedUserId = null,
} = {}) {
  return {
    author: {
      id: 'mod-1',
      username: 'mod-user',
    },
    guild: {
      id: 'guild-1',
      members: {
        fetch: fetchMember,
        search: searchMembers,
      },
    },
    reference,
    mentions: {
      repliedUser: repliedUserId ? { id: repliedUserId } : null,
    },
    channel: {
      messages: {
        fetch: async () => null,
      },
    },
    fetchReference: async () => null,
  };
}

test('resolveTarget should support user mention tokens and preserve remaining args', async () => {
  const targetId = '123456789012345678';
  const args = [`<@!${targetId}>`, '10m', 'deneme'];
  const message = createResolveMessage({
    fetchMember: async (id) => ({
      id,
      user: { id, username: 'MentionTarget' },
    }),
  });

  const result = await resolveTarget(null, message, args, {
    allowReplyTarget: false,
    allowMemberSearch: false,
    allowUnresolvedTarget: true,
  });

  assert.equal(result.target?.id, targetId);
  assert.equal(result.targetId, targetId);
  assert.deepEqual(result.cleanArgs, ['10m', 'deneme']);
});

test('resolveTarget should keep unresolved snowflake/mention as targetId fallback', async () => {
  const targetId = '1447015808344784956';
  const args = [`<@${targetId}>`, 'af'];
  const message = createResolveMessage({
    fetchMember: async () => null,
  });

  const result = await resolveTarget(null, message, args, {
    allowReplyTarget: false,
    allowMemberSearch: false,
    allowUnresolvedTarget: true,
  });

  assert.equal(result.target?.id, targetId);
  assert.equal(result.targetId, targetId);
  assert.deepEqual(result.cleanArgs, ['af']);
});

test('resolveTarget should ignore reply targets when disabled', async () => {
  const args = ['10m'];
  const message = createResolveMessage({
    reference: { messageId: 'reply-message-id' },
    repliedUserId: '123456789012345678',
    fetchMember: async (id) => ({
      id,
      user: { id, username: 'ReplyTarget' },
    }),
  });

  const result = await resolveTarget(null, message, args, {
    allowReplyTarget: false,
    allowMemberSearch: false,
    allowUnresolvedTarget: true,
  });

  assert.equal(result.target, null);
  assert.equal(result.targetId, null);
  assert.deepEqual(result.cleanArgs, ['10m']);
});

function createRole(id, position) {
  return { id: String(id), position: Number(position || 0) };
}

function createRoleCache(roles = []) {
  const map = new Map(roles.map((role) => [String(role.id), role]));
  return {
    has: (id) => map.has(String(id)),
    some: (predicate) => [...map.values()].some(predicate),
    values: () => map.values(),
  };
}

function createMember(id, roles = [], { isBot = false } = {}) {
  const highestRole = roles.reduce((highest, role) => {
    if (!highest || Number(role.position || 0) > Number(highest.position || 0)) {
      return role;
    }
    return highest;
  }, null);

  return {
    id: String(id),
    user: { id: String(id), bot: Boolean(isBot) },
    roles: {
      cache: createRoleCache(roles),
      highest: highestRole
        ? { id: String(highestRole.id), position: Number(highestRole.position || 0) }
        : { id: null, position: 0 },
    },
  };
}

test('evaluateModerationHierarchy should use native highest role positions', () => {
  const guildOwnerId = '1';
  const actor = createMember('10', [createRole('300', 90), createRole('200', 40)]);
  const higherTarget = createMember('20', [createRole('100', 60)]);
  const equalTarget = createMember('30', [createRole('101', 90)]);
  const lowerTarget = createMember('40', [createRole('102', 20)]);

  assert.equal(
    evaluateModerationHierarchy({ actorMember: actor, targetMember: higherTarget, guildOwnerId }).allowed,
    true
  );
  assert.equal(
    evaluateModerationHierarchy({ actorMember: actor, targetMember: equalTarget, guildOwnerId }).reason,
    'actor_hierarchy_not_high_enough'
  );
  assert.equal(
    evaluateModerationHierarchy({ actorMember: lowerTarget, targetMember: actor, guildOwnerId }).reason,
    'actor_hierarchy_not_high_enough'
  );
});

test('evaluateModerationHierarchy should enforce self owner protected and bot target rules', () => {
  const guildOwnerId = 'owner-1';
  const actor = createMember('actor-1', [createRole('300', 90)]);
  const selfTarget = createMember('actor-1', [createRole('100', 10)]);
  const ownerTarget = createMember(guildOwnerId, [createRole('101', 5)]);
  const protectedTarget = createMember('target-1', [createRole('999', 1)]);
  const botTarget = createMember('bot-1', [createRole('102', 1)], { isBot: true });

  assert.equal(
    evaluateModerationHierarchy({ actorMember: actor, targetMember: selfTarget, guildOwnerId }).reason,
    'self_target'
  );
  assert.equal(
    evaluateModerationHierarchy({ actorMember: actor, targetMember: ownerTarget, guildOwnerId }).reason,
    'target_is_owner'
  );
  assert.equal(
    evaluateModerationHierarchy({
      actorMember: actor,
      targetMember: protectedTarget,
      guildOwnerId,
      hardProtectedRoleIds: new Set(['999']),
    }).reason,
    'protected_target'
  );
  assert.equal(
    evaluateModerationHierarchy({
      actorMember: actor,
      targetMember: botTarget,
      guildOwnerId,
      botUserId: 'bot-1',
    }).reason,
    'target_is_bot'
  );
});

test('evaluateModerationHierarchy should allow owner override and emit native zero-position fields', () => {
  const guildOwnerId = 'owner-1';
  const ownerActor = createMember(guildOwnerId, [createRole('100', 1)]);
  const normalTarget = createMember('target-1', [createRole('999', 500)]);
  const zeroActor = createMember('actor-2', []);
  const zeroTarget = createMember('target-2', []);

  const ownerCheck = evaluateModerationHierarchy({
    actorMember: ownerActor,
    targetMember: normalTarget,
    guildOwnerId,
  });
  const zeroCheck = evaluateModerationHierarchy({
    actorMember: zeroActor,
    targetMember: zeroTarget,
    guildOwnerId,
  });

  assert.equal(ownerCheck.allowed, true);
  assert.equal(ownerCheck.reason, 'actor_is_owner_override');
  assert.equal(zeroCheck.allowed, false);
  assert.equal(zeroCheck.reason, 'actor_hierarchy_not_high_enough');
  assert.equal(zeroCheck.actorHighestRolePosition, 0);
  assert.equal(zeroCheck.targetHighestRolePosition, 0);
  assert.equal(zeroCheck.actorHighestRoleId, null);
  assert.equal(zeroCheck.targetHighestRoleId, null);
});
