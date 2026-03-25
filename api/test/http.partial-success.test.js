const test = require('node:test');
const assert = require('node:assert/strict');

const { createHttpApp } = require('../src/interfaces/http/createHttpApp');
const { createSessionSigner } = require('../src/application/security/sessionSigner');
const reactionRuleRepository = require('../src/infrastructure/repositories/reactionRuleRepository');
const commandRepository = require('../src/infrastructure/repositories/commandRepository');

const SESSION_SECRET = '1234567890123456';
const GUILD_ID = '1447015808344784956';
const USER_ID = '900100000000000001';

function createSessionCookie(payload) {
  const signer = createSessionSigner(SESSION_SECRET);
  const packed = signer.pack(payload, 60_000);
  return `user_session=${packed}`;
}

function createClient() {
  const message = {
    id: '155500000000000001',
    react: async () => {},
    reactions: { cache: new Map() },
  };
  const channel = {
    id: '155500000000000002',
    isTextBased: () => true,
    messages: {
      fetch: async (id) => (String(id) === message.id ? message : null),
    },
  };
  const guild = {
    id: GUILD_ID,
    members: {
      fetch: async () => ({
        permissions: {
          has: (perm) => perm === 'Administrator',
        },
      }),
    },
    channels: {
      cache: new Map([[channel.id, channel]]),
      fetch: async (id) => (String(id) === channel.id ? channel : null),
    },
  };

  return {
    guilds: {
      cache: new Map([[guild.id, guild]]),
      fetch: async (id) => (String(id) === guild.id ? guild : null),
    },
    isReady: () => true,
    ws: { status: 0 },
  };
}

async function startServer({ client, reactionActionService = null }) {
  const app = createHttpApp({
    client,
    reactionActionService,
    CLIENT_ID: 'test-client',
    CLIENT_SECRET: 'test-secret',
    REDIRECT_URI: 'http://localhost:3000/api/auth/callback',
    SESSION_SECRET,
    corsOrigin: 'http://localhost:5173',
  });

  return new Promise((resolve) => {
    const server = app.listen(0, () => resolve(server));
  });
}

test('reaction rule create returns partial success when runtime refresh fails after DB write', async () => {
  const original = {
    createRule: reactionRuleRepository.createRule,
  };
  reactionRuleRepository.createRule = async (input) => ({
    id: 77,
    ...input,
  });

  const server = await startServer({
    client: createClient(),
    reactionActionService: {
      invalidateGuildCache: () => {},
      refreshGuildRules: async () => {
        throw new Error('refresh_failed');
      },
    },
  });

  try {
    const { port } = server.address();
    const res = await fetch(`http://127.0.0.1:${port}/api/reaction-rules`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Origin: 'http://localhost:5173',
        Cookie: createSessionCookie({
          userId: USER_ID,
          guilds: [{ id: GUILD_ID, name: 'Guild One' }],
        }),
      },
      body: JSON.stringify({
        guildId: GUILD_ID,
        channelId: '155500000000000002',
        messageId: '155500000000000001',
        emojiType: 'unicode',
        emojiName: '✅',
        triggerMode: 'ADD',
        enabled: true,
        cooldownSeconds: 0,
        onlyOnce: false,
        groupKey: '',
        allowedRoles: [],
        excludedRoles: [],
        actions: [{ type: 'REPLY', payload: { text: 'selam' } }],
      }),
    });
    const body = await res.json();

    assert.equal(res.status, 200);
    assert.equal(body.success, true);
    assert.equal(body.partial, true);
    assert.match(String(body.warning || ''), /runtime cache/i);
    assert.equal(body.rule.id, 77);
  } finally {
    reactionRuleRepository.createRule = original.createRule;
    await new Promise((resolve) => server.close(resolve));
  }
});

test('command save returns partial success when audit logging fails after persistence', async () => {
  const original = {
    upsertGuildCommand: commandRepository.upsertGuildCommand,
    insertCommandAudit: commandRepository.insertCommandAudit,
  };
  commandRepository.upsertGuildCommand = async () => {};
  commandRepository.insertCommandAudit = async () => {
    throw new Error('audit_failed');
  };

  const server = await startServer({ client: createClient() });

  try {
    const { port } = server.address();
    const res = await fetch(`http://127.0.0.1:${port}/api/commands/${GUILD_ID}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Origin: 'http://localhost:5173',
        Cookie: createSessionCookie({
          userId: USER_ID,
          guilds: [{ id: GUILD_ID, name: 'Guild One' }],
        }),
      },
      body: JSON.stringify({
        command_name: 'hello',
        command_response: 'world',
      }),
    });
    const body = await res.json();

    assert.equal(res.status, 200);
    assert.equal(body.success, true);
    assert.equal(body.partial, true);
    assert.match(String(body.warning || ''), /audit/i);
  } finally {
    commandRepository.upsertGuildCommand = original.upsertGuildCommand;
    commandRepository.insertCommandAudit = original.insertCommandAudit;
    await new Promise((resolve) => server.close(resolve));
  }
});
