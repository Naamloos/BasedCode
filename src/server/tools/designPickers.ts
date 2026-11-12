/**
 * Interactive design pickers for query tools: query_color, query_font and query_radius.
 * Each returns the HTML body of a query widget; queryDocument wraps it with the widget bridge and theme.
 * The font picker is the only widget that loads anything remote: Google Fonts stylesheets and font files
 * (see googleFontsCsp, which the view server adds for query_font views only).
 */

/** Hosts the font picker may load from, added to that view's Content-Security-Policy. */
export const googleFontsCsp = { style: 'https://fonts.googleapis.com', font: 'https://fonts.gstatic.com' };

/** Popular Google Fonts, shown when the agent does not suggest its own. Grouped by category for the filter. */
export const defaultFonts: Record<string, string[]> = {
  'Sans serif': [
    'Inter', 'Roboto', 'Open Sans', 'Lato', 'Montserrat', 'Poppins', 'Nunito', 'Work Sans', 'DM Sans',
    'Manrope', 'Plus Jakarta Sans', 'Outfit', 'Figtree', 'Rubik', 'Source Sans 3', 'IBM Plex Sans',
    'Space Grotesk', 'Sora', 'Urbanist', 'Lexend',
  ],
  Serif: [
    'Playfair Display', 'Merriweather', 'Lora', 'Libre Baskerville', 'EB Garamond', 'Crimson Pro',
    'DM Serif Display', 'Fraunces', 'Cormorant Garamond', 'Source Serif 4', 'Instrument Serif', 'Spectral',
  ],
  Display: ['Bebas Neue', 'Oswald', 'Anton', 'Archivo Black', 'Righteous', 'Bricolage Grotesque', 'Syne', 'Unbounded'],
  Handwriting: ['Caveat', 'Dancing Script', 'Pacifico', 'Kalam', 'Satisfy'],
  Monospace: ['JetBrains Mono', 'Fira Code', 'IBM Plex Mono', 'Source Code Pro', 'Space Mono', 'Roboto Mono'],
};

/** Google Fonts family names: letters, digits and spaces. Keeps them safe in URLs and CSS. */
export const fontNamePattern = /^[A-Za-z0-9][A-Za-z0-9 ]{0,79}$/;
export const hexColorPattern = /^#[0-9a-fA-F]{6}$/;

const escape = (value: unknown) =>
  String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!);
const json = (value: unknown) => JSON.stringify(value).replace(/</g, '\\u003c');

const sharedStyle = `<style>
.picker{display:grid;gap:12px}
.picker label.q{font-weight:600}
.picker input[type=text],.picker select{font:inherit;color:var(--fg);background:var(--surface);padding:6px 8px;border:1px solid var(--border);border-radius:6px;min-width:0}
.picker .row{display:flex;gap:8px;align-items:center;flex-wrap:wrap}
.picker .muted{color:var(--muted);font-size:12px}
.picker .actions{display:flex;justify-content:flex-end}
.picker .actions button{background:var(--accent);color:#111;border-color:transparent;font-weight:600}
</style>`;

