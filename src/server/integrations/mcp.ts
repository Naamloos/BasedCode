import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { UnauthorizedError } from '@modelcontextprotocol/sdk/client/auth.js';
import {
  ListRootsRequestSchema,
  type CallToolResult,
  type Tool,
} from '@modelcontextprotocol/sdk/types.js';
import { pathToFileURL } from 'node:url';
import type { McpServerStatus, Run, ServerConfig, Workspace } from '../../shared/types.js';
import type { Credentials } from '../providers/credentials.js';
import { McpOAuth, mcpSecretKey, mcpSecretPrefix } from './mcpAuth.js';
import { Permissions } from '../workspace/permissions.js';
import { Processes } from '../runtime/processes.js';
import { Store } from '../storage/store.js';

interface Connection {
  client: Client;
  fingerprint: string;
}

export class McpConnections {
  private readonly connections = new Map<string, Connection>();
  private readonly connecting = new Map<string, Promise<Client>>();

  constructor(
    private readonly permissions: Permissions,
    private readonly processes: Processes,
    private readonly store: Store,
    private readonly credentials: Credentials,
    readonly oauth: McpOAuth,
  ) {}

  /** Enabled servers an agent may use in this workspace: workspace-only ones first, then app-wide ones. */
  list(workspace: Workspace): ServerConfig[] {
    return [...(workspace.settings.mcpServers ?? []), ...this.store.global().mcpServers].filter(
      (server) => server.enabled !== false,
    );
  }

  async status(servers: ServerConfig[]): Promise<Record<string, McpServerStatus>> {
    const saved = this.credentials.list();
    const result: Record<string, McpServerStatus> = {};
    for (const server of servers) {
      const prefix = mcpSecretPrefix(server.id);
      result[server.id] = {
        savedSecrets: saved
          .filter((key) => key.startsWith(prefix))
          .map((key) => key.slice(prefix.length)),
        signedIn: server.auth === 'oauth' ? await this.oauth.signedIn(server.id) : false,
      };
    }
    return result;
  }

  /** Removes stored secrets and sign-ins of servers that are no longer configured anywhere. */
  async forgetRemoved(): Promise<void> {
    const ids = new Set([
      ...this.store.global().mcpServers.map((server) => server.id),
      ...this.store
        .all('workspace')
        .flatMap((workspace) => (workspace.settings.mcpServers ?? []).map((server) => server.id)),
    ]);
    for (const key of this.credentials.list()) {
      const match = /^mcp:([^:]+):/.exec(key);
      if (match && !ids.has(match[1]!)) await this.credentials.remove(key);
    }
  }

  private async secretValues(server: ServerConfig, kind: 'env' | 'header', names: string[] = []) {
    const values: Record<string, string> = {};
    for (const name of names) {
      const value = await this.credentials.get(mcpSecretKey(server.id, `${kind}.${name}`));
      if (value) values[name] = value;
    }
    return values;
  }

  private key(workspace: Workspace, server: ServerConfig): string {
    return `${workspace.id}:${server.id}`;
  }

