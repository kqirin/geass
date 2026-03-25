import test from 'node:test';
import assert from 'node:assert/strict';

import { extractModerationSettingsPayload } from '../src/hooks/moderationSettingsState.js';

test('frontend loads existing moderation values from settings payload correctly', () => {
  const payload = extractModerationSettingsPayload({
    lock_enabled: true,
    lock_role: '1447015808344784999',
    lock_limit: 3,
    lock_safe_list: '1447015808344784888',
  });

  assert.equal(payload.lock_enabled, true);
  assert.equal(payload.lock_role, '1447015808344784999');
  assert.equal(payload.lock_limit, 3);
  assert.equal(payload.lock_safe_list, '1447015808344784888');
});

test('frontend unwraps nested settings snapshots without reintroducing legacy save metadata', () => {
  const payload = extractModerationSettingsPayload({
    success: true,
    settings: {
      lock_enabled: true,
      lock_role: '1447015808344784999',
      lock_limit: 7,
      lock_safe_list: '1447015808344784888,1447015808344784777',
    },
  });

  assert.equal(payload.lock_enabled, true);
  assert.equal(payload.lock_role, '1447015808344784999');
  assert.equal(payload.lock_limit, 7);
  assert.equal(payload.lock_safe_list, '1447015808344784888,1447015808344784777');
});
