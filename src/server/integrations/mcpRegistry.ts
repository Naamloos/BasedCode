import { randomUUID } from 'node:crypto';
import type {
  McpInstallField,
  McpInstallOption,
  McpRegistry,
  McpRegistryServer,
  ServerConfig,
} from '../../shared/types.js';

/**
 * Client for the official MCP Registry API (v0.1) and compatible registries such as GitHub's.
 * Registry metadata is untrusted input: it is normalized into install options here, and the user confirms every
 * value before anything runs. Nothing from the registry is executed until the server is started with approval.
 */

interface RegistryInput {
  name?: string;
  description?: string;
  isRequired?: boolean;
  isSecret?: boolean;
  default?: string;
  value?: string;
  valueHint?: string;
  choices?: string[];
  type?: 'positional' | 'named';
  variables?: Record<string, RegistryInput>;
}

interface RegistryPackage {
  registryType?: string;
  registryBaseUrl?: string;
  identifier?: string;
  version?: string;
  runtimeHint?: string;
  transport?: { type?: string; url?: string };
  runtimeArguments?: RegistryInput[];
  packageArguments?: RegistryInput[];
  environmentVariables?: RegistryInput[];
}

interface RegistryRemote {
  type?: string;
  url?: string;
  headers?: RegistryInput[];
  variables?: Record<string, RegistryInput>;
}

interface RegistryServerJson {
  name: string;
  title?: string;
  description?: string;
  version?: string;
  repository?: { url?: string };
  websiteUrl?: string;
  icons?: { src?: string }[];
  packages?: RegistryPackage[];
  remotes?: RegistryRemote[];
  _meta?: Record<string, unknown>;
}

interface RegistryList {
  servers?: { server: RegistryServerJson; _meta?: Record<string, unknown> }[];
  metadata?: { nextCursor?: string };
}

const runtimes: Record<string, { command: string; requirement: string }> = {
  npm: { command: 'npx', requirement: 'Node.js (npx)' },
  pypi: { command: 'uvx', requirement: 'Python with uv (uvx)' },
  oci: { command: 'docker', requirement: 'Docker' },
  nuget: { command: 'dnx', requirement: '.NET 10 SDK (dnx)' },
};

async function getJson<T>(url: string, signal?: AbortSignal): Promise<T> {
  const response = await fetch(url, {
    headers: { Accept: 'application/json', 'User-Agent': 'BasedCode' },
    signal: signal ?? AbortSignal.timeout(20_000),
  });
  if (!response.ok) throw new Error(`Registry request failed (${response.status}).`);
  const length = Number(response.headers.get('content-length') ?? 0);
  if (length > 20_000_000) throw new Error('Registry response is too large.');
  return (await response.json()) as T;
}

const pageSize = 30;

/** An MCP Central catalog entry: registry package data with its own field names around it. */
interface McpCentralServer {
  name?: string;
  title?: string | null;
  description?: string | null;
  version?: string | null;
  homepage?: string | null;
  icon_url?: string | null;
  repository?: { url?: string } | null;
  packages?: RegistryPackage[] | null;
  remotes?: RegistryRemote[] | null;
  status?: string;
}

function fromMcpCentral(entry: McpCentralServer): RegistryServerJson {
  return {
    name: entry.name ?? '',
    title: entry.title ?? undefined,
    description: entry.description ?? undefined,
    version: entry.version ?? undefined,
    websiteUrl: entry.homepage ?? undefined,
    repository: entry.repository ?? undefined,
    icons: entry.icon_url ? [{ src: entry.icon_url }] : undefined,
    packages: entry.packages ?? undefined,
    remotes: entry.remotes ?? undefined,
  };
}

/** A Truespar catalog entry: endpoints found in the wild, remote only, without versions. */
interface TruesparServer {
  key?: string;
  name?: string;
  description?: string | null;
  homepage?: string | null;
  repoUrl?: string | null;
  remoteEndpoints?: { transport?: string; url?: string }[] | null;
}

function fromTruespar(entry: TruesparServer): RegistryServerJson {
  return {
    // The key is the stable identifier; the name is a display title and is not unique.
    name: entry.key ?? '',
    title: entry.name ?? undefined,
    description: entry.description ?? undefined,
    version: 'latest',
    websiteUrl: entry.homepage ?? undefined,
    repository: entry.repoUrl ? { url: entry.repoUrl } : undefined,
    remotes: (entry.remoteEndpoints ?? []).map((endpoint) => ({
      type: endpoint.transport,
      url: endpoint.url,
    })),
  };
}

function base(registry: McpRegistry) {
  return registry.url.replace(/\/$/, '');
}

function listed(servers: RegistryServerJson[]): McpRegistryServer[] {
  return servers.filter((server) => server.name).map(normalize);
}

