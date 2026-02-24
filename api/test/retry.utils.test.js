const test = require('node:test');
const assert = require('node:assert/strict');

const { withRetry } = require('../src/utils/retry');

test('withRetry should stop at max attempts and report final failure context', async () => {
  const err = new Error('db down');
  err.code = 'ECONNREFUSED';

  let calls = 0;
  let finalFailure = null;

  await assert.rejects(
    () =>
      withRetry(
        'db_connect',
        async () => {
          calls += 1;
          throw err;
        },
        {
          attempts: 2,
          baseDelayMs: 1,
          maxDelayMs: 2,
          jitterRatio: 0,
          onFinalFailure: (ctx) => {
            finalFailure = ctx;
          },
        }
      ),
    /db down/
  );

  assert.equal(calls, 2);
  assert.equal(finalFailure?.taskName, 'db_connect');
  assert.equal(finalFailure?.attempt, 2);
  assert.equal(finalFailure?.attempts, 2);
  assert.equal(finalFailure?.retryable, true);
});

test('withRetry should not retry non-retryable errors', async () => {
  const err = new Error('validation');
  err.code = 'EINVAL';

  let calls = 0;
  let finalFailure = null;

  await assert.rejects(
    () =>
      withRetry(
        'input_validate',
        async () => {
          calls += 1;
          throw err;
        },
        {
          attempts: 5,
          baseDelayMs: 1,
          maxDelayMs: 2,
          onFinalFailure: (ctx) => {
            finalFailure = ctx;
          },
        }
      ),
    /validation/
  );

  assert.equal(calls, 1);
  assert.equal(finalFailure?.retryable, false);
});
