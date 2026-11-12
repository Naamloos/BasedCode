<script setup lang="ts">
import { computed } from 'vue';
import {
  ChevronRight,
  Check,
  LoaderCircle,
  CircleAlert,
  Terminal,
  FileCode2,
  Wrench,
  ListChecks,
  GitCommitHorizontal,
  Circle,
  CircleDot,
  CircleCheck,
  Undo2,
  Square,
} from '../../icons';
import { rpc } from '../../services/api';
import { commandTerminal } from '../../utils/status';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import type { Message, TerminalInfo } from '../../../shared/types';
import McpApp from '../visuals/McpApp.vue';
import LegacyMcpUi from '../visuals/LegacyMcpUi.vue';
import { legacyMcpResources } from '../../../shared/mcpUi';
import MiniTerminal from '../workspace/MiniTerminal.vue';
import { t } from '../../theme/themes';

const props = defineProps<{
  message: Message;
  workspaceId: string;
  terminals?: TerminalInfo[];
  /** Offer "Rewind here": restore files to just before this call and drop it and what followed. */
  rewindable?: boolean;
}>();
const emit = defineEmits<{ rewind: [messageId: string] }>();
const tool = computed(
  () =>
    props.message.metadata.tool as {
      name: string;
      args: Record<string, unknown>;
      status: string;
      result?: {
        result?: CallToolResult;
        app?: { serverId: string };
        terminalId?: string;
        output?: unknown;
        checks?: {
          name: string;
          status: string;
          exitCode: number;
          terminalId: string;
          outputTail?: string;
          problems?: unknown[];
        }[];
      };
      error?: string;
    },
);
const mcpArguments = computed<Record<string, unknown>>(() => {
  const args = tool.value.args.arguments;
  return args && typeof args === 'object' && !Array.isArray(args)
    ? (args as Record<string, unknown>)
    : {};
});
const legacyResources = computed(() =>
  tool.value.name === 'call_mcp' && !tool.value.result?.app
    ? legacyMcpResources(tool.value.result?.result)
    : [],
);
const liveTerminal = computed(() => commandTerminal(props.message, props.terminals));
function stopCommand() {
  const terminalId = liveTerminal.value?.id;
  // A failure here almost always means the command just finished on its own.
  if (terminalId) void rpc('terminal.stop', { terminalId }).catch(() => undefined);
}
const finishedOutput = computed(() =>
  tool.value.name === 'run_command' &&
  tool.value.status !== 'running' &&
  typeof tool.value.result?.output === 'string'
    ? tool.value.result.output
    : undefined,
);
const checks = computed(() =>
  tool.value.name === 'run_checks' ? (tool.value.result?.checks ?? []) : [],
);
type PlanStep = { step: string; status: 'pending' | 'in_progress' | 'completed' };
const plan = computed(() =>
  tool.value.name === 'update_plan' && Array.isArray(tool.value.args.steps)
    ? (tool.value.args.steps as PlanStep[])
    : undefined,
);
const summary = computed(() => {
  if (plan.value)
    return t('{done}/{total} done', {
      done: plan.value.filter((item) => item.status === 'completed').length,
      total: plan.value.length,
    });
  if (tool.value.name === 'git_commit') return String(tool.value.args.message ?? '').split('\n')[0];
  return String(
    tool.value.args.path ??
      tool.value.args.command ??
      tool.value.args.query ??
      tool.value.args.name ??
      '',
  );
});
</script>

