import { existsSync } from 'node:fs';
import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { delimiter, join, parse, dirname } from 'node:path';
import type { IPty } from 'node-pty';
import type { Run, TerminalInfo, Workspace } from '../../shared/types.js';
import { Events } from '../storage/events.js';
import { Store } from '../storage/store.js';
import { cleanOutput } from './output.js';

export function findExecutable(
  name: string,
  skipDirectory?: (directory: string) => boolean,
): string | undefined {
  const names =
    process.platform === 'win32' && !name.includes('.')
      ? [name + '.exe', name + '.cmd', name]
      : [name];
  if (name.includes('/') || name.includes('\\')) return existsSync(name) ? name : undefined;
  for (const directory of (process.env.PATH ?? '').split(delimiter)) {
    if (skipDirectory?.(directory)) continue;
    for (const candidate of names) {
      const path = join(directory, candidate);
      if (existsSync(path)) return path;
    }
  }
}

function commandEnvironment(): Record<string, string> {
  return Object.fromEntries(
    Object.entries(process.env).filter(
      ([key, value]) =>
        value !== undefined && !/TOKEN|SECRET|API_KEY|PASSWORD|BASEDCODE_AUTH/i.test(key),
    ),
  ) as Record<string, string>;
}

export class Processes {
  private readonly terminals = new Map<
    string,
    { info: TerminalInfo; pty: IPty; done: Promise<number> }
  >();
  readonly bubblewrap = process.platform === 'linux' ? findExecutable('bwrap') : undefined;

  constructor(
    private readonly events: Events,
    private readonly store: Store,
  ) {
    for (const terminal of store.all('terminal')) {
      if (terminal.status === 'running')
        store.put('terminal', {
          ...terminal,
          status: 'exited',
          output:
            terminal.output + '\r\n[Backend interrupted. Previous process outcome is unknown.]\r\n',
        });
    }
  }

  get sandbox(): { available: boolean; detail: string } {
    return {
      available: false,
      detail: this.bubblewrap
        ? 'Independent bubblewrap runner detected. Isolation has not been certified; commands still require individual approval.'
        : process.platform === 'win32'
          ? 'Independent Windows isolation is not implemented. Every command requires explicit approval and runs with your user permissions.'
          : 'No verified independent sandbox. Every command requires explicit approval and runs with your user permissions.',
    };
  }

  // Records written before kind/cwd existed are filled in so the UI can always label them.
  list(): TerminalInfo[] {
    return this.store.all('terminal').map((terminal) => ({
      ...terminal,
      kind: terminal.kind ?? (terminal.runId ? 'command' : 'user'),
      cwd:
        terminal.cwd ??
        this.store.all('workspace').find((workspace) => workspace.id === terminal.workspaceId)
          ?.path ??
        '',
    }));
  }

  launchProfile(
    workspace: Workspace,
    command: string,
    args: string[],
    network = false,
  ): { file: string; args: string[]; env: Record<string, string> } {
    if (!this.bubblewrap) {
      return { file: command, args, env: commandEnvironment() };
    }
    const sandboxArgs = [
      '--die-with-parent',
      '--new-session',
      '--unshare-all',
      '--proc',
      '/proc',
      '--dev',
      '/dev',
      '--tmpfs',
      '/tmp',
      '--dir',
      '/tmp/home',
    ];
    for (const path of [
      '/usr',
      '/bin',
      '/sbin',
      '/lib',
      '/lib64',
      '/etc/ssl/certs',
      '/etc/resolv.conf',
    ]) {
      if (existsSync(path)) sandboxArgs.push('--ro-bind', path, path);
    }
    const parents: string[] = [];
    let parent = dirname(workspace.path);
    while (parent !== parse(parent).root) {
      parents.unshift(parent);
      parent = dirname(parent);
    }
    for (const path of parents) sandboxArgs.push('--dir', path);
    sandboxArgs.push('--bind', workspace.path, workspace.path);
    if (existsSync(join(workspace.path, '.git')))
      sandboxArgs.push('--ro-bind', join(workspace.path, '.git'), join(workspace.path, '.git'));
    if (network) sandboxArgs.push('--share-net');
    sandboxArgs.push('--chdir', workspace.path, '--', command, ...args);
    return {
      file: this.bubblewrap,
      args: sandboxArgs,
      env: {
        PATH: '/usr/local/bin:/usr/bin:/bin',
        HOME: '/tmp/home',
        TMPDIR: '/tmp',
        TERM: 'xterm-256color',
        LANG: 'C.UTF-8',
      },
    };
  }

  async create(
    workspace: Workspace,
    command?: string,
    run?: Run,
    network = false,
    background = false,
  ): Promise<TerminalInfo> {
    const { spawn } = await import('node-pty');
    const shell =
      process.platform === 'win32' ? (findExecutable('pwsh') ?? 'powershell.exe') : '/bin/sh';
    const args = command
      ? process.platform === 'win32'
        ? ['-NoLogo', '-NoProfile', '-Command', command]
        : ['-lc', command]
      : process.platform === 'win32'
        ? ['-NoLogo', '-NoProfile']
        : [];
    const profile = run
      ? this.launchProfile(workspace, shell, args, network)
      : { file: shell, args, env: commandEnvironment() };
    const pty = spawn(profile.file, profile.args, {
      name: 'xterm-256color',
      cols: 110,
      rows: 28,
      cwd: workspace.path,
      env: profile.env,
    });
    const info: TerminalInfo = {
      id: randomUUID(),
      workspaceId: workspace.id,
      runId: run?.id,
      title: command?.slice(0, 70) ?? 'User terminal',
      kind: !run ? 'user' : background ? 'service' : 'command',
      cwd: workspace.path,
      owner: run ? 'agent' : 'user',
      status: 'running',
      output: '',
    };
    const done = new Promise<number>((resolve) => {
      pty.onData((data) => {
        info.output = (info.output + data).slice(-200_000);
        this.store.put('terminal', info);
        this.events.publish('terminal-output', { id: info.id, data }, workspace.id, run?.id);
      });
      pty.onExit(({ exitCode }) => {
        info.status = 'exited';
        info.exitCode = exitCode;
        this.store.put('terminal', info);
        this.events.publish('state');
        resolve(exitCode);
      });
    });
    this.terminals.set(info.id, { info, pty, done });
    this.store.put('terminal', info);
    this.events.publish('state');
    return { ...info };
  }

