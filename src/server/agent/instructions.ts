import { lstat, readFile, readdir } from 'node:fs/promises';
import { dirname, join, relative, sep } from 'node:path';
import { gitIgnoredPaths } from '../workspace/workspace.js';

/** File names read as project instructions, in the order they are applied within one directory. */
export const instructionNames = ['AGENTS.md', 'CLAUDE.md'];

/** Directories never searched for nested instruction files. */
const skipped = new Set([
  '.git',
  'node_modules',
  '.venv',
  'venv',
  '__pycache__',
  'dist',
  'build',
  '.next',
  '.nuxt',
  'target',
  'bin',
  'obj',
]);

const fileLimit = 32_000;
const totalLimit = 96_000;
const nestedDepth = 4;
const nestedFiles = 20;

export interface InstructionFile {
  /** Absolute path of the file. */
  path: string;
  /** Path as shown to the model and the user: relative to the workspace, or absolute for parent-directory files. */
  label: string;
  /** Where it applies: the whole workspace (itself or a parent directory) or one subdirectory. */
  scope: 'workspace' | 'nested';
  content: string;
  truncated: boolean;
}

async function readInstruction(
  path: string,
): Promise<{ content: string; truncated: boolean } | undefined> {
  try {
    // Links are skipped like everywhere else in the workspace tools.
    const metadata = await lstat(path);
    if (!metadata.isFile()) return undefined;
    const text = await readFile(path, 'utf8');
    if (!text.trim()) return undefined;
    return text.length > fileLimit
      ? { content: text.slice(0, fileLimit), truncated: true }
      : { content: text, truncated: false };
  } catch {
    return undefined;
  }
}

/** Parent directories from the filesystem root down to the workspace itself. */
function ancestors(workspacePath: string): string[] {
  const chain = [workspacePath];
  for (let current = workspacePath; dirname(current) !== current; current = dirname(current))
    chain.unshift(dirname(current));
  return chain;
}

async function nestedDirectories(root: string, ignored: Set<string>): Promise<string[]> {
  const found: string[] = [];
  const walk = async (directory: string, depth: number) => {
    if (depth > nestedDepth || found.length >= nestedFiles) return;
    let entries;
    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch {
      return;
    }
    if (
      directory !== root &&
      entries.some((entry) =>
        entry.isFile() && instructionNames.includes(entry.name) &&
        !ignored.has(relative(root, join(directory, entry.name)).split(sep).join('/')),
      )
    )
      found.push(directory);
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      if (!entry.isDirectory() || skipped.has(entry.name) || entry.name.startsWith('.')) continue;
      const path = join(directory, entry.name);
      if (ignored.has(`${relative(root, path).split(sep).join('/')}/`)) continue;
      await walk(path, depth + 1);
    }
  };
  await walk(root, 0);
  return found;
}

/**
 * Reads AGENTS.md / CLAUDE.md from the workspace's parent directories, the workspace itself, and its subdirectories.
 * Git-ignored files and directories are excluded. Parent and root files apply to the whole run; nested files apply to their own subtree. Total size is capped, and
 * files past the cap are listed without content so the model can still read them.
 */
export async function loadInstructions(workspacePath: string): Promise<InstructionFile[]> {
  const files: InstructionFile[] = [];
  let total = 0;
  const ignored = await gitIgnoredPaths({ path: workspacePath });
  const add = async (directory: string, scope: InstructionFile['scope']) => {
    const directoryIgnored = scope === 'nested' || directory === workspacePath
      ? ignored
      : await gitIgnoredPaths({ path: directory });
    for (const name of instructionNames) {
      if (
        scope === 'nested' &&
        files.filter((file) => file.scope === 'nested').length >= nestedFiles
      )
        return;
      const path = join(directory, name);
      const ignoredName = scope === 'nested'
        ? relative(workspacePath, path).split(sep).join('/')
        : name;
      if (directoryIgnored.has(ignoredName)) continue;
      const read = await readInstruction(path);
      if (!read) continue;
      const inside = relative(workspacePath, path);
      const label = inside.startsWith('..') ? path : inside.split(sep).join('/');
      const room = Math.max(0, totalLimit - total);
      const content = read.content.slice(0, room);
      total += content.length;
      files.push({
        path,
        label,
        scope,
        content,
        truncated: read.truncated || content.length < read.content.length,
      });
    }
  };
  for (const directory of ancestors(workspacePath)) await add(directory, 'workspace');
  for (const directory of await nestedDirectories(workspacePath, ignored)) await add(directory, 'nested');
  return files;
}

/** The instructions section appended to the system prompt. */
export function instructionsPrompt(files: InstructionFile[]): string {
  if (!files.length) return 'No AGENTS.md or CLAUDE.md was found in this workspace.';
  const sections = files.map((file) => {
    const scope =
      file.scope === 'nested'
        ? `${file.label.split('/').slice(0, -1).join('/')}/`
        : 'whole workspace';
    const body = file.content
      ? file.content.trim()
      : '(not included: size limit reached; read the file yourself before working in this area)';
    return `<project_instructions file="${file.label}" scope="${scope}">\n${body}${file.truncated && file.content ? '\n(truncated; read the file for the rest)' : ''}\n</project_instructions>`;
  });
  return `Project instructions follow. Apply them: files closer to the code you change win over broader ones, and the user's own messages win over all of them.\n${sections.join('\n')}`;
}
