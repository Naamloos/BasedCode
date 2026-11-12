<script setup lang="ts">
import { ref, onBeforeUnmount } from 'vue';
import { Gauge } from '../../icons';
import { formatCount, formatDuration, formatSpeed, type ModelUsage } from '../../utils/format';
import { t } from '../../theme/i18n';

defineProps<{ usage?: ModelUsage; model: string }>();
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
onBeforeUnmount(close);
</script>

<template>
  <div
    ref="root"
    class="model-usage"
  >
    <button
      type="button"
      class="model-usage-chip"
      :class="{ open }"
      :title="t('Usage statistics for {model}', { model })"
      :aria-label="t('Usage statistics for {model}', { model })"
      :aria-expanded="open"
      @click="toggle"
    >
      <Gauge :size="14" />
    </button>
    <div
      v-if="open"
      class="model-usage-panel"
      role="dialog"
      :aria-label="t('Model usage statistics')"
      @keydown.esc="close"
    >
      <header>
        <strong>{{ model }}</strong>
      </header>
      <p
        v-if="!usage"
        class="muted small"
      >
        {{ t('No prompts have run on this model yet. Stats appear after the first response.') }}
      </p>
      <dl v-else>
        <div>
          <dt>{{ t('Decode speed') }}</dt>
          <dd>{{ formatSpeed(usage.speed) }}</dd>
        </div>
        <div>
          <dt>{{ t('Last prompt') }}</dt>
          <dd>{{ formatSpeed(usage.lastSpeed) }}</dd>
        </div>
        <div>
          <dt>{{ t('Prompt processing') }}</dt>
          <dd>{{ formatSpeed(usage.promptSpeed) }}</dd>
        </div>
        <div>
          <dt>{{ t('Avg. first token') }}</dt>
          <dd>{{ formatDuration(usage.averageTtftMs) }}</dd>
        </div>
        <div>
          <dt>{{ t('Prompts') }}</dt>
          <dd>{{ usage.prompts }}</dd>
        </div>
        <div>
          <dt>{{ t('Output tokens') }}</dt>
          <dd>{{ formatCount(usage.outputTokens) }}</dd>
        </div>
        <div>
          <dt>{{ t('Input tokens') }}</dt>
          <dd>{{ formatCount(usage.inputTokens) }}</dd>
        </div>
        <div>
          <dt>{{ t('Generating') }}</dt>
          <dd>{{ formatDuration(usage.generationMs) }}</dd>
        </div>
      </dl>
      <footer
        v-if="usage?.lastUsed"
        class="muted small"
      >
        {{
          t('Last used {date} · speeds count decoding time only', {
            date: new Date(usage.lastUsed).toLocaleString(),
          })
        }}
      </footer>
    </div>
  </div>
</template>