  async command(
    workspace: Workspace,
    command: string,
    run: Run,
    signal: AbortSignal,
    background: boolean,
    network: boolean,
    timeoutMs = 120_000,
  ): Promise<unknown> {
    const info = await this.create(workspace, command, run, network, background);
    const terminal = this.get(info.id);
    const abort = () => this.stop(info.id);
    signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) abort();
    if (background) {
      signal.removeEventListener('abort', abort);
      return {
        terminalId: info.id,
        running: true,
        message: 'Service is running in a terminal tab. Use terminal_output or stop_terminal.',
      };
    }
    try {
      let timedOut = false;
      const timeout = setTimeout(() => {
        timedOut = true;
        this.stop(info.id);
      }, timeoutMs);
      try {
        const exitCode = await terminal.done;
        signal.throwIfAborted();
        return {
          terminalId: info.id,
          exitCode,
          ...(timedOut ? { timedOut: true } : {}),
          ...(terminal.info.stoppedByUser ? { stoppedByUser: true } : {}),
          output: cleanOutput(terminal.info.output.slice(-60_000)).slice(-30_000),
        };
      } finally {
        clearTimeout(timeout);
      }
    } finally {
      signal.removeEventListener('abort', abort);
      // Foreground agent commands are one-shot: their output is already in the tool result,
      // so drop the tab once done. Keep it if the user took control and is still using it.
      if (terminal.info.owner === 'agent') void this.close(info.id).catch(() => undefined);
    }
  }

  private get(id: string) {
    const terminal = this.terminals.get(id);
    if (!terminal) throw new Error('Terminal not found.');
    return terminal;
  }

  info(id: string): TerminalInfo {
    return this.store.get('terminal', id);
  }

  write(id: string, input: string, actor: 'user' | 'agent'): void {
    const terminal = this.get(id);
    if (terminal.info.owner !== actor)
      throw new Error('Take control of this terminal before typing.');
    if (terminal.info.status !== 'running') throw new Error('This terminal has exited.');
    terminal.pty.write(input);
  }

  resize(id: string, cols: number, rows: number): void {
    if (cols < 2 || rows < 1 || cols > 500 || rows > 300) return;
    // Terminals restored from an earlier session have no live PTY; resizing their view is harmless.
    const terminal = this.terminals.get(id);
    if (terminal?.info.status === 'running') terminal.pty.resize(cols, rows);
  }

  takeover(id: string, owner: 'user' | 'agent'): void {
    const terminal = this.get(id);
    if (owner === 'agent' && !terminal.info.runId)
      throw new Error('A user terminal cannot be assigned to an agent.');
    terminal.info.owner = owner;
    this.store.put('terminal', terminal.info);
    this.events.publish('state');
  }

  hasTakeover(runId: string): boolean {
    return this.list().some(
      (terminal) =>
        terminal.runId === runId && terminal.owner === 'user' && terminal.status === 'running',
    );
  }

  stop(id: string, byUser = false): void {
    const terminal = this.get(id);
    if (terminal.info.status !== 'running') return;
    if (byUser) {
      terminal.info.stoppedByUser = true;
      this.store.put('terminal', terminal.info);
    }
    if (process.platform === 'win32') {
      execFile(
        'taskkill.exe',
        ['/PID', String(terminal.pty.pid), '/T', '/F'],
        { windowsHide: true },
        (error) => {
          if (error && terminal.info.status === 'running') terminal.pty.kill();
        },
      );
    } else {
      try {
        process.kill(-terminal.pty.pid, 'SIGTERM');
      } catch {
        terminal.pty.kill();
      }
    }
    const force = setTimeout(() => {
      if (terminal.info.status !== 'running') return;
      if (process.platform === 'win32') terminal.pty.kill();
      else {
        try {
          process.kill(-terminal.pty.pid, 'SIGKILL');
        } catch {
          terminal.pty.kill('SIGKILL');
        }
      }
    }, 2500);
    force.unref();
    void terminal.done.then(() => clearTimeout(force));
  }

  /** Closes a terminal tab: stops its process tree if still running, then forgets it. */
  async close(id: string, byUser = false): Promise<void> {
    const terminal = this.terminals.get(id);
    if (terminal?.info.status === 'running') {
      this.stop(id, byUser);
      // stop() force-kills after 2.5 s; don't let a stuck process keep the tab open forever.
      await Promise.race([terminal.done, delay(4000)]);
    }
    this.terminals.delete(id);
    this.store.remove('terminal', id);
    this.events.publish('state');
  }

  async stopRuns(runIds: Set<string>): Promise<void> {
    const terminals = [...this.terminals.values()].filter(
      (terminal) =>
        terminal.info.runId &&
        runIds.has(terminal.info.runId) &&
        terminal.info.status === 'running',
    );
    for (const terminal of terminals) this.stop(terminal.info.id);
    await Promise.all(terminals.map((terminal) => terminal.done));
  }

  shutdown(): void {
    for (const terminal of this.terminals.values()) this.stop(terminal.info.id);
  }
}
