import { existsSync } from 'node:fs';
import { execFile } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { homedir } from 'node:os';
import { AgyError, isAntigravitySignedIn, type AntigravitySettings } from 'eve-antigravity';
import { promisify } from 'node:util';
import { findExecutable } from '../runtime/processes.js';

const exec = promisify(execFile);

/** The SDK uses plain spawn, which cannot launch Windows npm shims. */
export function cliPath(kind: 'codex' | 'claude' | 'antigravity', override = ''): string {
  // npm scripts prepend project dependencies; only detect user-installed CLIs.
  const path =
    override ||
    findExecutable(kind === 'antigravity' ? 'agy' : kind, (directory) =>
      /[\\/]node_modules[\\/]\.bin[\\/]?$/i.test(directory),
    );
  if (!path)
    throw new Error(
      `${kind === 'antigravity' ? 'Antigravity (agy)' : kind === 'codex' ? 'Codex' : 'Claude Code'} was not found on PATH. Install it or set its executable path.`,
    );
  if (process.platform === 'win32' && /\.(cmd|bat)$/i.test(path)) {
    if (kind === 'antigravity')
      throw new Error('Set the Antigravity executable path to the agy .exe or .js file.');
    const packageEntry =
      kind === 'codex' ? '@openai/codex/bin/codex.js' : '@anthropic-ai/claude-code/cli.js';
    const entry = [
      join(dirname(path), 'node_modules', packageEntry),
      join(dirname(path), '..', packageEntry),
    ].find((candidate) => existsSync(candidate));
    if (!entry)
      throw new Error(
        `Cannot resolve ${kind} launcher. Set its executable path to the CLI .exe or .js file.`,
      );
    return entry;
  }
  return path;
}

export function antigravityOptions(override = ''): AntigravitySettings & { runtimeDir: string } {
  const path = cliPath('antigravity', override);
  return {
    agyPath: /\.[cm]?js$/i.test(path) ? process.execPath : path,
    agyArgs: /\.[cm]?js$/i.test(path) ? [path] : [],
    runtimeDir: resolve(process.env.EVE_ANTIGRAVITY_DIR ?? join(homedir(), '.eve-antigravity')),
    env: { BASEDCODE_AUTH: '', BASEDCODE_API: '' },
  };
}

export function execCli(path: string, args: string[], maxBuffer = 1_000_000) {
  return /\.[cm]?js$/i.test(path)
    ? exec(process.execPath, [path, ...args], { timeout: 15_000, maxBuffer, windowsHide: true })
    : exec(path, args, { timeout: 15_000, maxBuffer, windowsHide: true });
}

export async function loginStatus(
  kind: 'codex' | 'claude' | 'antigravity',
  override: string,
): Promise<{ state: 'signed-in' | 'signed-out' | 'unknown'; detail: string; detected: boolean }> {
  let path: string;
  try {
    path = cliPath(kind, override);
  } catch {
    return {
      state: 'unknown',
      detail: 'CLI not detected. Install it or set its executable path.',
      detected: false,
    };
  }
  try {
    if (kind === 'antigravity') {
      const signedIn = await isAntigravitySignedIn(antigravityOptions(override));
      return {
        state: signedIn ? 'signed-in' : 'signed-out',
        detail: signedIn
          ? 'Using your Antigravity CLI authentication.'
          : 'Sign in with the CLI to connect your account.',
        detected: true,
      };
    }
    let output: { stdout: string; stderr: string };
    try {
      output = await execCli(
        path,
        kind === 'codex' ? ['login', 'status'] : ['auth', 'status', '--json'],
      );
    } catch (error) {
      const failure = error as { stdout?: string; stderr?: string };
      if (/not logged in|not signed in/i.test(`${failure.stdout ?? ''}\n${failure.stderr ?? ''}`))
        return {
          state: 'signed-out',
          detail: 'Sign in with the CLI to connect your account.',
          detected: true,
        };
      if (kind !== 'claude' || !failure.stdout) throw error;
      output = { stdout: failure.stdout, stderr: failure.stderr ?? '' };
    }
    if (kind === 'claude') {
      const status = JSON.parse(output.stdout) as { loggedIn?: boolean };
      if (typeof status.loggedIn !== 'boolean') throw new Error('Unrecognized status');
      return {
        state: status.loggedIn ? 'signed-in' : 'signed-out',
        detail: status.loggedIn
          ? 'Using your Claude CLI authentication.'
          : 'Sign in with the CLI to connect your account.',
        detected: true,
      };
    }
    if (/not logged in|not signed in/i.test(output.stdout + output.stderr))
      return {
        state: 'signed-out',
        detail: 'Sign in with the CLI to connect your account.',
        detected: true,
      };
    if (/logged in/i.test(output.stdout + output.stderr))
      return { state: 'signed-in', detail: 'Using your Codex CLI authentication.', detected: true };
    return {
      state: 'unknown',
      detail: 'The CLI returned an unrecognized sign-in status.',
      detected: true,
    };
  } catch (error) {
    return {
      state: 'unknown',
      detail: error instanceof AgyError
        ? error.message
        : 'Unable to check CLI authentication. Check the executable path and try again.',
      detected: !(error instanceof AgyError && error.code === 'NOT_INSTALLED'),
    };
  }
}
