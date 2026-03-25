'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { ChannelType, PermissionFlagsBits } = require('discord.js');

let embedCmd = null;

function loadCommand() {
  delete require.cache[require.resolve('../src/bot/commands/embed')];
  embedCmd = require('../src/bot/commands/embed');
  embedCmd.__internal?.clearPendingFlows?.();
}

function unloadCommand() {
  embedCmd?.__internal?.clearPendingFlows?.();
  delete require.cache[require.resolve('../src/bot/commands/embed')];
  embedCmd = null;
}

function makePermissionCarrier(canManage = true) {
  return {
    has: (perm) => perm === PermissionFlagsBits.ManageMessages && canManage,
  };
}

function makeBotMember(canSend = true) {
  return {
    permissions: { has: () => true },
    permissionsFor: () => ({ has: () => canSend }),
  };
}

function makeChannel({ botCanSend = true, id = '111111111111111111', sendFn = null, type = null } = {}) {
  return {
    type: type !== null ? type : ChannelType.GuildText,
    id,
    toString: () => '#test-channel',
    permissionsFor: () => ({ has: () => botCanSend }),
    send: sendFn || (async () => ({})),
  };
}

function makeGuild(channelsMap = {}, botMember = makeBotMember(true)) {
  return {
    channels: {
      fetch: async (id) => channelsMap[id] || null,
    },
    members: { me: botMember },
  };
}

function makeFields(values = {}) {
  return { getTextInputValue: (key) => values[key] ?? '' };
}

function extractCustomId(replyPayload) {
  const component = replyPayload?.components?.[0]?.components?.[0];
  return component?.data?.custom_id || component?.toJSON?.()?.custom_id || '';
}

function makePrefixMessage({
  canManage = true,
  guild = makeGuild(),
  channel = makeChannel(),
  mentionedChannel = null,
  authorId = 'actor-1',
} = {}) {
  const state = { replied: null };
  return {
    state,
    message: {
      author: { id: authorId },
      member: { permissions: makePermissionCarrier(canManage) },
      guild,
      mentions: { channels: { first: () => mentionedChannel } },
      channel,
      reply: async (payload) => {
        state.replied = payload;
        return payload;
      },
    },
  };
}

function makeButtonInteraction({ token, userId = 'actor-1', canManage = true, guild = null } = {}) {
  const interaction = {
    customId: `em_btn_open:${token}`,
    guild,
    user: { id: userId },
    memberPermissions: makePermissionCarrier(canManage),
    replied: false,
    deferred: false,
    shownModalId: null,
    _reply: null,
    _follow: null,
    isButton: () => true,
    isModalSubmit: () => false,
    showModal: async (modal) => {
      interaction.shownModalId = modal?.data?.custom_id || modal?.toJSON?.()?.custom_id || null;
    },
    reply: async (payload) => {
      interaction.replied = true;
      interaction._reply = payload;
    },
    followUp: async (payload) => {
      interaction._follow = payload;
    },
  };
  return interaction;
}

function makeModalInteraction({
  token,
  userId = 'actor-1',
  canManage = true,
  guild = null,
  fields = {},
} = {}) {
  const interaction = {
    customId: `em_mod_submit:${token}`,
    guild,
    user: { id: userId },
    memberPermissions: makePermissionCarrier(canManage),
    replied: false,
    deferred: false,
    _reply: null,
    _follow: null,
    _edit: null,
    isButton: () => false,
    isModalSubmit: () => true,
    deferReply: async () => {
      interaction.deferred = true;
    },
    editReply: async (payload) => {
      interaction._edit = payload;
    },
    reply: async (payload) => {
      interaction.replied = true;
      interaction._reply = payload;
    },
    followUp: async (payload) => {
      interaction._follow = payload;
    },
    fields: makeFields(fields),
  };
  return interaction;
}

function getErrorText(interaction) {
  return interaction._reply?.content || interaction._follow?.content || '';
}

test.beforeEach(() => {
  loadCommand();
});

test.afterEach(() => {
  unloadCommand();
});

test('embed prefix rejects actor without permission', async () => {
  const { message, state } = makePrefixMessage({ canManage: false });
  await embedCmd.run({ message, cleanArgs: [] });
  assert.match(String(state.replied?.content || ''), /Mesajları Yönet|iznine/i);
});

test('embed prefix rejects invalid target channel', async () => {
  const { message, state } = makePrefixMessage({
    channel: makeChannel({ type: 99 }),
  });
  await embedCmd.run({ message, cleanArgs: [] });
  assert.match(String(state.replied?.content || ''), /metin kanali|kanal/i);
});

test('embed prefix creates short tokenized custom id', async () => {
  const channel = makeChannel({ botCanSend: true });
  const { message, state } = makePrefixMessage({
    guild: makeGuild({}, makeBotMember(true)),
    channel,
    mentionedChannel: channel,
  });

  await embedCmd.run({ message, cleanArgs: ['<#111111111111111111>', 'x'.repeat(400)] });

  const customId = extractCustomId(state.replied);
  assert.match(customId, /^em_btn_open:[a-f0-9]+$/);
  assert.ok(customId.length < 100, `custom id should stay below Discord limit, got ${customId.length}`);
});

