import assert from 'node:assert/strict';
import { test } from 'node:test';
import { newerVersion } from './updates.js';

test('newerVersion compares numeric parts and pre-releases', () => {
  assert.equal(newerVersion('0.2.0', '0.1.0'), true);
  assert.equal(newerVersion('1.10.0', '1.9.9'), true);
  assert.equal(newerVersion('v1.0.0', '1.0.0'), false);
  assert.equal(newerVersion('0.9.0', '1.0.0'), false);
  assert.equal(newerVersion('1.0.0', '1.0.0-beta.1'), true);
  assert.equal(newerVersion('1.0.0-beta.1', '1.0.0'), false);
  assert.equal(newerVersion('0.0.1-alpha-2', '0.0.1-alpha-1'), true);
  assert.equal(newerVersion('0.0.1-alpha-1', '0.0.1-alpha-2'), false);
  assert.equal(newerVersion('0.0.1-alpha-10', '0.0.1-alpha-9'), true);
});
