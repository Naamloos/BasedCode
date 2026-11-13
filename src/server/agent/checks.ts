/** Outcome of one configured verification check after a run. */
export interface CheckResult {
  name: string;
  command: string;
  status: 'passed' | 'failed' | 'skipped';
  exitCode?: number;
  terminalId?: string;
  /** Tail of the command output; dropped before the result is stored on the completion message. */
  output?: string;
}

const statusMark: Record<CheckResult['status'], string> = {
  passed: '✓',
  failed: '✗',
  skipped: '–',
};

/** One line per check for the run's completion message. */
export function checkSummary(checks: CheckResult[]): string {
  if (!checks.length) return 'No verification checks are configured for this workspace.';

  const lines = checks.map((check) => {
    const exit = check.exitCode !== undefined ? ` (exit ${check.exitCode})` : '';
    return `${statusMark[check.status]} ${check.name}: ${check.status}${exit}`;
  });
  return lines.join('\n');
}

/** The failed checks with their output, handed back to the model for a fix-up round. */
export function checkFailureReport(checks: CheckResult[]): string {
  const failed = checks.filter((check) => check.status === 'failed');
  const sections = failed.map(
    (check) => `## ${check.name} (${check.command}, exit ${check.exitCode})\n${check.output ?? ''}`,
  );
  return sections.join('\n\n');
}

/** Warning for paths a checkpoint cannot restore; lists at most a dozen. */
export function coverageWarningText(paths: string[]): string {
  const shownLimit = 12;
  const shown = paths.slice(0, shownLimit).join(', ');
  const hiddenCount = paths.length - shownLimit;
  const more = hiddenCount > 0 ? `, and ${hiddenCount} more` : '';
  return `Prompt revert cannot restore excluded, linked, or oversized paths: ${shown}${more}.`;
}
