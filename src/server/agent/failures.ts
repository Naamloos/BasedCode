export class QuotaError extends Error {}

// Subscription CLIs report exhaustion as text, not as a structured API error.
export const usageLimitText =
  /usage limit|usage_limit|quota|insufficient_quota|purchase more credits|limit reached|out of extra usage/i;
export const contextOverflowText =
  /context (length|window)|maximum context|too many tokens|prompt is too long|context_length_exceeded|contextWindowExceeded/i;
/** Connection drops, timeouts and overload notices that are worth retrying. */
const transientText =
  /fetch failed|socket hang up|network error|ECONNRESET|ECONNREFUSED|ETIMEDOUT|EAI_AGAIN|EPIPE|UND_ERR_|overloaded|temporarily unavailable|server_error|rate.?limit(ed)?\b(?! reached)|too many requests|stream (was )?(closed|ended|interrupted)|connection (reset|closed|lost)/i;
const transientCodes = new Set([
  'ECONNRESET',
  'ECONNREFUSED',
  'ETIMEDOUT',
  'EAI_AGAIN',
  'EPIPE',
  'ENETUNREACH',
  'EHOSTUNREACH',
  'UND_ERR_SOCKET',
  'UND_ERR_CONNECT_TIMEOUT',
  'UND_ERR_HEADERS_TIMEOUT',
  'UND_ERR_BODY_TIMEOUT',
]);
const transientStatus = new Set([408, 409, 425, 429, 500, 502, 503, 504, 529]);

interface Failure {
  statusCode?: number;
  responseBody?: string;
  responseHeaders?: Record<string, string>;
  code?: string;
  cause?: unknown;
  message?: string;
}

function quotaBody(body?: string): boolean {
  if (!body) return false;
  try {
    const parsed = JSON.parse(body) as { error?: { code?: string; type?: string } };
    return ['insufficient_quota', 'quota_exceeded', 'usage_limit_reached'].includes(
      parsed.error?.code ?? parsed.error?.type ?? '',
    );
  } catch {
    /* Non-JSON errors do not establish quota exhaustion. */
    return false;
  }
}

/**
 * Sorts a provider failure. Usage exhaustion is checked first anywhere in the cause chain, so a 429 that means
 * "out of quota" is never retried; only a rate limit or connection problem is.
 */
export function failureKind(error: unknown): 'quota' | 'transient' | 'other' {
  const chain: Failure[] = [];
  for (let item = error, depth = 0; item && typeof item === 'object' && depth < 8; depth++) {
    if (item instanceof QuotaError) return 'quota';
    chain.push(item as Failure);
    item = (item as Failure).cause;
  }
  for (const failure of chain) {
    if (failure.message && usageLimitText.test(failure.message)) return 'quota';
    if (quotaBody(failure.responseBody)) return 'quota';
    if (failure.responseBody && usageLimitText.test(failure.responseBody)) return 'quota';
  }
  for (const failure of chain) {
    if (failure.statusCode && transientStatus.has(failure.statusCode)) return 'transient';
    if (failure.code && transientCodes.has(failure.code)) return 'transient';
    if (failure.message && transientText.test(failure.message)) return 'transient';
  }
  return 'other';
}

/** Milliseconds a provider asked us to wait (Retry-After), when it said. */
export function retryAfterMs(error: unknown): number | undefined {
  for (let item = error, depth = 0; item && typeof item === 'object' && depth < 8; depth++) {
    const headers = (item as Failure).responseHeaders;
    const value = headers?.['retry-after'] ?? headers?.['Retry-After'];
    if (value) {
      const seconds = Number(value);
      if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
      const date = Date.parse(value);
      if (Number.isFinite(date)) return Math.max(0, date - Date.now());
    }
    item = (item as Failure).cause;
  }
  return undefined;
}

/** Backoff for retry number `attempt` (0-based): 2s, 4s, 8s, 16s, 30s, with jitter, or the provider's Retry-After. */
export function retryDelayMs(attempt: number, error?: unknown): number {
  const asked = retryAfterMs(error);
  if (asked !== undefined) return Math.min(asked, 120_000);
  const base = Math.min(30_000, 2000 * 2 ** attempt);
  return Math.round(base * (0.8 + Math.random() * 0.4));
}

export const maxTransientRetries = 5;