export async function searchRegistry(
  registry: McpRegistry,
  search: string,
  cursor?: string,
): Promise<{ servers: McpRegistryServer[]; nextCursor?: string }> {
  if (registry.format === 'mcpcentral') {
    const query = new URLSearchParams({ limit: String(pageSize) });
    if (search.trim()) query.set('search', search.trim());
    if (cursor) query.set('cursor', cursor);
    const list = await getJson<{ servers?: McpCentralServer[]; next_cursor?: string | null }>(
      `${base(registry)}/servers?${query}`,
    );
    const entries = (list.servers ?? []).filter((entry) => entry?.status !== 'deleted');
    return { servers: listed(entries.map(fromMcpCentral)), nextCursor: list.next_cursor ?? undefined };
  }
  if (registry.format === 'truespar') {
    // Offset paging; the cursor carries the next offset.
    const offset = cursor && /^\d+$/.test(cursor) ? Number(cursor) : 0;
    const query = new URLSearchParams({ limit: String(pageSize), offset: String(offset) });
    if (search.trim()) query.set('q', search.trim());
    const list = await getJson<{ results?: TruesparServer[]; total?: number }>(
      `${base(registry)}/servers?${query}`,
    );
    const results = list.results ?? [];
    const next = offset + results.length;
    return {
      servers: listed(results.map(fromTruespar)),
      nextCursor: results.length && next < (list.total ?? 0) ? String(next) : undefined,
    };
  }
  const query = new URLSearchParams({ version: 'latest' });
  if (search.trim()) query.set('search', search.trim());
  // GitHub's registry rejects a cursor sent with a limit ("Invalid cursor parameter", 400): its cursor
  // already carries the page size. Later pages therefore send only the cursor.
  if (cursor) query.set('cursor', cursor);
  else query.set('limit', String(pageSize));
  const list = await getJson<RegistryList>(`${base(registry)}/servers?${query}`);
  const servers = (list.servers ?? [])
    .filter((entry) => entry?.server?.name && !isDeleted(entry._meta))
    .map((entry) => normalize(entry.server));
  return { servers, nextCursor: list.metadata?.nextCursor };
}

/** Fetches one exact version again, so installs use registry data rather than what the UI sent back. */
export async function fetchServer(
  registry: McpRegistry,
  name: string,
  version: string,
): Promise<RegistryServerJson> {
  // These catalogs only serve the current entry, so the version check below is what pins it.
  if (registry.format === 'mcpcentral' || registry.format === 'truespar') {
    const entry = await getJson<{ server?: McpCentralServer & TruesparServer }>(
      `${base(registry)}/servers/${encodeURIComponent(name)}`,
    );
    if (!entry.server) throw new Error('Registry returned no server.');
    const server =
      registry.format === 'truespar' ? fromTruespar(entry.server) : fromMcpCentral(entry.server);
    if (server.name !== name) throw new Error('Registry returned a different server.');
    if (registry.format === 'mcpcentral' && server.version !== version)
      throw new Error('This server has a newer version in the registry. Search again to install it.');
    return server;
  }
  const entry = await getJson<{ server: RegistryServerJson }>(
    `${base(registry)}/servers/${encodeURIComponent(name)}/versions/${encodeURIComponent(version)}`,
  );
  if (!entry.server?.name) throw new Error('Registry returned no server.');
  return entry.server;
}

function isDeleted(meta?: Record<string, unknown>): boolean {
  const official = meta?.['io.modelcontextprotocol.registry/official'] as
    { status?: string } | undefined;
  return official?.status === 'deleted';
}

function text(value: unknown, max = 2000): string {
  return typeof value === 'string' ? value.slice(0, max) : '';
}

export function normalize(server: RegistryServerJson): McpRegistryServer {
  const github = (
    server._meta?.['io.modelcontextprotocol.registry/publisher-provided'] as
      { github?: { displayName?: string; ownerAvatarUrl?: string } } | undefined
  )?.github;
  const icon =
    server.icons?.find((item) => item.src?.startsWith('https://'))?.src ?? github?.ownerAvatarUrl;
  return {
    name: text(server.name, 300),
    title: text(server.title ?? github?.displayName, 200) || undefined,
    description: text(server.description),
    version: text(server.version, 100),
    repository: httpsUrl(server.repository?.url),
    website: httpsUrl(server.websiteUrl),
    icon: httpsUrl(icon),
    options: installOptions(server),
  };
}

function httpsUrl(value: unknown): string | undefined {
  return typeof value === 'string' && value.startsWith('https://')
    ? value.slice(0, 1000)
    : undefined;
}

/** `{name}` placeholders in a string. */
function placeholders(value: string): string[] {
  return [...value.matchAll(/\{([A-Za-z0-9_.-]+)\}/g)].map((match) => match[1]!);
}

