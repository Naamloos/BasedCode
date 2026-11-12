import { lstat, realpath, readdir, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { delimiter, isAbsolute, relative, resolve, sep, parse, join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { Workspace } from '../../shared/types.js';

const exec = promisify(execFile);
export const excludedDirectories = new Set([
  '.git',
  'node_modules',
  '.venv',
  'venv',
  '__pycache__',
  'dist',
  '.next',
  '.nuxt',
]);

export function isInside(root: string, target: string): boolean {
  const value = relative(root, target);
  return value === '' || (!value.startsWith(`..${sep}`) && value !== '..' && !isAbsolute(value));
}

export function overlap(first: string, second: string): boolean {
  return isInside(first, second) || isInside(second, first);
}

export async function workspacePath(path: string, dataDirectory: string): Promise<string> {
  const canonical = await realpath(resolve(path));
  if (!(await lstat(canonical)).isDirectory()) throw new Error('Select a directory.');
  if (canonical === parse(canonical).root)
    throw new Error('Select a project folder, not an entire drive or filesystem.');
  if (overlap(canonical, dataDirectory))
    throw new Error('The workspace must not contain BasedCode application data.');
  return canonical;
}

export async function safePath(
  workspace: Workspace,
  input: string,
  mutation = false,
): Promise<string> {
  if ((await realpath(workspace.path)) !== workspace.path)
    throw new Error('The selected workspace root changed. Reopen the workspace.');
  if (!input || input.includes('\0'))
    throw new Error('A valid workspace-relative path is required.');
  const target = resolve(workspace.path, input);
  if (!isInside(workspace.path, target)) throw new Error('Path is outside the selected workspace.');
  const parts = relative(workspace.path, target).split(sep).filter(Boolean);
  if (mutation && parts.some((part) => excludedDirectories.has(part.toLowerCase()))) {
    throw new Error(
      'This path is outside checkpoint coverage. Use an explicitly approved command instead.',
    );
  }
  let current = workspace.path;
  for (const part of parts) {
    current = join(current, part);
    try {
      const stat = await lstat(current);
      if (stat.isSymbolicLink())
        throw new Error(
          'Symbolic links and junctions are not supported for workspace tool access.',
        );
      if (mutation && stat.isFile() && stat.nlink > 1)
        throw new Error('Refusing to mutate a hard-linked file.');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  }
  return target;
}

export async function fileTree(
  workspace: Workspace,
  directory = '.',
): Promise<{ name: string; path: string; directory: boolean }[]> {
  const path = await safePath(workspace, directory);
  const entries = await readdir(path, { withFileTypes: true });
  return entries
    .filter((entry) => !entry.isSymbolicLink() && entry.name !== '.git')
    .map((entry) => ({
      name: entry.name,
      path: relative(workspace.path, join(path, entry.name)).split(sep).join('/'),
      directory: entry.isDirectory(),
    }))
    .sort((a, b) => Number(b.directory) - Number(a.directory) || a.name.localeCompare(b.name));
}

export async function readText(
  workspace: Workspace,
  input: string,
): Promise<{ content: string; binary: boolean }> {
  const path = await safePath(workspace, input);
  const stat = await lstat(path);
  if (!stat.isFile()) throw new Error('Select a regular file.');
  if (stat.size > 2 * 1024 * 1024)
    throw new Error('File exceeds the 2 MiB preview limit. Open it in an external editor.');
  const bytes = await readFile(path);
  const binary = bytes.includes(0);
  return { content: binary ? '' : bytes.toString('utf8'), binary };
}

/** Newest matching executable under base/<versioned dir>/suffix, e.g. GitKraken's app-12.6.1. */
async function newestBundled(
  base: string | undefined,
  prefix: string,
  suffix: string[],
): Promise<string | undefined> {
  if (!base) return undefined;
  try {
    const versions = (await readdir(base, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory() && entry.name.startsWith(prefix))
      .map((entry) => entry.name)
      .sort((a, b) => b.localeCompare(a, undefined, { numeric: true }));
    return versions
      .map((version) => join(base, version, ...suffix))
      .find((path) => existsSync(path));
  } catch {
    return undefined;
  }
}

let gitExecutable: Promise<string | undefined> | undefined;
/**
 * Git from PATH, then common Windows installs, then copies bundled with Git clients
 * (GitHub Desktop, GitKraken, Fork), so Git views work on machines without Git on PATH.
 */
export function findGit(): Promise<string | undefined> {
  gitExecutable ??= (async () => {
    const names = process.platform === 'win32' ? ['git.exe', 'git.cmd'] : ['git'];
    for (const directory of (process.env.PATH ?? '').split(delimiter)) {
      for (const name of names)
        if (directory && existsSync(join(directory, name))) return join(directory, name);
    }
    if (process.platform !== 'win32') return undefined;
    const local = process.env.LOCALAPPDATA;
    const installed = [
      process.env.ProgramFiles,
      process.env['ProgramFiles(x86)'],
      local && join(local, 'Programs'),
    ]
      .filter((base): base is string => Boolean(base))
      .map((base) => join(base, 'Git', 'cmd', 'git.exe'))
      .find((path) => existsSync(path));
    return (
      installed ??
      (await newestBundled(local && join(local, 'GitHubDesktop'), 'app-', [
        'resources',
        'app',
        'git',
        'cmd',
        'git.exe',
      ])) ??
      (await newestBundled(local && join(local, 'gitkraken'), 'app-', [
        'resources',
        'app.asar.unpacked',
        'git',
        'cmd',
        'git.exe',
      ])) ??
      (await newestBundled(local && join(local, 'Fork', 'gitInstance'), '', ['cmd', 'git.exe']))
    );
  })();
  return gitExecutable;
}

/**
 * Workspace-relative paths Git ignores (directories end with "/"). Empty when Git is missing or this is not a
 * repository, so callers fall back to the built-in excluded directories.
 */
export async function gitIgnoredPaths(workspace: Pick<Workspace, 'path'>): Promise<Set<string>> {
  const git = await findGit();
  if (!git) return new Set();
  try {
    const { stdout } = await exec(
      git,
      [
        '--no-optional-locks',
        'ls-files',
        '--others',
        '--ignored',
        '--exclude-standard',
        '--directory',
        '-z',
      ],
      {
        cwd: workspace.path,
        timeout: 10_000,
        maxBuffer: 8 * 1024 * 1024,
        env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_CONFIG_NOSYSTEM: '1' },
        windowsHide: true,
      },
    );
    return new Set(stdout.split('\0').filter(Boolean));
  } catch {
    return new Set();
  }
}

export interface GitReadOptions {
  /** Workspace-relative pathspec; defaults to the whole workspace. */
  path?: string;
  /** Number of log entries. */
  count?: number;
  /** Commit-ish for `show`. */
  revision?: string;
  /** Diff only staged changes. */
  staged?: boolean;
  /** 1-based inclusive line range for `blame`. */
  startLine?: number;
  endLine?: number;
}

export type GitOperation = 'status' | 'diff' | 'log' | 'show' | 'blame';

/** Runs git in the workspace with prompts, system config and fsmonitor disabled. */
async function gitRunner(workspace: Workspace) {
  const git = await findGit();
  if (!git)
    throw new Error(
      'Git was not found. Install Git (git-scm.com) or add it to PATH, then restart BasedCode.',
    );
  return async (
    args: string[],
    options: { timeout?: number; okExit?: boolean } = {},
  ): Promise<string> => {
    try {
      return (
        await exec(git, ['--no-optional-locks', '-c', 'core.fsmonitor=false', ...args], {
          cwd: workspace.path,
          timeout: options.timeout ?? 15_000,
          maxBuffer: 2 * 1024 * 1024,
          env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_CONFIG_NOSYSTEM: '1' },
          windowsHide: true,
        })
      ).stdout;
    } catch (error) {
      const failure = error as {
        code?: number;
        stdout?: string;
        stderr?: string;
        message?: string;
      };
      if (options.okExit && failure.code === 1 && typeof failure.stdout === 'string')
        return failure.stdout;
      throw new Error((failure.stderr || failure.message || 'git failed').trim().slice(0, 2000));
    }
  };
}

async function pathspecs(workspace: Workspace, paths: string[]): Promise<string[]> {
  return Promise.all(
    paths.map(
      async (path) =>
        relative(workspace.path, await safePath(workspace, path))
          .split(sep)
          .join('/') || '.',
    ),
  );
}

/** Stage or unstage workspace paths. Returns the resulting short status for those paths. */
export async function gitStage(
  workspace: Workspace,
  paths: string[],
  unstage: boolean,
): Promise<string> {
  const run = await gitRunner(workspace);
  const specs = await pathspecs(workspace, paths);
  if (!unstage) await run(['add', '--all', '--', ...specs]);
  // A repository without commits has no HEAD to restore from; dropping the index entries is the equivalent.
  else
    await run(['restore', '--staged', '--', ...specs]).catch(() =>
      run(['rm', '-r', '--cached', '--quiet', '--', ...specs]),
    );
  return run(['status', '--short', '--', ...specs]);
}

/** Staged paths relative to the repository root, and the workspace's prefix within that repository. */
export async function gitStaged(
  workspace: Workspace,
): Promise<{ files: string[]; prefix: string }> {
  const run = await gitRunner(workspace);
  const prefix = (await run(['rev-parse', '--show-prefix'])).trim();
  const files = (await run(['diff', '--cached', '--name-only', '--no-renames', '-z']))
    .split('\0')
    .filter(Boolean);
  return { files, prefix };
}

/** Create or switch to a named local branch. No starting-point revision is accepted. */
export async function gitBranch(
  workspace: Workspace,
  name: string,
  create: boolean,
): Promise<string> {
  if (
    !/^[A-Za-z0-9][A-Za-z0-9._/-]{0,99}$/.test(name) ||
    name.startsWith('-') ||
    name.includes('..') ||
    name.endsWith('/') ||
    name.endsWith('.')
  )
    throw new Error('Invalid branch name.');
  const run = await gitRunner(workspace);
  await run(create ? ['switch', '-c', name] : ['switch', name]);
  return run(['status', '--short', '--branch']);
}

/** Stash or restore the latest stash entry. */
export async function gitStash(workspace: Workspace, operation: 'push' | 'pop'): Promise<string> {
  const run = await gitRunner(workspace);
  await run(operation === 'push' ? ['stash', 'push', '--include-untracked'] : ['stash', 'pop']);
  return run(['status', '--short', '--branch']);
}

/**
 * Commit the index. Hooks are pointed at an empty directory, because hooks are arbitrary programs that would run
 * outside command approval and the sandbox.
 */
export async function gitCommit(
  workspace: Workspace,
  message: string,
  emptyHooksDirectory: string,
): Promise<string> {
  const run = await gitRunner(workspace);
  await run(
    [
      '-c',
      `core.hooksPath=${emptyHooksDirectory}`,
      'commit',
      '--quiet',
      '--no-verify',
      '--cleanup=strip',
      '-m',
      message,
    ],
    { timeout: 60_000 },
  );
  return run(['log', '-1', '--stat', '--format=%h %s']);
}

export async function gitRead(
  workspace: Workspace,
  operation: GitOperation,
  options: GitReadOptions = {},
): Promise<string> {
  const git = await findGit();
  if (!git)
    throw new Error(
      'Git was not found. Install Git (git-scm.com) or add it to PATH, then restart BasedCode.',
    );
  // Validated through safePath so a pathspec cannot reach outside the workspace.
  const pathspec = options.path
    ? relative(workspace.path, await safePath(workspace, options.path))
        .split(sep)
        .join('/') || '.'
    : '.';
  // okExit: `git diff --no-index` exits 1 when the files differ, which is the expected case here.
  const run = async (args: string[], okExit = false): Promise<string> => {
    try {
      return (
        await exec(git, ['--no-optional-locks', '-c', 'core.fsmonitor=false', ...args], {
          cwd: workspace.path,
          timeout: 15_000,
          maxBuffer: 2 * 1024 * 1024,
          env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_CONFIG_NOSYSTEM: '1' },
          windowsHide: true,
        })
      ).stdout;
    } catch (error) {
      const failure = error as { code?: number; stdout?: string };
      if (okExit && failure.code === 1 && typeof failure.stdout === 'string') return failure.stdout;
      throw error;
    }
  };
  if (operation === 'status') return run(['status', '--short', '--', pathspec]);
  if (operation === 'log')
    return run([
      'log',
      `-${Math.min(Math.max(options.count ?? 12, 1), 200)}`,
      '--format=%h %ad %an%d %s',
      '--date=short',
      '--',
      pathspec,
    ]);
  if (operation === 'show' || operation === 'blame') {
    const revision = options.revision ?? 'HEAD';
    // Reject anything that git could parse as an option.
    if (!/^[A-Za-z0-9._/~^@{}-]+$/.test(revision) || revision.startsWith('-'))
      throw new Error('Invalid revision.');
    if (operation === 'show')
      return run([
        'show',
        '--no-ext-diff',
        '--no-textconv',
        '--stat',
        '--patch',
        revision,
        '--',
        pathspec,
      ]);
    if (!options.path) throw new Error('blame requires a file path.');
    const range = options.startLine
      ? ['-L', `${options.startLine},${options.endLine ?? options.startLine + 99}`]
      : [];
    return run(['blame', '--date=short', ...range, revision, '--', pathspec]);
  }
  if (options.staged)
    return run(['diff', '--no-ext-diff', '--no-textconv', '--cached', '--', pathspec]);
  // Tracked changes against HEAD; a repository without commits has no HEAD, so compare the index instead.
  const tracked = await run([
    'diff',
    '--no-ext-diff',
    '--no-textconv',
    'HEAD',
    '--',
    pathspec,
  ]).catch(() => run(['diff', '--no-ext-diff', '--no-textconv', '--cached', '--', pathspec]));
  // Plain git diff omits untracked files; the design requires them, so diff each against an empty file (bounded).
  const untracked = (await run(['ls-files', '--others', '--exclude-standard', '--', pathspec]))
    .split('\n')
    .filter(Boolean);
  let output = tracked;
  for (const file of untracked.slice(0, 200)) {
    if (output.length > 1_500_000) {
      output += `\n[${untracked.length} untracked files; output truncated]\n`;
      break;
    }
    output += await run(
      ['diff', '--no-ext-diff', '--no-textconv', '--no-index', '--', '/dev/null', file],
      true,
    );
  }
  return output;
}

export interface GitFileStatus {
  path: string;
  /** Index (staged) and worktree status letters from `git status --porcelain`; ' ' means unchanged. */
  index: string;
  worktree: string;
}

/** Branch, upstream distance and changed files, for the Git panel. */
export async function gitStatusEntries(workspace: Workspace): Promise<{
  branch: string;
  upstream?: string;
  ahead: number;
  behind: number;
  files: GitFileStatus[];
}> {
  const run = await gitRunner(workspace);
  const output = await run(['status', '--porcelain=v1', '-z', '--branch', '--untracked-files=all', '--', '.']);
  const parts = output.split('\0');
  const header = parts.shift() ?? '';
  const branchMatch = /^## (?:No commits yet on )?([^.\s]+)(?:\.\.\.(\S+))?(?: \[(.*)\])?/.exec(header);
  const ahead = Number(/ahead (\d+)/.exec(branchMatch?.[3] ?? '')?.[1] ?? 0);
  const behind = Number(/behind (\d+)/.exec(branchMatch?.[3] ?? '')?.[1] ?? 0);
  const files: GitFileStatus[] = [];
  for (let index = 0; index < parts.length; index++) {
    const entry = parts[index];
    if (!entry) continue;
    const status = { index: entry[0], worktree: entry[1], path: entry.slice(3) };
    // Renames and copies carry the original path as the next entry.
    if (status.index === 'R' || status.index === 'C') index++;
    files.push(status);
  }
  return { branch: branchMatch?.[1] ?? 'HEAD', upstream: branchMatch?.[2], ahead, behind, files };
}

/** Pushes the current branch, setting its upstream on origin the first time. */
export async function gitPush(workspace: Workspace): Promise<string> {
  const run = await gitRunner(workspace);
  const upstream = await run(['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}']).catch(() => '');
  await run(upstream.trim() ? ['push'] : ['push', '--set-upstream', 'origin', 'HEAD'], { timeout: 120_000 });
  return run(['status', '--short', '--branch']);
}
