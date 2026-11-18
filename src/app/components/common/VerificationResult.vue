<script setup lang="ts">
import type { VerificationResult } from '../../../shared/verification';
import { t } from '../../theme/themes';

defineProps<{ result: VerificationResult; showName?: boolean }>();
</script>

<template>
  <div class="verification-result">
    <p role="status">
      <strong v-if="showName">{{ result.name }} · </strong>
      <span :class="{ 'error-text': result.status === 'failed' }">{{
        t(result.stoppedByUser ? 'Check stopped' : result.timedOut ? 'Check timed out' :
          result.status === 'passed' ? 'Check passed' : 'Check failed')
      }}</span>
    </p>
    <details v-if="result.outputTail">
      <summary>{{ t('Output') }}</summary>
      <pre>{{ result.outputTail }}</pre>
    </details>
  </div>
</template>

<style scoped>
.verification-result {
  min-width: 0;
}
.verification-result pre {
  max-height: 12rem;
  overflow: auto;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
</style>
