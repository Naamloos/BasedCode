import { nextTick, ref, watch, type Ref } from 'vue';

const highlights = (globalThis.CSS as unknown as { highlights?: Map<string, unknown> } | undefined)
  ?.highlights;

/**
 * Find in chat. Uses the CSS Custom Highlight API so the rendered messages are never modified.
 * `canOpen` guards against opening without a chat; changing `resetOn` closes the bar.
 */
export function useChatFind(conversation: Ref<HTMLElement | undefined>, canOpen: () => boolean, resetOn: Ref<unknown>) {
  const findOpen = ref(false);
  const findText = ref('');
  const findIndex = ref(0);
  const findCount = ref(0);
  let findRanges: Range[] = [];

  function clearFindHighlights() {
    highlights?.delete('chat-find');
    highlights?.delete('chat-find-current');
  }

  function runFind(scroll = true) {
    clearFindHighlights();
    findRanges = [];
    const root = conversation.value;
    const query = findText.value.trim().toLowerCase();
    if (!root || !query) {
      findCount.value = 0;
      return;
    }

    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      if (node.parentElement?.closest('script, style, .find-bar')) continue;
      const text = (node.textContent ?? '').toLowerCase();
      for (let index = text.indexOf(query); index >= 0; index = text.indexOf(query, index + query.length)) {
        const range = new Range();
        range.setStart(node, index);
        range.setEnd(node, index + query.length);
        findRanges.push(range);
      }
    }

    findCount.value = findRanges.length;
    if (findIndex.value >= findRanges.length) findIndex.value = 0;
    if (findRanges.length && highlights) highlights.set('chat-find', new Highlight(...findRanges));
    showFindHit(scroll);
  }

  function showFindHit(scroll = true) {
    const range = findRanges[findIndex.value];
    if (!range) return;
    highlights?.set('chat-find-current', new Highlight(range));
    if (scroll) range.startContainer.parentElement?.scrollIntoView({ block: 'center' });
  }

  function stepFind(direction: number) {
    if (!findRanges.length) return;
    findIndex.value = (findIndex.value + direction + findRanges.length) % findRanges.length;
    showFindHit();
  }

  function openFind() {
    if (!canOpen()) return;
    findOpen.value = true;
    void nextTick(() => {
      document.querySelector<HTMLInputElement>('.find-bar input')?.select();
      runFind();
    });
  }

  function closeFind() {
    findOpen.value = false;
    findRanges = [];
    findCount.value = 0;
    clearFindHighlights();
  }

  /** Re-runs an open search without scrolling, for when the conversation re-renders. */
  function refreshFind() {
    if (findOpen.value && findText.value.trim()) void nextTick(() => runFind(false));
  }

  watch(findText, () => {
    findIndex.value = 0;
    runFind();
  });
  watch(resetOn, closeFind);

  return { findOpen, findText, findIndex, findCount, stepFind, openFind, closeFind, refreshFind };
}
