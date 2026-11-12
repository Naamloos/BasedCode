import type { Change } from '../../shared/types.js';

/** Splits a Git diff into the per-file changes displayed in the Changes list. */
export function splitGitDiff(diff: string): Change[] {
  const changes: Change[] = [];

  for (const part of diff.split(/^(?=diff --git )/m)) {
    if (!part.startsWith('diff --git ')) continue;

    const target = /^\+\+\+ (?:b\/)?(.+)$/m.exec(part)?.[1];
    const source = /^--- (?:a\/)?(.+)$/m.exec(part)?.[1];
    const header = /^diff --git a\/(.+?) b\/(.+)$/m.exec(part);

    // Deleted files have no target; binary diffs may have neither file marker.
    let path = header?.[2] ?? 'unknown';
    if (target && target !== '/dev/null') {
      path = target;
    } else if (source && source !== '/dev/null') {
      path = source;
    }

    let kind: Change['kind'] = 'modified';
    if (/^new file mode/m.test(part) || source === '/dev/null') {
      kind = 'created';
    } else if (/^deleted file mode/m.test(part) || target === '/dev/null') {
      kind = 'deleted';
    }

    changes.push({ path: path.trim(), kind, diff: part, binary: /^Binary files /m.test(part) });
  }

  return changes;
}
