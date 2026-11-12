import { computed, nextTick, onBeforeUnmount, ref, watch, type Component, type Ref } from 'vue';
import { t } from '../theme/i18n';

/** One entry in a settings section nav. `words` lists what its settings mention, so search finds them. */
export interface SettingsSection {
  id: string;
  label: string;
  icon: Component;
  words: string;
}

type HighlightRegistry = { set(name: string, value: unknown): void; delete(name: string): void };
const highlights = (globalThis.CSS as unknown as { highlights?: HighlightRegistry } | undefined)
  ?.highlights;
const HighlightCtor = (globalThis as unknown as { Highlight?: new (...ranges: Range[]) => unknown })
  .Highlight;

/**
 * Section nav search for settings modals: filters the sections, jumps to the first match when the open one
 * drops out, and highlights matches in the open section with the CSS Custom Highlight API (no DOM rewriting).
 */
export function useSettingsSearch(sections: readonly SettingsSection[], tab: Ref<string>) {
  const query = ref('');
  const body = ref<HTMLElement>();
  const words = computed(() => query.value.toLowerCase().split(/\s+/).filter(Boolean));
  const visible = computed(() =>
    sections.filter((section) => {
      const text = `${t(section.label)} ${section.label} ${section.words}`.toLowerCase();
      return words.value.every((word) => text.includes(word));
    }),
  );
  watch(visible, (list) => {
    if (list.length && !list.some((section) => section.id === tab.value)) tab.value = list[0].id;
  });

  function highlight() {
    if (!highlights) return;
    highlights.delete('settings-match');
    const root = body.value;
    if (!root || !words.value.length || !HighlightCtor) return;
    const ranges: Range[] = [];
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const text = node.textContent?.toLowerCase() ?? '';
      for (const word of words.value)
        for (let at = text.indexOf(word); at !== -1; at = text.indexOf(word, at + word.length)) {
          const range = new Range();
          range.setStart(node, at);
          range.setEnd(node, at + word.length);
          ranges.push(range);
        }
    }
    highlights.set('settings-match', new HighlightCtor(...ranges));
  }
  watch([words, tab], () => void nextTick(highlight));
  onBeforeUnmount(() => highlights?.delete('settings-match'));

  return { query, body, visible };
}
