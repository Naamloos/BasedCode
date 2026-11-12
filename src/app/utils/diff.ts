export type DiffKind = 'context' | 'addition' | 'deletion' | 'empty';
export interface DiffCell {
  number?: number;
  text: string;
  kind: DiffKind;
}
export type SplitRow =
  { type: 'meta' | 'hunk'; text: string } | { type: 'pair'; left: DiffCell; right: DiffCell };

/** One line of a unified diff with its old and new line numbers. `text` keeps the leading +/-/space marker. */
export interface DiffLine {
  text: string;
  kind: DiffKind | 'hunk' | 'meta';
  old?: number;
  new?: number;
}

const hunkHeader = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/;

/** Numbers each line of a unified diff (one or several files). */
export function numberDiff(diff: string): DiffLine[] {
  const lines: DiffLine[] = [];
  let inHunk = false;
  let oldLine = 0;
  let newLine = 0;
  for (const line of diff.split('\n')) {
    const hunk = hunkHeader.exec(line);
    if (hunk) {
      inHunk = true;
      oldLine = Number(hunk[1]);
      newLine = Number(hunk[3]);
      lines.push({ text: line, kind: 'hunk' });
    } else if (!inHunk || line.startsWith('diff ') || line.startsWith('Index: ')) {
      inHunk = false;
      lines.push({ text: line, kind: 'meta' });
    } else if (line.startsWith('-')) lines.push({ text: line, kind: 'deletion', old: oldLine++ });
    else if (line.startsWith('+')) lines.push({ text: line, kind: 'addition', new: newLine++ });
    else if (line.startsWith('\\')) lines.push({ text: line, kind: 'meta' });
    else lines.push({ text: line, kind: 'context', old: oldLine++, new: newLine++ });
  }
  return lines;
}

/**
 * The whole current file with one file's diff laid over it: unchanged lines between hunks are filled in
 * from `content`, and deleted lines appear where they were removed.
 */
export function fullFileDiff(content: string, diff: string): DiffLine[] {
  const file = content.split('\n');
  if (file.length > 1 && file.at(-1) === '') file.pop();
  const rows: DiffLine[] = [];
  let next = 1;
  let oldLine = 1;
  let newLine = 1;
  const copyUntil = (end: number) => {
    for (; next < end && next <= file.length; next++)
      rows.push({
        text: ` ${file[next - 1]}`,
        kind: 'context',
        old: next + oldLine - newLine,
        new: next,
      });
  };
  let inHunk = false;
  for (const line of diff.split('\n')) {
    const hunk = hunkHeader.exec(line);
    if (hunk) {
      // Carry the old/new offset from the previous hunk across the gap, then jump to this one.
      const start = Number(hunk[3]);
      copyUntil(hunk[4] === '0' ? start + 1 : start);
      oldLine = Number(hunk[1]) + (hunk[2] === '0' ? 1 : 0);
      newLine = next;
      inHunk = true;
    } else if (!inHunk || line.startsWith('\\')) continue;
    else if (line.startsWith('-')) rows.push({ text: line, kind: 'deletion', old: oldLine++ });
    else if (line.startsWith('+')) {
      rows.push({ text: line, kind: 'addition', new: newLine++ });
      next = newLine;
    } else if (line.startsWith(' ')) {
      rows.push({ text: line, kind: 'context', old: oldLine++, new: newLine++ });
      next = newLine;
    }
  }
  copyUntil(file.length + 1);
  return rows;
}

/** Pulls one file's section out of a multi-file `git diff`. */
export function fileSection(diff: string, path: string): string | undefined {
  return diff
    .split(/^(?=diff --git )/m)
    .find((section) => section.split('\n', 1)[0].endsWith(` b/${path}`));
}

/**
 * Turns a unified diff (one or several files) into side-by-side rows.
 * Runs of deletions followed by additions are paired line by line; the shorter side is padded.
 */
export function splitDiff(diff: string): SplitRow[] {
  const rows: SplitRow[] = [];
  let inHunk = false;
  let oldLine = 0;
  let newLine = 0;
  let deletions: DiffCell[] = [];
  let additions: DiffCell[] = [];
  const flush = () => {
    for (let index = 0; index < Math.max(deletions.length, additions.length); index++) {
      rows.push({
        type: 'pair',
        left: deletions[index] ?? { text: '', kind: 'empty' },
        right: additions[index] ?? { text: '', kind: 'empty' },
      });
    }
    deletions = [];
    additions = [];
  };
  for (const line of diff.split('\n')) {
    const hunk = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(line);
    if (hunk) {
      flush();
      inHunk = true;
      oldLine = Number(hunk[1]);
      newLine = Number(hunk[2]);
      rows.push({ type: 'hunk', text: line });
    } else if (!inHunk || line.startsWith('diff ') || line.startsWith('Index: ')) {
      flush();
      inHunk = false;
      if (line.trim()) rows.push({ type: 'meta', text: line });
    } else if (line.startsWith('-')) {
      deletions.push({ number: oldLine++, text: line.slice(1), kind: 'deletion' });
    } else if (line.startsWith('+')) {
      additions.push({ number: newLine++, text: line.slice(1), kind: 'addition' });
    } else if (line.startsWith('\\')) {
      flush();
      rows.push({ type: 'meta', text: line });
    } else {
      flush();
      const text = line.slice(1);
      rows.push({
        type: 'pair',
        left: { number: oldLine++, text, kind: 'context' },
        right: { number: newLine++, text, kind: 'context' },
      });
    }
  }
  flush();
  return rows;
}
