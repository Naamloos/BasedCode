import type { GlobalSettings, ModelInfo, ProviderConfig } from '../../shared/types.js';
import { antigravityOptions, cliPath } from './cli.js';
import { antigravityContextWindow, listAntigravityModels } from 'eve-antigravity';

function checkedUrl(base: string, path: string): URL {
  const url = new URL(base.replace(/\/$/, '') + path);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password)
    throw new Error('Invalid provider URL.');
  return url;
}

async function getJson<T>(url: URL, timeout: number, apiKey?: string): Promise<T> {
  let response: Response;
  try {
    response = await fetch(url, {
      signal: AbortSignal.timeout(timeout),
      headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : undefined,
    });
  } catch {
    throw new Error(`Not reachable at ${url.origin}. Is it running?`);
  }
  if (!response.ok) throw new Error(`Model discovery failed (${response.status}).`);
  return response.json() as Promise<T>;
}

/** Chat-capable model IDs from an OpenAI-compatible /models listing. */
export async function discoverModels(
  endpoint: string,
  apiKey?: string,
  timeout = 8000,
): Promise<string[]> {
  const body = await getJson<{ data?: { id: string }[] }>(
    checkedUrl(endpoint, '/models'),
    timeout,
    apiKey,
  );
  // Embedding models cannot chat; leave them out.
  return (body.data?.map((model) => model.id) ?? []).filter((model) => !/embed/i.test(model));
}

// Ollama and LM Studio serve the OpenAI-compatible API under /v1; their native APIs, which describe models, sit at the root.
const nativeBase = (endpoint: string) => endpoint.replace(/\/v1\/?$/, '');

async function ollama(endpoint: string, timeout: number): Promise<ModelInfo[]> {
  const base = nativeBase(endpoint);
  const tags = await getJson<{
    models?: {
      name: string;
      size?: number;
      details?: { parameter_size?: string; quantization_level?: string; context_length?: number };
      capabilities?: string[];
    }[];
  }>(checkedUrl(base, '/api/tags'), timeout);
  const running = await getJson<{ models?: { name: string }[] }>(
    checkedUrl(base, '/api/ps'),
    timeout,
  ).catch(() => ({ models: [] }));
  const loaded = new Set(running.models?.map((model) => model.name));
  return (tags.models ?? [])
    .filter((model) => !model.capabilities || model.capabilities.includes('completion'))
    .map((model) => ({
      id: model.name,
      parameters: model.details?.parameter_size,
      quantization: model.details?.quantization_level,
      sizeBytes: model.size,
      contextLength: model.details?.context_length,
      loaded: loaded.has(model.name),
      tools: model.capabilities ? model.capabilities.includes('tools') : undefined,
      thinking: model.capabilities?.includes('thinking'),
      vision: model.capabilities?.includes('vision'),
    }));
}

async function lmStudio(endpoint: string, timeout: number): Promise<ModelInfo[]> {
  const body = await getJson<{
    data?: {
      id: string;
      type?: string;
      quantization?: string;
      state?: string;
      max_context_length?: number;
      capabilities?: string[];
    }[];
  }>(checkedUrl(nativeBase(endpoint), '/api/v0/models'), timeout);
  return (body.data ?? [])
    .filter((model) => model.type !== 'embeddings')
    .map((model) => ({
      id: model.id,
      quantization: model.quantization,
      contextLength: model.max_context_length,
      loaded: model.state === 'loaded',
      tools: model.capabilities?.includes('tool_use') ?? false,
      vision: model.type === 'vlm',
    }));
}

// CLI model lists cost a process start, and change rarely; keep them briefly.
const cliCache = new Map<string, { models: ModelInfo[]; expires: number }>();

async function cached(key: string, load: () => Promise<ModelInfo[]>): Promise<ModelInfo[]> {
  const hit = cliCache.get(key);
  if (hit && hit.expires > Date.now()) return hit.models;
  const models = await load();
  cliCache.set(key, { models, expires: Date.now() + 10 * 60_000 });
  return models;
}

// "ultra" adds automatic task delegation, which runs sub-agents that BasedCode disables; offering it would only fail runs.
const usableEffort = (effort: string | undefined): effort is string =>
  Boolean(effort) && effort !== 'ultra';

