const test = require('node:test');
const assert = require('node:assert/strict');

const { parseTime, checkHierarchy } = require('../src/bot/moderation.utils');

test('parseTime should parse valid duration tokens', () => {
  assert.equal(parseTime('10s'), 10_000);
  assert.equal(parseTime('5m'), 5 * 60_000);
  assert.equal(parseTime('2h'), 2 * 60 * 60_000);
  assert.equal(parseTime('3d'), 3 * 24 * 60 * 60_000);
});

test('parseTime should reject invalid duration tokens', () => {
  assert.equal(parseTime(''), null);
  assert.equal(parseTime('0m'), null);
  assert.equal(parseTime('99x'), null);
  assert.equal(parseTime('abc'), null);
});

test('checkHierarchy should enforce self/equal/higher role checks', async () => {
  const actor = { id: '10', roles: { highest: { position: 50 } } };
  const sameActor = { id: '10', roles: { highest: { position: 1 } } };
  const lowerTarget = { id: '20', roles: { highest: { position: 40 } } };
  const equalTarget = { id: '30', roles: { highest: { position: 50 } } };

  assert.equal(await checkHierarchy(actor, sameActor), false);
  assert.equal(await checkHierarchy(actor, equalTarget), false);
  assert.equal(await checkHierarchy(actor, lowerTarget), true);
});
