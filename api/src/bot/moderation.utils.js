function actionNameFor(cmd) {
  return actionNames[cmd] || cmd.toUpperCase();
}

const actionNames = {
  warn: 'UYARI',
  mute: 'SUSTURMA',
  unmute: 'SUSTURMA KALDIR',
  kick: 'ATMA',
  jail: 'KARANTINA',
  unjail: 'KARANTINA KALDIR',
  ban: 'BAN',
  unban: 'BAN KALDIR',
  clear: 'TEMIZLE',
  vcmute: 'SES SUSTURMA',
  vcunmute: 'SES SUSTURMA KALDIR',
};

function getMsgFactory(settings) {
  return (key, fallback) => {
    const cm = settings?.custom_messages || {};
    const v = cm[key];
    return typeof v === 'string' && v.trim().length > 0 ? v : fallback;
  };
}

async function checkHierarchy(actorMember, targetMember) {
  try {
    if (!actorMember || !targetMember) return true;
    if (actorMember.id === targetMember.id) return false;

    const actorTop = actorMember.roles.highest?.position ?? 0;
    const targetTop = targetMember.roles.highest?.position ?? 0;

    return actorTop > targetTop;
  } catch {
    return false;
  }
}

function normalizeRawTargetId(raw) {
  return String(raw || '').replace(/[^\d]/g, '');
}

async function resolveMemberFromReply(message) {
  const guild = message.guild;
  if (!guild) return null;

  const repliedUserId = message.mentions?.repliedUser?.id || null;
  if (repliedUserId) {
    const member = await guild.members.fetch(repliedUserId).catch(() => null);
    if (member) return member;
  }

  if (!message.reference?.messageId) return null;
  const repliedMessage = await message.fetchReference().catch(() => null);
  const repliedAuthorId = repliedMessage?.author?.id || null;
  if (!repliedAuthorId) return null;
  return guild.members.fetch(repliedAuthorId).catch(() => null);
}

async function resolveMemberFromRaw(guild, raw) {
  const id = normalizeRawTargetId(raw);
  if (id) {
    const byId = await guild.members.fetch(id).catch(() => null);
    if (byId) return { member: byId, rawId: id };
  }

  const query = String(raw || '').trim();
  if (!query) return { member: null, rawId: id || null };

  try {
    const found = await guild.members.search({ query, limit: 1 }).catch(() => null);
    if (found && found.size > 0) {
      const bySearch = [...found.values()][0];
      return { member: bySearch, rawId: id || bySearch.id };
    }
  } catch {}

  return { member: null, rawId: id || null };
}

async function resolveTarget(_client, message, args) {
  const guild = message.guild;
  const replyMember = await resolveMemberFromReply(message);
  const raw = args[0];

  // Reply command with no target token: use replied message author as target.
  if (!raw) {
    if (replyMember) {
      return {
        target: replyMember,
        targetId: replyMember.id,
        cleanArgs: args,
        displayUsername: replyMember.user.username,
      };
    }
    return { target: null, targetId: null, cleanArgs: args, displayUsername: message.author.username };
  }

  const { member: memberFromRaw, rawId } = await resolveMemberFromRaw(guild, raw);
  if (memberFromRaw) {
    args.shift();
    return {
      target: memberFromRaw,
      targetId: memberFromRaw.id,
      cleanArgs: args,
      displayUsername: memberFromRaw.user.username,
    };
  }

  // If first token is not a user and message is a reply, treat token as reason/duration.
  if (replyMember) {
    return {
      target: replyMember,
      targetId: replyMember.id,
      cleanArgs: args,
      displayUsername: replyMember.user.username,
    };
  }

  args.shift();
  return { target: null, targetId: rawId || null, cleanArgs: args, displayUsername: message.author.username };
}

function parseTime(str) {
  if (!str) return null;
  const s = String(str).trim().toLowerCase();
  const m = s.match(/^(\d+)(s|m|h|d)$/);
  if (!m) return null;

  const n = parseInt(m[1], 10);
  const u = m[2];
  if (!Number.isFinite(n) || n <= 0) return null;

  if (u === 's') return n * 1000;
  if (u === 'm') return n * 60 * 1000;
  if (u === 'h') return n * 60 * 60 * 1000;
  if (u === 'd') return n * 24 * 60 * 60 * 1000;
  return null;
}

function formatTime(str) {
  return String(str);
}

module.exports = {
  actionNames,
  actionNameFor,
  getMsgFactory,
  checkHierarchy,
  resolveTarget,
  parseTime,
  formatTime,
};

