import type { ITheme } from '@xterm/xterm';

/** ANSI colours readable on light backgrounds; xterm's defaults are tuned for dark ones. */
const lightAnsi: ITheme = {
  black: '#1f2328',
  red: '#c4232b',
  green: '#1a7f37',
  yellow: '#8a6100',
  blue: '#0b5cd5',
  magenta: '#8e3ab8',
  cyan: '#0f7a8a',
  white: '#6e7781',
  brightBlack: '#57606a',
  brightRed: '#d73a49',
  brightGreen: '#2c974b',
  brightYellow: '#a87600',
  brightBlue: '#2f73e0',
  brightMagenta: '#a24fcc',
  brightCyan: '#1b8fa0',
  brightWhite: '#8c959f',
};

/** Builds an xterm theme from the app's current CSS tokens (set by applyAppearance). */
export function terminalTheme(): ITheme {
  const root = document.documentElement;
  const style = getComputedStyle(root);
  const token = (name: string) => style.getPropertyValue(name).trim();
  const background = token('--bg') || '#0d0f12';
  const accent = token('--accent') || '#e6ad77';
  return {
    ...(root.dataset.scheme === 'light' ? lightAnsi : {}),
    background,
    foreground: token('--text-secondary') || '#c4c9d2',
    cursor: accent,
    cursorAccent: background,
    selectionBackground: token('--surface-active') || '#404553',
  };
}

/** Calls back whenever the app theme changes; returns a disposer. */
export function onThemeChange(callback: () => void): () => void {
  const observer = new MutationObserver(callback);
  observer.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ['data-theme', 'data-scheme', 'style'],
  });
  return () => observer.disconnect();
}
