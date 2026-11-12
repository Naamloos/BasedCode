import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';

/**
 * A private CODEX_HOME for BasedCode runs, so the user's ~/.codex/config.toml, global AGENTS.md, rules, plugins,
 * skills and hooks never load. Only auth.json is copied in. If Codex refreshes the token during a run, the new
 * token is written back, but only when the user's own copy has not changed since BasedCode copied it.
 */
export class CodexHome {
  constructor(
    readonly directory: string,
    private readonly source = process.env.CODEX_HOME || join(homedir(), '.codex'),
  ) {}

  /** Prepares the private home. Returns undefined when there is no auth.json to copy (keyring or API-key auth). */
  async prepare(
    config: string,
  ): Promise<{ home: string; finish: () => Promise<void> } | undefined> {
    const sourceAuth = join(this.source, 'auth.json');
    const original = await readFile(sourceAuth).catch((error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') return undefined;
      throw error;
    });
    if (!original) return undefined;
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    // Anything Codex would treat as user-level instructions or extensions must not exist here.
    for (const name of [
      'AGENTS.md',
      'AGENTS.override.md',
      'rules',
      'plugins',
      'skills',
      'hooks',
      'prompts',
    ]) {
      await rm(join(this.directory, name), { recursive: true, force: true });
    }
    await atomicWrite(join(this.directory, 'config.toml'), config);
    const auth = join(this.directory, 'auth.json');
    await atomicWrite(auth, original);
    const digest = hash(original);
    return {
      home: this.directory,
      finish: async () => {
        const after = await readFile(auth).catch(() => undefined);
        if (!after || hash(after) === digest) return;
        const current = await readFile(sourceAuth).catch(() => undefined);
        if (current && hash(current) === digest) await atomicWrite(sourceAuth, after);
      },
    };
  }
}

function hash(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex');
}

async function atomicWrite(path: string, content: string | Buffer): Promise<void> {
  const temporary = `${path}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, content, { mode: 0o600 });
    await rename(temporary, path);
  } finally {
    await rm(temporary, { force: true });
  }
}

/** Config for the private home: every feature that gives Codex a path around BasedCode tools, switched off. */
export function codexConfig(disabledFeatures: string[]): string {
  return `# Written by BasedCode for its own Codex runs. Edits are overwritten.\nweb_search = "disabled"\ninclude_apply_patch_tool = false\n\n[features]\n${disabledFeatures.map((name) => `${name} = false`).join('\n')}\n`;
}
