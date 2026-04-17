import test from 'node:test';
import assert from 'node:assert/strict';

import {
  normalizeMessageAutomationPayload,
  resolveMessageAutomationVariables,
} from '../src/lib/messageAutomationViewModel.js';

test('message automation preview resolves supported variables', () => {
  const output = resolveMessageAutomationVariables(
    '{user_mention} - {user_name} - {server_name} - {member_count} - {boost_count} - {date}'
  );

  assert.equal(output, '@kirin - kirin - geass ded. - 29 - 8 - 17.04.2026');
});

test('message automation payload normalization falls back to safe defaults', () => {
  const normalized = normalizeMessageAutomationPayload({
    guildId: 'g-pro',
    settings: {
      welcome: {
        enabled: 'yes',
        embed: {
          color: 'invalid',
        },
      },
    },
  });

  assert.equal(normalized.guildId, 'g-pro');
  assert.equal(normalized.settings.welcome.enabled, false);
  assert.equal(normalized.settings.welcome.embed.color, '#7c3aed');
  assert.equal(normalized.settings.goodbye.enabled, false);
  assert.equal(normalized.settings.boost.enabled, false);
});
