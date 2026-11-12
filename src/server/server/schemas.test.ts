import assert from 'node:assert/strict';
import { test } from 'node:test';
import { globalSchema } from './schemas.js';
import { themeTokenNames } from '../../shared/types.js';

const appearance = globalSchema.shape.appearance;
const theme = {
  id: 'custom-test',
  name: 'My theme',
  scheme: 'dark',
  tokens: Object.fromEntries(themeTokenNames.map((token) => [token, '#123456'])),
};
const base = { theme: 'based', flame: 'classic' };

test('appearance remains compatible with settings without custom themes', () => {
  const parsed = appearance.parse(base);
  assert.equal(parsed.lightTheme, 'normie');
  assert.equal(parsed.customThemes, undefined);
});

test('appearance preserves custom theme colors including alpha', () => {
  const custom = { ...theme, tokens: { ...theme.tokens, '--accent-soft': '#12345614' } };
  assert.deepEqual(appearance.parse({ ...base, customThemes: [custom] }).customThemes, [custom]);
});

test('appearance rejects invalid custom theme data', () => {
  for (const custom of [
    { ...theme, name: ' ' },
    { ...theme, id: 'based' },
    { ...theme, tokens: {} },
    { ...theme, tokens: { ...theme.tokens, '--bg': 'url(https://example.com)' } },
  ]) {
    assert.equal(appearance.safeParse({ ...base, customThemes: [custom] }).success, false);
  }
  assert.equal(appearance.safeParse({ ...base, customThemes: [theme, theme] }).success, false);
});
