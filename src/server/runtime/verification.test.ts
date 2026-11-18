import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Workspace } from '../../shared/types.js';
import { failedVerificationChecks, runVerificationChecks } from './verification.js';

const check = { name: 'lint', command: 'npm run lint', automatic: false, timeoutSeconds: 8 };
const workspace = { id: 'workspace', settings: { checks: [check] } } as Workspace;

test('rerun selects only saved checks matching a failed historical check', () => {
  const other = { name: 'test', command: 'npm test' };
  const changed = { ...check, command: 'npm run lint:other' };
  assert.deepEqual(failedVerificationChecks([check, other, changed], [
    { ...check, status: 'failed' },
    { ...other, status: 'passed' },
    null,
  ]), [check]);
});

test('manual checks wait for approval and respect the configured timeout', async () => {
  const sequence: string[] = [];
  let allowed = false;
  const services = {
    store: {
      action: () => ({ id: 'action' }),
      put: () => {},
    },
    events: { publish: () => {} },
    permissions: {
      ask: async () => {
        sequence.push('approval');
        if (!allowed) throw new Error('denied');
      },
    },
    processes: {
      sandbox: { detail: 'sandbox' },
      command: async (_workspace: Workspace, command: string, run: unknown,
        _signal: AbortSignal, background: boolean, network: boolean, timeout: number) => {
        sequence.push(command);
        assert.equal(run, undefined);
        assert.equal(background, false);
        assert.equal(network, false);
        assert.equal(timeout, 8000);
        return { terminalId: 'terminal', exitCode: 0, output: 'lint output', timedOut: true };
      },
    },
  } as unknown as Parameters<typeof runVerificationChecks>[0];
  const run = () => runVerificationChecks(services, workspace, [check], new AbortController().signal);
  await assert.rejects(run, /denied/);
  assert.deepEqual(sequence, ['approval']);
  allowed = true;
  const [result] = await run();
  assert.deepEqual(sequence, ['approval', 'approval', check.command]);
  assert.equal(result.status, 'failed');
  assert.equal(result.timedOut, true);
  assert.equal(result.outputTail, 'lint output');
});