export function colorPickerHtml(args: Record<string, unknown>): string {
  const suggestions = (Array.isArray(args.suggestions) ? args.suggestions : []).filter(
    (value): value is string => typeof value === 'string' && hexColorPattern.test(value),
  );
  const initial = typeof args.value === 'string' && hexColorPattern.test(args.value) ? args.value : suggestions[0] ?? '#6366f1';
  return `${sharedStyle}<style>
.swatches{display:flex;gap:6px;flex-wrap:wrap}
.swatch{width:28px;height:28px;padding:0;border-radius:6px;border:1px solid var(--border)}
.swatch[aria-pressed=true]{outline:2px solid var(--accent);outline-offset:2px}
input[type=color]{width:56px;height:40px;padding:0;border:1px solid var(--border);border-radius:6px;background:none;cursor:pointer}
.preview{display:grid;grid-template-columns:1fr 1fr;border-radius:8px;overflow:hidden;border:1px solid var(--border)}
.preview div{padding:10px 12px}
.preview strong{display:block}
</style>
<form class="picker">
  <label class="q" for="hex">${escape(args.question)}</label>
  ${suggestions.length ? `<div class="swatches" role="group" aria-label="Suggestions">${suggestions.map((color) => `<button type="button" class="swatch" title="${color}" aria-label="${color}" style="background:${color}" data-color="${color}"></button>`).join('')}</div>` : ''}
  <div class="row">
    <input type="color" id="wheel" aria-label="Color picker" value="${initial.toLowerCase()}">
    <input type="text" id="hex" aria-label="Hex code" value="${initial.toLowerCase()}" maxlength="7" size="9" spellcheck="false">
    <span class="muted" id="contrast"></span>
  </div>
  <div class="preview" aria-hidden="true">
    <div id="on-color"><strong>Heading</strong>Text on this color</div>
    <div id="as-text" style="background:var(--surface)"><strong>Heading</strong>This color as text</div>
  </div>
  <div class="actions"><button type="submit">Use this color</button></div>
</form>
<script>
const wheel = document.getElementById('wheel'), hex = document.getElementById('hex');
const lum = (c) => { const v = [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16) / 255).map((x) => x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4); return 0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2]; };
const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((m, n) => n - m); return (x + 0.05) / (y + 0.05); };
function set(color) {
  if (!/^#[0-9a-f]{6}$/i.test(color)) return;
  color = color.toLowerCase();
  wheel.value = color; if (document.activeElement !== hex) hex.value = color;
  const white = ratio(color, '#ffffff'), black = ratio(color, '#000000');
  const text = white >= black ? '#ffffff' : '#000000';
  const box = document.getElementById('on-color'); box.style.background = color; box.style.color = text;
  document.getElementById('as-text').style.color = color;
  document.getElementById('contrast').textContent = 'Contrast with ' + (text === '#ffffff' ? 'white' : 'black') + ' text: ' + Math.max(white, black).toFixed(1) + ':1';
  for (const s of document.querySelectorAll('.swatch')) s.setAttribute('aria-pressed', String(s.dataset.color.toLowerCase() === color));
}
wheel.oninput = () => set(wheel.value);
hex.oninput = () => set(hex.value.startsWith('#') ? hex.value : '#' + hex.value);
for (const s of document.querySelectorAll('.swatch')) s.onclick = () => set(s.dataset.color);
document.querySelector('form').onsubmit = (event) => { event.preventDefault(); basedcode.submit(wheel.value.toLowerCase()); };
set(${json(initial)});
</script>`;
}

export function fontPickerHtml(args: Record<string, unknown>): string {
  const suggested = (Array.isArray(args.fonts) ? args.fonts : []).filter(
    (value): value is string => typeof value === 'string' && fontNamePattern.test(value),
  );
  const groups: Record<string, string[]> = suggested.length ? { Suggested: suggested, ...defaultFonts } : defaultFonts;
  const sample = typeof args.sampleText === 'string' && args.sampleText.trim() ? args.sampleText.slice(0, 120) : 'The quick brown fox jumps over the lazy dog';
  const all = [...new Set(Object.values(groups).flat())];
  // One stylesheet for every listed family, limited to the glyphs the previews use, so it stays small.
  const glyphs = [...new Set(`${sample}${all.join('')}0123456789`)].join('');
  const href = `https://fonts.googleapis.com/css2?${all.map((name) => `family=${encodeURIComponent(name).replace(/%20/g, '+')}`).join('&')}&text=${encodeURIComponent(glyphs)}&display=swap`;
  return `${sharedStyle}<link rel="stylesheet" href="${escape(href)}">
<style>
.list{display:grid;gap:4px;max-height:320px;overflow-y:auto!important;scrollbar-width:thin!important;padding-right:4px}
.font{display:grid;gap:2px;text-align:left;padding:8px 10px}
.font[aria-pressed=true]{border-color:var(--accent);box-shadow:0 0 0 1px var(--accent)}
.font .name{font:12px system-ui,sans-serif;color:var(--muted)}
.font .sample{font-size:20px;line-height:1.25;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.chosen{font-size:28px;line-height:1.2;padding:8px 0}
</style>
<form class="picker">
  <label class="q" for="filter">${escape(args.question)}</label>
  <div class="row">
    <input type="text" id="filter" placeholder="Filter or type any Google Font name" maxlength="80" style="flex:1">
    <select id="category" aria-label="Category"><option value="">All categories</option>${Object.keys(groups).map((name) => `<option>${escape(name)}</option>`).join('')}</select>
  </div>
  <div class="list" id="list" role="listbox" aria-label="Fonts"></div>
  <div class="row" id="custom-row" hidden><button type="button" id="custom">Use “<span id="custom-name"></span>” from Google Fonts</button></div>
  <div class="chosen" id="chosen" aria-live="polite"></div>
  <div class="actions"><button type="submit" id="submit" disabled>Use this font</button></div>
</form>
<script>
const groups = ${json(groups)}, sample = ${json(sample)};
const list = document.getElementById('list'), filter = document.getElementById('filter'), category = document.getElementById('category');
let chosen = '';
function choose(name) {
  chosen = name;
  const box = document.getElementById('chosen'); box.textContent = sample; box.style.fontFamily = JSON.stringify(name) + ', system-ui';
  document.getElementById('submit').disabled = false;
  document.getElementById('submit').textContent = 'Use ' + name;
  for (const b of list.children) b.setAttribute('aria-pressed', String(b.dataset.name === name));
}
function load(name) {
  // A family typed by hand is not in the page's stylesheet yet; fetch just that one.
  const link = document.createElement('link'); link.rel = 'stylesheet';
  link.href = 'https://fonts.googleapis.com/css2?family=' + encodeURIComponent(name).replace(/%20/g, '+') + '&display=swap';
  document.head.append(link);
}
function render() {
  const query = filter.value.trim().toLowerCase();
  list.replaceChildren();
  const seen = new Set();
  for (const [group, names] of Object.entries(groups)) {
    if (category.value && category.value !== group) continue;
    for (const name of names) {
      if (seen.has(name) || (query && !name.toLowerCase().includes(query))) continue;
      seen.add(name);
      const b = document.createElement('button'); b.type = 'button'; b.className = 'font'; b.dataset.name = name; b.setAttribute('role', 'option');
      b.setAttribute('aria-pressed', String(name === chosen));
      const label = document.createElement('span'); label.className = 'name'; label.textContent = name + ' · ' + group;
      const text = document.createElement('span'); text.className = 'sample'; text.textContent = sample; text.style.fontFamily = JSON.stringify(name) + ', system-ui';
      b.append(label, text); b.onclick = () => choose(name); b.ondblclick = () => { choose(name); basedcode.submit(name); };
      list.append(b);
    }
  }
  const typed = filter.value.trim();
  const custom = /^[A-Za-z0-9][A-Za-z0-9 ]{0,79}$/.test(typed) && ![...seen].some((n) => n.toLowerCase() === typed.toLowerCase());
  document.getElementById('custom-row').hidden = !custom;
  document.getElementById('custom-name').textContent = typed;
}
document.getElementById('custom').onclick = () => {
  const name = filter.value.trim().replace(/\\b\\w/g, (c) => c.toUpperCase());
  load(name); choose(name);
};
filter.oninput = render; category.onchange = render;
document.querySelector('form').onsubmit = (event) => { event.preventDefault(); if (chosen) basedcode.submit(chosen); };
render();
</script>`;
}

