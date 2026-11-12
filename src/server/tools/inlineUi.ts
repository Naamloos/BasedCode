import { libraryTags } from './widgetLibraries.js';

/** Message type the inline UI bridge posts to the host window. */
export const inlineUiMessage = 'basedcode-ui';

/**
 * Wraps agent-authored HTML from render_ui in a document with theme variables and a tiny bridge: it reports the
 * content height and forwards prompts from `basedcode.prompt(text)` or clicks on `[data-prompt]` elements.
 */
export function inlineUiDocument(
  html: string,
  libraries: readonly string[] = [],
  origin = '',
  files: Record<string, string> = {},
): string {
  const bridge = `<script>(() => {
  const post = data => parent.postMessage({ type: '${inlineUiMessage}', ...data }, '*');
  let inactive = false;
  window.basedcode = { submit: value => { if (!inactive) post({ action: 'submit', value }); }, prompt: text => { if (typeof text === 'string' && text.trim()) post({ action: 'prompt', text: text.slice(0, 20000) }); } };
  document.addEventListener('click', event => {
    const target = event.target instanceof Element ? event.target.closest('[data-prompt]') : null;
    if (target) { event.preventDefault(); window.basedcode.prompt(target.getAttribute('data-prompt') || ''); }
  });
  // The host sends its live theme tokens on load and whenever the appearance changes.
  addEventListener('message', event => {
    const data = event.source === parent ? event.data : null;
    if (data?.type === '${inlineUiMessage}-inactive') { inactive = true; document.documentElement.inert = true; return; }
    if (data?.type !== '${inlineUiMessage}-theme') return;
    const root = document.documentElement;
    root.style.colorScheme = data.scheme === 'light' ? 'light' : 'dark';
    for (const [name, value] of Object.entries(data.tokens || {})) if (/^--[a-z-]+$/.test(name) && typeof value === 'string') root.style.setProperty(name, value);
  });
  const size = () => {
    if (document.body) post({ action: 'size', height: Math.ceil(Math.max(document.body.getBoundingClientRect().height, document.body.scrollHeight)) });
  };
  addEventListener('DOMContentLoaded', () => {
    new ResizeObserver(size).observe(document.body);
    size();
  });
  addEventListener('load', size);
})();</script>`;
  const style = `<style>:root{color-scheme:light dark;--fg:CanvasText;--bg:transparent;--surface:Canvas;--muted:GrayText;--accent:#e6ad77;--border:#8884}
html{overflow:hidden!important}*{scrollbar-width:none!important}*::-webkit-scrollbar{display:none!important}html,body{box-sizing:border-box;margin:0;background:var(--bg);color:var(--fg);font:14px/1.5 system-ui,sans-serif}body{padding:12px}
button{font:inherit;color:var(--fg);background:var(--surface);border:1px solid var(--border);border-radius:6px;padding:6px 12px;cursor:pointer}
button:hover{border-color:var(--accent)}</style>`;
  // Chat attachments the widget asked for: basedcode.files[name] is a local URL it can fetch or load as a script.
  const fileMap = Object.keys(files).length
    ? `<script>window.basedcode.files=${JSON.stringify(files).replace(/</g, '\\u003c')};</script>`
    : '';
  const head = style + bridge + fileMap + libraryTags(libraries, origin);
  const full = /<html[\s>]/i.test(html);
  if (!full)
    return `<!doctype html><html><head><meta charset="utf-8">${head}</head><body>${html}</body></html>`;
  // A full document keeps its own structure; inject defaults first so its own styles win.
  return /<head[^>]*>/i.test(html)
    ? html.replace(/<head[^>]*>/i, (match) => `${match}${head}`)
    : html.replace(/<html[^>]*>/i, (match) => `${match}<head>${head}</head>`);
}
