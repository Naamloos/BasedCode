import { execFile, type ChildProcess } from 'node:child_process';
import spawn from 'cross-spawn';
import { existsSync } from 'node:fs';
import { readFile, stat, mkdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { homedir } from 'node:os';
import { promisify } from 'node:util';
import { randomUUID } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { basename, extname, join, dirname, resolve } from 'node:path';
import {
  CancellationTokenSource,
  createMessageConnection,
  StreamMessageReader,
  StreamMessageWriter,
  type MessageConnection,
} from 'vscode-jsonrpc/node.js';
import type {
  InitializeResult,
  DocumentDiagnosticReport,
  ServerCapabilities,
  WorkspaceEdit,
  CodeAction,
  Command,
  Range,
} from 'vscode-languageserver-protocol';
import type {
  Diagnostic,
  LanguageConfig,
  LanguageServerStatus,
  LanguageOperation,
  Run,
  Workspace,
} from '../../shared/types.js';
import { Store } from '../storage/store.js';
import { Events } from '../storage/events.js';
import { Permissions } from '../workspace/permissions.js';
import { Processes, findExecutable } from '../runtime/processes.js';
import {
  excludedDirectories,
  fileTree,
  gitIgnoredPaths,
  isInside,
  safePath,
} from '../workspace/workspace.js';

const exec = promisify(execFile);
const defaultPackages: Record<string, { package: string; dependencies: string[] }> = {
  'typescript-language-server': {
    package: 'typescript-language-server',
    dependencies: ['typescript-language-server', 'typescript'],
  },
  // Vue 2.x supports a standalone server; 3.x requires a separate TypeScript plugin bridge.
  'vue-language-server': {
    package: '@vue/language-server',
    dependencies: ['@vue/language-server@2.2.12', 'typescript@5'],
  },
  'pyright-langserver': { package: 'pyright', dependencies: ['pyright'] },
  'vscode-json-language-server': {
    package: 'vscode-langservers-extracted',
    dependencies: ['vscode-langservers-extracted'],
  },
  'vscode-html-language-server': {
    package: 'vscode-langservers-extracted',
    dependencies: ['vscode-langservers-extracted'],
  },
  'vscode-css-language-server': {
    package: 'vscode-langservers-extracted',
    dependencies: ['vscode-langservers-extracted'],
  },
  'yaml-language-server': {
    package: 'yaml-language-server',
    dependencies: ['yaml-language-server'],
  },
  'bash-language-server': {
    package: 'bash-language-server',
    dependencies: ['bash-language-server'],
  },
  'docker-langserver': {
    package: 'dockerfile-language-server-nodejs',
    dependencies: ['dockerfile-language-server-nodejs'],
  },
};

/** Per-user tool folders (relative to the home directory) that GUI apps often do not have on PATH. */
const toolDirectories: Record<string, string[]> = {
  'csharp-ls': ['.dotnet', 'tools'],
  'roslyn-language-server': ['.dotnet', 'tools'],
  gopls: ['go', 'bin'],
  'rust-analyzer': ['.cargo', 'bin'],
};
const dotnetTools = ['csharp-ls', 'roslyn-language-server'];

const languageIds: Record<string, string> = {
  '.ts': 'typescript',
  '.mts': 'typescript',
  '.cts': 'typescript',
  '.tsx': 'typescriptreact',
  '.js': 'javascript',
  '.mjs': 'javascript',
  '.cjs': 'javascript',
  '.jsx': 'javascriptreact',
  '.vue': 'vue',
  '.svelte': 'svelte',
  '.astro': 'astro',
  '.py': 'python',
  '.pyi': 'python',
  '.json': 'json',
  '.jsonc': 'jsonc',
  '.cs': 'csharp',
  '.html': 'html',
  '.htm': 'html',
  '.css': 'css',
  '.scss': 'scss',
  '.less': 'less',
  '.yaml': 'yaml',
  '.yml': 'yaml',
  '.toml': 'toml',
  '.xml': 'xml',
  '.md': 'markdown',
  '.sh': 'shellscript',
  '.bash': 'shellscript',
  '.zsh': 'shellscript',
  '.dockerfile': 'dockerfile',
  '.go': 'go',
  '.rs': 'rust',
  '.c': 'c',
  '.h': 'c',
  '.cpp': 'cpp',
  '.cc': 'cpp',
  '.cxx': 'cpp',
  '.hpp': 'cpp',
  '.hh': 'cpp',
  '.hxx': 'cpp',
  '.java': 'java',
  '.kt': 'kotlin',
  '.kts': 'kotlin',
  '.scala': 'scala',
  '.swift': 'swift',
  '.dart': 'dart',
  '.rb': 'ruby',
  '.php': 'php',
  '.lua': 'lua',
  '.zig': 'zig',
  '.ex': 'elixir',
  '.exs': 'elixir',
  '.hs': 'haskell',
  '.tf': 'terraform',
  '.sql': 'sql',
};

interface LanguageConnection {
  connection: MessageConnection;
  process: ChildProcess;
  documents: Map<string, number>;
  fingerprint: string;
  pullDiagnostics: boolean;
  capabilities: ServerCapabilities;
  diagnosticsListeners: Map<string, Set<(error?: Error) => void>>;
  /** While a code-action command runs, edits the server asks the client to apply are collected here. */
  editCapture?: WorkspaceEdit[];
}

export interface CodeActionSummary {
  title: string;
  kind?: string;
  preferred?: boolean;
  disabled?: string;
}

export function languageId(path: string): string {
  // Dockerfile, Dockerfile.dev and Containerfile carry no usable extension.
  if (/^(dockerfile|containerfile)(\.|$)/i.test(basename(path))) return 'dockerfile';
  return languageIds[extname(path).toLowerCase()] ?? 'plaintext';
}

/**
 * Servers may rewrite file URIs (typescript-language-server on Windows sends file:///c%3A/... for file:///C:/...),
 * so URIs are compared in this canonical form.
 */
function canonicalUri(uri: string): string {
  if (!uri.startsWith('file:')) return uri;
  try {
    const href = pathToFileURL(fileURLToPath(uri)).href;
    return process.platform === 'win32' ? href.toLowerCase() : href;
  } catch {
    return uri;
  }
}

export class Languages {
  private readonly connections = new Map<string, LanguageConnection>();
  private readonly starting = new Map<string, Promise<LanguageConnection>>();
  private readonly diagnostics = new Map<string, Diagnostic[]>();
  private readonly installing = new Map<string, Promise<LanguageConfig>>();

  constructor(
    private readonly permissions: Permissions,
    private readonly processes: Processes,
    private readonly events: Events,
    private readonly store: Store,
    private readonly managedDirectory: string,
  ) {}

  list(): Diagnostic[] {
    return [...this.diagnostics.values()].flat();
  }

  private async packageCommand(
    directory: string,
    packageName: string,
    binName: string,
    args: string[],
  ): Promise<{ command: string; args: string[] } | undefined> {
    try {
      const require = createRequire(join(directory, 'package.json'));
      const manifestPath = require.resolve(`${packageName}/package.json`);
      const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as {
        bin?: string | Record<string, string>;
      };
      const bin = typeof manifest.bin === 'string' ? manifest.bin : manifest.bin?.[binName];
      if (!bin) return undefined;
      const entry = resolve(dirname(manifestPath), bin);
      if (!isInside(dirname(manifestPath), entry) || !existsSync(entry)) return undefined;
      return { command: process.execPath, args: [entry, ...args] };
    } catch {
      return undefined;
    }
  }

  private async discover(
    workspace: Workspace,
    config: LanguageConfig,
  ): Promise<LanguageConfig | undefined> {
    const known = defaultPackages[config.command];
    if (known) {
      const local = await this.packageCommand(
        workspace.path,
        known.package,
        config.command,
        config.args,
      );
      if (local) return { ...config, ...local };
    }
    const toolDirectory = toolDirectories[config.command];
    const executable =
      findExecutable(config.command) ??
      (toolDirectory
        ? findExecutable(
            join(
              homedir(),
              ...toolDirectory,
              process.platform === 'win32' ? `${config.command}.exe` : config.command,
            ),
          )
        : undefined);
    return executable ? { ...config, command: executable } : undefined;
  }

  async discoverServers(workspace: Workspace): Promise<LanguageServerStatus[]> {
    return Promise.all(
      this.store.global().languageServers.map(async (config) => {
        const found = await this.discover(workspace, config);
        return {
          ...config,
          available: Boolean(found),
          canInstall: Boolean(
            defaultPackages[config.command] || dotnetTools.includes(config.command),
          ),
          resolved: found && [found.command, ...found.args].join(' '),
          running: this.connections.has(`${workspace.id}:${config.id}`),
        };
      }),
    );
  }

  async setup(
    workspace: Workspace,
    serverId: string,
    signal?: AbortSignal,
    run?: Run,
  ): Promise<LanguageConfig> {
    const config = this.store.global().languageServers.find((server) => server.id === serverId);
    if (!config) throw new Error('Unknown language server.');
    const found = await this.discover(workspace, config);
    if (found) return found;
    const pending = this.installing.get(serverId);
    if (pending) return pending;
    const promise = this.install(workspace, config, signal, run);
    this.installing.set(serverId, promise);
    try {
      return await promise;
    } finally {
      this.installing.delete(serverId);
    }
  }

  private async install(
    workspace: Workspace,
    config: LanguageConfig,
    signal?: AbortSignal,
    run?: Run,
  ): Promise<LanguageConfig> {
    const npm = defaultPackages[config.command];
    const dotnetPackage = dotnetTools.includes(config.command) ? config.command : undefined;
    const dotnet = dotnetPackage ? findExecutable('dotnet') : undefined;
    if (!npm && !dotnet)
      throw new Error(
        dotnetPackage
          ? 'C# setup requires the .NET 10 SDK or later. Install it, then retry setup.'
          : `${config.name} was not found. Configure its executable in App settings → MCP & languages.`,
      );
    const npmCli = process.env.BASEDCODE_NPM_CLI;
    if (npm && !npmCli)
      throw new Error(
        'Restart BasedCode through npm run dev/start to enable language-server setup.',
      );
    const directory = join(this.managedDirectory, randomUUID());
    const command = npm ? process.execPath : dotnet!;
    const args = npm
      ? [
          npmCli!,
          'install',
          '--ignore-scripts',
          '--no-audit',
          '--no-fund',
          '--prefix',
          directory,
          ...npm.dependencies,
        ]
      : [
          'tool',
          'install',
          '--tool-path',
          directory,
          dotnetPackage!,
          ...(dotnetPackage === 'roslyn-language-server' ? ['--prerelease'] : []),
        ];
    await this.permissions.ask(
      workspace.id,
      `Install ${config.name}`,
      `Download and install ${npm ? npm.dependencies.join(', ') : `${dotnetPackage} (requires .NET 10 SDK or later)`} into ${directory}.\nThis installs executable code from ${npm ? 'npm' : 'NuGet'} and saves the language-server configuration app-wide.`,
      signal,
      run,
    );
    const action = this.store.action(
      workspace.id,
      `Install language server: ${config.name}`,
      directory,
      run,
    );
    try {
      await mkdir(directory, { recursive: true, mode: 0o700 });
      const profile = this.processes.launchProfile(
        { ...workspace, path: directory },
        command,
        args,
        true,
      );
      await exec(profile.file, profile.args, {
        cwd: directory,
        env: profile.env,
        signal,
        timeout: 120_000,
        maxBuffer: 100_000,
        windowsHide: true,
      });
      const installed = npm
        ? await this.packageCommand(directory, npm.package, config.command, config.args)
        : {
            command: join(
              directory,
              process.platform === 'win32' ? `${dotnetPackage}.exe` : dotnetPackage!,
            ),
            args: config.args,
          };
      if (!installed || !existsSync(installed.command))
        throw new Error('Installation did not produce the requested language-server executable.');
      const updated = { ...config, ...installed };
      const global = this.store.global();
      // Do not overwrite settings changed while the installation was waiting for approval.
      const index = global.languageServers.findIndex(
        (server) => server.id === config.id && JSON.stringify(server) === JSON.stringify(config),
      );
      if (index < 0)
        throw new Error(
          'Language-server settings changed during installation. Retry setup with the current settings.',
        );
      global.languageServers[index] = updated;
      this.store.saveGlobal(global);
      this.store.put('action', { ...action, status: 'completed' });
      this.events.publish('state');
      return updated;
    } catch (error) {
      this.store.put('action', { ...action, status: 'unknown' });
      throw error;
    }
  }

  /** `automatic` starts an installed server without asking; it never installs one. */
  private async start(
    workspace: Workspace,
    config: LanguageConfig,
    signal?: AbortSignal,
    run?: Run,
    automatic = false,
  ): Promise<LanguageConnection> {
    if (automatic) {
      const found = await this.discover(workspace, config);
      if (!found) throw new Error(`${config.name} is not installed.`);
      config = found;
    } else config = await this.setup(workspace, config.id, signal, run);
    const key = `${workspace.id}:${config.id}`;
    const existing = this.connections.get(key);
    if (existing?.fingerprint === JSON.stringify(config)) return existing;
    const pending = this.starting.get(key);
    if (pending) return pending;
    const promise = (async () => {
      const executable = findExecutable(config.command);
      if (!executable)
        throw new Error(
          `${config.name} is not installed at "${config.command}" or available on PATH. Install it or set its executable in App settings → MCP & languages.`,
        );
      if (existing) {
        existing.connection.dispose();
        existing.process.kill();
        this.connections.delete(key);
      }
      if (!automatic)
        await this.permissions.ask(
          workspace.id,
          `Start language server: ${config.name}`,
          `${config.command} ${config.args.join(' ')}\n${this.processes.sandbox.detail}\nLanguage servers can load executable project plugins.`,
          signal,
          run,
        );
      const profile = this.processes.launchProfile(workspace, executable, config.args);
      const child = spawn(profile.file, profile.args, {
        cwd: workspace.path,
        env: profile.env,
        windowsHide: true,
        stdio: 'pipe',
      });
      if (!child.stdin || !child.stdout || !child.stderr)
        throw new Error('Language server requires stdio pipes.');
      let stderr = '';
      child.stderr.on('data', (bytes) => {
        stderr = (stderr + String(bytes)).slice(-4000);
      });
      const connection = createMessageConnection(
        new StreamMessageReader(child.stdout),
        new StreamMessageWriter(child.stdin),
      );
      const item: LanguageConnection = {
        connection,
        process: child,
        documents: new Map(),
        fingerprint: JSON.stringify(config),
        pullDiagnostics: false,
        capabilities: {},
        diagnosticsListeners: new Map(),
      };
      connection.onNotification(
        'textDocument/publishDiagnostics',
        (params: {
          uri: string;
          version?: number;
          diagnostics: Omit<Diagnostic, 'uri' | 'server'>[];
        }) => {
          const uri = canonicalUri(params.uri);
          if (params.version !== undefined && params.version < (item.documents.get(uri) ?? 0))
            return;
          this.diagnostics.set(
            `${key}:${uri}`,
            params.diagnostics
              .slice(0, 300)
              .map((diagnostic) => ({ ...diagnostic, uri: params.uri, server: config.name })),
          );
          for (const listener of item.diagnosticsListeners.get(uri) ?? []) listener();
          this.events.publish('diagnostics', this.list(), workspace.id);
        },
      );
      connection.onRequest('workspace/configuration', (params: { items: unknown[] }) =>
        params.items.map(() => ({})),
      );
      // Servers never write files directly: edits are only accepted while a code action BasedCode applies is running,
      // and BasedCode then writes them through its own validated mutation path.
      connection.onRequest('workspace/applyEdit', (params: { edit: WorkspaceEdit }) => {
        if (!item.editCapture)
          return {
            applied: false,
            failureReason: 'BasedCode only applies edits from code actions the agent requested.',
          };
        item.editCapture.push(params.edit);
        return { applied: true };
      });
      connection.onRequest('client/registerCapability', () => null);
      connection.onRequest('window/workDoneProgress/create', () => null);
      connection.listen();
      try {
        const failure = new Promise<never>((_, reject) => {
          child.once('error', (error) =>
            reject(new Error(`Cannot start ${config.name}: ${error.message}`)),
          );
          child.once('exit', () => reject(new Error(`${config.name} exited. ${stderr}`)));
        });
        const timeout = AbortSignal.timeout(20_000);
        const initialize = connection.sendRequest('initialize', {
          processId: process.pid,
          rootUri: pathToFileURL(workspace.path).href,
          workspaceFolders: [{ uri: pathToFileURL(workspace.path).href, name: workspace.name }],
          capabilities: {
            general: { positionEncodings: ['utf-16'] },
            // resourceOperations is empty: file create/rename/delete from a server is not supported.
            workspace: {
              configuration: true,
              workspaceFolders: true,
              applyEdit: true,
              workspaceEdit: { documentChanges: true, resourceOperations: [] },
            },
            textDocument: {
              publishDiagnostics: { relatedInformation: true, versionSupport: true },
              diagnostic: { dynamicRegistration: false },
              completion: { completionItem: { snippetSupport: false } },
              hover: { contentFormat: ['markdown', 'plaintext'] },
              signatureHelp: {
                signatureInformation: { documentationFormat: ['markdown', 'plaintext'] },
              },
              rename: { prepareSupport: true },
              codeAction: {
                codeActionLiteralSupport: {
                  codeActionKind: {
                    valueSet: [
                      '',
                      'quickfix',
                      'refactor',
                      'refactor.extract',
                      'refactor.inline',
                      'refactor.rewrite',
                      'source',
                      'source.organizeImports',
                      'source.fixAll',
                    ],
                  },
                },
                isPreferredSupport: true,
                disabledSupport: true,
                dataSupport: true,
                resolveSupport: { properties: ['edit'] },
              },
            },
          },
          initializationOptions: await this.initializationOptions(workspace, config),
        });
        const result = (await Promise.race([
          initialize,
          failure,
          new Promise<never>((_, reject) =>
            timeout.addEventListener(
              'abort',
              () => reject(new Error(`${config.name} initialization timed out.`)),
              { once: true },
            ),
          ),
        ])) as InitializeResult;
        item.pullDiagnostics = Boolean(result.capabilities.diagnosticProvider);
        item.capabilities = result.capabilities;
        await connection.sendNotification('initialized', {});
        this.connections.set(key, item);
        child.once('exit', () => {
          if (this.connections.get(key) === item) {
            this.connections.delete(key);
            for (const diagnosticKey of this.diagnostics.keys())
              if (diagnosticKey.startsWith(key + ':')) this.diagnostics.delete(diagnosticKey);
            this.events.publish('diagnostics', this.list(), workspace.id);
          }
          connection.dispose();
          for (const listeners of item.diagnosticsListeners.values())
            for (const listener of listeners)
              listener(new Error(`${config.name} exited. ${stderr}`));
        });
        return item;
      } catch (error) {
        connection.dispose();
        child.kill();
        throw error;
      }
    })();
    this.starting.set(key, promise);
    try {
      return await promise;
    } finally {
      this.starting.delete(key);
    }
  }

  private async initializationOptions(
    workspace: Workspace,
    config: LanguageConfig,
  ): Promise<Record<string, unknown>> {
    if (
      !config.languages.some((language) => ['typescript', 'javascript', 'vue'].includes(language))
    )
      return {};
    let tsdk: string | undefined;
    for (const directory of [workspace.path, dirname(config.args[0] ?? config.command)]) {
      try {
        tsdk = dirname(
          createRequire(join(directory, 'package.json')).resolve('typescript/lib/tsserver.js'),
        );
        break;
      } catch {
        /* Try the server's own TypeScript dependency next. */
      }
    }
    return config.languages.includes('vue')
      ? { vue: { hybridMode: false }, ...(tsdk ? { typescript: { tsdk } } : {}) }
      : {
          disableAutomaticTypingAcquisition: true,
          ...(tsdk ? { tsserver: { path: join(tsdk, 'tsserver.js') } } : {}),
        };
  }

  async query(
    workspace: Workspace,
    path: string,
    operation: LanguageOperation,
    line = 0,
    character = 0,
    signal?: AbortSignal,
    run?: Run,
    automatic = false,
  ): Promise<unknown> {
    const file = await safePath(workspace, path);
    const language = languageId(file);
    const config = this.store
      .global()
      .languageServers.find((server) => server.languages.includes(language));
    if (!config) throw new Error(`No language server is configured for ${language}.`);
    const server = await this.start(workspace, config, signal, run, automatic);
    const capability = {
      definition: 'definitionProvider',
      references: 'referencesProvider',
      hover: 'hoverProvider',
      symbols: 'documentSymbolProvider',
      completion: 'completionProvider',
      signatureHelp: 'signatureHelpProvider',
      typeDefinition: 'typeDefinitionProvider',
      implementation: 'implementationProvider',
      documentHighlight: 'documentHighlightProvider',
    } as const;
    if (operation !== 'diagnostics' && !server.capabilities[capability[operation]])
      throw new Error(`${config.name} does not support ${operation}.`);
    const uri = pathToFileURL(file).href;
    const documentKey = canonicalUri(uri);
    if (operation === 'diagnostics' && !server.pullDiagnostics) {
      let timer: ReturnType<typeof setTimeout> | undefined;
      let listener: (error?: Error) => void = () => undefined;
      const abort = () => listener(new Error('Language query cancelled.'));
      try {
        signal?.throwIfAborted();
        const published = new Promise<void>((resolve, reject) => {
          listener = (error) => (error ? reject(error) : resolve());
          const listeners = server.diagnosticsListeners.get(documentKey) ?? new Set();
          listeners.add(listener);
          server.diagnosticsListeners.set(documentKey, listeners);
          signal?.addEventListener('abort', abort, { once: true });
          timer = setTimeout(
            () =>
              listener(new Error(`${config.name} did not publish diagnostics within 20 seconds.`)),
            20_000,
          );
        });
        await Promise.all([this.sync(server, uri, file, language), published]);
        return this.diagnostics.get(`${workspace.id}:${config.id}:${documentKey}`) ?? [];
      } finally {
        clearTimeout(timer);
        signal?.removeEventListener('abort', abort);
        const listeners = server.diagnosticsListeners.get(documentKey);
        listeners?.delete(listener);
        if (!listeners?.size) server.diagnosticsListeners.delete(documentKey);
      }
    }
    await this.sync(server, uri, file, language);
    const method =
      operation === 'diagnostics'
        ? 'textDocument/diagnostic'
        : operation === 'symbols'
          ? 'textDocument/documentSymbol'
          : `textDocument/${operation}`;
    const cancellation = new CancellationTokenSource();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let abort: (() => void) | undefined;
    try {
      signal?.throwIfAborted();
      const request = server.connection.sendRequest(
        method,
        {
          textDocument: { uri },
          ...(['diagnostics', 'symbols'].includes(operation)
            ? {}
            : { position: { line, character } }),
          ...(operation === 'references' ? { context: { includeDeclaration: true } } : {}),
        },
        cancellation.token,
      );
      const timeout = new Promise<never>((_, reject) => {
        abort = () => {
          cancellation.cancel();
          reject(new Error('Language query cancelled.'));
        };
        signal?.addEventListener('abort', abort, { once: true });
        timer = setTimeout(() => {
          cancellation.cancel();
          reject(new Error('Language query timed out after 20 seconds.'));
        }, 20_000);
      });
      const result = await Promise.race([request, timeout]);
      if (operation === 'diagnostics') {
        const report = result as DocumentDiagnosticReport;
        if (report.kind === 'full') {
          this.diagnostics.set(
            `${workspace.id}:${config.id}:${documentKey}`,
            report.items
              .slice(0, 300)
              .map((diagnostic) => ({
                ...diagnostic,
                message:
                  typeof diagnostic.message === 'string'
                    ? diagnostic.message
                    : diagnostic.message.value,
                uri,
                server: config.name,
              })),
          );
          this.events.publish('diagnostics', this.list(), workspace.id);
        }
        return this.diagnostics.get(`${workspace.id}:${config.id}:${documentKey}`) ?? [];
      }
      return result;
    } finally {
      clearTimeout(timer);
      if (abort) signal?.removeEventListener('abort', abort);
      cancellation.dispose();
    }
  }

  /** Starts the server for a file and syncs its current content. */
  private async open(workspace: Workspace, path: string, signal?: AbortSignal, run?: Run) {
    const file = await safePath(workspace, path);
    const language = languageId(file);
    const config = this.store
      .global()
      .languageServers.find((server) => server.languages.includes(language));
    if (!config) throw new Error(`No language server is configured for ${language}.`);
    const server = await this.start(workspace, config, signal, run);
    const uri = pathToFileURL(file).href;
    await this.sync(server, uri, file, language);
    return { server, config, uri };
  }

  /** A request with cancellation, abort and a 20-second timeout. */
  private async send<T>(
    server: LanguageConnection,
    method: string,
    params: unknown,
    signal?: AbortSignal,
  ): Promise<T> {
    const cancellation = new CancellationTokenSource();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let abort: (() => void) | undefined;
    try {
      signal?.throwIfAborted();
      const timeout = new Promise<never>((_, reject) => {
        abort = () => {
          cancellation.cancel();
          reject(new Error('Language request cancelled.'));
        };
        signal?.addEventListener('abort', abort, { once: true });
        timer = setTimeout(() => {
          cancellation.cancel();
          reject(new Error(`${method} timed out after 20 seconds.`));
        }, 20_000);
      });
      return await Promise.race([
        server.connection.sendRequest(method, params, cancellation.token) as Promise<T>,
        timeout,
      ]);
    } finally {
      clearTimeout(timer);
      if (abort) signal?.removeEventListener('abort', abort);
      cancellation.dispose();
    }
  }

  /** The workspace edit for renaming the symbol at a position. Nothing is written here. */
  async rename(
    workspace: Workspace,
    path: string,
    line: number,
    character: number,
    newName: string,
    signal?: AbortSignal,
    run?: Run,
  ): Promise<WorkspaceEdit> {
    const { server, config, uri } = await this.open(workspace, path, signal, run);
    if (!server.capabilities.renameProvider)
      throw new Error(`${config.name} does not support rename.`);
    const position = { line, character };
    const prepares =
      typeof server.capabilities.renameProvider === 'object' &&
      server.capabilities.renameProvider.prepareProvider;
    if (
      prepares &&
      (await this.send<unknown>(
        server,
        'textDocument/prepareRename',
        { textDocument: { uri }, position },
        signal,
      )) === null
    ) {
      throw new Error(
        'No renameable symbol at that position. Check the zero-based line and character.',
      );
    }
    const edit = await this.send<WorkspaceEdit | null>(
      server,
      'textDocument/rename',
      { textDocument: { uri }, position, newName },
      signal,
    );
    if (!edit) throw new Error('The language server returned no rename edits.');
    return edit;
  }

  private async actions(
    workspace: Workspace,
    path: string,
    range: Range,
    only: string[] | undefined,
    signal?: AbortSignal,
    run?: Run,
  ) {
    // Fresh diagnostics let servers offer quick fixes for problems in the range.
    const diagnostics = await (
      this.query(workspace, path, 'diagnostics', 0, 0, signal, run) as Promise<Diagnostic[]>
    ).catch(() => [] as Diagnostic[]);
    const opened = await this.open(workspace, path, signal, run);
    if (!opened.server.capabilities.codeActionProvider)
      throw new Error(`${opened.config.name} does not support code actions.`);
    const before = (a: Range['start'], b: Range['start']) =>
      a.line < b.line || (a.line === b.line && a.character <= b.character);
    const overlapping = diagnostics
      .filter((item) => before(item.range.start, range.end) && before(range.start, item.range.end))
      // Strip BasedCode's own fields but keep code/source/data, which servers use to match their quick fixes.
      .map((item) => {
        const copy: Record<string, unknown> = { ...item };
        delete copy.uri;
        delete copy.server;
        return copy;
      });
    const result = await this.send<(CodeAction | Command)[] | null>(
      opened.server,
      'textDocument/codeAction',
      {
        textDocument: { uri: opened.uri },
        range,
        context: { diagnostics: overlapping, ...(only?.length ? { only } : {}), triggerKind: 1 },
      },
      signal,
    );
    return { ...opened, actions: result ?? [] };
  }

  /** Code actions available for a range. */
  async codeActions(
    workspace: Workspace,
    path: string,
    range: Range,
    only?: string[],
    signal?: AbortSignal,
    run?: Run,
  ): Promise<CodeActionSummary[]> {
    const { actions } = await this.actions(workspace, path, range, only, signal, run);
    return actions.map((action) => {
      if (typeof action.command === 'string') return { title: action.title, kind: 'command' };
      const literal = action as CodeAction;
      return {
        title: literal.title,
        kind: literal.kind,
        ...(literal.isPreferred ? { preferred: true } : {}),
        ...(literal.disabled ? { disabled: literal.disabled.reason } : {}),
      };
    });
  }

  /**
   * Resolves the code action with the given title and returns its edits without writing anything. Command-based
   * actions run on the server; edits it requests through workspace/applyEdit are captured and returned instead.
   */
  async codeActionEdits(
    workspace: Workspace,
    path: string,
    range: Range,
    title: string,
    only?: string[],
    signal?: AbortSignal,
    run?: Run,
  ): Promise<WorkspaceEdit[]> {
    const { server, config, actions } = await this.actions(
      workspace,
      path,
      range,
      only,
      signal,
      run,
    );
    const found = actions.find((action) => action.title === title);
    if (!found)
      throw new Error(
        `No code action titled "${title.slice(0, 200)}" is available. List the actions again; they depend on the current file.`,
      );
    let action: CodeAction =
      typeof found.command === 'string'
        ? { title: found.title, command: found as Command }
        : (found as CodeAction);
    if (action.disabled) throw new Error(`Code action is disabled: ${action.disabled.reason}`);
    const provider = server.capabilities.codeActionProvider;
    if (!action.edit && typeof provider === 'object' && provider.resolveProvider)
      action = await this.send<CodeAction>(server, 'codeAction/resolve', action, signal);
    const edits: WorkspaceEdit[] = action.edit ? [action.edit] : [];
    if (action.command) {
      if (server.editCapture)
        throw new Error(`${config.name} is already running another code action.`);
      server.editCapture = edits;
      try {
        await this.send(
          server,
          'workspace/executeCommand',
          { command: action.command.command, arguments: action.command.arguments },
          signal,
        );
      } finally {
        server.editCapture = undefined;
      }
    }
    if (!edits.length) throw new Error('The code action produced no edits.');
    return edits;
  }

  private async sync(
    server: LanguageConnection,
    uri: string,
    file: string,
    language: string,
  ): Promise<void> {
    if ((await stat(file)).size > 2 * 1024 * 1024)
      throw new Error('Language server file exceeds 2 MiB.');
    const text = await readFile(file, 'utf8');
    const previous = server.documents.get(canonicalUri(uri));
    const version = (previous ?? 0) + 1;
    server.documents.set(canonicalUri(uri), version);
    if (previous === undefined)
      await server.connection.sendNotification('textDocument/didOpen', {
        textDocument: { uri, languageId: language, version, text },
      });
    else
      await server.connection.sendNotification('textDocument/didChange', {
        textDocument: { uri, version },
        contentChanges: [{ text }],
      });
  }

  /**
   * Diagnostics for a just-edited file, but only from a language server that is already running, so edits never
   * trigger server setup or approval prompts. Returns undefined when no server is running or it is slow to answer.
   */
  /**
   * Diagnostics for a file the agent just wrote. Starts an installed server for its language without approval (as the
   * workspace scan does), never installs one, and gives up quietly when the server is slow or missing.
   */
  async diagnosticsAfterWrite(
    workspace: Workspace,
    path: string,
    signal?: AbortSignal,
  ): Promise<Diagnostic[] | undefined> {
    const config = this.store
      .global()
      .languageServers.find((server) => server.languages.includes(languageId(path)));
    if (!config) return undefined;
    // A cold start (tsserver, pyright) needs longer than a refresh on a running server.
    const wait = this.connections.has(`${workspace.id}:${config.id}`) ? 5_000 : 20_000;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const slow = new Promise<undefined>((resolve) => {
        timer = setTimeout(() => resolve(undefined), wait);
      });
      return await Promise.race([
        this.query(workspace, path, 'diagnostics', 0, 0, signal, undefined, true) as Promise<
          Diagnostic[]
        >,
        slow,
      ]);
    } catch {
      return undefined;
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * Collects diagnostics for every source file in the workspace that an installed language server handles. Never
   * installs servers and starts installed ones without approval. Files are queried a few at a time and capped.
   */
  async scanWorkspace(workspace: Workspace, signal?: AbortSignal): Promise<void> {
    const languages = new Set(
      (await this.discoverServers(workspace))
        .filter((server) => server.available)
        .flatMap((server) => server.languages),
    );
    if (!languages.size) return;
    const ignored = await gitIgnoredPaths(workspace).catch(() => new Set<string>());
    const files: string[] = [];
    const walk = async (directory: string): Promise<void> => {
      for (const item of await fileTree(workspace, directory)) {
        if (files.length >= 500) return;
        signal?.throwIfAborted();
        if (ignored.has(item.directory ? `${item.path}/` : item.path)) continue;
        if (item.directory) {
          if (!excludedDirectories.has(item.name.toLowerCase())) await walk(item.path);
        } else if (languages.has(languageId(item.path))) files.push(item.path);
      }
    };
    await walk('.');
    const queue = [...files];
    const worker = async () => {
      for (let path = queue.shift(); path !== undefined; path = queue.shift()) {
        signal?.throwIfAborted();
        await this.query(workspace, path, 'diagnostics', 0, 0, signal, undefined, true).catch(
          () => undefined,
        );
      }
    };
    await Promise.all(Array.from({ length: 4 }, worker));
  }

  async changed(workspace: Workspace, path: string): Promise<void> {
    const file = await safePath(workspace, path);
    const uri = pathToFileURL(file).href;
    for (const [key, server] of this.connections) {
      if (key.startsWith(`${workspace.id}:`) && server.documents.has(canonicalUri(uri)))
        await this.sync(server, uri, file, languageId(file));
    }
  }

  closeWorkspace(workspaceId: string): void {
    for (const [key, server] of this.connections) {
      if (!key.startsWith(`${workspaceId}:`)) continue;
      server.connection.dispose();
      server.process.kill();
      this.connections.delete(key);
    }
    for (const key of this.diagnostics.keys())
      if (key.startsWith(`${workspaceId}:`)) this.diagnostics.delete(key);
  }

  close(): void {
    for (const key of this.connections.keys()) this.closeWorkspace(key.split(':')[0]);
  }
}
