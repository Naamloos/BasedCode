import assert from 'node:assert/strict';
import { test } from 'node:test';
import { checkFailureReport, checkSummary, coverageWarningText, type CheckResult } from './checks.js';

const passed: CheckResult = { name: 'lint', command: 'npm run lint', status: 'passed', exitCode: 0 };
const failed: CheckResult = {
  name: 'test',
  command: 'npm test',
  status: 'failed',
  exitCode: 1,
  output: '1 failing',
};
const skipped: CheckResult = { name: 'types', command: 'tsc', status: 'skipped' };

test('checkSummary marks each check and its exit code', () => {
  assert.equal(
    checkSummary([passed, failed, skipped]),
    '✓ lint: passed (exit 0)\n✗ test: failed (exit 1)\n– types: skipped',
  );
});

test('checkSummary says when no checks are configured', () => {
  assert.equal(checkSummary([]), 'No verification checks are configured for this workspace.');
});

test('checkFailureReport includes only failed checks with output', () => {
  assert.equal(checkFailureReport([passed, failed]), '## test (npm test, exit 1)\n1 failing');
});

test('coverageWarningText lists at most twelve paths', () => {
  const paths = Array.from({ length: 14 }, (_, index) => `p${index}`);

  assert.equal(coverageWarningText(['a', 'b']), 'Prompt revert cannot restore excluded, linked, or oversized paths: a, b.');
  assert.match(coverageWarningText(paths), /p11, and 2 more\.$/);
});
