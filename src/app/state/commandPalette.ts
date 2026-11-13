import { computed, nextTick, ref, watch, type Ref } from 'vue';
import { t } from '../theme/themes';

export interface PaletteItem {
  id: string;
  label: string;
  section: string;
  hint?: string;
  icon: unknown;
  run: () => unknown;
}

export function useCommandPalette(
  paletteItems: Ref<PaletteItem[]>,
  perform: (action: () => Promise<void>) => unknown,
) {
  const paletteOpen = ref(false);
  const paletteText = ref('');
  const paletteIndex = ref(0);
  function openPalette() {
    paletteOpen.value = true;
    paletteText.value = '';
    paletteIndex.value = 0;
    void nextTick(() => document.querySelector<HTMLInputElement>('.palette input')?.focus());
  }
  function closePalette() {
    paletteOpen.value = false;
  }

  /** Palette group order: Chats, Actions, Settings, then files and workspaces. */
  const paletteSectionOrder = computed(() => [
    t('Chats'), t('Actions'), t('Settings'), t('Files'), t('Workspaces'),
  ]);
  const paletteResults = computed(() => {
    const words = paletteText.value.toLowerCase().split(/\s+/).filter(Boolean);
    const matches = words.length
      ? paletteItems.value.filter((item) => {
          const text = `${item.label} ${item.section} ${item.hint ?? ''}`.toLowerCase();
          return words.every((word) => text.includes(word));
        })
      : paletteItems.value.filter((item) => item.section !== t('Chats')).concat(
          paletteItems.value.filter((item) => item.section === t('Chats')).slice(0, 8),
        );
    // Stable sort keeps each group's own order while the groups follow paletteSectionOrder.
    const rank = (section: string) => {
      const index = paletteSectionOrder.value.indexOf(section);
      return index === -1 ? paletteSectionOrder.value.length : index;
    };
    return [...matches].sort((a, b) => rank(a.section) - rank(b.section)).slice(0, 60);
  });
  watch(paletteText, () => (paletteIndex.value = 0));
  function paletteKey(event: KeyboardEvent) {
    const count = paletteResults.value.length;
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      if (count) paletteIndex.value = (paletteIndex.value + (event.key === 'ArrowDown' ? 1 : -1) + count) % count;
      void nextTick(() => document.querySelector('.palette .active')?.scrollIntoView({ block: 'nearest' }));
    } else if (event.key === 'Enter') {
      event.preventDefault();
      const item = paletteResults.value[paletteIndex.value];
      if (item) runPaletteItem(item);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      closePalette();
    }
  }
  function runPaletteItem(item: PaletteItem) {
    closePalette();
    void perform(async () => {
      await item.run();
    });
  }

  return {
    paletteOpen, paletteText, paletteIndex, openPalette, closePalette,
    paletteResults, paletteKey, runPaletteItem,
  };
}
