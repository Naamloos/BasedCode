/**
 * App-wide silly effects layered on the particle and stamp system. Every effect goes through
 * burst/stamp/stoke, which already do nothing when effects are off or motion is reduced.
 */
import { burst, burstFrom, stamp, stoke } from './effects';

const KONAMI = [
  'ArrowUp', 'ArrowUp', 'ArrowDown', 'ArrowDown',
  'ArrowLeft', 'ArrowRight', 'ArrowLeft', 'ArrowRight', 'b', 'a',
];
const CLOSE_QUIPS = ['YEET', 'BEGONE', 'GONE', 'BYE'];
const RAGE_QUIPS = ['CALM DOWN', 'TOUCH GRASS', 'RAGE CLICK', 'EASY THERE'];
const SAVE_QUIPS = ['SAVED. PROBABLY.', 'CTRL+S ENJOYER', 'SECURED'];

const pick = (list: string[]) => list[Math.floor(Math.random() * list.length)];

/** Attaches the listeners and returns a function that removes them. */
export function installAntics(): () => void {
  let konami = 0;
  let typed = '';

  /** Briefly adds a class to <html>; the CSS only reacts inside .effects-on. */
  function flashClass(name: string, ms: number) {
    document.documentElement.classList.add(name);
    setTimeout(() => document.documentElement.classList.remove(name), ms);
  }
  const WORDS: Record<string, () => void> = {
    based: () => stamp('BASED'),
    disco: () => {
      stamp('DISCO MODE');
      flashClass('antics-disco', 5000);
    },
    yolo: () => {
      stamp('YOLO');
      burst(window.innerWidth / 2, window.innerHeight / 2, 120, 2);
    },
    fire: () => stoke(1),
  };

  // Triple-click also starts disco mode.
  function onClick(event: MouseEvent) {
    if (event.detail === 3) {
      flashClass('antics-disco', 3000);
    }
  }
  let clicks: number[] = [];

  function onPointerDown(event: PointerEvent) {
    const target = event.target as Element | null;
    const button = target?.closest('button, [role="button"], a');
    if (!button) return;

    // Closing a tab burns it to ash.
    if (button.matches('.file-tab .icon-button')) {
      burstFrom(button.closest('.file-tab'), 45, 1, 'ash');
      if (Math.random() < 0.25) stamp(pick(CLOSE_QUIPS));
      return;
    }

    // Every button click throws a few sparks.
    burst(event.clientX, event.clientY, 10, 0.6, 'spark');
    stoke(0.01);

    // Clicking 6 or more times in under 1.2 seconds counts as a rage click.
    const now = performance.now();
    clicks = [...clicks.filter((time) => now - time < 1200), now];
    if (clicks.length >= 6) {
      clicks = [];
      stamp(pick(RAGE_QUIPS));
      document.documentElement.classList.add('antics-shake');
      setTimeout(() => document.documentElement.classList.remove('antics-shake'), 500);
    }
  }

  function onKeyDown(event: KeyboardEvent) {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
      stamp(pick(SAVE_QUIPS));
    }

    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'c' && Math.random() < 0.3)
      stamp(pick(['STOLEN', 'YOINK', 'COPYPASTA']));
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z' && Math.random() < 0.3)
      stamp(pick(['IT NEVER HAPPENED', 'REWIND', 'NOPE']));

    // Typed words anywhere trigger easter eggs.
    const editing = (event.target as Element | null)?.closest?.(
      'input, textarea, select, [contenteditable]:not([contenteditable="false"])',
    );
    if (editing) typed = '';
    else if (event.key.length === 1) {
      typed = (typed + event.key.toLowerCase()).slice(-12);
      const word = Object.keys(WORDS).find((candidate) => typed.endsWith(candidate));
      if (word) {
        typed = '';
        WORDS[word]();
      }
    }

    const expected = KONAMI[konami];
    konami = event.key === expected ? konami + 1 : event.key === KONAMI[0] ? 1 : 0;
    if (konami === KONAMI.length) {
      konami = 0;
      stamp('ULTRA BASED');
      stoke(1);
      const { innerWidth: width, innerHeight: height } = window;
      for (let i = 0; i < 6; i++) {
        setTimeout(() => burst(Math.random() * width, Math.random() * height, 60, 1.6), i * 120);
      }
      document.documentElement.classList.add('antics-barrel');
      setTimeout(() => document.documentElement.classList.remove('antics-barrel'), 1000);
    }
  }

  // Cursor trail: a couple of embers every few frames, more when the mouse moves fast.
  let lastTrail = 0;
  let lastX = 0;
  let lastY = 0;
  function onPointerMove(event: PointerEvent) {
    const now = performance.now();
    if (now - lastTrail < 28) return;
    const speed = Math.hypot(event.clientX - lastX, event.clientY - lastY);
    lastTrail = now;
    lastX = event.clientX;
    lastY = event.clientY;
    burst(event.clientX, event.clientY, speed > 60 ? 4 : 1, 0.25, speed > 60 ? 'spark' : 'ember');
    resetIdle();
  }

  // Double-click anywhere detonates.
  function onDoubleClick(event: MouseEvent) {
    burst(event.clientX, event.clientY, 50, 1.3);
  }

  // Typing in any field sends sparks off the field and heats things up.
  function onInput(event: Event) {
    const field = event.target as HTMLElement | null;
    if (!field?.matches('input, textarea, [contenteditable]')) return;
    const box = field.getBoundingClientRect();
    burst(box.left + Math.random() * box.width, box.top, 2, 0.4, 'spark');
  }

  // Fast scrolling throws embers from the edge you're scrolling toward.
  function onWheel(event: WheelEvent) {
    if (Math.abs(event.deltaY) < 120) return;
    const y = event.deltaY > 0 ? window.innerHeight - 10 : 10;
    burst(event.clientX, y, 6, 0.8);
  }

  // Coming back to the window, or sitting idle, gets commentary.
  let idleTimer: ReturnType<typeof setTimeout> | undefined;
  function resetIdle() {
    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => stamp(pick(['HELLO?', 'STILL THERE?', 'AFK?'])), 90_000);
  }
  let leftAt = 0;
  function onVisibility() {
    if (document.hidden) leftAt = Date.now();
    else if (leftAt && Date.now() - leftAt > 30_000) stamp('WELCOME BACK');
  }

  resetIdle();
  const listeners: [EventTarget, string, EventListener][] = [
    [document, 'pointerdown', onPointerDown as EventListener],
    [document, 'keydown', onKeyDown as EventListener],
    [document, 'pointermove', onPointerMove as EventListener],
    [document, 'dblclick', onDoubleClick as EventListener],
    [document, 'click', onClick as EventListener],
    [document, 'input', onInput],
    [document, 'wheel', onWheel as EventListener],
    [document, 'visibilitychange', onVisibility],
  ];
  for (const [target, type, listener] of listeners)
    target.addEventListener(type, listener, { capture: true, passive: true });
  return () => {
    clearTimeout(idleTimer);
    for (const [target, type, listener] of listeners)
      target.removeEventListener(type, listener, { capture: true });
  };
}
