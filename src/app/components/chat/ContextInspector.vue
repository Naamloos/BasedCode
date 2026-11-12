<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { EyeOff, Eye, Pin, PinOff } from '../../icons';
import type { Message } from '../../../shared/types';
import { rpc } from '../../services/api';
import { t } from '../../theme/themes';

interface Inspection {
  provider?: string;
  threshold: number;
  system: { label: string; tokens: number }[];
  tools: { name: string; tokens: number }[];
  messages: {
    id: string;
    role: Message['role'];
    label: string;
    tokens: number;
    pinned: boolean;
    excluded: boolean;
    compacted: boolean;
  }[];
}

const props = defineProps<{ chatId: string; busy: boolean }>();
const emit = defineEmits<{ error: [message: string] }>();
defineExpose({ load });
const data = ref<Inspection>();
const loading = ref(false);
const showTools = ref(false);

async function load() {
  loading.value = true;
  try {
    data.value = await rpc<Inspection>('context.inspect', { chatId: props.chatId });
  } catch (error) {
    emit('error', error instanceof Error ? error.message : String(error));
  } finally {
    loading.value = false;
  }
}
onMounted(load);

async function flag(id: string, patch: { pinned?: boolean; excluded?: boolean }) {
  try {
    await rpc('context.flag', { messageId: id, ...patch });
    await load();
  } catch (error) {
    emit('error', error instanceof Error ? error.message : String(error));
  }
}

const sum = (items: { tokens: number }[]) => items.reduce((total, item) => total + item.tokens, 0);
const totals = computed(() => {
  if (!data.value) return undefined;
  const sent = data.value.messages.filter((item) => !item.excluded && !item.compacted);
  const system = sum(data.value.system);
  const tools = sum(data.value.tools);
  const messages = sum(sent);
  return { system, tools, messages, total: system + tools + messages };
});
const share = (tokens: number) =>
  totals.value?.total ? `${Math.max(0.5, (tokens / totals.value.total) * 100)}%` : '0%';
const largest = computed(() =>
  data.value ? Math.max(1, ...data.value.messages.map((item) => item.tokens)) : 1,
);
const roleName: Record<Message['role'], string> = {
  user: 'You',
  assistant: 'Model',
  tool: 'Tool',
  system: 'BasedCode',
};
</script>

<template>
  <section class="context-inspector">
    <header class="context-head">
      <div>
        <p class="context-sub">
          {{
            t('What the next prompt sends{model}. Token counts are estimates.', {
              model: data?.provider ? ` ${t('to')} ${data.provider}` : '',
            })
          }}
        </p>
      </div>
    </header>
    <div
      v-if="data && totals"
      class="context-body"
    >
      <div class="context-total">
        <strong>≈{{ totals.total.toLocaleString() }}</strong> {{ t('tokens') }}
        <span class="muted">
          · {{ t('compaction at ≈{tokens}', { tokens: data.threshold.toLocaleString() }) }}</span>
      </div>
      <div
        class="context-bar"
        :title="t('System prompt, tool definitions and conversation')"
      >
        <span
          class="seg system"
          :style="{ width: share(totals.system) }"
        />
        <span
          class="seg tools"
          :style="{ width: share(totals.tools) }"
        />
        <span
          class="seg messages"
          :style="{ width: share(totals.messages) }"
        />
      </div>
      <div class="context-legend">
        <span><i class="dot system" />{{ t('System prompt') }} ≈{{ totals.system.toLocaleString() }}</span>
        <span><i class="dot tools" />{{ t('Tools') }} ≈{{ totals.tools.toLocaleString() }}</span>
        <span><i class="dot messages" />{{ t('Conversation') }} ≈{{ totals.messages.toLocaleString() }}</span>
      </div>

      <h3>{{ t('System prompt') }}</h3>
      <ul class="context-list">
        <li
          v-for="part in data.system"
          :key="part.label"
        >
          <span class="label">{{ t(part.label) }}</span><span class="tokens">≈{{ part.tokens.toLocaleString() }}</span>
        </li>
      </ul>

      <h3>
        <button
          class="text-button"
          @click="showTools = !showTools"
        >
          {{ t('Tool definitions ({count})', { count: data.tools.length }) }}
        </button>
      </h3>
      <ul
        v-if="showTools"
        class="context-list"
      >
        <li
          v-for="tool in [...data.tools].sort((a, b) => b.tokens - a.tokens)"
          :key="tool.name"
        >
          <span class="label mono">{{ tool.name }}</span><span class="tokens">≈{{ tool.tokens.toLocaleString() }}</span>
        </li>
      </ul>

      <h3>{{ t('Conversation') }}</h3>
      <p class="context-hint">
        {{
          t(
            'Pin a message to keep it word for word through compaction. Drop one to stop sending it; it stays in the chat.',
          )
        }}
      </p>
      <ul class="context-list messages">
        <li
          v-for="item in data.messages"
          :key="item.id"
          :class="{ excluded: item.excluded, compacted: item.compacted, pinned: item.pinned }"
        >
          <span class="role">{{ t(roleName[item.role]) }}</span>
          <span
            class="label"
            :title="item.label"
          >{{ item.label || '—' }}</span>
          <span class="meter"><span :style="{ width: `${(item.tokens / largest) * 100}%` }" /></span>
          <span class="tokens">≈{{ item.tokens.toLocaleString() }}</span>
          <span
            v-if="item.compacted"
            class="tag"
          >{{ t('summarized') }}</span>
          <button
            class="icon-button"
            :disabled="busy || item.excluded"
            :title="item.pinned ? t('Unpin') : t('Pin: keep word for word through compaction')"
            @click="flag(item.id, { pinned: !item.pinned })"
          >
            <PinOff
              v-if="item.pinned"
              :size="13"
            /><Pin
              v-else
              :size="13"
            />
          </button>
          <button
            class="icon-button"
            :disabled="busy || item.pinned"
            :title="item.excluded ? t('Send this message again') : t('Drop: stop sending this message to the model')"
            @click="flag(item.id, { excluded: !item.excluded })"
          >
            <Eye
              v-if="item.excluded"
              :size="13"
            /><EyeOff
              v-else
              :size="13"
            />
          </button>
        </li>
      </ul>
      <p
        v-if="busy"
        class="context-hint"
      >
        {{ t('Pinning and dropping are available when the prompt finishes.') }}
      </p>
    </div>
    <div
      v-else
      class="context-body muted"
    >
      {{ t('Loading…') }}
    </div>
  </section>
