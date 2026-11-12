<script setup lang="ts">
import { computed } from 'vue';
import { Gauge } from '../../icons';
import type { RunStats } from '../../../shared/types';
import { formatCount, formatDuration, formatSpeed, tokensPerSecond } from '../../utils/format';
import { t } from '../../theme/i18n';

const props = defineProps<{ stats: RunStats; live: boolean }>();
const speed = computed(() => tokensPerSecond(props.stats));
const approx = computed(() => (props.stats.estimated ? '≈' : ''));
const promptSpeed = computed(() =>
  props.stats.promptMs > 0 && props.stats.inputTokens > 0
    ? props.stats.inputTokens / (props.stats.promptMs / 1000)
    : undefined,
);
const detail = computed(() =>
  [
    `${props.stats.provider} / ${props.stats.model}`,
    t('Output: {count} tokens', { count: `${approx.value}${props.stats.outputTokens}` }) +
      (props.stats.reasoningTokens
        ? ` (${t('{count} reasoning', { count: props.stats.reasoningTokens })})`
        : ''),
    t('Input: {count} tokens processed', { count: props.stats.inputTokens }),
    t('Decode speed: {speed} over {time}', {
      speed: formatSpeed(speed.value),
      time: formatDuration(props.stats.generationMs),
    }),
    t('Prompt processing: {speed} over {time}', {
      speed: formatSpeed(promptSpeed.value),
      time: formatDuration(props.stats.promptMs),
    }),
    t('Time to first token: {time}', { time: formatDuration(props.stats.ttftMs) }),
    t('Model calls: {steps} · Tool calls: {tools}', {
      steps: props.stats.steps,
      tools: props.stats.toolCalls,
    }),
    t('Total: {time}', { time: formatDuration(props.stats.totalMs) }),
    ...(props.stats.estimated
      ? [`≈ ${t('The provider did not report token counts; estimated from streamed chunks.')}`]
      : []),
  ].join('\n'),
);
</script>

<template>
  <div
    class="run-stats"
    :class="{ live }"
    :title="detail"
  >
    <Gauge :size="12" />
    <strong>{{ approx }}{{ formatSpeed(speed) }}</strong>
    <span>{{ approx }}{{ formatCount(stats.outputTokens) }} {{ t('tokens') }}</span>
    <span>TTFT {{ formatDuration(stats.ttftMs) }}</span>
    <span>{{ formatDuration(stats.totalMs) }}</span>
    <span v-if="stats.steps > 1 || stats.toolCalls">{{ t(stats.steps === 1 ? '{count} call' : '{count} calls', { count: stats.steps }) }} ·
      {{
        t(stats.toolCalls === 1 ? '{count} tool' : '{count} tools', { count: stats.toolCalls })
      }}</span>
    <span class="run-stats-model">{{ stats.model }}</span>
  </div>
</template>
