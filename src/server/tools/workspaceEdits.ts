import { relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { TextEdit, WorkspaceEdit } from 'vscode-languageserver-protocol';
import { replaceFile } from '../workspace/atomicWrite.js';
import { isInside, readText, safePath } from '../workspace/workspace.js';
import type { ToolContext } from './definitions.js';

export function createWorkspaceEditor(
  context: ToolContext,
  changed: (path: string) => Promise<object>,
  publishChange: (path: string) => void,
) {
  const { workspace, signal } = context;
  const relativeName = (absolute: string) =>
    relative(workspace.path, absolute).split(sep).join('/');
  /**
   * Applies language-server edits through the same checks as apply_patch: workspace paths only, no excluded or
   * binary files, no file creation/rename/deletion. Every file is computed before anything is written, and files
   * already written are restored if a later write fails.
   */
  return async (workspaceEdits: WorkspaceEdit[], dryRun: boolean) => {
    const perFile = new Map<string, TextEdit[]>();
    const add = (uri: string, edits: TextEdit[]) =>
      perFile.set(uri, [...(perFile.get(uri) ?? []), ...edits]);
    for (const edit of workspaceEdits) {
      for (const change of edit.documentChanges ?? []) {
        if ('kind' in change)
          throw new Error(
            `The edit wants to ${change.kind} a file, which BasedCode does not apply from language servers. Do it with file tools instead.`,
          );
        add(
          change.textDocument.uri,
          change.edits.filter((item): item is TextEdit => 'range' in item && 'newText' in item),
        );
      }
      if (!edit.documentChanges)
        for (const [uri, edits] of Object.entries(edit.changes ?? {})) add(uri, edits);
    }
    if (perFile.size > 100)
      throw new Error(`The edit touches ${perFile.size} files; the limit is 100.`);
    const planned: {
      path: string;
      absolute: string;
      before: string;
      after: string;
      edits: number;
    }[] = [];
    for (const [uri, edits] of perFile) {
      if (!uri.startsWith('file:')) throw new Error(`Unsupported document URI: ${uri}`);
      const target = fileURLToPath(uri);
      if (!isInside(workspace.path, target))
        throw new Error(`The edit touches ${target}, outside the workspace. Nothing was changed.`);
      const path = relativeName(target);
      const absolute = await safePath(workspace, path, true);
      const { content, binary } = await readText(workspace, path);
      if (binary) throw new Error(`The edit touches binary file ${path}.`);
      // UTF-16 positions map directly onto JavaScript string offsets.
      const starts = [0];
      for (const match of content.matchAll(/\r\n|\n|\r/g))
        starts.push(match.index + match[0].length);
      const offset = ({ line, character }: { line: number; character: number }) => {
        if (line >= starts.length) return content.length;
        // A position past the end of a line clamps to the line end, before its line break.
        const next = starts[line + 1];
        const end =
          next === undefined
            ? content.length
            : next - (content.slice(next - 2, next) === '\r\n' ? 2 : 1);
        return Math.min(starts[line] + character, end);
      };
      const ordered = edits
        .map((edit, index) => ({
          start: offset(edit.range.start),
          end: offset(edit.range.end),
          text: edit.newText,
          index,
        }))
        .sort((a, b) => a.start - b.start || a.index - b.index);
      for (let index = 1; index < ordered.length; index++) {
        if (ordered[index].start < ordered[index - 1].end)
          throw new Error(`The language server returned overlapping edits for ${path}.`);
      }
      let after = content;
      // Apply from the end so earlier offsets stay valid; same-position inserts keep their original order.
      for (const edit of [...ordered].reverse())
        after = after.slice(0, edit.start) + edit.text + after.slice(edit.end);
      if (after !== content)
        planned.push({ path, absolute, before: content, after, edits: edits.length });
    }
    const files = planned.map(({ path, edits }) => ({ path, edits }));
    if (dryRun || !planned.length) return { files, applied: false };
    const written: typeof planned = [];
    try {
      for (const file of planned) {
        signal.throwIfAborted();
        // The language server read the file earlier; refuse if it changed since.
        if ((await readText(workspace, file.path)).content !== file.before)
          throw new Error(
            `${file.path} changed while the edit was prepared. Nothing was kept; retry.`,
          );
        await replaceFile(file.absolute, file.after);
        written.push(file);
      }
    } catch (error) {
      for (const file of written)
        await replaceFile(file.absolute, file.before).catch(() => undefined);
      for (const file of written) publishChange(file.path);
      throw error;
    }
    const results = [];
    for (const file of planned)
      results.push({ path: file.path, edits: file.edits, ...(await changed(file.path)) });
    return { files: results, applied: true };
  };
}
