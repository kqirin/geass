const test = require('node:test');
const assert = require('node:assert/strict');

const { createGuildEntitlementResolver } = require('../src/controlPlane/entitlementResolver');
const { createFeatureGateEvaluator } = require('../src/controlPlane/featureGates');
const { createInMemoryGuildPlanRepository } = require('../src/controlPlane/guildPlanRepository');

test('feature gate evaluator resolves default free plan with safe capability decisions', async () => {
  const repository = createInMemoryGuildPlanRepository();
  const entitlementResolver = createGuildEntitlementResolver({
    config: {
      controlPlane: {
        premium: {
          defaultPlan: 'free',
          manualPlanOverrides: {},
        },
      },
    },
    guildPlanRepository: repository,
    nowFn: () => 1_700_000_000_000,
  });
  const evaluator = createFeatureGateEvaluator({
    entitlementResolver,
    nowFn: () => 1_700_000_000_000,
  });

  const context = await evaluator.resolveGuildFeatureContext({
    guildId: '999999999999999001',
  });
  assert.equal(context.entitlement.status, 'resolved');
  assert.equal(context.entitlement.planTier, 'free');
  assert.equal(context.entitlement.source, 'config_default');
  assert.equal(context.capabilities.protected_dashboard.allowed, true);
  assert.equal(context.capabilities.advanced_dashboard_preferences.allowed, false);
  assert.equal(
    context.capabilities.advanced_dashboard_preferences.reasonCode,
    'plan_upgrade_required'
  );
  assert.equal(context.capabilities.future_reaction_rules_write.allowed, false);
  assert.equal(
    context.capabilities.future_reaction_rules_write.reasonCode,
    'capability_not_active'
  );
});

test('feature gate evaluator respects manual plan overrides', async () => {
  const repository = createInMemoryGuildPlanRepository();
  const entitlementResolver = createGuildEntitlementResolver({
    config: {
      controlPlane: {
        premium: {
          defaultPlan: 'free',
          manualPlanOverrides: {
            '999999999999999001': 'pro',
          },
        },
      },
    },
    guildPlanRepository: repository,
  });
  const evaluator = createFeatureGateEvaluator({
    entitlementResolver,
  });

  const context = await evaluator.resolveGuildFeatureContext({
    guildId: '999999999999999001',
  });
  assert.equal(context.entitlement.status, 'resolved');
  assert.equal(context.entitlement.planTier, 'pro');
  assert.equal(context.entitlement.source, 'config_manual_override');
  assert.equal(context.capabilities.advanced_dashboard_preferences.allowed, true);
});

test('feature gate evaluator can resolve plan from repository source', async () => {
  const repository = createInMemoryGuildPlanRepository({
    seedRecords: {
      '999999999999999001': 'business',
    },
  });
  const entitlementResolver = createGuildEntitlementResolver({
    config: {
      controlPlane: {
        premium: {
          defaultPlan: 'free',
          manualPlanOverrides: {},
        },
      },
    },
    guildPlanRepository: repository,
  });
  const evaluator = createFeatureGateEvaluator({
    entitlementResolver,
  });

  const context = await evaluator.resolveGuildFeatureContext({
    guildId: '999999999999999001',
  });
  assert.equal(context.entitlement.status, 'resolved');
  assert.equal(context.entitlement.planTier, 'business');
  assert.equal(context.entitlement.source, 'repository');
});

test('feature gate evaluator fails closed when default entitlement plan is invalid', async () => {
  const repository = createInMemoryGuildPlanRepository();
  const entitlementResolver = createGuildEntitlementResolver({
    config: {
      controlPlane: {
        premium: {
          defaultPlan: 'not-a-plan',
          manualPlanOverrides: {},
        },
      },
    },
    guildPlanRepository: repository,
  });
  const evaluator = createFeatureGateEvaluator({
    entitlementResolver,
  });

  const context = await evaluator.resolveGuildFeatureContext({
    guildId: '999999999999999001',
  });
  assert.equal(context.entitlement.status, 'unresolved');
  assert.equal(context.entitlement.reasonCode, 'default_plan_invalid');
  assert.equal(
    Object.values(context.capabilities).every((entry) => entry.allowed === false),
    true
  );
  assert.equal(
    Object.values(context.capabilities).every(
      (entry) => entry.reasonCode === 'entitlement_unresolved'
    ),
    true
  );
});

test('feature gate evaluator fails closed when guild scope is missing', async () => {
  const evaluator = createFeatureGateEvaluator({
    entitlementResolver: createGuildEntitlementResolver({
      config: {
        controlPlane: {
          premium: {
            defaultPlan: 'free',
            manualPlanOverrides: {},
          },
        },
      },
      guildPlanRepository: createInMemoryGuildPlanRepository(),
    }),
  });

  const context = await evaluator.resolveGuildFeatureContext({
    guildId: null,
  });
  assert.equal(context.entitlement.status, 'unresolved');
  assert.equal(context.entitlement.reasonCode, 'guild_id_required');
  assert.equal(
    Object.values(context.capabilities).every((entry) => entry.allowed === false),
    true
  );
});
