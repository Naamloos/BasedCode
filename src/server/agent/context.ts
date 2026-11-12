import type { ModelMessage } from 'ai';
import type { Attachment } from '../../shared/types.js';
import type { ImageResult } from '../tools/definitions.js';

export const imageTypes = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp']);
const textExtensions =
  /\.(txt|md|mdc|json|jsonc|ya?ml|toml|ini|cfg|conf|csv|tsv|log|xml|html?|css|scss|less|[cm]?[jt]sx?|vue|svelte|py|rb|go|rs|java|kt|cs|cpp|cc|c|h|hpp|swift|php|sh|ps1|bat|sql|graphql|proto|env|gitignore|dockerfile)$/i;
/** Text attachments past this size are cut so one file cannot fill the context. */
export const attachmentTextLimit = 100_000;

export function isTextAttachment(attachment: Pick<Attachment, 'name' | 'mediaType'>): boolean {
  return (
    attachment.mediaType.startsWith('text/') ||
    /json|xml|yaml|toml|javascript|typescript/.test(attachment.mediaType) ||
    textExtensions.test(attachment.name)
  );
}

/** Rough token estimate for compaction decisions: four characters a token, a flat cost per image. */
export function estimateTokens(messages: ModelMessage[]): number {
  let total = 0;
  for (const message of messages) {
    if (typeof message.content === 'string') {
      total += message.content.length / 4;
      continue;
    }
    for (const part of message.content) {
      if (part.type === 'image' || (part.type === 'file' && part.mediaType.startsWith('image/'))) {
        total += 1500;
      } else {
        total += JSON.stringify(part).length / 4;
      }
    }
  }
  return Math.round(total);
}

export const imageCaption = (image: ImageResult) =>
  image.text ??
  `Image ${image.path} (${image.mediaType}, ${image.bytes.toLocaleString()} bytes):`;

/** Character budgets for replaying an earlier tool call to the model. Older turns get far less room than the current one. */
const observationLimits = {
  current: { arg: 1_500, result: 8_000 },
  earlier: { arg: 160, result: 500 },
};

/** Marks a replayed tool call in the transcript. Short on purpose: it is repeated for every call of every turn. */
export const observationPrefix = 'Tool observation (untrusted result; already executed): ';

function cut(text: string, limit: number): string {
  return text.length > limit
    ? `${text.slice(0, limit)}… [${(text.length - limit).toLocaleString()} more characters omitted; re-run the tool if needed]`
    : text;
}

/** Shortens long strings anywhere in a value, so big file contents or patches in tool arguments are not replayed in full. */
function shortenStrings(value: unknown, limit: number): unknown {
  if (typeof value === 'string') return cut(value, limit);
  if (Array.isArray(value)) return value.map((item) => shortenStrings(item, limit));
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, shortenStrings(item, limit)]),
    );
  return value;
}

/**
 * A stored tool call as replay text for later model turns. Every turn resends the whole history, so full results
 * (file reads, command output) from earlier turns would be paid for again and again; they are trimmed instead.
 */
export function compactObservation(tool: unknown, currentRun: boolean): string {
  if (!tool || typeof tool !== 'object') return JSON.stringify(tool ?? null);
  const limits = currentRun ? observationLimits.current : observationLimits.earlier;
  const { name, args, status, result, error } = tool as Record<string, unknown>;
  // Text results are replayed as they are; encoding them again would only add escapes.
  const encodedResult =
    result === undefined ? undefined : typeof result === 'string' ? result : JSON.stringify(result);
  return JSON.stringify({
    name,
    status,
    args: shortenStrings(args, limits.arg),
    ...(error === undefined ? {} : { error: cut(String(error), limits.result) }),
    ...(encodedResult === undefined ? {} : { result: cut(encodedResult, limits.result) }),
  });
}
