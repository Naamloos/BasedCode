import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';

/** Well-known secret formats. Each pattern is specific enough that a match is very likely a real credential. */
const patterns: { name: string; pattern: RegExp }[] = [
  { name: 'Anthropic API key', pattern: /\bsk-ant-[A-Za-z0-9_-]{20,}/ },
  { name: 'OpenAI API key', pattern: /\bsk-(?:proj-|svcacct-)?[A-Za-z0-9_-]{32,}/ },
  { name: 'GitHub token', pattern: /\b(?:gh[pousr]_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{60,})/ },
  { name: 'GitLab token', pattern: /\bglpat-[A-Za-z0-9_-]{20,}/ },
  { name: 'AWS access key', pattern: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/ },
  { name: 'Google API key', pattern: /\bAIza[0-9A-Za-z_-]{35}\b/ },
  { name: 'Slack token', pattern: /\bxox[abprs]-[A-Za-z0-9-]{10,}/ },
  { name: 'Stripe live key', pattern: /\b[rs]k_live_[A-Za-z0-9]{20,}/ },
  { name: 'npm token', pattern: /\bnpm_[A-Za-z0-9]{36}\b/ },
  { name: 'Private key', pattern: /-----BEGIN (?:[A-Z]+ )?PRIVATE KEY-----/ },
  {
    name: 'JSON web token',
    pattern: /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/,
  },
];

/** Tool calls that send data off this machine, or run commands that can. Local file edits are not scanned. */
export function isOutboundTool(name: string): boolean {
  return (
    ['run_command', 'terminal_input', 'web_fetch', 'call_mcp', 'install', 'install_server', 'git', 'git_commit'].includes(
      name,
    ) || name.startsWith('browser')
  );
}

export interface SecretMatch {
  kind: string;
  /** The match with most of it hidden, safe to show on an approval card. */
  redacted: string;
}

export function redact(value: string): string {
  return value.length <= 8 ? '•'.repeat(value.length) : `${value.slice(0, 4)}…${value.slice(-2)}`;
}

/**
 * Likely secrets in `text`: well-known token formats, plus exact values the caller knows are secret (from `.env`
 * files or saved provider credentials).
 */
export function findSecrets(text: string, known: Iterable<{ name: string; value: string }> = []): SecretMatch[] {
  const found: SecretMatch[] = [];
  const seen = new Set<string>();
  for (const { name, pattern } of patterns) {
    const match = new RegExp(pattern.source, 'g');
    for (const hit of text.matchAll(match)) {
      if (seen.has(hit[0])) continue;
      seen.add(hit[0]);
      found.push({ kind: name, redacted: redact(hit[0]) });
    }
  }
  for (const { name, value } of known) {
    if (value.length < 8 || seen.has(value) || !text.includes(value)) continue;
    seen.add(value);
    found.push({ kind: name, redacted: redact(value) });
  }
  return found;
}

/** Values that look secret in the workspace's top-level `.env*` files (KEY, TOKEN, SECRET, PASSWORD and similar names). */
export async function envSecrets(folder: string): Promise<{ name: string; value: string }[]> {
  const secrets: { name: string; value: string }[] = [];
  const entries = await readdir(folder).catch(() => [] as string[]);
  for (const entry of entries) {
    if (!/^\.env(\..+)?$/.test(entry) || /\.(example|sample|template)$/.test(entry)) continue;
    const text = await readFile(join(folder, entry), 'utf8').catch(() => '');
    for (const line of text.split(/\r?\n/)) {
      const match = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
      if (!match || !/KEY|TOKEN|SECRET|PASSWORD|PASSWD|CREDENTIAL|PRIVATE|AUTH/i.test(match[1])) continue;
      const value = match[2].trim().replace(/^(['"])(.*)\1$/, '$2');
      if (value.length >= 8) secrets.push({ name: `${entry} ${match[1]}`, value });
    }
  }
  return secrets;
}
