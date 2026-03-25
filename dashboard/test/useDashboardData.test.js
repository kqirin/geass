import test from 'node:test';
import assert from 'node:assert/strict';

import {
  BOT_PRESENCE_LOAD_STATES,
  createInitialReactionForm,
  isBotPresenceReady,
  resolveInitialGuildId,
  shouldShowGuildSelector,
} from '../src/hooks/useDashboardData.js';

test('bot presence snapshot is considered ready only after payload is fully loaded', () => {
  assert.equal(isBotPresenceReady({ status: BOT_PRESENCE_LOAD_STATES.IDLE }), false);
  assert.equal(isBotPresenceReady({ status: BOT_PRESENCE_LOAD_STATES.LOADING }), false);
  assert.equal(isBotPresenceReady({ status: BOT_PRESENCE_LOAD_STATES.ERROR }), false);
  assert.equal(isBotPresenceReady({ status: BOT_PRESENCE_LOAD_STATES.READY }), true);
});

test('initial reaction form uses a valid unicode emoji and carries guild scope safely', () => {
  const form = createInitialReactionForm('1447015808344784956');

  assert.equal(form.guildId, '1447015808344784956');
  assert.equal(form.emojiType, 'unicode');
  assert.equal(form.emojiName, '✅');
  assert.equal(Array.isArray(form.actions), true);
  assert.equal(form.actions.length, 1);
});

test('single-guild dashboard hides the selector and resolves a stable initial guild', () => {
  const guilds = [
    { id: '1447015808344784956', name: 'Guild One' },
    { id: '1447015808344784999', name: 'Guild Two' },
  ];

  assert.equal(shouldShowGuildSelector('', guilds), true);
  assert.equal(shouldShowGuildSelector('1447015808344784956', guilds), false);
  assert.equal(resolveInitialGuildId('1447015808344784956', guilds), '1447015808344784956');
  assert.equal(resolveInitialGuildId('1999999999999999999', guilds), '1447015808344784956');
});
