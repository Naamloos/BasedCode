import type { Component } from 'vue';
import {
  Clock,
  ShieldQuestion,
  LoaderCircle,
  Pause,
  Check,
  CircleAlert,
  CircleX,
  Unplug,
} from '../icons';
import type { Message, RunStatus, TerminalInfo } from '../../shared/types';
import { t } from '../theme/i18n';

// Every state gets an icon and a word, so it never depends on color alone.
export const runStatus: Record<
  RunStatus,
  { label: string; icon: Component; tone: string; spin?: boolean }
> = {
  queued: { label: 'Queued', icon: Clock, tone: 'neutral' },
  awaiting_approval: { label: 'Needs approval', icon: ShieldQuestion, tone: 'warning' },
  running: { label: 'Running', icon: LoaderCircle, tone: 'live', spin: true },
  paused: { label: 'Paused', icon: Pause, tone: 'warning' },
  completed: { label: 'Completed', icon: Check, tone: 'success' },
  failed: { label: 'Failed', icon: CircleAlert, tone: 'danger' },
  cancelled: { label: 'Cancelled', icon: CircleX, tone: 'neutral' },
  interrupted: { label: 'Interrupted', icon: Unplug, tone: 'danger' },
};

/** States worth flagging in the chat list; a finished or cancelled run needs no badge. */
export const notableRunStates = new Set<RunStatus>([
  'queued',
  'awaiting_approval',
  'running',
  'paused',
  'failed',
  'interrupted',
]);

export const terminalKind: Record<TerminalInfo['kind'], string> = {
  user: 'User shell',
  command: 'Agent command',
  service: 'Service',
};

/** The terminal behind a running foreground run_command/run_checks call: the same tab the terminal panel shows. */
export function commandTerminal(
  message: Message,
  terminals: TerminalInfo[] | undefined,
): TerminalInfo | undefined {
  const tool = message.metadata.tool as
    | { name?: string; status?: string; args?: Record<string, unknown> }
    | undefined;
  if (!tool || tool.status !== 'running' || !['run_command', 'run_checks'].includes(tool.name ?? ''))
    return undefined;
  return terminals?.find(
    (terminal) =>
      terminal.runId === message.runId &&
      terminal.kind === 'command' &&
      terminal.status === 'running' &&
      (tool.name === 'run_checks' ||
        terminal.title === String(tool.args?.command).slice(0, 70)),
  );
}

/** A command still running in this tool group, so it can be stopped without opening the group. */
export function groupCommandTerminal(
  tools: Message[],
  terminals: TerminalInfo[] | undefined,
): TerminalInfo | undefined {
  for (const tool of tools) {
    const terminal = commandTerminal(tool, terminals);
    if (terminal) return terminal;
  }
  return undefined;
}

export function toolGroupState(tools: Message[]) {
  const statuses = tools.map(
    (tool) => (tool.metadata.tool as { status?: string } | undefined)?.status,
  );
  return {
    running: statuses.includes('running'),
    failed: statuses.filter((status) => status === 'failed').length,
  };
}

/** One quiet row per tool group: "✓ Worked for 12s · 6 steps". */
export function toolGroupLabel(tools: Message[]): string {
  const state = toolGroupState(tools);
  const steps = t(tools.length === 1 ? '{count} step' : '{count} steps', { count: tools.length });
  if (state.running) return `${t('Working…')} · ${steps}`;

  const first = Date.parse(tools[0].createdAt);
  const last = Date.parse(tools[tools.length - 1].createdAt);
  const seconds = Math.max(1, Math.round((last - first) / 1000));
  const took = seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
  const failed = state.failed ? ` · ${t('{count} failed', { count: state.failed })}` : '';
  return `${t('Worked for {time}', { time: took })} · ${steps}${failed}`;
}

export function terminalState(info: TerminalInfo): string {
  if (info.status === 'running') return t('Running');
  return info.exitCode === undefined
    ? t('Exited')
    : t('Exited · code {code}', { code: info.exitCode });
}
