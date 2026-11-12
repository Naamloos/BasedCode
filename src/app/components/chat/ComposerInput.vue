<script setup lang="ts">
import { computed, nextTick, ref, watch, onMounted, onBeforeUnmount } from 'vue';
import { burst, effectsActive, hotHtml, hotMs, stoke } from '../../theme/effects';
import { t } from '../../theme/themes';
import type { SlashCommandInfo } from '../../../shared/commands';

// A textarea can't style single characters, so its text is transparent (selection stays native)
// and a mirror underneath draws the same text: fresh characters animated, plus a flame caret.
const model = defineModel<string>({ required: true });
const props = defineProps<{
  disabled: boolean;
  placeholder: string;
  commands?: readonly SlashCommandInfo[];
}>();
const emit = defineEmits<{ submit: []; queue: [] }>();
const textarea = ref<HTMLTextAreaElement>();
const mirror = ref<HTMLElement>();
const underlay = ref<HTMLElement>();
const born = ref<number[]>([]); // When each character appeared, aligned with the text.
const now = ref(performance.now());
const caret = ref(-1); // Collapsed selection position while focused, else -1.
let timer = 0;

function updateCaret() {
  const element = textarea.value;
  caret.value =
    element && document.activeElement === element && element.selectionStart === element.selectionEnd
      ? element.selectionStart
      : -1;
}

/** Where the flame caret is on screen, for aiming sparks and ash. */
function caretPoint(): { x: number; y: number } | undefined {
  const box = mirror.value?.querySelector('.fire-caret')?.getBoundingClientRect();
  return box ? { x: box.left, y: box.top + box.height / 2 } : undefined;
}

// Track insertions by diffing against the previous value: shared prefix and suffix keep their ages.
watch(
  model,
  async (next, previous = '') => {
    let prefix = 0;
    while (prefix < next.length && prefix < previous.length && next[prefix] === previous[prefix])
      prefix++;
    let suffix = 0;
    while (
      suffix < next.length - prefix &&
      suffix < previous.length - prefix &&
      next[next.length - 1 - suffix] === previous[previous.length - 1 - suffix]
    )
      suffix++;
    const inserted = next.length - prefix - suffix;
    const removed = previous.length - prefix - suffix;
    const time = performance.now();
    // Pasting a wall of text should not animate thousands of spans.
    const fresh = Array.from({ length: inserted }, () => (inserted > 200 ? 0 : time));
    born.value = [
      ...born.value.slice(0, prefix),
      ...fresh,
      ...born.value.slice(previous.length - suffix),
    ];
    tickUntilCool();
    if (!effectsActive() || (inserted === 0 && removed === 0)) return;
    updateCaret();
    await nextTick();
    const point = caretPoint();
    if (inserted > 0 && inserted <= 200) {
      // Each keystroke throws sparks off the caret and stokes the fire a little.
      if (point) burst(point.x, point.y, 6, 0.55, 'spark');
      stoke(0.012);
    } else if (removed > 0 && point) {
      // Deleting burns the characters away into ash.
      burst(point.x, point.y, Math.min(24, 5 + removed * 3), 0.7, 'ash');
    }
  },
  { immediate: true },
);

// Re-render while anything is hot so finished characters drop their animation wrapper.
function tickUntilCool() {
  now.value = performance.now();
  if (timer) return;
  const step = () => {
    now.value = performance.now();
    timer = born.value.some((time) => now.value - time < hotMs) ? window.setTimeout(step, 120) : 0;
  };
  timer = window.setTimeout(step, 120);
}
const selectionChanged = () => {
  if (document.activeElement === textarea.value) updateCaret();
};
onMounted(() => document.addEventListener('selectionchange', selectionChanged));
onBeforeUnmount(() => {
  clearTimeout(timer);
  document.removeEventListener('selectionchange', selectionChanged);
});

// A trailing newline needs a character after it, or the mirror's last line collapses.
const html = computed(() =>
  effectsActive()
    ? hotHtml(model.value, (index) => now.value - (born.value[index] ?? 0), 0, caret.value) +
      (model.value.endsWith('\n') ? ' ' : '')
    : '',
);
type Token = { text: string; kind?: string };
/** A leading slash command split into chips drawn under the text: command name, then each argument. */
const commandTokens = computed<Token[] | undefined>(() => {
  const match = /^(\s*)\/([^\s]*)([\s\S]*)$/.exec(model.value);
  if (!match || !props.commands) return undefined;
  const [, lead, name, rest] = match;
  const command = props.commands.find((item) => item.name === name);
  const partial = !command && !!name && props.commands.some((item) => item.name.startsWith(name));
  const tokens: Token[] = [
    { text: lead },
    { text: `/${name}`, kind: command ? 'known' : partial || !name ? 'partial' : 'unknown' },
  ];
  const params = command?.params ?? [];
  let index = 0;
  const parts = rest.split(/(\s+)/);
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    if (!part) continue;
    if (/^\s+$/.test(part) || !command) {
      tokens.push({ text: part, kind: /^\s+$/.test(part) ? undefined : 'unknown' });
      continue;
    }
    const param = params[index];
    if (param?.rest) {
      tokens.push({ text: parts.slice(i).join('').trimEnd(), kind: 'arg' });
      const trailing = /\s*$/.exec(parts.slice(i).join(''))?.[0];
      if (trailing) tokens.push({ text: trailing });
      break;
    }
    tokens.push({ text: part, kind: param ? 'arg' : 'unknown' });
    index++;
  }
  if (model.value.endsWith('\n')) tokens.push({ text: ' ' });
  return tokens;
});
function syncScroll() {
  if (!textarea.value) return;
  if (mirror.value) mirror.value.scrollTop = textarea.value.scrollTop;
  if (underlay.value) underlay.value.scrollTop = textarea.value.scrollTop;
}
watch([html, commandTokens], () => requestAnimationFrame(syncScroll));
defineExpose({ focus: () => textarea.value?.focus(), element: textarea });
</script>

<template>
  <div
    class="composer-input"
    :class="{ mirrored: effectsActive() }"
  >
    <div
      v-if="commandTokens"
      ref="underlay"
      class="composer-command-underlay"
      aria-hidden="true"
    >
      <span
        v-for="(token, index) in commandTokens"
        :key="index"
        :class="token.kind && ['chip', token.kind]"
      >{{ token.text }}</span>
    </div>
    <!-- Text is escaped by hotHtml; the mirror only ever shows the user's own input. -->
    <!-- eslint-disable vue/no-v-html -->
    <div
      v-if="effectsActive()"
      ref="mirror"
      class="composer-mirror"
      aria-hidden="true"
      v-html="html"
    />
    <!-- eslint-enable vue/no-v-html -->
    <textarea
      ref="textarea"
      v-model="model"
      autocomplete="off"
      :disabled="props.disabled"
      :placeholder="props.placeholder"
      rows="3"
      :aria-label="t('Message the coding agent')"
      spellcheck="true"
      @scroll="syncScroll"
      @focus="updateCaret"
      @blur="caret = -1"
      @keydown.enter.exact.prevent="emit('submit')"
      @keydown.alt.enter.prevent="emit('queue')"
    />
  </div>
</template>
