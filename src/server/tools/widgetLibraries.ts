import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Libraries bundled with BasedCode for inline widgets (render_ui / query_ui). Widgets opt in by name; the backend
 * serves the files locally from /views/lib/, so widgets still never touch the network.
 */
interface Library {
  /** npm package that ships the files. */
  package: string;
  /** Classic scripts that define a global, relative to the package root. */
  script?: string;
  /** Import map entries (specifier → path relative to the package root); trailing "/" maps a directory. */
  imports?: Record<string, string>;
  /** Directories under the package root that may be served (for module imports). */
  serve?: string[];
  /** Line for the tool description. */
  usage: string;
}

export const widgetLibraries = {
  three: {
    package: 'three',
    imports: { three: 'build/three.module.js', 'three/addons/': 'examples/jsm/' },
    serve: ['build/', 'examples/jsm/'],
    usage:
      "three: `<script type=\"module\">import * as THREE from 'three'; import { OrbitControls } from 'three/addons/controls/OrbitControls.js';</script>`",
  },
  motion: {
    package: 'motion',
    script: 'dist/motion.js',
    usage: 'motion: global `Motion` (`const { animate, stagger, spring } = Motion`)',
  },
  tailwind: {
    package: '@tailwindcss/browser',
    script: 'dist/index.global.js',
    usage:
      'tailwind: Tailwind v4 utility classes; custom theme via `<style type="text/tailwindcss">`',
  },
  matter: {
    package: 'matter-js',
    script: 'build/matter.min.js',
    usage: 'matter: global `Matter` (2D physics: Engine, Bodies, Composite, Runner, Render)',
  },
  confetti: {
    package: 'canvas-confetti',
    script: 'dist/confetti.browser.js',
    usage: 'confetti: global `confetti({ particleCount: 120, spread: 70 })`',
  },
  tone: {
    package: 'tone',
    script: 'build/Tone.js',
    usage:
      'tone: global `Tone` (call `await Tone.start()` inside a click handler before playing sound)',
  },
  lucide: {
    package: 'lucide',
    script: 'dist/umd/lucide.min.js',
    usage:
      'lucide: icons via `<i data-lucide="rocket"></i>`, rendered automatically (call `lucide.createIcons({ icons: lucide.icons })` after adding icons later)',
  },
} satisfies Record<string, Library>;

export type WidgetLibrary = keyof typeof widgetLibraries;
export const widgetLibraryNames = Object.keys(widgetLibraries) as [WidgetLibrary, ...WidgetLibrary[]];

const here = dirname(fileURLToPath(import.meta.url));
const packages = new Map<string, { root: string; version: string }>();

function packageInfo(name: string): { root: string; version: string } {
  let info = packages.get(name);
  if (!info) {
    // Some packages (three) don't export package.json, so find the folder like Node's lookup does.
    let manifest = '';
    for (let dir = here; !manifest; dir = dirname(dir)) {
      const candidate = join(dir, 'node_modules', name, 'package.json');
      if (existsSync(candidate)) manifest = candidate;
      else if (dirname(dir) === dir) throw new Error(`Widget library ${name} is not installed.`);
    }
    info = {
      root: dirname(manifest),
      version: (JSON.parse(readFileSync(manifest, 'utf8')) as { version: string }).version,
    };
    packages.set(name, info);
  }
  return info;
}

/** Versioned URL path, so files can be cached immutably. */
function libraryPath(library: Library, file: string): string {
  return `/views/lib/${library.package}@${packageInfo(library.package).version}/${file}`;
}

/** Tags to put in a widget's head, before its own code. */
export function libraryTags(names: readonly string[], origin: string): string {
  const selected = [...new Set(names)]
    .filter((name): name is WidgetLibrary => name in widgetLibraries)
    .map((name) => widgetLibraries[name] as Library);
  const imports: Record<string, string> = {};
  for (const library of selected)
    for (const [specifier, file] of Object.entries(library.imports ?? {}))
      imports[specifier] = origin + libraryPath(library, file);
  const map = Object.keys(imports).length
    ? `<script type="importmap">${JSON.stringify({ imports }).replace(/</g, '\\u003c')}</script>`
    : '';
  const scripts = selected
    .filter((library) => library.script)
    .map((library) => `<script src="${origin}${libraryPath(library, library.script!)}"></script>`)
    .join('');
  const icons = names.includes('lucide')
    ? `<script>addEventListener('DOMContentLoaded', () => window.lucide?.createIcons({ icons: lucide.icons }));</script>`
    : '';
  return map + scripts + icons;
}

/** Resolves /views/lib/<package>@<version>/<file> to a file on disk, or undefined when it is not served. */
export function libraryFile(path: string): string | undefined {
  const match = /^\/views\/lib\/((?:@[^/]+\/)?[^/@]+)@([^/]+)\/(.+)$/.exec(path);
  if (!match) return undefined;
  const [, name, version, file] = match;
  if (file.split(/[\\/]/).some((part) => part === '..' || part === '.' || part === '')) return undefined;
  const library = (Object.values(widgetLibraries) as Library[]).find((item) => item.package === name);
  if (!library) return undefined;
  const info = packageInfo(name);
  if (version !== info.version) return undefined;
  const allowed = [...(library.script ? [library.script] : []), ...(library.serve ?? [])];
  if (!allowed.some((entry) => (entry.endsWith('/') ? file.startsWith(entry) : file === entry)))
    return undefined;
  const full = resolve(info.root, file);
  const inside = relative(info.root, full);
  if (!inside || inside.startsWith('..') || inside.includes(`..${sep}`)) return undefined;
  return /\.(m?js|css)$/.test(full) ? full : undefined;
}

export function libraryUsage(): string {
  return Object.values(widgetLibraries)
    .map((library) => `- ${library.usage}`)
    .join('\n');
}
