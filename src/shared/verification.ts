import type { WorkspaceSettings } from './types.js';

type Check = WorkspaceSettings['checks'][number];

export function sameVerificationCheck(check: Check, other: unknown): boolean {
  if (!other || typeof other !== 'object') return false;
  return 'name' in other && other.name === check.name &&
    'command' in other && other.command === check.command;
}

export interface VerificationResult {
  name: string;
  status: 'passed' | 'failed';
  exitCode: number;
  timedOut?: boolean;
  stoppedByUser?: boolean;
  terminalId: string;
  outputTail: string;
  problems: { file: string; line: number; column?: number; severity?: string; message: string }[];
}
