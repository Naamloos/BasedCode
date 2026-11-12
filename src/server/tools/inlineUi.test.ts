import { test } from 'node:test';
import assert from 'node:assert/strict';
import { inlineUiDocument } from './inlineUi.js';

test('wraps a fragment in a document with the bridge', () => {
  const output = inlineUiDocument('<button data-prompt="Go">Go</button>');
  assert.match(output, /^<!doctype html>/);
  assert.match(output, /window\.basedcode/);
  assert.match(output, /<body><button data-prompt="Go">Go<\/button><\/body>/);
});

test('injects the bridge into a full document head', () => {
  const output = inlineUiDocument('<html><head><title>x</title></head><body>hi</body></html>');
  assert.ok(output.indexOf('window.basedcode') < output.indexOf('<title>'));
  assert.match(output, /<body>hi<\/body>/);
});
