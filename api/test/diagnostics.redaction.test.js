const test = require('node:test');
const assert = require('node:assert/strict');

const diagnostics = require('../src/diagnostics');
const { createDiscordClient } = require('../src/discordClient');
const { config } = require('../src/config');

function targetGuildId() {
  return config.discord.targetGuildId || 'guild-1';
}

function parseDiagLogs(lines) {
  return lines
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return null;
      }
    })
    .filter(Boolean)
    .filter((entry) => entry.scope === 'diag');
}

test('diag mode redacts message content from messageCreate logs', async () => {
  const previousDiagMode = process.env.DIAG_MODE;
  process.env.DIAG_MODE = '1';
  diagnostics.__internal.resetDiagStateForTests();

  const captured = [];
  const originalConsoleLog = console.log;
  console.log = (...args) => {
    captured.push(args.map((x) => String(x)).join(' '));
  };

  const client = createDiscordClient({
    cache: { getCustomCommand: () => null },
    moderationBot: { handlePrefix: async () => false },
    getPrivateRoomService: () => ({ handleMessageCreate: async () => false }),
    logSystem: () => { },
    logError: () => { },
  });

  try {
    const handler = client.listeners('messageCreate')[0];

    await handler({
      id: 'msg-redaction-1',
      content: 'VERY_SECRET_TOKEN=abc123',
      author: { id: 'user-1', bot: false },
      guild: { id: targetGuildId() },
      channel: {
        id: 'channel-1',
        send: async () => { },
      },
    });

    const records = parseDiagLogs(captured);
    const messageRecord = records.find((entry) => entry.event === 'discord.messageCreate');

    assert.ok(messageRecord, 'discord.messageCreate diag kaydi bulunamadi');
    assert.equal(messageRecord.opId, 'msg-redaction-1');
    assert.equal(messageRecord.requestId, null);
    // B1 optimization: leaner payload — no contentPreview/content fields
    assert.equal(Object.prototype.hasOwnProperty.call(messageRecord.payload, 'contentPreview'), false);
    assert.equal(Object.prototype.hasOwnProperty.call(messageRecord.payload, 'content'), false);
  } finally {
    console.log = originalConsoleLog;
    await client.destroy().catch(() => { });
    if (previousDiagMode === undefined) delete process.env.DIAG_MODE;
    else process.env.DIAG_MODE = previousDiagMode;
  }
});

test('diag mode adds requestId/opId and rate-limits noisy events', () => {
  const previousDiagMode = process.env.DIAG_MODE;
  process.env.DIAG_MODE = '1';
  diagnostics.__internal.resetDiagStateForTests();

  const captured = [];
  const originalConsoleLog = console.log;
  console.log = (...args) => {
    captured.push(args.map((x) => String(x)).join(' '));
  };

  try {
    diagnostics.logDiag('voice.connect_called', {
      operationId: 42,
      context: {
        requestId: 'req-42',
      },
    });

    for (let i = 0; i < 40; i += 1) {
      diagnostics.logDiag('discord.messageCreate', {
        guildId: 'g-1',
        channelId: 'c-1',
        messageId: `m-${i}`,
        contentRedacted: true,
        contentLength: 12,
      });
    }

    const records = parseDiagLogs(captured);
    const connectRecord = records.find((entry) => entry.event === 'voice.connect_called');
    assert.ok(connectRecord, 'voice.connect_called diag kaydi bulunamadi');
    assert.equal(connectRecord.requestId, 'req-42');
    assert.equal(connectRecord.opId, '42');

    const messageRecords = records.filter((entry) => entry.event === 'discord.messageCreate');
    assert.equal(messageRecords.length <= 20, true, 'messageCreate rate-limit uygulanmadi');
    assert.equal(records.some((entry) => entry.event === 'diag.rate_limited'), true);
  } finally {
    console.log = originalConsoleLog;
    if (previousDiagMode === undefined) delete process.env.DIAG_MODE;
    else process.env.DIAG_MODE = previousDiagMode;
  }
});
