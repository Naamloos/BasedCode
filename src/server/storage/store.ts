import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import type {
  Action,
  Approval,
  Attachment,
  Chat,
  Comparison,
  GlobalSettings,
  Message,
  ProviderConfig,
  ProviderLimits,
  Run,
  TerminalInfo,
  Workspace,
  WorkspaceSettings,
} from '../../shared/types.js';
import { defaultMcpRegistries } from '../../shared/types.js';

export function defaultProviders(): ProviderConfig[] {
  return [
    // No preset model: a hardcoded name is rarely installed. The composer's picker lists what is.
    {
      id: randomUUID(),
      kind: 'ollama',
      model: '',
      endpoint: 'http://127.0.0.1:11434/v1',
      enabled: true,
      requireConsent: false,
    },
    {
      id: randomUUID(),
      kind: 'lmstudio',
      model: '',
      endpoint: 'http://127.0.0.1:1234/v1',
      enabled: false,
      requireConsent: false,
    },
    {
      id: randomUUID(),
      kind: 'claude',
      model: 'sonnet',
      endpoint: '',
      enabled: false,
      requireConsent: false,
    },
    {
      id: randomUUID(),
      kind: 'codex',
      model: '',
      endpoint: '',
      enabled: false,
      requireConsent: false,
    },
  ];
}

export function defaultGlobal(): GlobalSettings {
  return {
    welcomeDismissed: false,
    providers: defaultProviders(),
    approvalMode: 'always',
    language: 'based',
    disabledTools: [],
    compaction: { enabled: true, thresholdTokens: 64_000 },
    appearance: { theme: 'based', lightTheme: 'normie', mode: 'dark', flame: 'classic' },
    keybindings: {},
    mcpServers: [],
    mcpRegistries: structuredClone(defaultMcpRegistries),
    knownMcpRegistries: defaultMcpRegistries.map((registry) => registry.id),
    languageServers: defaultLanguageServers(),
    codexPath: '',
    claudePath: '',
  };
}

function defaultLanguageServers(): GlobalSettings['languageServers'] {
  return [
    {
      id: 'typescript',
      name: 'TypeScript / JavaScript',
      languages: ['typescript', 'javascript', 'typescriptreact', 'javascriptreact'],
      command: 'typescript-language-server',
      args: ['--stdio'],
    },
    {
      id: 'vue',
      name: 'Vue',
      languages: ['vue'],
      command: 'vue-language-server',
      args: ['--stdio'],
    },
    {
      id: 'python',
      name: 'Python',
      languages: ['python'],
      command: 'pyright-langserver',
      args: ['--stdio'],
    },
    {
      id: 'json',
      name: 'JSON',
      languages: ['json', 'jsonc'],
      command: 'vscode-json-language-server',
      args: ['--stdio'],
    },
    {
      id: 'csharp',
      name: 'C# / Roslyn',
      languages: ['csharp'],
      command: 'roslyn-language-server',
      args: ['--stdio', '--autoLoadProjects'],
    },
  ];
}

export function defaultSettings(): WorkspaceSettings {
  return {
    mcpServers: [],
    checks: [],
    editor: { command: 'code', args: ['--goto', '{file}'] },
  };
}

export interface Records {
  workspace: Workspace;
  chat: Chat;
  run: Run & { reverted?: boolean };
  message: Message;
  approval: Approval;
  action: Action;
  terminal: TerminalInfo;
  global: Partial<GlobalSettings> & { id: string };
  attachment: Attachment;
  limits: ProviderLimits;
  comparison: Comparison;
}

export class Store {
  readonly db: DatabaseSync;
  /** Last write time per run (its record, messages or actions), in ms. Lets the agent notice a run that went silent. */
  readonly runActivity = new Map<string, number>();