function field(
  key: string,
  label: string,
  input: RegistryInput | undefined,
  secret = false,
): McpInstallField {
  return {
    key,
    label,
    description: text(input?.description) || undefined,
    required: Boolean(input?.isRequired),
    secret: secret || Boolean(input?.isSecret),
    default: text(input?.default, 4000) || undefined,
    choices: input?.choices?.filter((choice) => typeof choice === 'string').slice(0, 50),
  };
}

/** Fields for an argument list: arguments without a fixed value, and placeholders inside fixed values. */
function argumentFields(prefix: string, inputs: RegistryInput[] = []): McpInstallField[] {
  const fields: McpInstallField[] = [];
  inputs.forEach((input, index) => {
    const label = input.name ?? input.valueHint ?? `Argument ${index + 1}`;
    if (input.value === undefined) fields.push(field(`${prefix}${index}`, label, input));
    for (const name of placeholders(input.value ?? ''))
      fields.push(field(`${prefix}${index}.${name}`, name, input.variables?.[name] ?? input));
  });
  return fields;
}

export function installOptions(server: RegistryServerJson): McpInstallOption[] {
  const options: McpInstallOption[] = [];
  (server.packages ?? []).forEach((pkg, index) => {
    const type = pkg.registryType ?? 'unknown';
    const transport =
      pkg.transport?.type === 'streamable-http'
        ? 'http'
        : pkg.transport?.type === 'sse'
          ? 'sse'
          : 'stdio';
    if (transport !== 'stdio') return; // A package serving HTTP needs a separate start step; not offered.
    const runtime = runtimes[type];
    if (!runtime && !pkg.runtimeHint) return;
    options.push({
      id: `package:${index}`,
      kind: 'package',
      transport: 'stdio',
      label: `${type} · ${text(pkg.identifier, 300)}${pkg.version ? `@${text(pkg.version, 100)}` : ''}`,
      requirement: runtime?.requirement ?? pkg.runtimeHint,
      fields: [
        ...(pkg.environmentVariables ?? [])
          .map((input) => field(`env.${input.name ?? ''}`, input.name ?? '', input))
          .filter((item) => item.label),
        ...argumentFields('runtimeArg.', pkg.runtimeArguments),
        ...argumentFields('packageArg.', pkg.packageArguments),
      ],
    });
  });
  (server.remotes ?? []).forEach((remote, index) => {
    if (!remote.url || !/^https?:\/\//.test(remote.url)) return;
    const transport = remote.type === 'sse' ? 'sse' : 'http';
    options.push({
      id: `remote:${index}`,
      kind: 'remote',
      transport,
      label: `${transport === 'sse' ? 'SSE' : 'Streamable HTTP'} · ${text(remote.url, 500)}`,
      fields: [
        ...placeholders(remote.url).map((name) =>
          field(`url.${name}`, name, remote.variables?.[name]),
        ),
        ...(remote.headers ?? []).flatMap((header) => {
          const name = header.name ?? '';
          if (!name) return [];
          const inside = placeholders(header.value ?? '');
          if (header.value !== undefined && !inside.length) return [];
          if (!inside.length) return [field(`header.${name}`, name, header, header.isSecret)];
          return inside.map((variable) =>
            field(
              `header.${name}.${variable}`,
              variable,
              header.variables?.[variable] ?? header,
              header.isSecret,
            ),
          );
        }),
      ],
    });
  });
  return options;
}

function fill(template: string, values: Record<string, string>, prefix: string): string {
  return template.replace(
    /\{([A-Za-z0-9_.-]+)\}/g,
    (match, name: string) => values[`${prefix}${name}`] ?? match,
  );
}

function argumentsFrom(
  inputs: RegistryInput[] = [],
  prefix: string,
  values: Record<string, string>,
): string[] {
  const args: string[] = [];
  inputs.forEach((input, index) => {
    const key = `${prefix}${index}`;
    const value =
      input.value !== undefined
        ? fill(input.value, values, `${key}.`)
        : (values[key] ?? input.default ?? '');
    if (input.type === 'named') {
      if (!input.name) return;
      if (input.value === undefined && !value) return;
      args.push(input.name);
      if (value) args.push(value);
    } else if (value) args.push(value);
  });
  return args;
}

export interface BuiltServer {
  config: ServerConfig;
  /** Secret values by credential name ('env.NAME' / 'header.NAME'), stored outside settings. */
  secrets: Record<string, string>;
}

/** Turns a registry server, one install option and the user's values into a harness-owned server config. */
export function buildServer(
  registryId: string,
  server: RegistryServerJson,
  optionId: string,
  values: Record<string, string>,
): BuiltServer {
  const option = installOptions(server).find((item) => item.id === optionId);
  if (!option) throw new Error('This install option is not offered by the registry entry.');
  for (const item of option.fields)
    if (item.required && !(values[item.key] ?? item.default))
      throw new Error(`${item.label} is required.`);
  const secretKeys = new Set(option.fields.filter((item) => item.secret).map((item) => item.key));
  const resolved: Record<string, string> = {};
  for (const item of option.fields) {
    const value = values[item.key] ?? item.default;
    if (value) resolved[item.key] = String(value).slice(0, 4000);
  }
  const normalized = normalize(server);
  const config: ServerConfig = {
    id: randomUUID(),
    name: normalized.title ?? server.name.split('/').pop() ?? server.name,
    description: normalized.description || undefined,
    transport: option.transport,
    enabled: true,
    registry: { registryId, name: server.name, version: normalized.version },
  };
  const secrets: Record<string, string> = {};
  const [kind, index] = option.id.split(':') as ['package' | 'remote', string];
  if (kind === 'package') {
    const pkg = server.packages![Number(index)]!;
    const identifier = pkg.identifier ?? '';
    if (!/^[A-Za-z0-9@][A-Za-z0-9@/._:+-]*$/.test(identifier))
      throw new Error('Registry package identifier is not valid.');
    const version = pkg.version && /^[A-Za-z0-9._+-]+$/.test(pkg.version) ? pkg.version : undefined;
    const runtimeArgs = argumentsFrom(pkg.runtimeArguments, 'runtimeArg.', resolved);
    const packageArgs = argumentsFrom(pkg.packageArguments, 'packageArg.', resolved);
    const env: Record<string, string> = {};
    const secretEnv: string[] = [];
    for (const input of pkg.environmentVariables ?? []) {
      const name = input.name;
      if (!name || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) continue;
      const value = resolved[`env.${name}`];
      if (!value) continue;
      if (secretKeys.has(`env.${name}`)) {
        secrets[`env.${name}`] = value;
        secretEnv.push(name);
      } else env[name] = value;
    }
    const type = pkg.registryType ?? '';
    let command = pkg.runtimeHint || runtimes[type]?.command || '';
    let args: string[];
    if (type === 'oci') {
      command = pkg.runtimeHint || 'docker';
      const passEnv = [...Object.keys(env), ...secretEnv].flatMap((name) => ['-e', name]);
      args = [
        ...(runtimeArgs.length ? runtimeArgs : ['run', '-i', '--rm']),
        ...passEnv,
        version && !identifier.includes(':') ? `${identifier}:${version}` : identifier,
        ...packageArgs,
      ];
    } else {
      const spec =
        type === 'pypi'
          ? version
            ? `${identifier}==${version}`
            : identifier
          : version
            ? `${identifier}@${version}`
            : identifier;
      const defaults = type === 'npm' ? ['-y'] : type === 'nuget' ? ['--yes'] : [];
      args = [...(runtimeArgs.length ? runtimeArgs : defaults), spec, ...packageArgs];
    }
    Object.assign(config, {
      command,
      args,
      env: Object.keys(env).length ? env : undefined,
      secretEnv: secretEnv.length ? secretEnv : undefined,
    });
  } else {
    const remote = server.remotes![Number(index)]!;
    const url = new URL(fill(remote.url!, resolved, 'url.'));
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password)
      throw new Error('Remote URL must be HTTP(S) without embedded credentials.');
    if (/\{[^}]+\}/.test(decodeURI(url.href)))
      throw new Error('Remote URL still has unfilled values.');
    const headers: Record<string, string> = {};
    const secretHeaders: string[] = [];
    for (const header of remote.headers ?? []) {
      const name = header.name;
      if (!name || !/^[A-Za-z0-9-]+$/.test(name)) continue;
      const value =
        header.value !== undefined
          ? fill(header.value, resolved, `header.${name}.`)
          : resolved[`header.${name}`];
      if (!value || /\{[^}]+\}/.test(value)) continue;
      if (header.isSecret || [...secretKeys].some((key) => key.startsWith(`header.${name}`))) {
        secrets[`header.${name}`] = value;
        secretHeaders.push(name);
      } else headers[name] = value;
    }
    Object.assign(config, {
      url: url.href,
      headers: Object.keys(headers).length ? headers : undefined,
      secretHeaders: secretHeaders.length ? secretHeaders : undefined,
      auth: 'none',
    });
  }
  return { config, secrets };
}

/**
 * Whether a remote MCP endpoint asks for OAuth: a 401 to an unauthenticated initialize request that points at
 * protected-resource metadata (or any 401 when the entry declared no auth headers).
 */
export async function probeOAuth(url: string): Promise<boolean> {
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          protocolVersion: '2025-06-18',
          capabilities: {},
          clientInfo: { name: 'BasedCode', version: '0.1.0' },
        },
      }),
      redirect: 'error',
      signal: AbortSignal.timeout(8_000),
    });
    await response.body?.cancel().catch(() => undefined);
    return response.status === 401;
  } catch {
    return false;
  }
}