  async connect(
    workspace: Workspace,
    server: ServerConfig,
    signal?: AbortSignal,
    run?: Run,
  ): Promise<Client> {
    const key = this.key(workspace, server);
    const existing = this.connections.get(key);
    if (existing?.fingerprint === JSON.stringify(server)) return existing.client;
    const pending = this.connecting.get(key);
    if (pending) return pending;

    const connection = (async () => {
      if (existing) {
        await existing.client.close();
        this.connections.delete(key);
      }
      await this.permissions.ask(
        workspace.id,
        `Connect MCP: ${server.name} (${server.id})`,
        server.transport !== 'stdio'
          ? `Connect to ${server.url}. This remote service can perform effects outside your local workspace. Its individual tool calls require approval.`
          : `Start ${server.command} ${(server.args ?? []).join(' ')} in ${workspace.path}. ${this.processes.sandbox.detail} This server may execute project code.`,
        signal,
        run,
      );
      const client = new Client(
        { name: 'BasedCode', version: '0.1.0' },
        {
          capabilities: {
            roots: { listChanged: false },
            extensions: {
              'io.modelcontextprotocol/ui': {
                mimeTypes: ['text/html;profile=mcp-app'],
              },
            },
            experimental: {
              'io.modelcontextprotocol/ui': {
                mimeTypes: ['text/html;profile=mcp-app'],
              },
            },
          },
        },
      );
      client.setRequestHandler(ListRootsRequestSchema, async () => ({
        roots: [{ uri: pathToFileURL(workspace.path).href, name: workspace.name }],
      }));
      let transport;
      if (server.transport !== 'stdio') {
        const url = new URL(server.url ?? '');
        if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password)
          throw new Error('MCP requires an HTTP(S) URL without embedded credentials.');
        const headers = {
          ...server.headers,
          ...(await this.secretValues(server, 'header', server.secretHeaders)),
        };
        const options = {
          requestInit: { headers },
          authProvider: server.auth === 'oauth' ? this.oauth.provider(server) : undefined,
        };
        transport =
          server.transport === 'sse'
            ? new SSEClientTransport(url, options)
            : new StreamableHTTPClientTransport(url, options);
      } else {
        if (!server.command) throw new Error('MCP command is required.');
        // Registry packages are fetched by their runtime (npx, uvx, docker) on first start.
        const profile = this.processes.launchProfile(
          workspace,
          server.command,
          server.args ?? [],
          Boolean(server.registry),
        );
        transport = new StdioClientTransport({
          command: profile.file,
          args: profile.args,
          env: {
            ...profile.env,
            ...server.env,
            ...(await this.secretValues(server, 'env', server.secretEnv)),
          },
          cwd: workspace.path,
          stderr: 'pipe',
        });
      }
      try {
        await client.connect(transport, { signal, timeout: 20_000 });
      } catch (error) {
        await transport.close().catch(() => undefined);
        if (
          error instanceof UnauthorizedError ||
          (server.auth !== 'oauth' && /\b401\b/.test(String(error)))
        )
          throw new Error(
            server.auth === 'oauth'
              ? `${server.name} needs you to sign in. Open App settings › MCP and choose Sign in.`
              : `${server.name} rejected the connection (401). It may need an API key or OAuth sign-in in App settings › MCP.`,
          );
        throw error;
      }
      this.connections.set(key, {
        client,
        fingerprint: JSON.stringify(server),
      });
      return client;
    })();
    this.connecting.set(key, connection);
    try {
      return await connection;
    } finally {
      this.connecting.delete(key);
    }
  }

  server(workspace: Workspace, id: string): ServerConfig {
    const scoped = workspace.settings.mcpServers ?? [];
    const server =
      scoped.find((item) => item.id === id) ??
      this.store.global().mcpServers.find((item) => item.id === id);
    if (!server) throw new Error('MCP server is not configured in App settings.');
    if (server.enabled === false)
      throw new Error(`MCP server ${server.name} is disabled in App settings.`);
    return server;
  }

  async discover(
    workspace: Workspace,
    id: string,
    signal?: AbortSignal,
    run?: Run,
  ): Promise<{ tools: Tool[]; resources: unknown[]; prompts: unknown[] }> {
    const server = this.server(workspace, id);
    const client = await this.connect(workspace, server, signal, run);
    const tools: Tool[] = [];
    const capabilities = client.getServerCapabilities();
    let cursor: string | undefined;
    if (capabilities?.tools) {
      do {
        const result = await client.listTools({ cursor }, { signal, timeout: 20_000 });
        tools.push(...result.tools);
        cursor = result.nextCursor;
        if (tools.length > 500) throw new Error('MCP tool catalog exceeds 500 entries.');
      } while (cursor);
    }
    const resources = capabilities?.resources ? (await client.listResources()).resources : [];
    const prompts = capabilities?.prompts ? (await client.listPrompts()).prompts : [];
    return { tools, resources, prompts };
  }

  async call(
    workspace: Workspace,
    id: string,
    name: string,
    args: Record<string, unknown>,
    signal?: AbortSignal,
    run?: Run,
    fromApp = false,
  ): Promise<{
    result: CallToolResult;
    app?: { serverId: string; html: string };
  }> {
    const server = this.server(workspace, id);
    const client = await this.connect(workspace, server, signal, run);
    const catalog = await this.discover(workspace, id, signal, run);
    const tool = catalog.tools.find((item) => item.name === name);
    if (!tool) throw new Error('Tool is not exposed by this MCP server.');
    const uiMetadata = tool._meta?.ui;
    if (
      fromApp &&
      typeof uiMetadata === 'object' &&
      uiMetadata &&
      'visibility' in uiMetadata &&
      Array.isArray(uiMetadata.visibility) &&
      !uiMetadata.visibility.includes('app')
    ) {
      throw new Error('This tool is not exposed to embedded apps.');
    }
    await this.permissions.ask(
      workspace.id,
      `MCP tool: ${server.name} (${server.id}) / ${name}`,
      `${JSON.stringify(args, null, 2)}\nThis tool may affect external systems. Its effects may remain after prompt revert.`,
      signal,
      run,
    );
    const action = this.store.action(
      workspace.id,
      `${server.name}: ${name}`,
      JSON.stringify(args),
      run,
    );
    try {
      const result = (await client.callTool({ name, arguments: args }, undefined, {
        signal,
        timeout: 120_000,
      })) as CallToolResult;
      this.store.put('action', {
        ...action,
        status: result.isError ? 'failed' : 'completed',
      });
      const ui = tool._meta?.ui;
      const resourceUri =
        typeof ui === 'object' && ui && 'resourceUri' in ui ? ui.resourceUri : undefined;
      let app: { serverId: string; html: string } | undefined;
      if (typeof resourceUri === 'string' && resourceUri.startsWith('ui://')) {
        try {
          const resource = await client.readResource({ uri: resourceUri });
          const content = resource.contents.find((item) => item.mimeType?.startsWith('text/html'));
          if (content) {
            const html =
              'text' in content
                ? content.text
                : Buffer.from(content.blob, 'base64').toString('utf8');
            if (html.length < 10_000_000) app = { serverId: id, html };
          }
        } catch (error) {
          console.error(`Failed to load MCP app ${resourceUri}:`, error);
        }
      }
      return { result, app };
    } catch (error) {
      this.store.put('action', {
        ...action,
        status: 'unknown',
        detail: `${action.detail}\nNo confirmed result: ${error instanceof Error ? error.message : String(error)}`,
      });
      throw error;
    }
  }

  async resource(
    workspace: Workspace,
    id: string,
    uri: string,
    signal?: AbortSignal,
    run?: Run,
  ): Promise<unknown> {
    const server = this.server(workspace, id);
    const client = await this.connect(workspace, server, signal, run);
    await this.permissions.ask(workspace.id, 'Read MCP resource', `${id}: ${uri}`, signal, run);
    return client.readResource({ uri });
  }

  async prompt(
    workspace: Workspace,
    id: string,
    name: string,
    args: Record<string, string>,
    signal?: AbortSignal,
    run?: Run,
  ): Promise<unknown> {
    const server = this.server(workspace, id);
    const client = await this.connect(workspace, server, signal, run);
    return client.getPrompt({ name, arguments: args });
  }

  async closeWorkspace(workspaceId: string): Promise<void> {
    for (const [key, connection] of this.connections) {
      if (!key.startsWith(`${workspaceId}:`)) continue;
      this.connections.delete(key);
      await connection.client.close();
    }
  }

  async close(): Promise<void> {
    await Promise.all(
      [...this.connections.values()].map((connection) => connection.client.close()),
    );
    this.connections.clear();
  }
}
