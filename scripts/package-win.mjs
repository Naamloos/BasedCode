// Builds the Windows installer: stages the app, a production node_modules, the Node.js and NW.js
// runtimes and the BasedCode.exe launcher in release/stage, then compiles release/BasedCode-Setup-<version>.exe
// with Inno Setup. Run `npm ci && npm run build` first. Requires Inno Setup 6 (preinstalled on GitHub runners).
import { execFileSync } from 'node:child_process';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { cp, mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ensureRuntime } from './runtime.mjs';
import { widgetLibraries } from '../src/server/tools/widgetLibraries.ts';

if (process.platform !== 'win32') throw new Error('The Windows installer can only be built on Windows.');
const require = createRequire(import.meta.url);
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const release = join(root, 'release');
const stage = join(release, 'stage');
const app = join(stage, 'app');
const run = (file, args, options = {}) =>
  execFileSync(file, args, { stdio: 'inherit', cwd: root, ...options });

const { version } = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
if (!existsSync(join(root, 'dist/ui/index.html'))) throw new Error('Run npm run build first.');

console.info(`Packaging BasedCode ${version} for Windows ${process.arch}…`);
await rm(release, { recursive: true, force: true });
await mkdir(app, { recursive: true });

// App sources. The backend runs through tsx, so TypeScript sources ship as-is.
for (const entry of [
  'src/server',
  'src/shared',
  'scripts',
  'desktop',
  'dist',
  'package.json',
  'package-lock.json',
  'tsconfig.json',
  'LICENSE',
])
  await cp(join(root, entry), join(app, entry), {
    recursive: true,
    filter: (source) => !/\.test\.ts$/.test(source),
  });

// Production dependencies, installed by the same Node.js that ships with the app so native modules match.
const npmCli = process.env.npm_execpath;
if (npmCli) run(process.execPath, [npmCli, 'ci', '--omit=dev', '--no-audit', '--no-fund'], { cwd: app });
else run('npm.cmd', ['ci', '--omit=dev', '--no-audit', '--no-fund'], { cwd: app, shell: true });

// Widgets use browser assets, not these packages' Node entry points or dependency trees.
const legal = /^(licen[cs]e|notice|copying)/i;
for (const library of Object.values(widgetLibraries)) {
  const source = join(root, 'node_modules', library.package);
  const target = join(app, 'node_modules', library.package);
  const files = new Set([
    'package.json',
    ...('script' in library ? [library.script] : []),
    ...('serve' in library ? library.serve : []),
    ...(await readdir(source)).filter((name) => legal.test(name)),
  ]);
  for (const file of files) {
    await mkdir(dirname(join(target, file)), { recursive: true });
    await cp(join(source, file), join(target, file), { recursive: true });
  }
}

// Drop files nothing loads at runtime (source maps, type declarations, docs). They are over a third of the
// files in node_modules and include its longest paths, which is what breaks installs near the 260-character limit.
const junk = /\.(map|md|markdown|d\.ts|d\.mts|d\.cts|tsbuildinfo|pdb)$/i;
let pruned = 0;
let removedBytes = 0;
const ptyPrebuilds = join(app, 'node_modules/node-pty/prebuilds');
async function prune(directory, discard = false) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      // Every Claude call supplies the user's CLI path; neither SDK's bundled CLI is used.
      const remove =
        discard ||
        (basename(directory) === '@openai' && entry.name.startsWith('codex')) ||
        (basename(directory) === '@anthropic-ai' && entry.name.startsWith('claude-agent-sdk-')) ||
        (directory === ptyPrebuilds && entry.name !== `${process.platform}-${process.arch}`);
      await prune(path, remove);
      if (remove) await rm(path, { recursive: true });
    } else if (discard ||
      (basename(directory) === 'claude-agent-sdk' && entry.name === 'cli.js') ||
      (junk.test(entry.name) && !legal.test(entry.name))) {
      removedBytes += (await stat(path)).size;
      await rm(path, { force: true });
      pruned++;
    }
  }
}
await prune(join(app, 'node_modules'));
console.info(
  `Pruned ${pruned} unused files (${(removedBytes / 1024 ** 2).toFixed(1)} MiB) from node_modules.`,
);