export function radiusPickerHtml(args: Record<string, unknown>): string {
  const initial = typeof args.value === 'number' ? Math.min(48, Math.max(0, Math.round(args.value))) : 8;
  return `${sharedStyle}<style>
.presets{display:flex;gap:6px;flex-wrap:wrap}
.stage{display:flex;gap:12px;align-items:flex-start;flex-wrap:wrap;padding:12px;border:1px dashed var(--border);border-radius:8px}
.card{width:180px;padding:12px;background:var(--surface);border:1px solid var(--border);box-shadow:0 2px 8px #0002}
.card .img{height:56px;background:linear-gradient(135deg,var(--accent),#6366f1);margin-bottom:8px}
.demo-button{background:var(--accent);color:#111;border:none;padding:8px 16px;font-weight:600}
.demo-input{padding:8px;border:1px solid var(--border);background:var(--surface);color:var(--fg);width:140px}
input[type=range]{flex:1}
</style>
<form class="picker">
  <label class="q" for="radius">${escape(args.question)}</label>
  <div class="presets" role="group" aria-label="Presets">
    ${[['Sharp', 0], ['Subtle', 4], ['Soft', 8], ['Round', 16], ['Pill', 999]].map(([name, value]) => `<button type="button" data-value="${value}">${name}</button>`).join('')}
  </div>
  <div class="row"><input type="range" id="radius" min="0" max="48" step="1" value="${initial}"><output id="out">${initial}px</output></div>
  <div class="stage" aria-hidden="true">
    <div class="card r"><div class="img r"></div><strong>Card title</strong><div class="muted">Some supporting text</div></div>
    <div style="display:grid;gap:8px"><button type="button" class="demo-button r" tabindex="-1">Button</button><input class="demo-input r" tabindex="-1" placeholder="Input field"></div>
  </div>
  <div class="actions"><button type="submit">Use this rounding</button></div>
</form>
<script>
const range = document.getElementById('radius'); let pill = false;
function set(value) {
  pill = value >= 999; if (!pill) range.value = value;
  document.getElementById('out').textContent = pill ? 'Pill' : range.value + 'px';
  for (const el of document.querySelectorAll('.r')) el.style.borderRadius = pill ? (el.classList.contains('card') || el.classList.contains('img') ? '24px' : '999px') : range.value + 'px';
}
range.oninput = () => set(Number(range.value));
for (const b of document.querySelectorAll('[data-value]')) b.onclick = () => set(Number(b.dataset.value));
document.querySelector('form').onsubmit = (event) => { event.preventDefault(); basedcode.submit(pill ? 'pill' : Number(range.value)); };
set(${initial});
</script>`;
}
