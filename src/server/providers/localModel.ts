import { createOpenAI } from '@ai-sdk/openai';
import { extractReasoningMiddleware, wrapLanguageModel, type LanguageModel } from 'ai';
import { antigravity } from 'eve-antigravity';
import { reasoningOff, type ProviderConfig } from '../../shared/types.js';
import { antigravityOptions } from './cli.js';
import type { Credentials } from './credentials.js';
import { reasoningFetch, withoutReasoning } from './reasoning.js';

export async function createLocalModel(
  provider: ProviderConfig,
  credentials: Pick<Credentials, 'get'>,
  antigravityPath: string | undefined,
): Promise<LanguageModel> {
  if (!provider.model)
    throw new Error(`Choose a ${provider.kind} model with the model picker below the composer.`);
  if (provider.kind === 'antigravity') {
    const effort = provider.effort || undefined;
    if (effort !== undefined && effort !== 'low' && effort !== 'medium' && effort !== 'high')
      throw new Error('Antigravity reasoning effort must be low, medium or high.');
    return antigravity(provider.model, {
      ...antigravityOptions(antigravityPath),
      effort,
    });
  }
  const url = new URL(provider.endpoint);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password)
    throw new Error('Provider endpoint must be HTTP(S) without embedded credentials.');
  const model = createOpenAI({
    baseURL: provider.endpoint,
    apiKey: (await credentials.get(provider.id)) ?? 'local',
    fetch: provider.effort === reasoningOff ? withoutReasoning(provider.kind) : reasoningFetch,
  }).chat(provider.model);
  return wrapLanguageModel({
    model,
    middleware: extractReasoningMiddleware({ tagName: 'think', separator: '' }),
  });
}

export async function assertModelInstalled(
  provider: ProviderConfig,
  credentials: Pick<Credentials, 'get'>,
  signal: AbortSignal,
): Promise<void> {
  // Fail clearly when the configured model is not installed; the raw API answer is just "Not Found".
  const apiKey = await credentials.get(provider.id);
  const listing =
    provider.kind === 'antigravity'
      ? undefined
      : await fetch(provider.endpoint.replace(/\/$/, '') + '/models', {
          signal: AbortSignal.any([signal, AbortSignal.timeout(8000)]),
          headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : undefined,
        })
          .then((response) =>
            response.ok ? (response.json() as Promise<{ data?: { id: string }[] }>) : undefined,
          )
          .catch(() => {
            throw new Error(
              `${provider.kind} is not reachable at ${provider.endpoint}. Start it, or pick another model.`,
            );
          });
  const installed = listing?.data?.map((model) => model.id);
  if (installed && !installed.includes(provider.model))
    throw new Error(
      `Model "${provider.model}" is not installed in ${provider.kind}. Pick an installed model with the model picker.`,
    );
}
