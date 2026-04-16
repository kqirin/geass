import test from 'node:test';
import assert from 'node:assert/strict';

import {
  DEFAULT_LOGS_UNAVAILABLE_MESSAGE,
  getUnavailableLogsMessage,
  normalizeReadonlyLogsPayload,
  resolveLogsCategoryState,
} from '../src/lib/logsViewModel.js';

test('logs payload normalization keeps stable read-only contract', () => {
  const normalized = normalizeReadonlyLogsPayload(
    {
      contractVersion: 1,
      guildId: 'g-1',
      available: true,
      items: [{ id: '10' }],
      pagination: {
        limit: 10,
        nextCursor: '9',
      },
      reasonCode: null,
    },
    { guildId: 'fallback-guild' }
  );

  assert.equal(normalized.contractVersion, 1);
  assert.equal(normalized.guildId, 'g-1');
  assert.equal(normalized.available, true);
  assert.equal(normalized.items.length, 1);
  assert.equal(normalized.pagination.limit, 10);
  assert.equal(normalized.pagination.nextCursor, '9');
  assert.equal(normalized.reasonCode, null);
  assert.equal(normalized.explanation, null);
});

test('logs section state resolves loading, error, unavailable, empty, ready', () => {
  assert.equal(
    resolveLogsCategoryState({
      payload: null,
      error: null,
      isLoading: true,
    }),
    'loading'
  );

  assert.equal(
    resolveLogsCategoryState({
      payload: null,
      error: { code: 'internal_error' },
      isLoading: false,
    }),
    'error'
  );

  assert.equal(
    resolveLogsCategoryState({
      payload: normalizeReadonlyLogsPayload({
        available: false,
        items: [],
        pagination: { limit: 25, nextCursor: null },
        reasonCode: 'command_logs_not_available',
      }),
      error: null,
      isLoading: false,
    }),
    'unavailable'
  );

  assert.equal(
    resolveLogsCategoryState({
      payload: normalizeReadonlyLogsPayload({
        available: true,
        items: [],
        pagination: { limit: 25, nextCursor: null },
        reasonCode: null,
      }),
      error: null,
      isLoading: false,
    }),
    'empty'
  );

  assert.equal(
    resolveLogsCategoryState({
      payload: normalizeReadonlyLogsPayload({
        available: true,
        items: [{ id: '1' }],
        pagination: { limit: 25, nextCursor: null },
        reasonCode: null,
      }),
      error: null,
      isLoading: false,
    }),
    'ready'
  );
});

test('unavailable logs message returns stable Turkish fallback', () => {
  assert.equal(
    getUnavailableLogsMessage({
      available: false,
      items: [],
      pagination: { limit: 25, nextCursor: null },
      reasonCode: 'system_logs_not_available',
      explanation: null,
    }),
    DEFAULT_LOGS_UNAVAILABLE_MESSAGE
  );
});