<template>
  <div class="tool-wrap">
    <details
      class="tool-card"
      :class="tool.status"
    >
      <summary>
        <ChevronRight
          :size="13"
          class="disclosure"
        />
        <component
          :is="
            tool.name === 'run_command'
              ? Terminal
              : plan
                ? ListChecks
                : tool.name.startsWith('git_')
                  ? GitCommitHorizontal
                  : tool.name.includes('file') || ['apply_patch', 'edit_lines'].includes(tool.name)
                    ? FileCode2
                    : Wrench
          "
          :size="15"
        />
        <span class="tool-name">{{ tool.name.replaceAll('_', ' ') }}</span>
        <span class="tool-summary">{{ summary }}</span>
        <LoaderCircle
          v-if="tool.status === 'running'"
          :size="14"
          class="spin"
        />
        <CircleAlert
          v-else-if="tool.status === 'failed'"
          :size="14"
          class="error-text"
        />
        <Check
          v-else
          :size="14"
          class="success-text"
        />
        <button
          v-if="liveTerminal"
          type="button"
          class="text-button tool-stop"
          :title="t('Stop this command')"
          @click.stop.prevent="stopCommand"
        >
          <Square :size="11" /> {{ t('Stop') }}
        </button>
        <button
          v-if="rewindable && tool.status !== 'running'"
          type="button"
          class="text-button tool-rewind"
          :title="t('Rewind here: restore files to just before this call and drop it and everything after it')"
          @click.stop.prevent="emit('rewind', message.id)"
        >
          <Undo2 :size="12" /> {{ t('Rewind') }}
        </button>
      </summary>
      <div class="tool-body">
        <div class="eyebrow">
          {{ t('INPUT') }}
        </div>
        <pre>{{ JSON.stringify(tool.args, null, 2) }}</pre>
        <MiniTerminal
          v-if="liveTerminal || finishedOutput"
          :key="liveTerminal?.id ?? message.id"
          :terminal-id="liveTerminal?.id"
          :output="finishedOutput ?? liveTerminal?.output"
        />
        <section
          v-for="check in checks"
          :key="check.terminalId"
        >
          <strong :class="check.status === 'passed' ? 'success-text' : 'error-text'">{{ check.name }} · {{ check.status }} ·
            {{ t('exit {code}', { code: check.exitCode }) }}</strong>
          <MiniTerminal :output="check.outputTail ?? ''" />
          <pre v-if="check.problems?.length">{{ JSON.stringify(check.problems, null, 2) }}</pre>
        </section>
        <template
          v-if="(!liveTerminal && finishedOutput === undefined && !checks.length) || tool.error"
        >
          <div class="eyebrow">
            {{ t(tool.error ? 'ERROR' : 'RESULT') }}
          </div>
          <pre :class="{ 'error-text': tool.error }">{{
            tool.error ??
            (typeof tool.result === 'string' ? tool.result : JSON.stringify(tool.result, null, 2))
          }}</pre>
        </template>
      </div>
    </details>
    <ul
      v-if="plan"
      class="plan-list"
    >
      <li
        v-for="(item, index) in plan"
        :key="index"
        :class="item.status"
      >
        <CircleCheck
          v-if="item.status === 'completed'"
          :size="14"
          class="success-text"
          :aria-label="t('Completed')"
        />
        <CircleDot
          v-else-if="item.status === 'in_progress'"
          :size="14"
          :aria-label="t('In progress')"
        />
        <Circle
          v-else
          :size="14"
          :aria-label="t('Pending')"
        />
        <span>{{ item.step }}</span>
      </li>
    </ul>
    <McpApp
      v-if="tool.result?.app && tool.result.result"
      :message-id="message.id"
      :workspace-id="workspaceId"
      :server-id="tool.result.app.serverId"
      :args="mcpArguments"
      :result="tool.result.result"
    />
    <LegacyMcpUi
      v-for="(resource, index) in legacyResources"
      :key="`${resource.uri}:${index}`"
      :message="message"
      :workspace-id="workspaceId"
      :resource="resource"
    />
  </div>
</template>

<style scoped>
.tool-rewind {
  margin-left: 4px;
  padding: 0 6px;
  height: 20px;
  opacity: 0;
}
summary:hover .tool-rewind,
.tool-rewind:focus-visible {
  opacity: 1;
}
@media (hover: none) {
  .tool-rewind {
    opacity: 1;
  }
}
.tool-stop {
  margin-left: 4px;
  padding: 0 6px;
  height: 20px;
}
.plan-list {
  list-style: none;
  margin: 4px 0 0;
  padding: 6px 10px;
  display: grid;
  gap: 4px;
}
.plan-list li {
  display: flex;
  align-items: center;
  gap: 8px;
}
.plan-list li.completed span {
  text-decoration: line-through;
  opacity: 0.65;
}
.plan-list li.in_progress span {
  font-weight: 600;
}
</style>