</template>

<style scoped>
.context-inspector {
  display: flex;
  flex-direction: column;
  min-height: 0;
  min-width: 0;
  flex: 1;
  overflow-y: auto;
  overflow-x: hidden;
}
.context-head {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  padding: 10px 12px 0;
}
.context-sub {
  margin: 0;
  flex: 1;
  font-size: 12px;
  color: var(--muted);
}
.context-body {
  padding: 10px 12px 16px;
}
.context-total {
  font-size: 14px;
  margin-bottom: 8px;
}
.muted {
  color: var(--muted);
}
.context-bar {
  display: flex;
  height: 10px;
  border-radius: 999px;
  overflow: hidden;
  background: var(--surface-active);
}
.seg.system,
.dot.system {
  background: var(--accent);
}
.seg.tools,
.dot.tools {
  background: var(--text-secondary);
}
.seg.messages,
.dot.messages {
  background: var(--success);
}
.context-legend {
  display: flex;
  flex-wrap: wrap;
  gap: 14px;
  margin: 8px 0 4px;
  font-size: 12px;
  color: var(--text-secondary);
}
.dot {
  display: inline-block;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  margin-right: 6px;
}
h3 {
  margin: 18px 0 6px;
  font-size: 12px;
  color: var(--faint);
  font-weight: 600;
}
h3 .text-button {
  padding: 0;
  font-weight: 600;
}
.context-hint {
  margin: 0 0 6px;
  font-size: 12px;
  color: var(--muted);
}
.context-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  gap: 2px;
}
.context-list li {
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 8px;
  min-height: 26px;
  padding: 2px 6px;
  border-radius: 6px;
  font-size: 12px;
}
.context-list li:hover {
  background: var(--surface-hover);
}
.context-list .label {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.mono {
  font-family: var(--mono, monospace);
}
.role {
  width: 44px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  flex-shrink: 0;
  color: var(--muted);
}
.tokens {
  width: 52px;
  flex-shrink: 0;
  text-align: right;
  color: var(--text-secondary);
  font-variant-numeric: tabular-nums;
}
.meter {
  width: 40px;
  flex-shrink: 0;
  height: 4px;
  border-radius: 2px;
  background: var(--surface-active);
  overflow: hidden;
}
.meter span {
  display: block;
  height: 100%;
  background: var(--accent-line, var(--accent));
}
.tag {
  font-size: 10px;
  color: var(--faint);
}
li.excluded .label,
li.compacted .label {
  text-decoration: line-through;
  opacity: 0.55;
}
li.pinned .role {
  color: var(--accent);
}
.context-list .icon-button {
  width: 22px;
  height: 22px;
  flex-shrink: 0;
}
</style>
