import assert from 'node:assert/strict';
import { test } from 'node:test';
import { QuotaError, failureKind, retryDelayMs } from './failures.js';

test('usage exhaustion is never treated as retryable, even behind a 429', () => {
  assert.equal(failureKind(new QuotaError('out')), 'quota');
  assert.equal(failureKind({ statusCode: 429, message: 'You exceeded your current quota' }), 'quota');
  assert.equal(
    failureKind({ statusCode: 429, responseBody: '{"error":{"code":"insufficient_quota"}}' }),
    'quota',
  );
  assert.equal(failureKind(new Error('Claude usage limit reached')), 'quota');
});

test('rate limits and dropped connections are transient', () => {
  assert.equal(failureKind({ statusCode: 429, message: 'Too Many Requests' }), 'transient');
  assert.equal(failureKind({ statusCode: 529, message: 'Overloaded' }), 'transient');
  assert.equal(failureKind(new TypeError('fetch failed', { cause: { code: 'ECONNRESET' } })), 'transient');
  assert.equal(failureKind(new Error('socket hang up')), 'transient');
  assert.equal(failureKind(new Error('Invalid API key')), 'other');
});

test('retry delay follows Retry-After, else backs off with a cap', () => {
  assert.equal(retryDelayMs(0, { responseHeaders: { 'retry-after': '7' } }), 7000);
  assert.ok(retryDelayMs(0) >= 1600 && retryDelayMs(0) <= 2400);
  assert.ok(retryDelayMs(10) <= 36_000);
});
