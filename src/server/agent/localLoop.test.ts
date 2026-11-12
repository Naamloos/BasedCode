import assert from 'node:assert/strict';
import { test } from 'node:test';
import { localStep } from './localLoop.js';

test('complete text ends the loop, while executed tools always get a follow-up', () => {
  assert.equal(localStep('stop', 'Done.', 0, 0), undefined);
  assert.equal(localStep('stop', 'Checking now.', 1, 0), '');
  assert.equal(localStep('tool-calls', '', 2, 0), '');
  assert.equal(localStep('length', '', 1, 3), '');
});

test('truncated, empty and reasoning-only steps request bounded continuation', () => {
  assert.match(localStep('length', 'Partial answer', 0, 0)!, /length limit/);
  // Reasoning is separate from result.text, so a reasoning-only response has empty text.
  assert.match(localStep('stop', '', 0, 0)!, /neither a final answer nor a tool call/);
  assert.ok(localStep('stop', '   ', 0, 2));
  assert.ok(localStep('tool-calls', '', 0, 0));
  for (const reason of ['stop', 'length', 'tool-calls'] as const) {
    assert.throws(() => localStep(reason, '', 0, 3), /after 3 continuation attempts/);
  }
  assert.equal(localStep('stop', 'Recovered.', 0, 3), undefined);
});

test('interrupted or filtered generations never count as completion', () => {
  for (const reason of ['error', 'content-filter', 'other'] as const) {
    assert.throws(() => localStep(reason, 'Partial answer', 0, 0), /not completed/);
    assert.throws(() => localStep(reason, '', 1, 0), /not completed/);
  }
});
