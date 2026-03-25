const test = require('node:test');
const assert = require('node:assert/strict');

const { createTemplateSender } = require('../src/application/messages/templateService');

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function buildMessage() {
  const calls = {
    reply: 0,
    send: 0,
    deleted: 0,
    replyPayloads: [],
    sendPayloads: [],
  };

  const sentMessage = {
    delete: async () => {
      calls.deleted += 1;
    },
  };

  const message = {
    member: {
      displayName: 'Mod',
      displayAvatarURL: () => null,
    },
    author: {
      username: 'mod',
      displayAvatarURL: () => null,
    },
    reply: async (payload) => {
      calls.reply += 1;
      calls.replyPayloads.push(payload);
      return sentMessage;
    },
    channel: {
      send: async (payload) => {
        calls.send += 1;
        calls.sendPayloads.push(payload);
        return sentMessage;
      },
    },
    client: {
      users: {
        fetch: async () => null,
      },
    },
  };

  return { message, calls };
}

test('template sender keeps default reply behavior for commands', async () => {
  const sender = createTemplateSender();
  const { message, calls } = buildMessage();

  await sender.sendTemplate({
    message,
    commandName: 'warn',
    templateKey: 'success',
    context: { target: '@u', reason: 'r', caseId: '#1' },
  });

  assert.equal(calls.reply, 1);
  assert.equal(calls.send, 0);
});

test('template sender supports channel-send mode with auto cleanup', async () => {
  const sender = createTemplateSender();
  const { message, calls } = buildMessage();

  await sender.sendTemplate({
    message,
    commandName: 'warn',
    templateKey: 'success',
    context: { target: '@u', reason: 'r', caseId: '#2' },
    asReply: false,
    deleteAfterMs: 10,
  });

  assert.equal(calls.reply, 0);
  assert.equal(calls.send, 1);
  await wait(30);
  assert.equal(calls.deleted, 1);
});

test('warn template embed icon uses target member avatar instead of executor avatar', async () => {
  const sender = createTemplateSender();
  const { message, calls } = buildMessage();
  const executorAvatarUrl = 'https://cdn.example.com/executor.png';
  const targetAvatarUrl = 'https://cdn.example.com/target-member.png';

  message.member.displayAvatarURL = () => executorAvatarUrl;
  message.author.displayAvatarURL = () => executorAvatarUrl;

  const targetMember = {
    id: '1447015808344784956',
    user: {
      id: '1447015808344784956',
      displayAvatarURL: () => targetAvatarUrl,
    },
  };

  await sender.sendTemplate({
    message,
    commandName: 'warn',
    templateKey: 'success',
    context: { target: '@target', reason: 'test', caseId: '#1' },
    iconUser: message.author,
    targetUserOrId: targetMember,
  });

  assert.equal(calls.replyPayloads.length, 1);
  const payload = calls.replyPayloads[0];
  const embedJson = payload.embeds[0].toJSON();
  assert.equal(embedJson.author.icon_url, targetAvatarUrl);
  assert.notEqual(embedJson.author.icon_url, executorAvatarUrl);
});

test('warn template embed icon uses target avatar fetched by user id', async () => {
  const sender = createTemplateSender();
  const { message, calls } = buildMessage();
  const targetId = '1447015808344784956';
  const executorAvatarUrl = 'https://cdn.example.com/executor.png';
  const fetchedTargetAvatarUrl = 'https://cdn.example.com/target-fetched.png';
  const fetchCalls = [];

  message.member.displayAvatarURL = () => executorAvatarUrl;
  message.author.displayAvatarURL = () => executorAvatarUrl;
  message.client.users.fetch = async (id) => {
    fetchCalls.push(id);
    return {
      id,
      displayAvatarURL: () => fetchedTargetAvatarUrl,
    };
  };

  await sender.sendTemplate({
    message,
    commandName: 'warn',
    templateKey: 'success',
    context: { target: `<@${targetId}>`, reason: 'test', caseId: '#2' },
    iconUser: message.author,
    targetUserOrId: targetId,
  });

  assert.deepEqual(fetchCalls, [targetId]);
  assert.equal(calls.replyPayloads.length, 1);
  const payload = calls.replyPayloads[0];
  const embedJson = payload.embeds[0].toJSON();
  assert.equal(embedJson.author.icon_url, fetchedTargetAvatarUrl);
  assert.notEqual(embedJson.author.icon_url, executorAvatarUrl);
});

test('warn template keeps embed valid when target fetch fails (no executor avatar fallback)', async () => {
  const sender = createTemplateSender();
  const { message, calls } = buildMessage();
  const targetId = '1447015808344784956';
  const executorAvatarUrl = 'https://cdn.example.com/executor.png';

  message.member.displayAvatarURL = () => executorAvatarUrl;
  message.author.displayAvatarURL = () => executorAvatarUrl;
  message.client.users.fetch = async () => {
    throw new Error('not_found');
  };

  await sender.sendTemplate({
    message,
    commandName: 'warn',
    templateKey: 'success',
    context: { target: `<@${targetId}>`, reason: 'test', caseId: '#3' },
    iconUser: message.author,
    targetUserOrId: targetId,
  });

  assert.equal(calls.replyPayloads.length, 1);
  const payload = calls.replyPayloads[0];
  const embedJson = payload.embeds[0].toJSON();
  assert.equal(embedJson.author.icon_url, undefined);
});

test('template sender does not fallback to channel.send unless explicitly enabled', async () => {
  const sender = createTemplateSender();
  const { message, calls } = buildMessage();
  message.reply = async () => {
    calls.reply += 1;
    throw new Error('reply_failed');
  };

  await assert.rejects(async () => {
    await sender.sendTemplate({
      message,
      commandName: 'warn',
      templateKey: 'systemError',
    });
  });

  assert.equal(calls.reply, 1);
  assert.equal(calls.send, 0);
});

test('template sender can fallback to channel.send when requested', async () => {
  const sender = createTemplateSender();
  const { message, calls } = buildMessage();
  message.reply = async () => {
    calls.reply += 1;
    throw new Error('reply_failed');
  };

  await sender.sendTemplate({
    message,
    commandName: 'warn',
    templateKey: 'systemError',
    allowReplyFallback: true,
  });

  assert.equal(calls.reply, 1);
  assert.equal(calls.send, 1);
});

test('template sender removes empty caseId parentheses from rendered moderation title', async () => {
  const sender = createTemplateSender();
  const { message, calls } = buildMessage();

  await sender.sendTemplate({
    message,
    commandName: 'warn',
    templateKey: 'success',
    context: { target: '@u', reason: 'Yok', caseId: '' },
  });

  const payload = calls.replyPayloads[0];
  const embedJson = payload.embeds[0].toJSON();
  assert.match(String(embedJson.description || ''), /sebep: Yok/i);
  assert.doesNotMatch(String(embedJson.description || ''), /\(\)/);
});
