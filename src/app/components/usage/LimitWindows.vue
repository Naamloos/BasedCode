<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from 'vue';
import type { LimitWindow, ProviderLimits } from '../../../shared/types';
import { t } from '../../theme/i18n';

// Compact: a round usage ring for the composer that opens a popover. Full: labelled bars with reset times for the dashboard.
const props = defineProps<{ limits?: ProviderLimits; compact?: boolean }>();
const emit = defineEmits<{ dashboard: [] }>();

function resetText(window: LimitWindow): string {
  if (!window.resetsAt) return '';
  const minutes = Math.round((new Date(window.resetsAt).getTime() - Date.now()) / 60_000);
  if (minutes <= 0) return t('resets now');
  if (minutes < 60) return t('resets in {time}', { time: `${minutes}m` });
  if (minutes < 48 * 60)
    return t('resets in {time}', { time: `${Math.floor(minutes / 60)}h ${minutes % 60}m` });
  return t('resets {date}', {
    date: new Date(window.resetsAt).toLocaleDateString(undefined, {
      weekday: 'short',
      hour: 'numeric',
      minute: '2-digit',
    }),
  });
}
const tone = (window: LimitWindow) =>
  window.status === 'rejected' || (window.usedPercent ?? 0) >= 90
    ? 'danger'
    : window.status === 'allowed_warning' || (window.usedPercent ?? 0) >= 70
      ? 'warn'
      : '';
const age = computed(() => {
  if (!props.limits) return '';
  const minutes = Math.round((Date.now() - new Date(props.limits.updatedAt).getTime()) / 60_000);
  return minutes < 1
    ? t('just now')
    : t('{time} ago', { time: minutes < 60 ? `${minutes}m` : `${Math.round(minutes / 60)}h` });
});
const name = computed(() =>
  props.limits?.kind === 'codex' ? 'Codex' : props.limits?.kind === 'antigravity' ? 'Antigravity' : 'Claude',
);

// The ring shows the most constrained window, so it warns as soon as any limit gets close.
const worst = computed(() =>
  props.limits?.windows.reduce<LimitWindow | undefined>(
    (most, window) =>
      !most || (window.usedPercent ?? 0) > (most.usedPercent ?? 0) || window.status === 'rejected'
        ? window
        : most,
    undefined,
  ),
);
const RADIUS = 7;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;
const dash = computed(
  () => CIRCUMFERENCE * (1 - Math.min(100, worst.value?.usedPercent ?? 0) / 100),
);

const open = ref(false);
const root = ref<HTMLElement>();
function outside(event: PointerEvent) {
  if (!root.value?.contains(event.target as Node)) close();
}
function close() {
  open.value = false;
  window.removeEventListener('pointerdown', outside);
}
function toggle() {
  if (open.value) {
    close();
    return;
  }
  open.value = true;
  window.addEventListener('pointerdown', outside);
}
function showDashboard() {
  close();
  emit('dashboard');
}
onBeforeUnmount(close);
</script>

<template>
  <div
    v-if="compact && limits?.windows.length"
    ref="root"
    class="limit-ring-wrap"
  >
    <button
      type="button"
      class="limit-ring"
      :class="[worst && tone(worst), { open }]"
      :title="t('{name} usage windows ({source}, {age})', { name, source: limits.source, age })"
      :aria-expanded="open"
      @click="toggle"
    >
      <svg
        viewBox="0 0 18 18"
        width="18"
        height="18"
        aria-hidden="true"
      >
        <circle
          class="limit-ring-track"
          cx="9"
          cy="9"
          :r="RADIUS"
        />
        <circle
          class="limit-ring-fill"
          cx="9"
          cy="9"
          :r="RADIUS"
          :stroke-dasharray="CIRCUMFERENCE"
          :stroke-dashoffset="dash"
        />
      </svg>
    </button>
    <div
      v-if="open"
      class="limit-popover"
      role="dialog"
      :aria-label="
        t('{name} usage windows ({source}, {age})', { name, source: limits.source, age })
      "
      @keydown.esc="close"
    >
      <header>
        <strong>{{ t('{name} usage', { name }) }}</strong>
      </header>
      <div class="limit-windows">
        <div
          v-for="window in limits.windows"
          :key="window.label"
          class="limit-row"
          :class="tone(window)"
        >
          <span class="limit-label">{{ window.label }}</span><span class="limit-track"><span :style="{ width: `${Math.min(100, window.usedPercent ?? 0)}%` }" /></span><span class="limit-value">{{
            window.usedPercent === undefined
              ? t(window.status === 'rejected' ? 'limit hit' : 'ok')
              : `${window.usedPercent}%`
          }}</span><span class="limit-reset">{{ resetText(window) }}</span>
        </div>
      </div>
      <footer>
        <span class="muted small">{{ limits.plan ? `${t('{plan} plan', { plan: limits.plan })} · ` : ''
        }}{{ t('From {source}, {age}.', { source: limits.source.toLowerCase(), age }) }}</span>
        <button
          type="button"
          class="text-button"
          @click="showDashboard"
        >
          {{ t('Usage dashboard') }}
        </button>
      </footer>
    </div>
  </div>
  <div
    v-else-if="!compact && limits"
    class="limit-windows"
  >
    <div
      v-for="window in limits.windows"
      :key="window.label"
      class="limit-row"
      :class="tone(window)"
    >
      <span class="limit-label">{{ window.label }}</span><span class="limit-track"><span :style="{ width: `${Math.min(100, window.usedPercent ?? 0)}%` }" /></span><span class="limit-value">{{
        window.usedPercent === undefined
          ? t(window.status === 'rejected' ? 'limit hit' : 'ok')
          : `${window.usedPercent}%`
      }}</span><span class="limit-reset">{{ resetText(window) }}</span>
    </div>
    <p class="muted small">
      {{ limits.plan ? `${t('{plan} plan', { plan: limits.plan })} · ` : ''
      }}{{ t('From {source}, {age}.', { source: limits.source.toLowerCase(), age }) }}
    </p>
  </div>
</template>
