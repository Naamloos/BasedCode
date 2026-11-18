import type { Run, Workspace } from '../../shared/types.js';
import { sameVerificationCheck, type VerificationResult } from '../../shared/verification.js';
import type { Events } from '../storage/events.js';
import type { Store } from '../storage/store.js';
import type { Permissions } from '../workspace/permissions.js';
import { cleanOutput, parseProblems } from './output.js';
import type { Processes } from './processes.js';

export function failedVerificationChecks(checks: Workspace['settings']['checks'], report: unknown) {
  if (!Array.isArray(report)) return [];
  return checks.filter((check) => check.command.trim() && report.some((entry) =>
    entry?.status === 'failed' && sameVerificationCheck(check, entry),
  ));
}

export async function runVerificationChecks(
  { store, events, permissions, processes }: {
    store: Store;
    events: Events;
    permissions: Permissions;
    processes: Processes;
  },
  workspace: Workspace,
  checks: Workspace['settings']['checks'],
  signal: AbortSignal,
  run?: Run,
  progress?: (result: unknown) => void,
) {
  await permissions.ask(
    workspace.id,
    'Run verification checks',
    `${checks.map((check) => `${check.name}: ${check.command}`).join('\n')}\n\nFolder: ${workspace.path}\n${processes.sandbox.detail}`,
    signal,
    run,
  );
  const results: VerificationResult[] = [];
  for (const check of checks) {
    signal.throwIfAborted();
    const action = store.action(
      workspace.id,
      `Check: ${check.name}`,
      `${check.command}\nMay affect uncaptured files or external systems.`,
      run,
    );
    events.publish('state');
    try {
      const result = (await processes.command(
        workspace,
        check.command,
        run,
        signal,
        false,
        false,
        (check.timeoutSeconds ?? 120) * 1000,
      )) as { terminalId: string; exitCode: number; output: string; timedOut?: boolean; stoppedByUser?: boolean };
      store.put('action', { ...action, status: 'completed' });
      const problems = parseProblems(result.output);
      results.push({
        name: check.name,
        status: !result.timedOut && !result.stoppedByUser && result.exitCode === 0 ? 'passed' : 'failed',
        timedOut: result.timedOut,
        stoppedByUser: result.stoppedByUser,
        exitCode: result.exitCode,
        terminalId: result.terminalId,
        problems,
        outputTail: cleanOutput(result.output).slice(-4_000),
      });
      progress?.({ checks: [...results] });
    } catch (error) {
      store.put('action', { ...action, status: 'unknown' });
      throw error;
    } finally {
      events.publish('state');
    }
  }
  return results;
}
