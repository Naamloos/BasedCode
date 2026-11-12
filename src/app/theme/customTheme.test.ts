import assert from 'node:assert/strict';
import { test } from 'node:test';
import { themeTokenNames } from '../../shared/types';
import { generateThemeTokens } from './customTheme';

test('generates every token while preserving the three chosen colors', () => {
  const tokens = generateThemeTokens('#101010', '#eeeeee', '#cc8800', 'dark');
  assert.deepEqual(Object.keys(tokens).sort(), [...themeTokenNames].sort());
  assert.equal(tokens['--bg'], '#101010');
  assert.equal(tokens['--text'], '#eeeeee');
  assert.equal(tokens['--accent'], '#cc8800');
  for (const value of Object.values(tokens)) assert.match(value, /^#[0-9a-f]{6}([0-9a-f]{2})?$/);
  assert.equal(tokens['--accent-soft'], '#cc880014');
});

test('surfaces brighten in dark mode and darken in light mode', () => {
  const dark = generateThemeTokens('#101010', '#ffffff', '#0088ff', 'dark');
  const light = generateThemeTokens('#eeeeee', '#111111', '#0088ff', 'light');
  assert.ok(dark['--surface'] > dark['--bg']);
  assert.ok(dark['--surface-raised'] > dark['--surface']);
  assert.ok(light['--surface'] < light['--bg']);
  assert.ok(light['--surface-raised'] < light['--surface']);
});

test('accent labels choose contrasting black or white', () => {
  assert.equal(generateThemeTokens('#101010', '#eeeeee', '#ffffff', 'dark')['--on-accent'], '#000000');
  assert.equal(generateThemeTokens('#eeeeee', '#111111', '#000000', 'light')['--on-accent'], '#ffffff');
});
