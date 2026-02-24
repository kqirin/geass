
const {
  joinVoiceChannel,
  getVoiceConnection,
  VoiceConnectionStatus,
  entersState,
} = require('@discordjs/voice');


const stateByGuild = new Map();

function getStatus(guildId, client) {
  const conn = getVoiceConnection(guildId);
  const st = stateByGuild.get(guildId);

  const guild = client?.guilds?.cache?.get(guildId);
  const botVoiceChannelId = guild?.members?.me?.voice?.channelId || null;
  const channelId = botVoiceChannelId || conn?.joinConfig?.channelId || st?.channelId || null;

  let channelName = null;
  if (channelId && guild) {
    const ch = guild.channels.cache.get(channelId);
    if (ch) channelName = ch.name;
  }

  const connAlive = !!conn && conn.state.status !== VoiceConnectionStatus.Destroyed;
  const connected = Boolean(channelId) && (conn ? connAlive : Boolean(botVoiceChannelId));

  if (!connected && st) {
    stateByGuild.delete(guildId);
  }

  return {
    connected,
    channelId,
    channelName,
  };
}

async function connectToChannel({ client, guildId, channelId, selfDeaf = true }) {
  const guild = client.guilds.cache.get(guildId);
  if (!guild) throw new Error('Sunucu bulunamadi');

  const channel = guild.channels.cache.get(channelId);
  if (!channel) throw new Error('Kanal bulunamadi');

  if (channel.type !== 2 && channel.type !== 13) {
    throw new Error('Bu kanal ses kanali degil');
  }

  const existing = getVoiceConnection(guildId);
  if (existing) {
    try {
      existing.destroy();
    } catch {}
  }

  const connection = joinVoiceChannel({
    channelId,
    guildId,
    adapterCreator: guild.voiceAdapterCreator,
    selfDeaf,
  });

  stateByGuild.set(guildId, { channelId });

  connection.on(VoiceConnectionStatus.Destroyed, () => {
    stateByGuild.delete(guildId);
  });

  connection.on(VoiceConnectionStatus.Disconnected, async () => {
    try {
      await Promise.race([
        entersState(connection, VoiceConnectionStatus.Signalling, 5_000),
        entersState(connection, VoiceConnectionStatus.Connecting, 5_000),
      ]);
    } catch {
      try {
        connection.destroy();
      } catch {}
      stateByGuild.delete(guildId);
    }
  });

  try {
    await entersState(connection, VoiceConnectionStatus.Ready, 20_000);
    stateByGuild.set(guildId, { channelId });
    return { ok: true };
  } catch {
    try {
      connection.destroy();
    } catch {}
    stateByGuild.delete(guildId);
    throw new Error('Ses baglantisi kurulamadi');
  }
}

async function disconnect({ guildId }) {
  const conn = getVoiceConnection(guildId);
  if (conn) {
    try {
      conn.destroy();
    } catch {}
  }
  stateByGuild.delete(guildId);
  return { ok: true };
}

module.exports = {
  getStatus,
  connectToChannel,
  disconnect,
};

