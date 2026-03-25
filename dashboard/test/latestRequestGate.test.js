import test from 'node:test';
import assert from 'node:assert/strict';

import { createLatestRequestGate } from '../src/lib/latestRequestGate.js';

test('latest request gate invalidates stale responses after guild switch', () => {
  const gate = createLatestRequestGate('guild-a');

  const first = gate.begin('guild-a');
  gate.switchKey('guild-b');
  const second = gate.begin('guild-b');

  assert.equal(first.isCurrent(), false);
  assert.equal(gate.isCurrent(first.token, 'guild-a'), false);
  assert.equal(second.isCurrent(), true);
  assert.equal(gate.isCurrent(second.token, 'guild-b'), true);
});

test('latest request gate keeps only the newest request for the same guild', () => {
  const gate = createLatestRequestGate('guild-a');

  const first = gate.begin('guild-a');
  const second = gate.begin('guild-a');

  assert.equal(first.isCurrent(), false);
  assert.equal(second.isCurrent(), true);
});
