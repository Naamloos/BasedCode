import { readFile, writeFile } from 'node:fs/promises';
import type { ProviderKind } from '../../shared/types.js';

/** LiteLLM's community price list; downloaded at launch and cached so estimates still work offline. */
export const pricesUrl =
  'https://raw.githubusercontent.com/BerriAI/litellm/main/model_prices_and_context_window.json';

interface Price {
  input: number;
  output: number;
  cacheRead?: number;
}

let prices = new Map<string, Price>();

const num = (value: unknown) =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined;

/** Keeps only priced entries; the file is untrusted data, so every field is checked. */
function parse(text: string): Map<string, Price> {
  const data: unknown = JSON.parse(text);
  const result = new Map<string, Price>();
  if (!data || typeof data !== 'object') return result;
  for (const [key, entry] of Object.entries(data as Record<string, unknown>)) {
    if (!entry || typeof entry !== 'object') continue;
    const record = entry as Record<string, unknown>;
    const input = num(record.input_cost_per_token);
    const output = num(record.output_cost_per_token);
    if (input === undefined || output === undefined) continue;
    result.set(key.toLowerCase(), {
      input,
      output,
      cacheRead: num(record.cache_read_input_token_cost),
    });
  }
  return result;
}

/** Loads the cached copy, then refreshes it from the network. Failures leave the previous table in place. */
export async function loadPrices(cachePath: string): Promise<void> {
  try {
    prices = parse(await readFile(cachePath, 'utf8'));
  } catch {
    /* No cache yet. */
  }
  try {
    const response = await fetch(pricesUrl, { signal: AbortSignal.timeout(30_000) });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const text = await response.text();
    const fresh = parse(text);
    if (!fresh.size) throw new Error('No prices in the downloaded file.');
    prices = fresh;
    await writeFile(cachePath, text, { mode: 0o600 });
  } catch (error) {
    console.error(
      'Could not refresh model prices:',
      error instanceof Error ? error.message : error,
    );
  }
}

/** Providers whose calls need a list-price estimate. */
const estimatedKinds: ProviderKind[] = ['codex', 'openai', 'antigravity'];

/**
 * Estimated USD cost of one model call at API list prices, or undefined when the model is not in the table.
 * `inputTokens` includes cached tokens, as the AI SDK reports them; reasoning tokens are already part of `outputTokens`.
 */
export function estimateCost(
  kind: ProviderKind,
  model: string,
  usage: { inputTokens: number; cachedInputTokens: number; outputTokens: number },
): number | undefined {
  if (!estimatedKinds.includes(kind)) return undefined;
  const name = kind === 'antigravity'
    ? model.trim().toLowerCase().replace(/^antigravity\//, '')
    : model.toLowerCase();
  let price = prices.get(name) ?? prices.get(`openai/${name}`);
  if (kind === 'antigravity' && !price) {
    // agy adds reasoning variants to the underlying API model ID.
    const base = name.replace(/-(low|medium|high|thinking)$/, '');
    price = prices.get(base)
      ?? prices.get(`gemini/${base}`)
      ?? prices.get(`anthropic/${base}`)
      ?? prices.get(`openai/${base}`);
  }
  if (!price) return undefined;
  const cached = Math.min(usage.cachedInputTokens, usage.inputTokens);
  return (
    (usage.inputTokens - cached) * price.input +
    cached * (price.cacheRead ?? price.input) +
    usage.outputTokens * price.output
  );
}
