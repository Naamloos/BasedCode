import { ref, watch } from 'vue';

function readEnabled(): boolean {
  try {
    return localStorage.getItem('basedcode.effects') === 'on';
  } catch {
    return false;
  }
}
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

/** Flames, embers and hot characters. Off by default, off when the system asks for reduced motion, switchable from the status bar. */
export const effectsEnabled = ref(readEnabled());
export const motionAllowed = ref(!reducedMotion.matches);
reducedMotion.addEventListener('change', () => {
  motionAllowed.value = !reducedMotion.matches;
});
watch(effectsEnabled, (enabled) => {
  try {
    localStorage.setItem('basedcode.effects', enabled ? 'on' : 'off');
  } catch {
    /* Preference only. */
  }
});
export const effectsActive = () => effectsEnabled.value && motionAllowed.value;

/** Flame intensity from 0 to 1. Streaming tokens stoke it; it settles back to a low idle burn. */
export const heat = ref(0.3);

/** WebGL renderer the fire ended up on (e.g. "NVIDIA GeForce …" or "SwiftShader"), shown in the status bar tooltip. */
export const webglRenderer = ref('');

/** Live effect stats, updated once per second: page fps, worst frame gap, effect JS time per tick, particle count. */
export const effectsStats = ref('');
export function stoke(amount: number) {
  if (effectsActive()) heat.value = Math.min(1, heat.value + amount);
}

/**
 * Particle bursts requested by the UI, drawn by the flame layer. Coordinates are viewport pixels.
 * ember: soft glowing blobs that float up. spark: fast bright streaks. ash: grey flakes that drift down.
 */
export type ParticleKind = 'ember' | 'spark' | 'ash';
export interface Burst {
  x: number;
  y: number;
  count: number;
  power: number;
  kind: ParticleKind;
}
const burstListeners = new Set<(burst: Burst) => void>();
export function onBurst(listener: (burst: Burst) => void) {
  burstListeners.add(listener);
  return () => burstListeners.delete(listener);
}
export function burst(x: number, y: number, count = 40, power = 1, kind: ParticleKind = 'ember') {
  if (!effectsActive()) return;
  for (const listener of burstListeners) listener({ x, y, count, power, kind });
}
export function burstFrom(
  element: Element | null | undefined,
  count = 40,
  power = 1,
  kind: ParticleKind = 'ember',
) {
  const box = element?.getBoundingClientRect();
  if (box) burst(box.left + box.width / 2, box.top + box.height / 2, count, power, kind);
}

/** One-shot "stamp" text slammed onto the screen (completion, combo milestones). */
const stampListeners = new Set<(text: string) => void>();
export function onStamp(listener: (text: string) => void) {
  stampListeners.add(listener);
  return () => stampListeners.delete(listener);
}
// Streamed replies reveal gradually; a stamp waits until every reveal has caught up, so it lands on a settled screen.
const reveals = ref(0);
export function holdReveal() {
  reveals.value++;
}
export function releaseReveal() {
  reveals.value = Math.max(0, reveals.value - 1);
}
export function stamp(text: string) {
  if (!effectsActive()) return;
  const fire = () => {
    for (const listener of stampListeners) listener(text);
  };
  if (reveals.value === 0) {
    fire();
    return;
  }
  const stop = watch(reveals, (count) => {
    if (count === 0) {
      stop();
      setTimeout(fire, 250);
    }
  });
}

/** How long a character stays "hot" (shaking, glowing) after it appears. Matches the CSS animation. */
export const hotMs = 1100;

// Deterministic per-position jitter, so a character keeps its shake direction across re-renders.
const hash = (value: number) => {
  const s = Math.sin(value * 127.1 + 311.7) * 43758.5453;
  return s - Math.floor(s);
};
const escape = (text: string) =>
  text.replace(
    /[&<>"]/g,
    (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[char]!,
  );

/** Style for one hot character: random direction and a negative delay so a re-render resumes mid-animation instead of restarting. */
export function hotStyle(index: number, age: number): string {
  const x = ((hash(index) * 2 - 1) * 7).toFixed(1);
  const y = ((hash(index + 0.37) * 2 - 1) * 6).toFixed(1);
  const r = ((hash(index + 0.71) * 2 - 1) * 22).toFixed(1);
  return `--x:${x}px;--y:${y}px;--r:${r}deg;animation-delay:${-Math.round(age)}ms`;
}

/**
 * HTML for text whose characters have individual ages (ms since they appeared).
 * Hot characters become animated inline-blocks; each word holding one is kept on a single line,
 * so the animation never changes where lines wrap.
 */
export function hotHtml(
  text: string,
  ageOf: (index: number) => number,
  indexOffset = 0,
  caretIndex = -1,
): string {
  // The fire caret is a zero-width marker, so drawing it never moves text.
  const caret = '<span class="fire-caret"></span>';
  let html = '';
  for (const part of text.matchAll(/\s+|\S+/g)) {
    const start = part.index!;
    const value = part[0];
    if (/^\s/.test(value)) {
      const at = caretIndex - start;
      html +=
        at >= 0 && at < value.length
          ? escape(value.slice(0, at)) + caret + escape(value.slice(at))
          : escape(value);
      continue;
    }
    let word = '';
    let hot = false;
    for (let offset = 0; offset < value.length; offset++) {
      const index = start + offset;
      if (index === caretIndex) word += caret;
      const age = ageOf(index);
      const char = escape(value[offset]);
      if (age < hotMs) {
        hot = true;
        word += `<span class="hot-char" style="${hotStyle(index + indexOffset, age)}">${char}</span>`;
      } else word += char;
    }
    html += hot ? `<span class="hot-word">${word}</span>` : word;
  }
  if (caretIndex === text.length) html += caret;
  return html;
}
