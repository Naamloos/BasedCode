// The standalone JavaScript project needs the ambient NW.js declaration explicitly loaded.
// eslint-disable-next-line @typescript-eslint/triple-slash-reference
/// <reference path="./nw.d.ts" />
import { fork } from 'node:child_process';
import { existsSync } from 'node:fs';
import {
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rename,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const workerFile = fileURLToPath(import.meta.url);
const idleTimeout = 45_000;
const setupTimeout = 10 * 60_000;

async function fileSize(path) {
  try {
    return (await stat(path)).size;
  } catch (error) {
    if (error.code === 'ENOENT') return 0;
    throw error;
  }
}

export async function ensureRuntime(version, signal, flavor = 'normal') {
  if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error('Invalid NW.js runtime version.');
  const platform = { win32: 'win', linux: 'linux', darwin: 'osx' }[process.platform];
  if (!platform || !['x64', 'arm64', 'ia32'].includes(process.arch))
    throw new Error(`Unsupported desktop platform: ${process.platform}/${process.arch}`);
  const cacheDir = resolve(
    process.platform === 'win32'
      ? join(process.env.LOCALAPPDATA ?? homedir(), 'BasedCode', 'runtime')
      : join(process.env.XDG_CACHE_HOME ?? join(homedir(), '.cache'), 'BasedCode', 'runtime'),
  );
  const folderName = `nwjs${flavor === 'sdk' ? '-sdk' : ''}-v${version}-${platform}-${process.arch}`;
  const binaryName =
    platform === 'win' ? 'nw.exe' : platform === 'osx' ? 'nwjs.app/Contents/MacOS/nwjs' : 'nw';
  const installed = join(cacheDir, folderName);
  const executable = join(installed, binaryName);
  const marker = join(installed, '.basedcode-ready');
  if (existsSync(executable) && existsSync(marker)) return executable;
  await mkdir(cacheDir, { recursive: true, mode: 0o700 });
  const staging = await mkdtemp(join(cacheDir, '.install-'));
  const stagingRelative = relative(cacheDir, staging);
  if (
    isAbsolute(stagingRelative) ||
    stagingRelative.startsWith('..') ||
    !stagingRelative.startsWith('.install-')
  )
    throw new Error('Runtime staging directory escapes its cache.');
  const archiveName = `${folderName}.${platform === 'linux' ? 'tar.gz' : 'zip'}`;
  const archive = join(staging, archiveName);
  const checksum = join(staging, 'shasum', `${version}.txt`);
  const cachedManifest = join(cacheDir, 'manifest.json');
  let child;
  let timer;
  let cancelled = false;
  const cancel = () => {
    cancelled = true;
    child?.kill();
  };
  signal.addEventListener('abort', cancel, { once: true });
  let stage = 'Contacting nwjs.io for the runtime manifest';

  try {
    signal.throwIfAborted();
    // Reuse cached bytes, but verify and extract them before marking the runtime ready.
    if (existsSync(join(cacheDir, archiveName)))
      await copyFile(join(cacheDir, archiveName), archive);
    if (existsSync(join(cacheDir, 'shasum', `${version}.txt`))) {
      await mkdir(dirname(checksum), { recursive: true });
      await copyFile(join(cacheDir, 'shasum', `${version}.txt`), checksum);
    }
    let manifestUrl = 'https://nwjs.io/versions.json';
    if (existsSync(cachedManifest)) {
      try {
        JSON.parse(await readFile(cachedManifest, 'utf8'));
        manifestUrl = pathToFileURL(cachedManifest).href;
      } catch {
        /* Fetch a fresh manifest when a previous attempt left invalid JSON. */
      }
    }
    const options = {
      version,
      platform,
      arch: process.arch,
      flavor,
      downloadUrl: 'https://dl.nwjs.io',
      manifestUrl,
      cacheDir: staging,
      cache: true,
      ffmpeg: false,
      nativeAddon: false,
      shaSum: true,
    };
    console.info(
      `Setting up NW.js ${version}. First setup may take a few minutes; Ctrl+C cancels.`,
    );
    child = fork(workerFile, ['--download', JSON.stringify(options)], {
      stdio: ['ignore', 'inherit', 'inherit', 'ipc'],
      windowsHide: true,
    });
    if (signal.aborted) cancel();
    const started = Date.now();
    let lastProgress = started;
    let lastSignature = '';
    let observing = false;
    let timeoutError;
    const observe = async () => {
      if (observing) return;
      observing = true;
      try {
        const bytes = await fileSize(archive);
        const manifestBytes = await fileSize(join(staging, 'manifest.json'));
        const checksumBytes = await fileSize(checksum);
        let extracted = 0;
        let count = 0;
        try {
          const files = await readdir(join(staging, folderName), { withFileTypes: true });
          count = files.length;
          for (const file of files)
            if (file.isFile()) extracted += await fileSize(join(staging, folderName, file.name));
        } catch (error) {
          if (error.code !== 'ENOENT') throw error;
        }
        stage = count
          ? `Extracting runtime · ${(extracted / 1048576).toFixed(1)} MiB written`
          : checksumBytes
            ? 'Verifying the cached archive checksum'
            : bytes
              ? `Downloading archive from dl.nwjs.io · ${(bytes / 1048576).toFixed(1)} MiB received`
              : manifestBytes
                ? 'Connecting to dl.nwjs.io for the archive'
                : 'Contacting nwjs.io for the runtime manifest';
        const signature = `${bytes}:${manifestBytes}:${checksumBytes}:${count}:${extracted}`;
        if (signature !== lastSignature) {
          lastProgress = Date.now();
          lastSignature = signature;
        }
        const elapsed = Math.round((Date.now() - started) / 1000);
        console.info(`  ${stage} (${elapsed}s elapsed)`);
        if (Date.now() - lastProgress > idleTimeout || Date.now() - started > setupTimeout) {
          timeoutError = new Error(
            `NW.js setup timed out: ${stage}. No progress for ${Math.round((Date.now() - lastProgress) / 1000)}s. Check access to nwjs.io and dl.nwjs.io, then retry. The app backend has not started.`,
          );
          child.kill();
        }
      } catch (error) {
        timeoutError = error;
        child.kill();
      } finally {
        observing = false;
      }
    };
    timer = setInterval(() => {
      void observe();
    }, 2000);
    await new Promise((resolveDownload, reject) => {
      child.once('error', reject);
      child.once('close', (code) => {
        if (cancelled) reject(new Error('NW.js setup cancelled.'));
        else if (timeoutError) reject(timeoutError);
        else if (code !== 0)
          reject(
            new Error(`NW.js installer exited with code ${code}. See the download error above.`),
          );
        else resolveDownload();
      });
    });
    clearInterval(timer);
    signal.throwIfAborted();
    if (!existsSync(join(staging, folderName, binaryName)))
      throw new Error('NW.js setup finished without the expected executable.');
    await writeFile(join(staging, folderName, '.basedcode-ready'), version);
    // Both paths are fixed children of the validated cache; never remove the cache itself.
    const installRelative = relative(cacheDir, installed);
    if (installRelative !== folderName)
      throw new Error('Runtime installation directory escapes its cache.');
    await rm(installed, { recursive: true, force: true });
    await rename(join(staging, folderName), installed);
    await rename(archive, join(cacheDir, archiveName));
    await copyFile(join(staging, 'manifest.json'), cachedManifest);
    await mkdir(join(cacheDir, 'shasum'), { recursive: true });
    await copyFile(checksum, join(cacheDir, 'shasum', `${version}.txt`));
    console.info('NW.js runtime is ready. Starting BasedCode…');
    return executable;
  } finally {
    clearInterval(timer);
    signal.removeEventListener('abort', cancel);
    await rm(staging, { recursive: true, force: true });
  }
}

if (process.argv[2] === '--download') {
  const { get } = await import('nw');
  try {
    await get(JSON.parse(process.argv[3]));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
