import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  claudeResetOutcome,
  claudeResets,
  claudeResetsHidden,
  claudeWeeklyReset,
  codexResetOutcome,
  codexResets,
} from './limits.js';

test('codexResets lists available credits with their expiry', () => {
  assert.deepEqual(
    codexResets({
      availableCount: 2,
      credits: [
        { id: 'c1', title: 'Launch gift', grantedAt: 1, expiresAt: 1_800_000_000, status: 'available' },
        { id: 'c2', grantedAt: 1, status: 'redeemed' },
      ],
    }),
    [{ id: 'c1', label: 'Launch gift', left: 1, expiresAt: new Date(1_800_000_000_000).toISOString() }],
  );
});

test('codexResets falls back to the count when Codex gives no details', () => {
  assert.deepEqual(codexResets({ availableCount: 3, credits: null }), [
    { id: '', label: 'Codex reset', left: 3 },
  ]);
});

test('codexResets ignores empty or malformed summaries', () => {
  assert.deepEqual(codexResets({ availableCount: 0 }), []);
  assert.deepEqual(codexResets(null), []);
  assert.deepEqual(codexResets({ availableCount: 'two' }), []);
});

test('claudeResets reads usable grants and the weekly 5-hour reset', () => {
  const resets = claudeResets({
    five_hour: { utilization: 100 },
    cedar_ember: {
      eligible: true,
      grants: [
        { id: 'promo_1', label: 'Holiday reset', resets_left: 2, ends_at: '2026-12-31T00:00:00Z', usable_now: false, use_requires_limit: true },
        { id: 'spent', resets_left: 0 },
        { id: 'held', resets_left: 1, paused: true },
      ],
    },
    juniper_tide: { available: true },
  });
  assert.deepEqual(resets, [
    { id: 'promo_1', label: 'Holiday reset', left: 2, expiresAt: '2026-12-31T00:00:00Z', usableNow: false },
    { id: 'held', label: 'Claude limit reset', left: 1, expiresAt: undefined, usableNow: false, unavailableReason: 'paused' },
    { id: claudeWeeklyReset, label: 'Weekly 5-hour reset', left: 1, usableNow: true },
  ]);
});

test('claudeResets keeps grants of an ineligible account with the reason, and skips bad grants', () => {
  assert.deepEqual(
    claudeResets({
      cedar_ember: {
        eligible: false,
        ineligible_reason: 'cli_version',
        grants: [{ id: 'full_1', label: 'Full reset', resets_left: 1, type: 'full' }, { id: 'BAD ID', resets_left: 1 }],
      },
    }),
    [{ id: 'full_1', label: 'Full reset', left: 1, expiresAt: undefined, usableNow: false, unavailableReason: 'cli_version' }],
  );
});

test('claudeResets reports a hidden grant when Claude refuses this client (surface)', () => {
  assert.deepEqual(
    claudeResets({
      cedar_ember: { eligible: false, ineligible_reason: 'surface', grants: [], next_grant_id: 'g1' },
      juniper_tide: { eligible: false, ineligible_reason: 'surface', available: false },
    }),
    [{ id: '', label: 'Claude limit reset', unavailableReason: 'surface' }],
  );
  assert.equal(
    claudeResets({ cedar_ember: { eligible: false, ineligible_reason: 'surface', grants: [], next_grant_id: 42 } }).length,
    1,
  );
  assert.deepEqual(
    claudeResets({ cedar_ember: { eligible: false, ineligible_reason: 'surface', grants: [], next_grant_id: null } }),
    [],
  );
});

test('claudeResetsHidden spots the surface refusal only', () => {
  assert.equal(claudeResetsHidden({ cedar_ember: { eligible: false, ineligible_reason: 'surface', grants: [] } }), true);
  assert.equal(claudeResetsHidden({ juniper_tide: { eligible: false, ineligible_reason: 'surface' } }), true);
  assert.equal(claudeResetsHidden({ cedar_ember: { eligible: false, ineligible_reason: 'no_grant' } }), false);
  assert.equal(claudeResetsHidden(undefined), false);
});

test('claudeResets returns nothing without grants or the fields', () => {
  assert.deepEqual(claudeResets({ cedar_ember: { eligible: false, ineligible_reason: 'no_grant', grants: [{ id: 'a', resets_left: 1 }] } }), []);
  assert.deepEqual(claudeResets({ five_hour: { utilization: 10 } }), []);
  assert.deepEqual(claudeResets(undefined), []);
});

test('reset outcomes report success only when limits were reset', () => {
  assert.equal(codexResetOutcome('reset').ok, true);
  assert.equal(codexResetOutcome('noCredit').ok, false);
  assert.equal(codexResetOutcome('somethingNew').ok, false);
  assert.equal(claudeResetOutcome('reset').ok, true);
  assert.equal(claudeResetOutcome('not_limited').ok, false);
  assert.equal(claudeResetOutcome(undefined).ok, false);
});
