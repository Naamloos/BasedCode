import assert from 'node:assert/strict';
import { test } from 'node:test';
import { PromptTimeLimit } from './promptTimeLimit.js';

test('prompt limits stop one minute early, can be updated, and are cleared after a run', (t) => {
  const now = Date.parse('2026-11-12T12:00:00Z');
  t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now });
  let expired = 0;
  const limit = new PromptTimeLimit(() => expired++);
  assert.equal(limit.check().secondsRemaining, null);
  const state = limit.check('2026-11-12T13:03:00+01:00');
  assert.equal(state.deadline, '2026-11-12T12:03:00.000Z');
  assert.equal(state.cutoff, '2026-11-12T12:02:00.000Z');
  assert.equal(state.secondsRemaining, 120);
  t.mock.timers.tick(60_000);
  assert.equal(limit.check().secondsRemaining, 60);
  limit.check('2026-11-12T12:04:00Z');
  t.mock.timers.tick(119_999);
  assert.equal(expired, 0);
  t.mock.timers.tick(1);
  assert.equal(expired, 1);

  limit.check('2026-11-12T12:05:00Z');
  limit.clear();
  t.mock.timers.tick(120_000);
  assert.equal(expired, 1);
  assert.throws(() => limit.check('invalid'), /Invalid prompt deadline/);

  limit.check('2026-11-12T12:00:00Z');
  t.mock.timers.tick(1);
  assert.equal(expired, 2);
  limit.clear();
});
