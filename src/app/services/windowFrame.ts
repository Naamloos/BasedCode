import { ref, onMounted, onBeforeUnmount } from 'vue';
import { confirmAction } from '../state/dialogs';
import { t } from '../theme/i18n';

/**
 * Bridge to the NW.js shell for the frameless window. The app runs in a frame without desktop access,
 * so window buttons and drag areas are forwarded to the shell by postMessage.
 * The frame is marked nwfaketop, so window.parent points at itself; the shell therefore messages first
 * and the app answers through that message's source. In a plain browser tab no shell speaks and the controls stay hidden.
 */
export function useWindowFrame() {
  const embedded = ref(false);
  const maximized = ref(false);
  let shell: MessageEventSource | null = null;
  let shellOrigin = '';
  const send = (message: Record<string, unknown>) => {
    shell?.postMessage({ source: 'basedcode-app', ...message }, { targetOrigin: shellOrigin });
  };
  const command = (name: 'minimize' | 'toggle-maximize' | 'close' | 'reload') =>
    send({ type: 'window-command', command: name });

  // A pending native folder dialog; the shell answers with 'folder-picked'.
  let folderAnswer: ((path: string | null) => void) | undefined;
  /**
   * Shows the shell's native folder dialog. Resolves to the chosen path, or null when cancelled.
   * Returns undefined without a shell (a browser tab, e.g. remote access): callers fall back to the built-in picker.
   */
  function pickFolder(): Promise<string | null> | undefined {
    if (!embedded.value) return undefined;
    folderAnswer?.(null);
    return new Promise((resolve) => {
      folderAnswer = resolve;
      send({ type: 'pick-folder' });
    });
  }

  // A pending native file dialog; the shell answers with 'files-picked'.
  let filesAnswer: ((paths: string[]) => void) | undefined;
  /** Native multi-file dialog. Resolves to absolute paths ([] when cancelled); undefined without a shell. */
  function pickFiles(): Promise<string[]> | undefined {
    if (!embedded.value) return undefined;
    filesAnswer?.([]);
    return new Promise((resolve) => {
      filesAnswer = resolve;
      send({ type: 'pick-files' });
    });
  }

  let frame = 0;
  // Elements marked data-drag-region move the window; their boxes are mirrored as drag areas in the shell.
  function reportDragRegions() {
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(() => {
      const rects = [...document.querySelectorAll<HTMLElement>('[data-drag-region]')]
        .map((element) => element.getBoundingClientRect())
        .filter((rect) => rect.width > 0 && rect.height > 0)
        .map((rect) => ({ x: rect.x, y: rect.y, width: rect.width, height: rect.height }));
      send({ type: 'drag-regions', rects });
    });
  }

  const observer = new ResizeObserver(reportDragRegions);
  async function received(event: MessageEvent) {
    // Only the NW.js app shell (a chrome-extension origin) can drive the window state.
    if (
      !event.source ||
      event.source === window ||
      !event.origin.startsWith('chrome-extension://') ||
      event.data?.source !== 'basedcode-shell'
    )
      return;
    if (event.data.type === 'confirm-close' && event.source === shell) {
      const approved = await confirmAction(
        t('Quit BasedCode?'),
        String(event.data.detail),
        t('Quit'),
      );
      send({ type: 'close-decision', approved });
      return;
    }
    if (event.data.type === 'folder-picked' && event.source === shell) {
      const path = event.data.path;
      folderAnswer?.(typeof path === 'string' && path ? path : null);
      folderAnswer = undefined;
      return;
    }
    if (event.data.type === 'files-picked' && event.source === shell) {
      const paths = Array.isArray(event.data.paths) ? event.data.paths : [];
      filesAnswer?.(paths.filter((path: unknown): path is string => typeof path === 'string' && !!path));
      filesAnswer = undefined;
      return;
    }
    if (event.data.type !== 'window-state') return;
    maximized.value = Boolean(event.data.maximized);
    if (!embedded.value) {
      shell = event.source;
      shellOrigin = event.origin;
      embedded.value = true;
      for (const element of document.querySelectorAll('[data-drag-region]'))
        observer.observe(element);
    }
    reportDragRegions();
  }

  onMounted(() => {
    window.addEventListener('message', received);
    window.addEventListener('resize', reportDragRegions);
  });
  onBeforeUnmount(() => {
    window.removeEventListener('message', received);
    window.removeEventListener('resize', reportDragRegions);
    observer.disconnect();
  });

  return { embedded, maximized, command, pickFolder, pickFiles };
}
