/** Keeps a streaming reasoning block scrolled to its latest line as content grows. */
export const vAutoscroll = {
  mounted(el: HTMLElement, binding: { value: boolean }) {
    const observer = new MutationObserver(() => {
      if (binding.value) el.scrollTop = el.scrollHeight;
    });
    observer.observe(el, { childList: true, subtree: true, characterData: true });
    (el as HTMLElement & { __autoscroll?: MutationObserver }).__autoscroll = observer;
  },
  updated(el: HTMLElement, binding: { value: boolean }) {
    if (binding.value) el.scrollTop = el.scrollHeight;
  },
  unmounted(el: HTMLElement & { __autoscroll?: MutationObserver }) {
    el.__autoscroll?.disconnect();
  },
};