  constructor(path: string) {
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    this.db = new DatabaseSync(path);
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA foreign_keys = ON;
      PRAGMA busy_timeout = 5000;
      CREATE TABLE IF NOT EXISTS records (
        kind TEXT NOT NULL,
        id TEXT NOT NULL,
        body TEXT NOT NULL CHECK (json_valid(body)),
        sequence INTEGER PRIMARY KEY AUTOINCREMENT,
        UNIQUE(kind, id)
      );
      CREATE INDEX IF NOT EXISTS records_kind ON records(kind);
      CREATE TABLE IF NOT EXISTS checkpoints (
        run_id TEXT PRIMARY KEY,
        before_state TEXT NOT NULL,
        after_state TEXT
      );
      CREATE TABLE IF NOT EXISTS tool_checkpoints (
        message_id TEXT PRIMARY KEY,
        run_id TEXT NOT NULL,
        state TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS restore_journal (
        id TEXT PRIMARY KEY,
        body TEXT NOT NULL
      );
      PRAGMA user_version = 1;
    `);

    for (const run of this.all('run')) {
      if (['running', 'paused', 'awaiting_approval', 'queued'].includes(run.status)) {
        this.put('run', {
          ...run,
          status: 'interrupted',
          reconnecting: undefined,
          error:
            'The backend stopped. Inspect the workspace and action outcomes before continuing.',
        });
        // Only a run that had started has partial work worth mentioning; a queued one simply never ran.
        if (run.status !== 'queued')
          this.message(
            run.chatId,
            run.id,
            'system',
            'BasedCode stopped while this prompt was running. Resume to let the agent pick up where it left off, or retry the prompt from the start.',
            { interrupted: true, error: true },
          );
      }
    }
    // Leftovers of the interrupted runs: half-streamed replies and tool calls that never reported back.
    for (const message of this.all('message')) {
      const tool = message.metadata.tool as { status?: string } | undefined;
      if (message.metadata.streaming || tool?.status === 'running')
        this.put('message', {
          ...message,
          metadata: {
            ...message.metadata,
            streaming: false,
            ...(tool?.status === 'running'
              ? { tool: { ...tool, status: 'failed', error: 'Interrupted when BasedCode stopped.' } }
              : {}),
          },
        });
    }
    for (const approval of this.all('approval')) {
      if (approval.status === 'pending') this.put('approval', { ...approval, status: 'denied' });
    }
    for (const action of this.all('action')) {
      if (action.status === 'pending') this.put('action', { ...action, status: 'unknown' });
    }
    for (const message of this.all('message')) {
      if (message.metadata.compacting)
        this.put('message', {
          ...message,
          content: 'Compaction was interrupted when the backend stopped.',
          metadata: { error: true },
        });
    }
    const migrateServers = !this.all('global')[0]?.languageServers;
    this.migrateProviders();
    this.migrateServers(migrateServers);
    this.migrateRegistries();
  }

  /** Adds default MCP registries introduced since this install last saw the list, once each. */
  private migrateRegistries(): void {
    const record = this.all('global')[0];
    if (!record?.mcpRegistries) return; // Unsaved list: the defaults apply as they are.
    // Installs from before this field knew the first two defaults.
    const known = new Set(record.knownMcpRegistries ?? ['official', 'github']);
    const fresh = defaultMcpRegistries.filter((registry) => !known.has(registry.id));
    if (!fresh.length) return;
    const registries = [...record.mcpRegistries];
    for (const registry of fresh)
      if (!registries.some((item) => item.id === registry.id) && registries.length < 20)
        registries.push(structuredClone(registry));
    this.put('global', {
      ...record,
      mcpRegistries: registries,
      knownMcpRegistries: [...known, ...fresh.map((registry) => registry.id)],
    });
  }

  all<K extends keyof Records>(kind: K): Records[K][] {
    const rows = this.db
      .prepare('SELECT body FROM records WHERE kind = ? ORDER BY sequence')
      .all(kind);
    return rows.map((row) => JSON.parse(String(row.body)) as Records[K]);
  }

  get<K extends keyof Records>(kind: K, id: string): Records[K] {
    const row = this.db.prepare('SELECT body FROM records WHERE kind = ? AND id = ?').get(kind, id);
    if (!row) throw new Error(`${kind} not found.`);
    return JSON.parse(String(row.body)) as Records[K];
  }

  put<K extends keyof Records>(kind: K, record: Records[K]): Records[K] {
    this.db
      .prepare(
        'INSERT INTO records(kind, id, body) VALUES (?, ?, ?) ON CONFLICT(kind, id) DO UPDATE SET body = excluded.body',
      )
      .run(kind, record.id, JSON.stringify(record));
    const runId = kind === 'run' ? record.id : (record as { runId?: string }).runId;
    if (runId) this.runActivity.set(runId, Date.now());
    return record;
  }

  remove<K extends keyof Records>(kind: K, id: string): void {
    this.db.prepare('DELETE FROM records WHERE kind = ? AND id = ?').run(kind, id);
  }

  private transactionDepth = 0;

  /** Runs `operation` atomically. Nested calls join the outer transaction. */
  transaction<T>(operation: () => T): T {
    if (this.transactionDepth > 0) {
      this.transactionDepth++;
      try {
        return operation();
      } finally {
        this.transactionDepth--;
      }
    }
    this.transactionDepth = 1;
    try {
      return this.outerTransaction(operation);
    } finally {
      this.transactionDepth = 0;
    }
  }

  private outerTransaction<T>(operation: () => T): T {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const result = operation();
      this.db.exec('COMMIT');
      return result;
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }

  /** App-wide settings, with defaults filled in for fields added after the record was saved. */
  global(): GlobalSettings {
    const saved: Partial<GlobalSettings> & { id?: string } = { ...this.all('global')[0] };
    delete saved.id;
    const defaults = defaultGlobal();
    return {
      ...defaults,
      ...saved,
      compaction: { ...defaults.compaction, ...saved.compaction },
      appearance: { ...defaults.appearance, ...saved.appearance },
      keybindings: { ...saved.keybindings },
    };
  }

  saveGlobal(settings: GlobalSettings): void {
    this.put('global', { id: 'app', ...settings });
  }

  /**
   * Provider connections used to live in each workspace. The first workspace's list becomes the global one, and every
   * workspace keeps its old order as its own fallback list when that list is the one adopted.
   */
  private migrateProviders(): void {
    type Legacy = WorkspaceSettings & { providers?: ProviderConfig[] };
    const workspaces = this.all('workspace') as (Workspace & { settings: Legacy })[];
    const legacy = workspaces.filter((workspace) => workspace.settings.providers);
    const hasGlobal = this.all('global')[0]?.providers;
    if (!legacy.length && hasGlobal) return;
    const global = this.global();
    if (!hasGlobal && legacy[0]?.settings.providers)
      global.providers = legacy[0].settings.providers;
    this.saveGlobal(global);
    for (const workspace of legacy) {
      const { providers, ...settings } = workspace.settings;
      const adopted = providers?.every((provider) =>
        global.providers.some((item) => item.id === provider.id),
      );
      const fallback = adopted
        ? providers?.map((provider) => ({ providerId: provider.id, enabled: provider.enabled }))
        : undefined;
      this.put('workspace', {
        ...workspace,
        settings: { ...settings, ...(fallback && workspace !== legacy[0] ? { fallback } : {}) },
      });
    }
    for (const record of this.all('global')) {
      const template = record.newWorkspace as Legacy | undefined;
      if (template?.providers) {
        delete template.providers;
        this.put('global', record);
      }
    }
  }

  private migrateServers(firstMigration: boolean): void {
    type Legacy = WorkspaceSettings & {
      mcpServers?: GlobalSettings['mcpServers'];
      languageServers?: GlobalSettings['languageServers'];
    };
    const global = this.global();
    if (firstMigration) global.languageServers = [];
    const merge = <T extends { id: string }>(target: T[], source: T[]) => {
      for (const server of source) {
        const { id, ...config } = server;
        if (
          target.some(
            (item) =>
              JSON.stringify({ ...item, id: undefined }) ===
              JSON.stringify({ ...config, id: undefined }),
          )
        )
          continue;
        target.push({ ...server, id: target.some((item) => item.id === id) ? randomUUID() : id });
      }
    };
    this.transaction(() => {
      for (const workspace of this.all('workspace')) {
        const legacy = workspace.settings as Legacy;
        const { languageServers, ...settings } = legacy;
        if (languageServers) {
          merge(global.languageServers, languageServers);
          // Old releases stored both server lists in workspace settings; migrate those MCP entries once.
          merge(global.mcpServers, legacy.mcpServers ?? []);
          this.put('workspace', { ...workspace, settings });
        }
      }
      if (global.newWorkspace) {
        const { mcpServers, languageServers, ...settings } = global.newWorkspace as Legacy;
        merge(global.mcpServers, mcpServers ?? []);
        merge(global.languageServers, languageServers ?? []);
        global.newWorkspace = settings;
      }
      if (firstMigration && !global.languageServers.length)
        global.languageServers = defaultLanguageServers();
      global.languageServers = global.languageServers.map((server) =>
        server.id === 'csharp' && server.command === 'csharp-ls' && !server.args.length
          ? {
              ...server,
              name: 'C# / Roslyn',
              command: 'roslyn-language-server',
              args: ['--stdio', '--autoLoadProjects'],
            }
          : server,
      );
      this.saveGlobal(global);
    });
  }

  /** Settings for a newly opened workspace: the saved template, or the built-in defaults. */
  newWorkspaceSettings(): WorkspaceSettings {
    const template = this.global().newWorkspace;
    return template ? structuredClone(template) : defaultSettings();
  }

  message(
    chatId: string,
    runId: string,
    role: Message['role'],
    content: string,
    metadata: Message['metadata'] = {},
  ): Message {
    return this.put('message', {
      id: randomUUID(),
      chatId,
      runId,
      role,
      content,
      metadata,
      createdAt: new Date().toISOString(),
    });
  }

  action(workspaceId: string, title: string, detail: string, run?: Run): Action {
    return this.put('action', {
      id: randomUUID(),
      workspaceId,
      title,
      detail,
      chatId: run?.chatId,
      runId: run?.id,
      status: 'pending',
      reverted: false,
      createdAt: new Date().toISOString(),
    });
  }
}
