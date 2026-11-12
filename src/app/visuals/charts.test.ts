import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatTick, niceTicks } from './charts.js';

test('nice ticks cover the range with round steps', () => {
  assert.deepEqual(niceTicks(0, 87), [0, 20, 40, 60, 80, 100]);
  assert.deepEqual(niceTicks(-3, 3, 3), [-4, -2, 0, 2, 4]);
});

test('ticks are shortened', () => {
  assert.equal(formatTick(1500), '1500');
  assert.equal(formatTick(25_000), '25k');
  assert.equal(formatTick(3_200_000), '3.2M');
});
