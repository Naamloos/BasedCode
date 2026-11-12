import { ref } from 'vue';

/** Owns pane dimensions, drag handlers and their saved preferences. */
export function usePaneLayout() {
  const paneDefaults = { left: 264, right: 360, terminal: 220 };
  const terminalHeight = ref(paneDefaults.terminal);
  const leftWidth = ref(paneDefaults.left);
  const rightWidth = ref(paneDefaults.right);
  try {
    const saved = JSON.parse(localStorage.getItem('pane-sizes-v2') ?? '{}') as {
      left?: number;
      right?: number;
      terminal?: number;
    };
    if (saved.left) leftWidth.value = saved.left;
    if (saved.right) rightWidth.value = saved.right;
    if (saved.terminal) terminalHeight.value = saved.terminal;
  } catch {
    /* fall back to the defaults */
  }
  /** Drags a pane edge: `apply` gets the pointer's offset from where the drag started. Saves pane sizes when done. */
  function dragEdge(event: PointerEvent, axis: 'x' | 'y', apply: (offset: number) => void) {
    const initial = axis === 'x' ? event.clientX : event.clientY;
    const move = (pointer: PointerEvent) =>
      apply((axis === 'x' ? pointer.clientX : pointer.clientY) - initial);
    const stop = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', stop);
      document.body.classList.remove('resizing');
      savePaneSizes();
    };
    document.body.classList.add('resizing');
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', stop);
  }
  function savePaneSizes() {
    try {
      localStorage.setItem(
        'pane-sizes-v2',
        JSON.stringify({
          left: leftWidth.value,
          right: rightWidth.value,
          terminal: terminalHeight.value,
        }),
      );
    } catch {
      /* sizes are a convenience */
    }
  }
  /** Double-clicking a handle snaps that pane back to its default size. */
  function resetPane(pane: keyof typeof paneDefaults) {
    ({ left: leftWidth, right: rightWidth, terminal: terminalHeight })[pane].value =
      paneDefaults[pane];
    savePaneSizes();
  }
  function resizeTerminal(event: PointerEvent) {
    const height = terminalHeight.value;
    dragEdge(event, 'y', (offset) => {
      terminalHeight.value = Math.max(100, Math.min(innerHeight - 280, height - offset));
    });
  }
  function resizeLeft(event: PointerEvent) {
    const width = leftWidth.value;
    dragEdge(event, 'x', (offset) => {
      leftWidth.value = Math.max(180, Math.min(480, width + offset));
    });
  }
  function resizeRight(event: PointerEvent) {
    const width = rightWidth.value;
    dragEdge(event, 'x', (offset) => {
      rightWidth.value = Math.max(
        240,
        Math.min(innerWidth - leftWidth.value - 360, width - offset),
      );
    });
  }

  return {
    terminalHeight,
    leftWidth,
    rightWidth,
    resetPane,
    resizeTerminal,
    resizeLeft,
    resizeRight,
  };
}