// Fail packaging if trimming loses a widget entry point.
for (const library of Object.values(widgetLibraries)) {
  const files = 'script' in library ? [library.script] : Object.values(library.imports);
  for (const file of files)
    assert(
      existsSync(join(app, 'node_modules', library.package, file)),
      `Missing widget asset: ${library.package}/${file}`,
    );
}
assert(!existsSync(join(app, 'node_modules/@openai/codex')), 'Bundled Codex CLI must not ship');
assert(!existsSync(join(app, 'node_modules/@anthropic-ai/claude-agent-sdk/cli.js')), 'Bundled Claude CLI must not ship');

// Runtimes: this Node.js binary, and the regular (non-SDK) NW.js build the dev tooling pins.
await cp(process.execPath, join(stage, 'node.exe'));
const nwManifest = JSON.parse(
  await readFile(join(resolve(dirname(require.resolve('nw')), '..'), 'package.json'), 'utf8'),
);
const nwExecutable = await ensureRuntime(nwManifest.version, new AbortController().signal, 'normal');
await cp(dirname(nwExecutable), join(stage, 'nwjs'), {
  recursive: true,
  filter: (source) => !source.endsWith('.basedcode-ready'),
});

// Icon: a 256px PNG wrapped in an ICO container (Windows Vista+ reads PNG-compressed icons).
const iconPng = join(release, 'icon-256.png');
run('powershell.exe', [
  '-NoProfile',
  '-Command',
  `Add-Type -AssemblyName System.Drawing;` +
    `$s=[System.Drawing.Image]::FromFile('${join(root, 'desktop/icon.png')}');` +
    `$b=New-Object System.Drawing.Bitmap 256,256;$g=[System.Drawing.Graphics]::FromImage($b);` +
    `$g.InterpolationMode='HighQualityBicubic';$g.DrawImage($s,0,0,256,256);` +
    `$b.Save('${iconPng}',[System.Drawing.Imaging.ImageFormat]::Png)`,
]);
const png = await readFile(iconPng);
const header = Buffer.alloc(22);
header.writeUInt16LE(0, 0); // reserved
header.writeUInt16LE(1, 2); // type: icon
header.writeUInt16LE(1, 4); // one image
header.writeUInt8(0, 6); // width 256
header.writeUInt8(0, 7); // height 256
header.writeUInt16LE(1, 10); // colour planes
header.writeUInt16LE(32, 12); // bits per pixel
header.writeUInt32LE(png.length, 14);
header.writeUInt32LE(22, 18); // image data offset
const icon = join(stage, 'BasedCode.ico');
await writeFile(icon, Buffer.concat([header, png]));

// Launcher: a tiny windowless exe, compiled with the C# compiler that ships with .NET Framework.
const csc = join(process.env.WINDIR ?? 'C:\\Windows', 'Microsoft.NET/Framework64/v4.0.30319/csc.exe');
run(csc, [
  '/nologo',
  '/target:winexe',
  '/optimize+',
  `/win32icon:${icon}`,
  '/reference:System.Windows.Forms.dll',
  `/out:${join(stage, 'BasedCode.exe')}`,
  join(root, 'installer/Launcher.cs'),
]);

// Installer.
const iscc = [
  process.env.ISCC,
  join(process.env['ProgramFiles(x86)'] ?? '', 'Inno Setup 6/ISCC.exe'),
  join(process.env.ProgramFiles ?? '', 'Inno Setup 6/ISCC.exe'),
  join(process.env.LOCALAPPDATA ?? '', 'Programs/Inno Setup 6/ISCC.exe'),
].find((path) => path && existsSync(path));
if (!iscc)
  throw new Error(
    'Inno Setup 6 (ISCC.exe) not found. Install it with `winget install JRSoftware.InnoSetup`, ' +
      'or set ISCC to the full path of ISCC.exe. Everything else is staged in release/stage.',
  );
run(iscc, [
  `/DAppVersion=${version}`,
  `/DSourceDir=${stage}`,
  `/DOutputDir=${release}`,
  join(root, 'installer/basedcode.iss'),
]);
console.info(`Installer ready: ${join(release, `BasedCode-Setup-${version}.exe`)}`);
