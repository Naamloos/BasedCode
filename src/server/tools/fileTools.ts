import { randomUUID } from 'node:crypto';
import { mkdir, readFile, readdir, rename, rmdir, stat, unlink, writeFile } from 'node:fs/promises';
import { dirname, join, matchesGlob, relative, sep } from 'node:path';
import { z } from 'zod';
import { replaceFile } from '../workspace/atomicWrite.js';
import {
  excludedDirectories,
  fileTree,
  gitIgnoredPaths,
  readText,
  safePath,
} from '../workspace/workspace.js';
import {
  type DefineTool,
  type ImageResult,
  type ToolContext,
  type ToolDefinition,
  type ToolServices,
} from './definitions.js';
import { createFileNotifier } from './fileChanges.js';
import { documentExtensions, extractDocument, parseRange } from './documents.js';
import {
  formatMatches,
  numberedLines,
  outline,
  pathTree,
  readHeader,
  type FileMatches,
} from './textResults.js';

const imageTypes: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
};
const imageLimit = 5 * 1024 * 1024;
const documentLimit = 100 * 1024 * 1024;

export function createFileTools(
  context: ToolContext,
  services: ToolServices,
  definition: DefineTool,
): ToolDefinition[] {
  const { workspace, run, signal } = context;
  const { events, permissions, languages } = services;
  const changed = createFileNotifier(context, events, languages);

  // Git-ignored paths, loaded once per search call; includeIgnored bypasses them.
  const ignoredFilter = async (includeIgnored: boolean) => {
    const ignored = includeIgnored ? new Set<string>() : await gitIgnoredPaths(workspace);
    return (name: string, directory: boolean) => ignored.has(directory ? `${name}/` : name);
  };
  const relativeName = (absolute: string) =>
    relative(workspace.path, absolute).split(sep).join('/');

  return [
    definition(
      'file_info',
      'File or directory metadata (size, modified time).',
      { path: z.string() },
      async ({ path }) => {
        const info = await stat(await safePath(workspace, path));
        return {
          path,
          directory: info.isDirectory(),
          size: info.size,
          modifiedAt: info.mtime.toISOString(),
          mode: info.mode & 0o777,
        };
      },
    ),
    definition(
      'list_files',
      'List a directory as a tree (directories end in "/"). depth > 1 recurses, skipping generated, dependency and Git-ignored directories.',
      {
        path: z.string().default('.'),
        depth: z.number().int().min(1).max(6).default(1),
      },
      async ({ path, depth }) => {
        const isIgnored = depth > 1 ? await ignoredFilter(false) : () => false;
        const entries: { path: string; directory: boolean }[] = [];
        let truncated = false;
        const walk = async (directory: string, level: number): Promise<void> => {
          for (const item of await fileTree(workspace, directory)) {
            signal.throwIfAborted();
            if (entries.length >= 1000) {
              truncated = true;
              return;
            }
            if (
              depth > 1 &&
              (isIgnored(item.path, item.directory) ||
                (item.directory && excludedDirectories.has(item.name.toLowerCase())))
            )
              continue;
            entries.push({ path: item.path, directory: item.directory });
            if (item.directory && level < depth) await walk(item.path, level + 1);
          }
        };
        await walk(path, 1);
        if (!entries.length) return '(empty directory)';
        const root = relativeName(await safePath(workspace, path));
        return (
          pathTree(entries, root) +
          (truncated ? '\n[Stopped at 1000 entries; list a subdirectory or lower depth.]' : '')
        );
      },
    ),
    definition(
      'make_directory',
      'Create a directory and missing parents. Not needed before write_file.',
      { path: z.string() },
      async ({ path }) => {
        await mkdir(await safePath(workspace, path, true), { recursive: true });
        events.publish('files-changed', { path }, workspace.id, run.id);
        return { path, created: true };
      },
    ),
    definition(
      'delete_directory',
      'Delete an EMPTY directory after user approval; delete its files first.',
      { path: z.string() },
      async ({ path }) => {
        const absolute = await safePath(workspace, path, true);
        if (absolute === workspace.path) throw new Error('Refusing to delete the workspace root.');
        if (!(await stat(absolute)).isDirectory()) throw new Error('Not a directory.');
        if ((await readdir(absolute)).length) throw new Error('Directory is not empty.');
        await permissions.ask(workspace.id, 'Delete directory', path, signal, run);
        await rmdir(absolute);
        events.publish('files-changed', { path }, workspace.id, run.id);
        return { path, deleted: true };
      },
    ),
    definition(
      'view_image',
      'Look at a workspace image (PNG, JPEG, GIF or WebP, up to 5 MB). Some providers cannot receive images; the result then says so.',
      {
        path: z.string(),
      },
      async ({ path }) => {
        const absolute = await safePath(workspace, path);
        const extension = absolute.slice(absolute.lastIndexOf('.')).toLowerCase();
        const mediaType = imageTypes[extension];
        if (!mediaType)
          throw new Error(`Not a supported image type: ${extension}. Use PNG, JPEG, GIF or WebP.`);
        const metadata = await stat(absolute);
        if (!metadata.isFile()) throw new Error('Not a regular file.');
        if (metadata.size > imageLimit)
          throw new Error(
            `Image is ${(metadata.size / 1024 / 1024).toFixed(1)} MB; the limit is 5 MB.`,
          );
        const data = (await readFile(absolute)).toString('base64');
        return {
          path,
          mediaType,
          bytes: metadata.size,
          data,
          imageResult: true,
        } satisfies ImageResult;
      },
    ),
    definition(
      'extract_document',
      `Extract text from a document in the workspace (path) or attached to this chat (attachmentId): ${documentExtensions.join(', ')}. Output is paged by characters; follow nextOffset. Set range to limit PDF pages, slides, sheets or EPUB chapters. includeImages also returns embedded pictures (costly; only when visuals matter).`,
      {
        path: z.string().optional(),
        attachmentId: z.string().regex(/^[\w-]+$/).optional(),
        range: z.string().optional().describe('Pages/slides/sheets, e.g. "3" or "2-5".'),
        offset: z.number().int().min(0).default(0),
        maxChars: z.number().int().min(1_000).max(20_000).default(12_000),
        includeImages: z.boolean().default(false),
        maxImages: z.number().int().min(1).max(12).default(4),
      },
      async ({ path, attachmentId, range, offset, maxChars, includeImages, maxImages }) => {
        if (!path === !attachmentId) throw new Error('Pass exactly one of path or attachmentId.');
        let name: string;
        let bytes: Buffer;
        if (attachmentId) {
          const attached = services.store
            .all('message')
            .some(
              (message) =>
                message.chatId === run.chatId &&
                ((message.metadata.attachments as { id: string }[] | undefined) ?? []).some(
                  (item) => item.id === attachmentId,
                ),
            );
          if (!attached) throw new Error('No attachment with that id in this chat.');
          name = services.store.get('attachment', attachmentId).name;
          bytes = await readFile(join(services.attachmentDirectory, attachmentId));
        } else {
          const absolute = await safePath(workspace, path!);
          const metadata = await stat(absolute);
          if (!metadata.isFile()) throw new Error('Not a regular file.');
          if (metadata.size > documentLimit) throw new Error('Document is larger than 100 MB.');
          name = absolute;
          bytes = await readFile(absolute);
        }
        signal.throwIfAborted();
        const document = await extractDocument(bytes, name, {
          includeImages,
          maxImages,
          range: parseRange(range),
        });
        const text = document.text.slice(offset, offset + maxChars);
        const end = offset + text.length;
        const summary = {
          source: path ?? attachmentId,
          format: document.format,
          ...(document.parts ? { parts: document.parts } : {}),
          totalChars: document.text.length,
          offset,
          ...(end < document.text.length ? { nextOffset: end } : {}),
          ...(includeImages ? { images: document.images.map((image) => image.name) } : {}),
          text: text || '(no extractable text; it may be a scan. Try includeImages to look at it.)',
        };
        if (!document.images.length) return summary;
        const [first, ...rest] = document.images;
        return {
          path: path ?? attachmentId!,
          mediaType: first.mediaType,
          bytes: document.images.reduce((total, image) => total + image.data.length, 0),
          data: Buffer.from(first.data).toString('base64'),
          moreImages: rest.map((image) => ({
            mediaType: image.mediaType,
            data: Buffer.from(image.data).toString('base64'),
          })),
          text: JSON.stringify(summary),
          imageResult: true,
        } satisfies ImageResult;
      },
    ),
    definition(
      'read_file',
      'Read a text file as numbered lines ("N: text"; the number is not part of the file). Returns up to 200 lines (fewer when lines are long) and says where to continue. find starts a few lines above the first line containing that text.',
      {
        path: z.string(),
        startLine: z.number().int().min(1).default(1).describe('1-based. Ignored with find.'),
        lines: z
          .number()
          .int()
          .min(1)
          .max(500)
          .default(200)
          .describe('How many lines to read: a count, not an end line.'),
        find: z
          .string()
          .min(1)
          .optional()
          .describe('Literal, case-sensitive text to jump to (first hit at or after startLine).'),
      },
      async ({ path, startLine, lines, find }) => {
        const result = await readText(workspace, path);
        if (result.binary) return `${path} is a binary file.`;
        const all = result.content.split(/\r\n|\n|\r/);
        let matchLine: number | undefined;
        if (find) {
          const index = all.findIndex(
            (line, position) => position >= startLine - 1 && line.includes(find),
          );
          if (index === -1) throw new Error(`"${find.slice(0, 100)}" was not found in ${path}.`);
          matchLine = index + 1;
          // Up to 10 lines of lead-in, never so many that the match falls outside the window.
          startLine = Math.max(1, matchLine - Math.min(10, Math.floor(lines / 4)));
        }
        const { text, endLine } = numberedLines(all, startLine, lines);
        return `${readHeader(path, startLine, endLine, all.length, matchLine)}\n${text}`;
      },
    ),
    definition(
      'search',
      'Search file contents: literal and case-insensitive unless regex/caseSensitive. Narrow with path and glob. Matches come grouped per file as "line: text". output "files" lists only the files that match, "count" the matches per file. Skips generated, dependency and Git-ignored paths.',
      {
        query: z.string().min(1),
        regex: z.boolean().default(false).describe('query is a JavaScript regular expression.'),
        caseSensitive: z.boolean().default(false),
        path: z.string().default('.').describe('Directory or file to search.'),
        glob: z.string().optional().describe('Only files matching this glob, e.g. "src/**/*.vue".'),
        context: z.number().int().min(0).max(5).default(0).describe('Lines around each match.'),
        maxResults: z.number().int().min(1).max(500).default(100),
        includeIgnored: z.boolean().default(false),
        output: z.enum(['lines', 'files', 'count']).default('lines'),
        filenames: z.boolean().default(false).describe('Match file paths instead of contents.'),
      },
      async ({
        query,
        filenames,
        regex,
        caseSensitive,
        path,
        glob,
        context,
        maxResults,
        includeIgnored,
        output,
      }) => {
        const isIgnored = await ignoredFilter(includeIgnored);
        const pattern = new RegExp(
          regex ? query : query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'),
          caseSensitive ? '' : 'i',
        );
        const files: FileMatches[] = [];
        // Lines mode counts matches against maxResults; the other modes count files.
        let found = 0;
        let total = 0;
        let inspected = 0;
        let truncated = false;
        const visit = async (absolute: string): Promise<void> => {
          inspected++;
          const name = relativeName(absolute);
          if (isIgnored(name, false) || (glob && !matchesGlob(name, glob))) return;
          if (filenames) {
            if (!pattern.test(name)) return;
            files.push({ path: name, lines: [], matches: [] });
            found++;
            return;
          }
          if ((await stat(absolute)).size > 512_000) return;
          const bytes = await readFile(absolute);
          if (bytes.includes(0)) return;
          const lines = bytes.toString('utf8').split(/\r?\n/);
          const matches: number[] = [];
          for (let index = 0; index < lines.length; index++) {
            if (!pattern.test(lines[index])) continue;
            if (output === 'lines' && found + matches.length >= maxResults) {
              truncated = true;
              break;
            }
            matches.push(index);
            if (output === 'files') break;
          }
          if (!matches.length) return;
          files.push({ path: name, lines: output === 'lines' ? lines : [], matches });
          found += output === 'lines' ? matches.length : 1;
          total += matches.length;
        };
        const walk = async (directory: string): Promise<void> => {
          for (const item of await readdir(directory, { withFileTypes: true })) {
            signal.throwIfAborted();
            if (found >= maxResults || inspected >= 10_000) {
              truncated = true;
              return;
            }
            if (item.isSymbolicLink() || excludedDirectories.has(item.name.toLowerCase())) continue;
            const absolute = join(directory, item.name);
            if (item.isDirectory()) {
              if (!isIgnored(relativeName(absolute), true)) await walk(absolute);
            } else if (item.isFile()) await visit(absolute);
          }
        };
        const root = await safePath(workspace, path);
        if ((await stat(root)).isFile()) await visit(root);
        else await walk(root);
        if (!files.length) return 'No matches.';
        const note = truncated
          ? `\n[Stopped at the limit; narrow with path or glob, or raise maxResults.]`
          : '';
        if (filenames || output === 'files') return files.map((file) => file.path).join('\n') + note;
        if (output === 'count')
          return (
            files.map((file) => `${file.path}: ${file.matches.length}`).join('\n') +
            `\n${total} matches in ${files.length} files${note}`
          );
        return formatMatches(files, context) + note;
      },
    ),
    definition(
      'find_files',
      'List files whose workspace-relative path matches a glob such as "**/*.test.ts" or "src/**/index.{ts,vue}". Skips generated, dependency and Git-ignored paths.',
      {
        pattern: z.string().min(1),
        path: z.string().default('.').describe('Directory to search from.'),
        maxResults: z.number().int().min(1).max(2000).default(300),
        includeIgnored: z.boolean().default(false),
      },
      async ({ pattern, path, maxResults, includeIgnored }) => {
        const isIgnored = await ignoredFilter(includeIgnored);
        const files: string[] = [];
        let truncated = false;
        const walk = async (directory: string): Promise<void> => {
          for (const item of await readdir(directory, { withFileTypes: true })) {
            signal.throwIfAborted();
            if (files.length >= maxResults) {
              truncated = true;
              return;
            }
            if (item.isSymbolicLink() || excludedDirectories.has(item.name.toLowerCase())) continue;
            const absolute = join(directory, item.name);
            const name = relativeName(absolute);
            if (isIgnored(name, item.isDirectory())) continue;
            if (item.isDirectory()) {
              await walk(absolute);
              continue;
            }
            if (item.isFile() && matchesGlob(name, pattern)) files.push(name);
          }
        };
        await walk(await safePath(workspace, path));
        if (!files.length) return 'No files match.';
        return (
          files.sort().join('\n') +
          (truncated ? `\n[Stopped at ${maxResults} files; narrow the pattern or path.]` : '')
        );
      },
    ),
    definition(
      'read_files',
      'Read up to 10 text files in one call as numbered lines. The files share one size budget, so each read may stop early and say where to continue with read_file.',
      {
        paths: z.array(z.string()).min(1).max(10),
      },
      async ({ paths }) => {
        const budget = Math.floor(20_000 / paths.length);
        const sections = await Promise.all(
          paths.map(async (path) => {
            try {
              const result = await readText(workspace, path);
              if (result.binary) return `${path} is a binary file.`;
              const all = result.content.split(/\r\n|\n|\r/);
              const { text, endLine } = numberedLines(all, 1, 400, budget);
              return `${readHeader(path, 1, endLine, all.length)}\n${text}`;
            } catch (error) {
              return `${path}: ERROR ${error instanceof Error ? error.message : String(error)}`;
            }
          }),
        );
        return sections.join('\n\n');
      },
    ),
    definition(
      'file_outline',
      'Map files without reading them: the lines that declare classes, functions, types and top-level bindings (headings for Markdown), each with its line number. Use it to find where to read_file in a large file.',
      {
        paths: z.array(z.string()).min(1).max(8),
      },
      async ({ paths }) => {
        const limit = Math.floor(300 / paths.length);
        const sections = await Promise.all(
          paths.map(async (path) => {
            try {
              const result = await readText(workspace, path);
              return result.binary
                ? `${path} is a binary file.`
                : outline(result.content, path, Math.max(40, limit));
            } catch (error) {
              return `${path}: ERROR ${error instanceof Error ? error.message : String(error)}`;
            }
          }),
        );
        return sections.join('\n\n');
      },
    ),
    definition(
      'write_file',
      'Create a text file (parents are created). Replacing an existing file requires its exact current content as expectedContent; prefer apply_patch or edit_lines for changes.',
      {
        path: z.string(),
        content: z.string().max(2_000_000),
        expectedContent: z.string().optional(),
      },
      async ({ path, content, expectedContent }) => {
        const absolute = await safePath(workspace, path, true);
        let previous: string | undefined;
        let mode = 0o644;
        try {
          const metadata = await stat(absolute);
          if (metadata.size > 2_000_000)
            throw new Error('Existing file exceeds the text mutation limit.');
          previous = await readFile(absolute, 'utf8');
          mode = metadata.mode & 0o777;
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
        }
        if (previous !== undefined && expectedContent !== previous)
          throw new Error(
            'The file changed or expectedContent was omitted. Read it before replacing.',
          );
        if (previous === undefined && expectedContent !== undefined)
          throw new Error('Expected an existing file, but none exists.');
        await mkdir(dirname(absolute), { recursive: true });
        const temporary = join(dirname(absolute), `.basedcode-${randomUUID()}`);
        try {
          await writeFile(temporary, content, { flag: 'wx', mode });
          await rename(temporary, absolute);
        } finally {
          await unlink(temporary).catch((error: NodeJS.ErrnoException) => {
            if (error.code !== 'ENOENT') throw error;
          });
        }
        return { path, saved: true, ...(await changed(path)) };
      },
    ),
    definition(
      'apply_patch',
      'Replace exact text in a file: expectedText/replacement for one edit, or edits for several applied in order, all or none. expectedText must match exactly once unless replaceAll is set; keep it short but unique.',
      {
        path: z.string(),
        expectedText: z.string().min(1).optional(),
        replacement: z.string().optional(),
        replaceAll: z.boolean().default(false),
        edits: z
          .array(
            z.object({
              expectedText: z.string().min(1),
              replacement: z.string(),
              replaceAll: z.boolean().optional(),
            }),
          )
          .max(50)
          .optional(),
      },
      async ({ path, expectedText, replacement, replaceAll, edits }) => {
        if (edits?.length && expectedText !== undefined)
          throw new Error('Use either expectedText/replacement or edits, not both.');
        const steps = edits?.length
          ? edits
          : expectedText !== undefined && replacement !== undefined
            ? [{ expectedText, replacement, replaceAll }]
            : [];
        if (!steps.length)
          throw new Error('Provide expectedText and replacement, or a non-empty edits array.');
        const absolute = await safePath(workspace, path, true);
        const { content, binary } = await readText(workspace, path);
        if (binary) throw new Error('Cannot patch a binary file.');
        // Models usually send LF text; match against CRLF files by adapting each edit to the file's line endings.
        const crlf = content.includes('\r\n');
        const adapt = (text: string) => (crlf ? text.replace(/\r?\n/g, '\r\n') : text);
        let next = content;
        let replacements = 0;
        steps.forEach((step, index) => {
          const target = next.includes(step.expectedText)
            ? step.expectedText
            : adapt(step.expectedText);
          const value = target === step.expectedText ? step.replacement : adapt(step.replacement);
          const count = next.split(target).length - 1;
          const label = steps.length > 1 ? `Edit ${index + 1}` : 'Patch';
          if (count === 0)
            throw new Error(
              `${label}: expectedText was not found. Read the current file and copy the text exactly.`,
            );
          if (count > 1 && !step.replaceAll)
            throw new Error(
              `${label}: expectedText matches ${count} times. Include more surrounding text or set replaceAll.`,
            );
          next = step.replaceAll
            ? next.split(target).join(value)
            : next.replace(target, () => value);
          replacements += step.replaceAll ? count : 1;
        });
        await replaceFile(absolute, next);
        return { path, patched: true, replacements, ...(await changed(path)) };
      },
    ),
    definition(
      'edit_lines',
      'Replace line ranges by number, without retyping the old text: cheapest for rewriting or deleting blocks. Line numbers are those read_file showed and refer to the file before this call. expect guards against stale numbers: text the current startLine must contain. All edits apply or none.',
      {
        path: z.string(),
        edits: z
          .array(
            z.object({
              startLine: z.number().int().min(1),
              endLine: z
                .number()
                .int()
                .min(1)
                .optional()
                .describe('Last line replaced, inclusive. Defaults to startLine.'),
              expect: z.string().min(1).describe('Text found on the current startLine.'),
              content: z
                .string()
                .describe('New lines for the range, without line numbers. Empty deletes the range.'),
            }),
          )
          .min(1)
          .max(50),
      },
      async ({ path, edits }) => {
        const absolute = await safePath(workspace, path, true);
        const { content, binary } = await readText(workspace, path);
        if (binary) throw new Error('Cannot edit a binary file.');
        const newline = content.includes('\r\n') ? '\r\n' : '\n';
        const lines = content.split(/\r\n|\n/);
        const ordered = edits
          .map((edit) => ({ ...edit, endLine: edit.endLine ?? edit.startLine }))
          .sort((a, b) => a.startLine - b.startLine);
        ordered.forEach((edit, index) => {
          const label = `Edit at line ${edit.startLine}`;
          if (edit.endLine < edit.startLine) throw new Error(`${label}: endLine is before startLine.`);
          if (edit.endLine > lines.length)
            throw new Error(`${label}: the file has only ${lines.length} lines.`);
          if (index && edit.startLine <= ordered[index - 1].endLine)
            throw new Error(`${label}: overlaps the edit at line ${ordered[index - 1].startLine}.`);
          if (!lines[edit.startLine - 1].includes(edit.expect.trim()))
            throw new Error(
              `${label}: expect was not found on that line, which reads: ${JSON.stringify(lines[edit.startLine - 1].slice(0, 200))}. Read the file again; line numbers have shifted.`,
            );
        });
        // Bottom-up, so earlier line numbers stay valid while later ranges change length.
        for (const edit of ordered.reverse())
          lines.splice(
            edit.startLine - 1,
            edit.endLine - edit.startLine + 1,
            ...(edit.content === '' ? [] : edit.content.replace(/\r?\n$/, '').split(/\r?\n/)),
          );
        await replaceFile(absolute, lines.join(newline));
        return {
          path,
          edited: edits.length,
          totalLines: lines.length,
          ...(await changed(path)),
        };
      },
    ),
    definition(
      'move_file',
      'Move or rename a file. Never replaces an existing destination.',
      { from: z.string(), to: z.string() },
      async ({ from, to }) => {
        const source = await safePath(workspace, from, true);
        const destination = await safePath(workspace, to, true);
        if (!(await stat(source)).isFile()) throw new Error('Only regular files can be moved.');
        try {
          await stat(destination);
          throw new Error('Destination exists.');
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
        }
        await mkdir(dirname(destination), { recursive: true });
        await rename(source, destination);
        events.publish('files-changed', { path: from }, workspace.id, run.id);
        return { from, to, ...(await changed(to)) };
      },
    ),
    definition(
      'delete_file',
      'Delete a file after user approval.',
      { path: z.string() },
      async ({ path }) => {
        const absolute = await safePath(workspace, path, true);
        if (!(await stat(absolute)).isFile()) throw new Error('Only regular files can be deleted.');
        await permissions.ask(workspace.id, 'Delete file', path, signal, run);
        await unlink(absolute);
        events.publish('files-changed', { path }, workspace.id, run.id);
        return { path, deleted: true };
      },
    ),
  ];
}