test('embed button rejects user other than starter', async () => {
  const channel = makeChannel({ botCanSend: true });
  const guild = makeGuild({ [channel.id]: channel }, makeBotMember(true));
  const { message, state } = makePrefixMessage({
    guild,
    channel,
    mentionedChannel: channel,
    authorId: 'starter-1',
  });

  await embedCmd.run({ message, cleanArgs: [] });
  const token = extractCustomId(state.replied).split(':')[1];

  const interaction = makeButtonInteraction({
    token,
    userId: 'other-user',
    guild,
  });
  await embedCmd.handleInteraction(interaction);

  assert.match(getErrorText(interaction), /komutu başlatan/i);
  assert.equal(interaction.shownModalId, null);
});

test('embed modal rejects submitter other than starter', async () => {
  const channelId = '222222222222222222';
  const channel = makeChannel({ botCanSend: true, id: channelId });
  const guild = makeGuild({ [channelId]: channel }, makeBotMember(true));
  const { message, state } = makePrefixMessage({
    guild,
    channel,
    mentionedChannel: channel,
    authorId: 'starter-2',
  });

  await embedCmd.run({ message, cleanArgs: [] });
  const token = extractCustomId(state.replied).split(':')[1];

  const modal = makeModalInteraction({
    token,
    userId: 'other-user',
    guild,
    fields: { em_title: 'T', em_desc: 'D' },
  });
  await embedCmd.handleInteraction(modal);

  assert.match(getErrorText(modal), /komutu başlatan/i);
});

test('embed modal rejects starter if permission was removed', async () => {
  const channelId = '333333333333333333';
  const channel = makeChannel({ botCanSend: true, id: channelId });
  const guild = makeGuild({ [channelId]: channel }, makeBotMember(true));
  const { message, state } = makePrefixMessage({
    guild,
    channel,
    mentionedChannel: channel,
    authorId: 'starter-3',
  });

  await embedCmd.run({ message, cleanArgs: [] });
  const token = extractCustomId(state.replied).split(':')[1];

  const modal = makeModalInteraction({
    token,
    userId: 'starter-3',
    canManage: false,
    guild,
    fields: { em_title: 'T', em_desc: 'D' },
  });
  await embedCmd.handleInteraction(modal);

  assert.match(getErrorText(modal), /Mesajları Yönet/i);
});

test('embed modal rejects duplicate submit after successful send', async () => {
  const channelId = '444444444444444444';
  let sent = null;
  const channel = makeChannel({
    botCanSend: true,
    id: channelId,
    sendFn: async (payload) => {
      sent = payload;
      return {};
    },
  });
  const guild = makeGuild({ [channelId]: channel }, makeBotMember(true));
  const { message, state } = makePrefixMessage({
    guild,
    channel,
    mentionedChannel: channel,
    authorId: 'starter-4',
  });

  await embedCmd.run({ message, cleanArgs: ['<#444444444444444444>', 'Merhaba'] });
  const token = extractCustomId(state.replied).split(':')[1];

  const first = makeModalInteraction({
    token,
    userId: 'starter-4',
    guild,
    fields: { em_title: 'Test', em_desc: 'Aciklama' },
  });
  await embedCmd.handleInteraction(first);
  assert.ok(sent, 'first submit should send embed');

  const second = makeModalInteraction({
    token,
    userId: 'starter-4',
    guild,
    fields: { em_title: 'Test', em_desc: 'Aciklama' },
  });
  await embedCmd.handleInteraction(second);
  assert.match(getErrorText(second), /oturumu artık geçerli değil/i);
});

test('embed modal sends embed successfully for starter', async () => {
  const channelId = '555555555555555555';
  let sent = null;
  const channel = makeChannel({
    botCanSend: true,
    id: channelId,
    sendFn: async (payload) => {
      sent = payload;
      return {};
    },
  });
  const guild = makeGuild({ [channelId]: channel }, makeBotMember(true));
  const { message, state } = makePrefixMessage({
    guild,
    channel,
    mentionedChannel: channel,
    authorId: 'starter-5',
  });

  await embedCmd.run({ message, cleanArgs: ['<#555555555555555555>', 'Normal mesaj'] });
  const token = extractCustomId(state.replied).split(':')[1];

  const modal = makeModalInteraction({
    token,
    userId: 'starter-5',
    guild,
    fields: {
      em_title: 'Test Baslik',
      em_desc: 'Test aciklama',
      em_color: '#5865F2',
    },
  });
  await embedCmd.handleInteraction(modal);

  assert.ok(sent !== null, 'channel.send should have been called');
  assert.equal(sent.content, 'Normal mesaj');
  assert.ok(sent.embeds?.length > 0, 'embed should be sent');
  const editDesc = modal._edit?.embeds?.[0]?.data?.description || '';
  assert.match(editDesc, /kanalına gönderildi/i);
});