/** Models the signed-in Codex account can use, from the Codex app-server `model/list`. */
async function codex(codexPath: string): Promise<ModelInfo[]> {
  const { listModels } = await import('ai-sdk-provider-codex-cli');
  // The package's default floor tracks its newest tested CLI; model/list itself is older than that.
  const result = await listModels({
    codexPath: cliPath('codex', codexPath),
    minCodexVersion: '0.150.0',
    requestTimeoutMs: 15_000,
  }).catch((error: unknown) => {
    throw new Error(
      `Codex model list failed: ${error instanceof Error ? error.message : String(error)}. Is the Codex CLI installed and signed in?`,
    );
  });
  const listed: ModelInfo[] = result.models.map((model) => {
    const raw = model as Record<string, unknown>;
    const efforts = Array.isArray(raw.supportedReasoningEfforts)
      ? raw.supportedReasoningEfforts
          .map((item) =>
            typeof item === 'string'
              ? item
              : (item as { reasoningEffort?: string }).reasoningEffort,
          )
          .filter(usableEffort)
      : undefined;
    return {
      id: typeof raw.model === 'string' ? raw.model : model.id,
      name: (typeof raw.displayName === 'string' ? raw.displayName : model.name) ?? undefined,
      description: model.description ?? undefined,
      tools: true,
      thinking: Boolean(efforts?.length),
      efforts,
      defaultEffort:
        typeof raw.defaultReasoningEffort === 'string' ? raw.defaultReasoningEffort : undefined,
      isDefault: Boolean(model.isDefault),
    };
  });
  return listed;
}

/** Models the signed-in Claude Code account can use, asked from an idle Agent SDK session that never sends a prompt. */
async function claude(claudePath: string): Promise<ModelInfo[]> {
  const { query } = await import('@anthropic-ai/claude-agent-sdk');
  // A streaming prompt that never yields keeps the session open without sending anything to the model.
  const idle: AsyncIterable<never> = {
    [Symbol.asyncIterator]: () => ({ next: () => new Promise<never>(() => undefined) }),
  };
  const session = query({
    prompt: idle,
    options: {
      tools: [],
      settingSources: [],
      plugins: [],
      persistSession: false,
      pathToClaudeCodeExecutable: cliPath('claude', claudePath),
    },
  });
  try {
    const models = await Promise.race([
      session.supportedModels(),
      new Promise<never>((_, reject) =>
        setTimeout(
          () =>
            reject(
              new Error('Claude Code did not answer within 20 s. Is it installed and signed in?'),
            ),
          20_000,
        ),
      ),
    ]);
    const listed: ModelInfo[] = models.map((model) => ({
      id: model.value,
      name: model.displayName,
      description: model.description,
      tools: true,
      thinking: Boolean(model.supportsAdaptiveThinking || model.supportsEffort),
      efforts: model.supportedEffortLevels,
      isDefault: model.value === 'default',
    }));
    return listed;
  } finally {
    session.close();
  }
}

/** Models a provider offers, with whatever details its API reports. Falls back to the plain OpenAI listing. */
export async function catalog(
  provider: ProviderConfig,
  global: GlobalSettings,
  timeout = 2500,
  refresh = false,
  apiKey?: string,
): Promise<ModelInfo[]> {
  if (provider.kind === 'antigravity') {
    const options = antigravityOptions(global.antigravityPath);
    const key = `antigravity:${options.agyPath}:${options.agyArgs?.join(':')}:${options.runtimeDir}`;
    if (refresh) cliCache.delete(key);
    return cached(key, async () =>
      (await listAntigravityModels(options)).map((id) => ({
        id,
        contextLength: antigravityContextWindow(id),
        tools: true,
        vision: false,
        thinking: true,
        efforts: ['low', 'medium', 'high'],
      })),
    );
  }
  if (provider.kind === 'codex' || provider.kind === 'claude') {
    const path = provider.kind === 'codex' ? global.codexPath : global.claudePath;
    const key = `${provider.kind}:${path}`;
    if (refresh) cliCache.delete(key);
    return cached(key, () => (provider.kind === 'codex' ? codex(path) : claude(path)));
  }
  // A generic OpenAI-compatible service has no native API to describe its models, and may not list them at all.
  if (provider.kind === 'openai') {
    return (await discoverModels(provider.endpoint, apiKey, timeout).catch(() => ['default'])).map(
      (id) => ({ id, isDefault: id === 'default' || undefined }),
    );
  }
  try {
    return provider.kind === 'ollama'
      ? await ollama(provider.endpoint, timeout)
      : await lmStudio(provider.endpoint, timeout);
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('Not reachable')) throw error;
    return (await discoverModels(provider.endpoint, apiKey, timeout)).map((id) => ({ id }));
  }
}
