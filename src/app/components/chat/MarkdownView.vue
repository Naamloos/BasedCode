<script setup lang="ts">
import { computed, ref, watch, onMounted, onUpdated, onBeforeUnmount } from 'vue';
import { marked, Marked } from 'marked';
import DOMPurify from 'dompurify';
import hljs from 'highlight.js';
import { effectsActive, holdReveal, hotHtml, hotMs, releaseReveal } from '../../theme/effects';
import { t } from '../../theme/i18n';
import { attachmentUrl, mediaUrl } from '../../services/api';
import { previewMediaType } from '../../../shared/preview';

/** `workspaceId` lets relative image paths render from the workspace. */
const props = defineProps<{ content: string; streaming?: boolean; workspaceId?: string }>();
const emit = defineEmits<{ link: [url: string] }>();
const root = ref<HTMLElement>();
const renderer = new marked.Renderer();
renderer.code = ({ text, lang }) => {
  const language = lang?.split(/\s/)[0];
  const known = language && hljs.getLanguage(language);
  const highlighted = known
    ? hljs.highlight(text, { language }).value
    : hljs.highlight(text, { language: 'plaintext' }).value;
  return `<pre data-language="${known ? language : ''}"><code class="hljs">${highlighted}</code></pre>`;
};
const mathSymbols: Record<string, string> = {
  rightarrow: '→',
  to: '→',
  leftarrow: '←',
  leftrightarrow: '↔',
  Rightarrow: '⇒',
  Leftarrow: '⇐',
  Leftrightarrow: '⇔',
  times: '×',
  cdot: '·',
  pm: '±',
  leq: '≤',
  geq: '≥',
  neq: '≠',
  approx: '≈',
  infty: '∞',
};
const markdown = new Marked({
  renderer,
  extensions: [
    {
      name: 'mathSymbol',
      level: 'inline',
      start: (source) => source.search(/\$|\\\(/),
      tokenizer(source) {
        const match =
          /^(\${1,2})\s*\\([a-zA-Z]+)\s*\1/.exec(source) ??
          /^\\\(\s*\\([a-zA-Z]+)\s*\\\)/.exec(source);
        if (!match) return;
        const command = match[2] ?? match[1];
        if (Object.hasOwn(mathSymbols, command))
          return { type: 'mathSymbol', raw: match[0], text: mathSymbols[command] };
      },
      renderer: (token) => token.text,
    },
    {
      // :lucide-rocket: becomes an icon placeholder, filled with the SVG after sanitizing.
      name: 'lucideIcon',
      level: 'inline',
      start: (source) => source.indexOf(':lucide-'),
      tokenizer(source) {
        const match = /^:lucide-([a-z0-9]+(?:-[a-z0-9]+)*):/.exec(source);
        if (match) return { type: 'lucideIcon', raw: match[0], text: match[1] };
      },
      renderer: (token) =>
        `<span class="md-icon" data-icon="${token.text}" role="img" aria-label="${token.text}"></span>`,
    },
  ],
});

/** Where an image in Markdown loads from: workspace files and attachments only, never the network. */
function imageSource(src: string): string | undefined {
  const attachment = /^attachment:([0-9a-f-]{36})$/i.exec(src);
  if (attachment) return attachmentUrl(attachment[1]);
  if (!props.workspaceId || /^[a-z][a-z0-9+.-]*:/i.test(src) || src.startsWith('//')) return;
  let path = src.replace(/^\.\//, '');
  try {
    path = decodeURIComponent(path);
  } catch {
    // Keep a path with a stray % as written.
  }
  if (!previewMediaType(path)?.startsWith('image/')) return;
  return mediaUrl(props.workspaceId, path);
}

// A private DOMPurify instance, so its hooks don't affect other sanitizers in the app.
const purifier = DOMPurify(window);
purifier.addHook('afterSanitizeAttributes', (node) => {
  if (node.tagName !== 'IMG') return;
  const original = node.getAttribute('src') ?? '';
  const source = imageSource(original);
  if (!source) {
    const fallback = document.createElement('span');
    fallback.textContent = node.getAttribute('alt') || original;
    node.replaceWith(fallback);
    return;
  }
  node.setAttribute('data-path', original);
  node.setAttribute('src', source);
  node.setAttribute('loading', 'lazy');
  node.setAttribute('class', 'md-image');
});
// Batch renders without making displayed text fall behind the provider.
const shown = ref(props.content.length);
const revealing = ref(false);
let revealFrame = 0;
let lastCommit = 0;
function pumpReveal(time: number) {
  if (time - lastCommit >= 40) {
    shown.value = props.content.length;
    lastCommit = time;
    revealFrame = 0;
    if (revealing.value) {
      revealing.value = false;
      releaseReveal();
    }
    return;
  }
  revealFrame = requestAnimationFrame(pumpReveal);
}
watch(
  () => props.content,
  (content) => {
    if (!props.streaming || content.length < shown.value) {
      shown.value = content.length;
      return;
    }
    if (!revealing.value) {
      revealing.value = true;
      holdReveal();
    }
    if (!revealFrame) revealFrame = requestAnimationFrame(pumpReveal);
  },
);
onBeforeUnmount(() => {
  cancelAnimationFrame(revealFrame);
  if (revealing.value) releaseReveal();
});
const visible = computed(() => props.content.slice(0, Math.floor(shown.value)));

const sanitize = (html: string) =>
  purifier.sanitize(html, {
    FORBID_TAGS: ['style', 'iframe', 'form', 'input', 'button'],
    FORBID_ATTR: ['style', 'target', 'srcset'],
  });

// While text is growing, only the last Markdown block can still change. Finished blocks render once
// (cached by their source) into a container the DOM leaves alone; only the live block re-renders.
const blockCache = new Map<string, string>();
const parts = computed(() => {
  if (!props.streaming && !revealing.value) {
    blockCache.clear();
    return {
      stable: sanitize(markdown.parse(visible.value, { async: false }) as string),
      live: '',
    };
  }
  const tokens = markdown.lexer(visible.value);
  const blocks = tokens.filter((token) => token.type !== 'space');
  const render = (token: (typeof tokens)[number]) => {
    const cached = blockCache.get(token.raw);
    if (cached !== undefined) return cached;
    const html = sanitize(markdown.parser(Object.assign([token], { links: tokens.links })));
    blockCache.set(token.raw, html);
    return html;
  };
  const last = blocks.at(-1);
  return {
    stable: blocks.slice(0, -1).map(render).join(''),
    live: last ? sanitize(markdown.parser(Object.assign([last], { links: tokens.links }))) : '',
  };
});
const live = ref<HTMLElement>();

// Buttons are added after sanitizing, from trusted code, so untrusted Markdown still cannot create controls.
function decorateCodeBlocks() {
  for (const pre of root.value?.querySelectorAll('pre') ?? []) {
    if (pre.parentElement?.classList.contains('code-block')) continue;
    const wrapper = document.createElement('div');
    wrapper.className = 'code-block';
    const header = document.createElement('div');
    header.className = 'code-block-header';
    const label = document.createElement('span');
    label.textContent = pre.dataset.language || t('text');
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'copy-code';
    button.textContent = t('Copy');
    button.setAttribute('aria-label', t('Copy code to clipboard'));
    header.append(label, button);
    pre.replaceWith(wrapper);
    wrapper.append(header, pre);
  }
}
// Hot characters while streaming: remember when the text reached each length, then after every render
// wrap the most recent characters (counted from the end of the rendered text) in animated spans.
// Rendering replaces the DOM on each token, so ages carry over through negative animation delays.
const arrivals: { length: number; time: number }[] = [];
watch(visible, (content) => {
  if (!props.streaming && !revealing.value) {
    arrivals.length = 0;
    return;
  }
  const time = performance.now();
  arrivals.push({ length: content.length, time });
  while (arrivals.length > 2 && time - arrivals[1].time > hotMs) arrivals.shift();
});
function arrivalOf(index: number): number {
  return arrivals.find((entry) => entry.length > index)?.time ?? 0;
}
function heatUpRecentText() {
  // Only the live block holds the newest text, so only it is walked.
  const element = live.value;
  if (!element || !(props.streaming || revealing.value) || !effectsActive() || !arrivals.length)
    return;
  const now = performance.now();
  const length = visible.value.length;
  const coolFrom = arrivals.find((entry) => now - entry.time < hotMs);
  let remaining = Math.min(
    70,
    coolFrom ? length - (arrivals[arrivals.indexOf(coolFrom) - 1]?.length ?? 0) : 0,
  );
  if (remaining <= 0) return;
  const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT, {
    acceptNode: (node) =>
      node.parentElement?.closest('.code-block-header')
        ? NodeFilter.FILTER_REJECT
        : NodeFilter.FILTER_ACCEPT,
  });
  const nodes: Text[] = [];
  while (walker.nextNode()) nodes.push(walker.currentNode as Text);
  let fromEnd = 0;
  for (let index = nodes.length - 1; index >= 0 && remaining > 0; index--) {
    const node = nodes[index];
    const text = node.data;
    const take = Math.min(remaining, text.length);
    const cold = text.slice(0, text.length - take);
    const hot = text.slice(text.length - take);
    const offset = fromEnd;
    // Character k from the end of the rendered text maps to source index length-1-k.
    const html = hotHtml(
      hot,
      (local) => now - arrivalOf(length - 1 - (offset + take - 1 - local)),
      length - offset - take,
    );
    const holder = document.createElement('span');
    holder.innerHTML = html;
    node.replaceWith(cold, ...holder.childNodes);
    remaining -= take;
    fromEnd += take;
  }
  // Wrapping is only valid on fresh HTML; wrapping unchanged DOM nests animation spans.
}

// Icons load lazily: the full Lucide set is large and most replies use none.
let lucide: Promise<typeof import('lucide')> | undefined;
async function decorateIcons() {
  const pending = [
    ...(root.value?.querySelectorAll<HTMLElement>('.md-icon:not([data-done])') ?? []),
  ];
  if (!pending.length) return;
  lucide ??= import('lucide');
  const { icons, createElement } = await lucide;
  for (const holder of pending) {
    holder.dataset.done = '';
    const name = (holder.dataset.icon ?? '').replace(/(?:^|-)([a-z0-9])/g, (_, letter: string) =>
      letter.toUpperCase(),
    );
    const node = (icons as Record<string, Parameters<typeof createElement>[0]>)[name];
    if (node) holder.replaceChildren(createElement(node, { width: '1em', height: '1em' }));
    else holder.textContent = `:${holder.dataset.icon}:`;
  }
}
function decorate() {
  decorateCodeBlocks();
  void decorateIcons();
}
onMounted(decorate);
onUpdated(decorate);
watch(() => parts.value.live, heatUpRecentText, { flush: 'post' });

function coolText(event: AnimationEvent) {
  const character = event.target;
  if (!(character instanceof HTMLElement) || !character.classList.contains('hot-char')) return;
  const word = character.parentElement;
  character.replaceWith(...character.childNodes);
  if (word?.classList.contains('hot-word') && !word.querySelector('.hot-char'))
    word.replaceWith(...word.childNodes);
}

async function copy(button: HTMLButtonElement) {
  const text = button.closest('.code-block')?.querySelector('code')?.textContent ?? '';
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    // Clipboard API can be unavailable in the embedded frame; fall back to a selection copy.
    const area = document.createElement('textarea');
    area.value = text;
    document.body.append(area);
    area.select();
    // Keep the legacy fallback for embedded frames without Clipboard API access.
    const legacyDocument = document as Document & { execCommand(command: 'copy'): boolean };
    legacyDocument.execCommand('copy');
    area.remove();
  }
  button.textContent = t('Copied');
  setTimeout(() => {
    button.textContent = t('Copy');
  }, 1500);
}

function clicked(event: MouseEvent) {
  const target = event.target as HTMLElement;
  const button = target.closest<HTMLButtonElement>('.copy-code');
  if (button) {
    void copy(button);
    return;
  }
  const image = target.closest<HTMLImageElement>('img.md-image');
  if (image && !image.closest('a')) {
    const path = image.dataset.path ?? '';
    if (!path.startsWith('attachment:')) emit('link', path);
    return;
  }
  const anchor = target.closest('a');
  if (!anchor) return;
  event.preventDefault();
  emit('link', anchor.getAttribute('href') ?? '');
}
</script>

<template>
  <!-- Sanitization is required because model and tool text is untrusted. -->
  <!-- eslint-disable vue/no-v-html -->
  <div
    ref="root"
    class="markdown"
    @click="clicked"
    @animationend="coolText"
  >
    <div
      class="markdown-part"
      v-html="parts.stable"
    />
    <div
      ref="live"
      class="markdown-part"
      v-html="parts.live"
    />
  </div>
  <!-- eslint-enable vue/no-v-html -->
</template>
