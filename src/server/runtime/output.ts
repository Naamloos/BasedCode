/**
 * Helpers that turn raw PTY output into something a model can read cheaply: no ANSI/OSC escape sequences,
 * carriage-return redraws collapsed to their final state, and parsed error locations for check commands.
 */

/* eslint-disable no-control-regex -- this module exists to match terminal control characters. */

// CSI (ESC [ ... final), OSC (ESC ] ... BEL or ST), other two-byte ESC sequences, and 8-bit CSI.
const escapes =
  /\u001b\[[0-?]*[ -/]*[@-~]|\u001b\][^\u0007\u001b]*(?:\u0007|\u001b\\)|\u001b[PX^_][^\u001b]*\u001b\\|\u001b[@-Z\\-_]|\u009b[0-?]*[ -/]*[@-~]/g;

/** Strips escape sequences and resolves `\r` redraws (progress bars) to the last written text per line. */
export function cleanOutput(raw: string): string {
  return (
    raw
      .replace(escapes, '')
      .replace(/\r\n/g, '\n')
      .split('\n')
      .map((line) => (line.includes('\r') ? (line.split('\r').filter(Boolean).at(-1) ?? '') : line))
      .join('\n')
      // Remaining control characters except tab and newline.
      .replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, '')
  );
}

export interface CheckProblem {
  file: string;
  line: number;
  column?: number;
  severity: 'error' | 'warning';
  message: string;
}

/**
 * Best-effort error extraction from common tool formats: TypeScript/vue-tsc (`file(1,2): error TS1: msg`
 * and `file:1:2 - error TS1: msg`), and generic `file:line:col: error: msg` (gcc, ruff, eslint compact, …).
 * ESLint's default "stylish" output puts the file on its own line followed by `  line:col  error  msg  rule`.
 */
export function parseProblems(output: string, limit = 50): CheckProblem[] {
  const problems: CheckProblem[] = [];
  let currentFile: string | undefined;
  for (const line of cleanOutput(output).split('\n')) {
    if (problems.length >= limit) break;
    let match =
      /^(.+?)\((\d+),(\d+)\): (error|warning)\b:?\s*(.*)$/.exec(line) ??
      /^(.+?):(\d+):(\d+)\s+-\s+(error|warning)\b:?\s*(.*)$/.exec(line) ??
      /^(.+?):(\d+):(\d+):\s*(error|warning)\b:?\s*(.*)$/i.exec(line);
    if (match) {
      problems.push({
        file: match[1].trim(),
        line: Number(match[2]),
        column: Number(match[3]),
        severity: match[4].toLowerCase() as 'error' | 'warning',
        message: match[5].trim().slice(0, 300),
      });
      continue;
    }
    match = /^\s+(\d+):(\d+)\s+(error|warning)\s+(.+)$/.exec(line);
    if (match && currentFile) {
      problems.push({
        file: currentFile,
        line: Number(match[1]),
        column: Number(match[2]),
        severity: match[3] as 'error' | 'warning',
        message: match[4]
          .trim()
          .replace(/\s{2,}/g, ' ')
          .slice(0, 300),
      });
      continue;
    }
    if (/^\S.*\.[A-Za-z0-9]+$/.test(line.trim()) && !line.startsWith(' '))
      currentFile = line.trim();
    else if (!line.trim()) currentFile = undefined;
  }
  return problems;
}
