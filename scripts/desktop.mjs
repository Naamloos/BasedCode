import { fork, spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, openSync, writeSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { ensureRuntime } from './runtime.mjs';

const require = createRequire(import.meta.url);
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
process.chdir(root);
if (Number(process.versions.node.split('.')[0]) < 24)
  throw new Error('BasedCode requires Node.js 24 or newer.');
const development = process.argv.includes('--dev');
if (!development && !existsSync(join(root, 'dist/ui/index.html')))
  throw new Error('Run npm run build before npm start, or use npm run dev.');
// Keep the Chromium profile inside the BasedCode data folder. Without this NW.js creates a second
// folder named after desktop/package.json ("basedcode-desktop") next to it in LocalAppData.
const dataRoot = resolve(
  process.env.BASEDCODE_DATA_DIR ??
    (process.platform === 'win32'
      ? join(process.env.LOCALAPPDATA ?? homedir(), 'BasedCode')
      : join(process.env.XDG_DATA_HOME ?? join(homedir(), '.local', 'share'), 'basedcode')),
);
// The installed app has no console (BasedCode.exe is windowless), so its output goes to a log file
// in the data folder; otherwise a failed start leaves nothing to look at.
const packaged = process.env.BASEDCODE_PACKAGED === '1';
let output = 'inherit';
if (packaged) {
  try {
    mkdirSync(dataRoot, { recursive: true });
    output = openSync(join(dataRoot, 'basedcode.log'), 'w');
  } catch {
    output = 'ignore';
  }
}
function report(message) {
  if (typeof output === 'number') writeSync(output, `${message}
`);
  else if (output === 'inherit') console.error(message);
}
const token = randomBytes(32).toString('hex');
const startup = new AbortController();
let backend;
let vite;
let desktop;
let closing = false;

async function cleanup() {
  if (closing) return;
  closing = true;
  startup.abort();
  if (backend?.connected) backend.send('shutdown');
  const force = setTimeout(() => {
    backend?.kill();
    desktop?.kill();
  }, 6000);
  force.unref();
  await vite?.close();
}

process.on('SIGINT', () => {
  desktop?.kill();
  void cleanup();
});
process.on('SIGTERM', () => {
  desktop?.kill();
  void cleanup();
});

try {
  // Installed builds ship their own NW.js runtime next to the app; source checkouts download it on first run.
  let executable = process.env.BASEDCODE_NW_RUNTIME;
  if (!executable) {
    const nwDirectory = resolve(dirname(require.resolve('nw')), '..');
    const manifest = JSON.parse(await readFile(join(nwDirectory, 'package.json'), 'utf8'));
    executable = await ensureRuntime(manifest.version, startup.signal, development ? 'sdk' : 'normal');
  }
  startup.signal.throwIfAborted();
  // The dev UI port lives in vite.config.ts; start Vite first so the backend trusts whatever origin it resolved.
  let uiOrigin = '';
  if (development) {
    const { createServer } = await import('vite');
    vite = await createServer();
    await vite.listen();
    uiOrigin = new URL(vite.resolvedUrls.local[0]).origin;
  }
  backend = fork(join(root, 'src/server/server.ts'), [], {
    execArgv: ['--import', 'tsx'],
    env: {
      ...process.env,
      BASEDCODE_AUTH: token,
      BASEDCODE_UI_ORIGIN: uiOrigin,
      BASEDCODE_NPM_CLI: process.env.npm_execpath ?? '',
    },
    stdio: ['ignore', output, output, 'ipc'],
    windowsHide: true,
  });
  const origin = await new Promise((resolveOrigin, reject) => {
    const timeout = setTimeout(() => reject(new Error('Backend startup timed out.')), 20_000);
    backend.once('error', reject);
    backend.once('exit', (code) => reject(new Error(`Backend exited during startup (${code}).`)));
    backend.on('message', (message) => {
      if (message?.type === 'ready') {
        clearTimeout(timeout);
        resolveOrigin(message.origin);
      }
    });
  });
  // No windowsHide here: on Windows it passes SW_HIDE, which NW.js applies to its main window, so the app never appears.
  const profile = join(dataRoot, development ? 'nw-profile-dev' : 'nw-profile');
  desktop = spawn(executable, [`--user-data-dir=${profile}`, join(root, 'desktop')], {
    stdio: ['ignore', output, output],
    env: {
      ...process.env,
      BASEDCODE_AUTH: token,
      BASEDCODE_API: origin,
      BASEDCODE_UI: uiOrigin || origin,
      BASEDCODE_DEV: development ? '1' : '0',
    },
  });
  desktop.on('error', (error) => {
    report(error.message);
    void cleanup();
  });
  desktop.on('exit', () => {
    void cleanup();
  });
  backend.on('exit', () => {
    desktop?.kill();
    void vite?.close();
  });
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  report(message);
  await cleanup();
  // Nobody sees a log file unprompted: tell the user why the installed app did not open.
  if (packaged && process.platform === 'win32')
    spawn(
      'powershell.exe',
      [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        'Add-Type -AssemblyName System.Windows.Forms;' +
          "[void][System.Windows.Forms.MessageBox]::Show($env:BASEDCODE_START_ERROR,'BasedCode','OK','Error')",
      ],
      {
        detached: true,
        stdio: 'ignore',
        windowsHide: true,
        env: {
          ...process.env,
          BASEDCODE_START_ERROR: `BasedCode could not start:
${message}

Details: ${join(dataRoot, 'basedcode.log')}`,
        },
      },
    ).unref();
  process.exitCode = 1;
}
