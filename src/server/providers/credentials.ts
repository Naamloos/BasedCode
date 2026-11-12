import { execFile } from 'node:child_process';
import { readFile, writeFile, rename } from 'node:fs/promises';
import { join } from 'node:path';
import { findExecutable } from '../runtime/processes.js';

/**
 * Provider credentials saved through the operating system: Windows DPAPI (current user) or the Linux Secret Service
 * via `secret-tool`. Without either, credentials stay in memory for the session; there is no plaintext fallback.
 * Values never enter SQLite, transcripts or terminal output.
 */
export class Credentials {
  private readonly session = new Map<string, string>();
  private readonly secretTool =
    process.platform === 'linux' ? findExecutable('secret-tool') : undefined;
  private readonly vault: string;
  private saved = new Set<string>();

  constructor(dataDirectory: string) {
    this.vault = join(dataDirectory, 'credentials.json');
  }

  get storage(): { available: boolean; detail: string } {
    if (process.platform === 'win32')
      return {
        available: true,
        detail: 'Saved encrypted with Windows DPAPI for your user account.',
      };
    if (this.secretTool)
      return {
        available: true,
        detail: 'Saved in your desktop keyring through the Secret Service (secret-tool).',
      };
    return {
      available: false,
      detail:
        'No OS credential store was found (install libsecret-tools for secret-tool). Credentials are kept in memory until you quit.',
    };
  }

  async load(): Promise<void> {
    if (process.platform === 'win32') this.saved = new Set(Object.keys(await this.readVault()));
    else if (this.secretTool) {
      const index = await this.run(this.secretTool, [
        'lookup',
        'service',
        'basedcode',
        'account',
        '__index',
      ]).catch(() => '');
      this.saved = new Set(index ? (JSON.parse(index) as string[]) : []);
    }
  }

  list(): string[] {
    return [...new Set([...this.saved, ...this.session.keys()])];
  }

  async get(id: string): Promise<string | undefined> {
    const cached = this.session.get(id);
    if (cached !== undefined || !this.saved.has(id)) return cached;
    let value: string | undefined;
    if (process.platform === 'win32') {
      const blob = (await this.readVault())[id];
      if (blob)
        value = await this.powershell(
          '[Text.Encoding]::UTF8.GetString([Security.Cryptography.ProtectedData]::Unprotect([Convert]::FromBase64String($in), $null, "CurrentUser"))',
          blob,
        );
    } else if (this.secretTool)
      value = await this.run(this.secretTool, ['lookup', 'service', 'basedcode', 'account', id]);
    if (value !== undefined) this.session.set(id, value);
    return value;
  }

  /** Saves a credential, or removes it when the value is empty. */
  async set(id: string, value: string): Promise<void> {
    if (!value) {
      await this.remove(id);
      return;
    }
    this.session.set(id, value);
    if (process.platform === 'win32') {
      const blob = await this.powershell(
        '[Convert]::ToBase64String([Security.Cryptography.ProtectedData]::Protect([Text.Encoding]::UTF8.GetBytes($in), $null, "CurrentUser"))',
        value,
      );
      await this.writeVault({ ...(await this.readVault()), [id]: blob });
    } else if (this.secretTool) {
      await this.run(
        this.secretTool,
        ['store', `--label=BasedCode provider ${id}`, 'service', 'basedcode', 'account', id],
        value,
      );
    } else return;
    this.saved.add(id);
    await this.saveIndex();
  }

  async remove(id: string): Promise<void> {
    this.session.delete(id);
    if (process.platform === 'win32') {
      const vault = await this.readVault();
      delete vault[id];
      await this.writeVault(vault);
    } else if (this.secretTool)
      await this.run(this.secretTool, ['clear', 'service', 'basedcode', 'account', id]).catch(
        () => undefined,
      );
    this.saved.delete(id);
    await this.saveIndex();
  }

  private async saveIndex(): Promise<void> {
    if (this.secretTool)
      await this.run(
        this.secretTool,
        [
          'store',
          '--label=BasedCode credential index',
          'service',
          'basedcode',
          'account',
          '__index',
        ],
        JSON.stringify([...this.saved]),
      );
  }

  private async readVault(): Promise<Record<string, string>> {
    try {
      return JSON.parse(await readFile(this.vault, 'utf8')) as Record<string, string>;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return {};
      throw error;
    }
  }

  private async writeVault(vault: Record<string, string>): Promise<void> {
    const temporary = `${this.vault}.tmp`;
    await writeFile(temporary, JSON.stringify(vault), { mode: 0o600 });
    await rename(temporary, this.vault);
  }

  /** Runs a DPAPI one-liner in Windows PowerShell (which ships ProtectedData); the secret travels on stdin. */
  private powershell(script: string, input: string): Promise<string> {
    return this.run(
      'powershell.exe',
      [
        '-NoLogo',
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        `Add-Type -AssemblyName System.Security; $in = [Console]::In.ReadToEnd(); ${script}`,
      ],
      input,
    );
  }

  private run(file: string, args: string[], input?: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const child = execFile(
        file,
        args,
        { windowsHide: true, timeout: 15_000, maxBuffer: 1_000_000 },
        (error, stdout) => {
          if (error) reject(new Error(`Credential store failed: ${error.message.split('\n')[0]}`));
          else resolve(stdout.replace(/\r?\n$/, ''));
        },
      );
      child.stdin?.end(input ?? '');
    });
  }
}
