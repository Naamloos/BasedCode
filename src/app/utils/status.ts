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
import type { RunStatus, TerminalInfo } from '../../shared/types';
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

export function terminalState(info: TerminalInfo): string {
  if (info.status === 'running') return t('Running');
  return info.exitCode === undefined
    ? t('Exited')
    : t('Exited · code {code}', { code: info.exitCode });
}
