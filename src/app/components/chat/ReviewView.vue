<script setup lang="ts">
import { computed } from 'vue';
import { LoaderCircle, MessageSquareQuote, Trash2, Wrench } from '../../icons';
import type { Chat, Message, Run } from '../../../shared/types';
import MarkdownView from './MarkdownView.vue';
import { t } from '../../theme/themes';

/** A second opinion shown as a read-only document in its own tab, not as a chat. */
const props = defineProps<{
  review: Chat;
  run?: Run;
  reviewedPrompt?: string;
  messages: Message[];
  workspaceId: string;
  /** The reviewed chat is busy, so asking it to address the review must wait. */
  busy: boolean;
}>();
const emit = defineEmits<{ address: []; delete: []; link: [url: string] }>();

const working = computed(() =>
  ['queued', 'running', 'paused', 'awaiting_approval'].includes(props.run?.status ?? 'queued'),
);
const text = computed(() =>
  props.messages
    .filter((message) => message.role === 'assistant' && message.content.trim())
    .map((message) => message.content)
    .join('\n\n'),
);
const tools = computed(() => props.messages.filter((message) => message.role === 'tool'));
const toolLabel = (message: Message) => {
  const tool = message.metadata.tool as { name?: string; args?: Record<string, unknown> } | undefined;
  return `${tool?.name ?? 'tool'} ${String(tool?.args?.path ?? tool?.args?.query ?? tool?.args?.pattern ?? '').slice(0, 80)}`;
};
</script>

<template>
  <section class="review-view">
    <header class="review-view-head">
      <MessageSquareQuote :size="16" />
      <div class="review-view-title">
        <strong>{{ t('Second opinion') }}</strong>
        <span class="muted">{{ run?.provider ?? review.title }}</span>
      </div>
      <span class="spacer" />
      <button
        class="secondary-button"
        :disabled="busy || run?.status !== 'completed'"
        :title="t('Ask this chat\'s model to check the review\'s findings and fix the ones that hold up')"
        @click="emit('address')"
      >
        {{ t('Address it') }}
      </button>
      <button
        class="icon-button"
        :disabled="working"
        :title="t('Delete this review')"
        @click="emit('delete')"
      >
        <Trash2 :size="14" />
      </button>
    </header>
    <div class="review-view-body">
      <p
        v-if="reviewedPrompt"
        class="review-view-prompt"
      >
        <span class="muted">{{ t('Reviewing:') }}</span> {{ reviewedPrompt }}
      </p>
      <details
        v-if="tools.length"
        class="review-view-tools"
      >
        <summary><Wrench :size="12" /> {{ t('{count} file(s) and searches read', { count: tools.length }) }}</summary>
        <ul>
          <li
            v-for="message in tools"
            :key="message.id"
          >
            {{ toolLabel(message) }}
          </li>
        </ul>
      </details>
      <MarkdownView
        v-if="text"
        :content="text"
        :streaming="working"
        :workspace-id="workspaceId"
        @link="(url) => emit('link', url)"
      />
      <p
        v-if="working"
        class="muted review-view-status"
      >
        <LoaderCircle
          :size="13"
          class="spin"
        /> {{ t('Reviewing…') }}
      </p>
      <p
        v-else-if="run?.status !== 'completed'"
        class="error-text"
      >
        {{ run?.error ?? t('The review did not finish.') }}
      </p>
    </div>
  </section>
</template>

<style scoped>
.review-view {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
}
.review-view-head {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 20px;
  border-bottom: 1px solid var(--border);
}
.review-view-title {
  display: flex;
  flex-direction: column;
  font-size: 13px;
  min-width: 0;
}
.review-view-title span {
  font-size: 12px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.spacer {
  flex: 1;
}
.review-view-body {
  flex: 1;
  overflow-y: auto;
  padding: 16px clamp(16px, 4vw, 56px) 40px;
  max-width: 860px;
  width: 100%;
  margin: 0 auto;
  box-sizing: border-box;
}
.review-view-prompt {
  font-size: 12px;
  margin: 0 0 10px;
  padding: 8px 10px;
  border-left: 2px solid var(--border-strong);
  color: var(--text-secondary);
}
.review-view-tools {
  font-size: 12px;
  color: var(--muted);
  margin-bottom: 12px;
}
.review-view-tools summary {
  cursor: pointer;
  display: flex;
  align-items: center;
  gap: 6px;
}
.review-view-tools ul {
  margin: 6px 0 0;
  padding-left: 18px;
  font-family: var(--mono, monospace);
}
.review-view-status {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
}
.muted {
  color: var(--muted);
}
</style>
