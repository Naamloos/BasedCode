<script setup lang="ts">
import { computed, ref } from 'vue';
import type { Message } from '../../../shared/types';
import { rpc } from '../../services/api';
import { t } from '../../theme/themes';

const props = defineProps<{ message: Message; active: boolean }>();
const tool = computed(() => props.message.metadata.tool as {
  args: { question: string; options?: string[] };
  result?: { queryId?: string; answer?: string };
  error?: string;
});
const reply = ref('');
const sending = ref(false);
const error = ref('');

async function send(value: string) {
  if (sending.value || !props.active || !tool.value.result?.queryId || !value.trim()) return;
  sending.value = true;
  error.value = '';
  try {
    await rpc('query.answer', { messageId: props.message.id, value });
  } catch (failure) {
    error.value = failure instanceof Error ? failure.message : String(failure);
    sending.value = false;
  }
}
</script>

<template>
  <div class="tool-card async-question">
    <p>{{ tool.args.question }}</p>
    <form
      v-if="active && tool.result?.queryId"
      @submit.prevent="send(reply)"
    >
      <button
        v-for="(option, index) in tool.args.options"
        :key="index"
        class="secondary-button"
        type="button"
        :disabled="sending"
        @click="send(option)"
      >
        {{ option }}
      </button>
      <label>
        {{ t('Reply while the agent works') }}
        <textarea
          v-model="reply"
          rows="2"
          maxlength="20000"
          :disabled="sending"
        />
      </label>
      <button
        class="secondary-button"
        type="submit"
        :disabled="sending || !reply.trim()"
      >
        {{ t('Send') }}
      </button>
    </form>
    <p
      v-else-if="tool.result?.answer"
      class="answer"
    >
      {{ tool.result.answer }}
    </p>
    <p
      v-else-if="!active && !tool.error"
      class="muted"
    >
      {{ t('Question closed') }}
    </p>
    <p
      v-if="error || tool.error"
      class="error-text"
      role="alert"
    >
      {{ error || tool.error }}
    </p>
  </div>
</template>

<style scoped>
.async-question {
  padding: 12px;
  overflow-wrap: anywhere;
}
.async-question p {
  white-space: pre-wrap;
}
.async-question form {
  display: grid;
  justify-items: start;
  gap: 8px;
}
.async-question label {
  width: 100%;
}
</style>
