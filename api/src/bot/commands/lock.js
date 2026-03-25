const { runLockCommand } = require('./channelLock.helpers');

function isLockPolicyEnabled(settings) {
  return settings?.lock_enabled === true || settings?.lock_enabled === 1 || settings?.lock_enabled === '1';
}

async function run(ctx) {
  const { settings, verifyPermission } = ctx;

  if (!isLockPolicyEnabled(settings)) {
    await runLockCommand(ctx, { skipActorPermission: false });
    return;
  }

  const check = await verifyPermission('lock', null, {
    actionCommand: 'lock',
    safeListBypassesRoleRestriction: true,
    authoritativeActorRoleCheck: true,
  });
  if (!check.success) return;

  const receipt = await check.consumeLimit();
  if (!receipt) return;

  try {
    const result = await runLockCommand(ctx, { skipActorPermission: true });
    if (!result?.ok) {
      await receipt.rollback?.();
      return;
    }
    await receipt.commit?.();
  } catch (err) {
    await receipt.rollback?.();
    throw err;
  }
}

module.exports = { run };
