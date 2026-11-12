import { execFile } from 'node:child_process';
import { createWriteStream } from 'node:fs';
import { mkdir, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

const repository = 'Naamloos/BasedCode';
const assetPattern = /^BasedCode-Setup-.+\.exe$/i;

export interface UpdateInfo {
  /** False in source checkouts and on platforms without an installer: the updater stays hidden. */
  supported: boolean;
  current: string;
  latest?: string;
  available: boolean;
  notesUrl?: string;
  error?: string;
}

interface Release {
  tag_name: string;
  html_url: string;
  draft: boolean;
  prerelease: boolean;
  assets: { name: string; size: number; browser_download_url: string }[];
}

/**
 * Compares dotted numeric versions ("1.10.0" > "1.9.2"). A pre-release suffix sorts before its release,
 * and two pre-releases of the same version compare by suffix ("alpha-2" > "alpha-1").
 */
export function newerVersion(candidate: string, current: string): boolean {
  const parse = (value: string) => {
    const clean = value.trim().replace(/^v/, '');
    const dash = clean.indexOf('-');
    const core = dash < 0 ? clean : clean.slice(0, dash);
    const pre = dash < 0 ? '' : clean.slice(dash + 1);
    return { parts: core.split('.').map((part) => Number(part) || 0), pre };
  };
  const a = parse(candidate);
  const b = parse(current);
  for (let index = 0; index < Math.max(a.parts.length, b.parts.length); index++) {
    const difference = (a.parts[index] ?? 0) - (b.parts[index] ?? 0);
    if (difference) return difference > 0;
  }
  if (a.pre && b.pre) return a.pre.localeCompare(b.pre, 'en', { numeric: true }) > 0;
  return Boolean(b.pre) && !a.pre;
}

/** Checks GitHub releases for a newer Windows installer and runs it on request. */
export class Updates {
  private release?: Release;
  private installing = false;
  readonly supported = process.platform === 'win32' && process.env.BASEDCODE_PACKAGED === '1';

  constructor(private readonly onQuit: () => void) {}

  async current(): Promise<string> {
    const manifest = JSON.parse(await readFile(resolve('package.json'), 'utf8')) as {
      version: string;
    };
    return manifest.version;
  }

  async check(): Promise<UpdateInfo> {
    const current = await this.current();
    if (!this.supported) return { supported: false, current, available: false };
    try {
      const response = await fetch(`https://api.github.com/repos/${repository}/releases/latest`, {
        headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'BasedCode-Updater' },
        signal: AbortSignal.timeout(15_000),
      });
      // 404 means no published release yet (or the repository is private): not an error worth showing.
      if (response.status === 404) {
        this.release = undefined;
        return { supported: true, current, available: false };
      }
      let release: Release;
      if (response.status === 403 || response.status === 429) {
        await response.body?.cancel();
        // Public release pages remain available when the unauthenticated API is rate limited.
        const page = await fetch(
          `https://github.com/${repository}/releases/latest`,
          {
            signal: AbortSignal.timeout(15_000),
          },
        );
        await page.body?.cancel();
        if (!page.ok) throw new Error(`GitHub answered ${page.status}.`);
        const location = new URL(page.url);
        const tag = decodeURIComponent(
          location.pathname.split('/').at(-1) ?? '',
        );
        if (
          location.origin !== 'https://github.com' ||
          location.pathname !==
            `/${repository}/releases/tag/${encodeURIComponent(tag)}` ||
          !/^v?\d+\.\d+\.\d+$/.test(tag)
        )
          throw new Error('GitHub did not return a stable release.');
        const name = `BasedCode-Setup-${tag.replace(/^v/, '')}.exe`;
        const downloadUrl = `https://github.com/${repository}/releases/download/${encodeURIComponent(tag)}/${name}`;
        const asset = await fetch(downloadUrl, {
          method: 'HEAD',
          signal: AbortSignal.timeout(15_000),
        });
        if (!asset.ok && asset.status !== 404)
          throw new Error(`GitHub answered ${asset.status}.`);
        release = {
          tag_name: tag,
          html_url: page.url,
          draft: false,
          prerelease: false,
          assets: asset.ok
            ? [
                {
                  name,
                  size: Number(asset.headers.get('content-length')) || 0,
                  browser_download_url: downloadUrl,
                },
              ]
            : [],
        };
      } else {
        if (!response.ok)
          throw new Error(`GitHub answered ${response.status}.`);
        release = (await response.json()) as Release;
      }
      const latest = release.tag_name.replace(/^v/, '');
      const hasAsset = release.assets.some((asset) => assetPattern.test(asset.name));
      this.release = release;
      return {
        supported: true,
        current,
        latest,
        available: hasAsset && newerVersion(latest, current),
        notesUrl: release.html_url,
      };
    } catch (error) {
      return {
        supported: true,
        current,
        available: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Downloads the installer and starts it silently, then quits so it can replace the app files.
   * The app lives in Program Files, so the installer needs elevation: it is started through the shell
   * (Start-Process), which shows the Windows UAC prompt. A plain spawn fails with EACCES instead.
   */
  async install(): Promise<void> {
    if (!this.supported) throw new Error('Updates are only available in the installed Windows app.');
    if (this.installing) return;
    if (!this.release) await this.check();
    const asset = this.release?.assets.find((candidate) => assetPattern.test(candidate.name));
    if (!asset) throw new Error('The latest release has no Windows installer.');
    const url = new URL(asset.browser_download_url);
    if (url.protocol !== 'https:' || url.hostname !== 'github.com')
      throw new Error('Unexpected installer download location.');
    this.installing = true;
    try {
      const folder = join(tmpdir(), 'basedcode-update');
      await rm(folder, { recursive: true, force: true });
      await mkdir(folder, { recursive: true });
      const installer = join(folder, asset.name);
      const response = await fetch(url, { headers: { 'User-Agent': 'BasedCode-Updater' } });
      if (!response.ok || !response.body) throw new Error(`Download failed (${response.status}).`);
      await pipeline(
        Readable.fromWeb(response.body as import('node:stream/web').ReadableStream),
        createWriteStream(installer),
      );
      const { size } = await stat(installer);
      if (asset.size && size !== asset.size)
        throw new Error('The installer download was incomplete. Try again.');
      // /RELAUNCH=1 makes the installer wait for this app to exit and reopen it when done.
      const args = ['/SILENT', '/SUPPRESSMSGBOXES', '/NORESTART', '/RELAUNCH=1'];
      const installDir = process.env.BASEDCODE_INSTALL_DIR?.replace(/[\\/]+$/, '');
      if (installDir && !installDir.includes('"')) args.push(`/DIR="${installDir}"`);
      // Paths travel in environment variables so nothing needs escaping inside the PowerShell command.
      await new Promise<void>((done, fail) =>
        execFile(
          'powershell.exe',
          [
            '-NoProfile',
            '-NonInteractive',
            '-Command',
            "$ErrorActionPreference = 'Stop'; " +
              'Start-Process -FilePath $env:BASEDCODE_UPDATE_INSTALLER -ArgumentList $env:BASEDCODE_UPDATE_ARGS',
          ],
          {
            windowsHide: true,
            env: {
              ...process.env,
              BASEDCODE_UPDATE_INSTALLER: installer,
              BASEDCODE_UPDATE_ARGS: args.join(' '),
            },
          },
          (error) =>
            error
              ? fail(new Error('The update was cancelled or Windows could not start the installer.'))
              : done(),
        ),
      );
      // The installer is running (the UAC prompt was accepted): shut down so its files are free to replace.
      setTimeout(this.onQuit, 500);
    } catch (error) {
      this.installing = false;
      throw error;
    }
  }
}
