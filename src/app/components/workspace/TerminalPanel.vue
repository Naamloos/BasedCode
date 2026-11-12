<script setup lang="ts">
import { ref, watch, nextTick, onMounted, onBeforeUnmount } from 'vue';
import { Terminal as Xterm } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import {
  Plus,
  Square,
  Hand,
  Bot,
  ChevronDown,
  Terminal,
  User,
  Server,
  Folder,
  X,
} from '../../icons';
import type { TerminalInfo } from '../../../shared/types';
import { rpc, onEvent } from '../../services/api';
import { confirmAction } from '../../state/dialogs';
import { terminalKind, terminalState } from '../../utils/status';
import { t } from '../../theme/themes';
import { terminalTheme, onThemeChange } from '../../theme/terminalTheme';

const kindIcon = { user: User, command: Bot, service: Server };
import '@xterm/xterm/css/xterm.css';

const props = defineProps<{ terminals: TerminalInfo[]; workspaceId: string }>();
const emit = defineEmits<{ error: [message: string]; collapse: [] }>();
const selected = ref('');
const host = ref<HTMLDivElement>();
const instances = new Map<string, { terminal: Xterm; fit: FitAddon; element: HTMLDivElement }>();
let observer: ResizeObserver | undefined;
let unsubscribe: (() => void) | undefined;
let stopTheme: (() => void) | undefined;
const report = (failure: unknown) =>
  emit('error', failure instanceof Error ? failure.message : String(failure));

async function select(id: string) {
  selected.value = id;
  await nextTick();
  if (!host.value) return;
  let instance = instances.get(id);
  const info = props.terminals.find((terminal) => terminal.id === id);
  if (!info) return;
  if (!instance) {
    const terminal = new Xterm({
      cursorBlink: true,
      fontFamily: '"JetBrains Mono Variable", "JetBrains Mono", Consolas, monospace',
      fontSize: 12,
      scrollback: 5000,
      theme: terminalTheme(),
      disableStdin: info.owner !== 'user' || info.status !== 'running',
    });
    const fit = new FitAddon();
    terminal.loadAddon(fit);
    const element = document.createElement('div');
    element.className = 'terminal-instance';
    host.value.appendChild(element);
    terminal.open(element);
    terminal.write(info.output);
    terminal.onData((data) => {
      void rpc('terminal.write', { terminalId: id, data }).catch(report);
    });
    terminal.onResize((size) => {
      void rpc('terminal.resize', { terminalId: id, ...size }).catch(report);
    });
    instance = { terminal, fit, element };
    instances.set(id, instance);
  }
  for (const [key, value] of instances) value.element.style.display = key === id ? 'block' : 'none';
  instance.fit.fit();
}
watch(
  () => props.terminals,
  (terminals, previous) => {
    // Dispose views of closed terminals and move off a closed selection.
    for (const [id, instance] of instances) {
      if (terminals.some((terminal) => terminal.id === id)) continue;
      instance.terminal.dispose();
      instance.element.remove();
      instances.delete(id);
    }
    if (selected.value && !terminals.some((terminal) => terminal.id === selected.value))
      selected.value = '';
    if (terminals.length && (!selected.value || terminals.length > (previous?.length ?? 0)))
      void select(terminals.at(-1)!.id);
    for (const info of terminals) {
      const instance = instances.get(info.id);
      if (instance)
        instance.terminal.options.disableStdin = info.owner !== 'user' || info.status !== 'running';
    }
  },
  { immediate: true },
);
onMounted(() => {
  observer = new ResizeObserver(() => {
    instances.get(selected.value)?.fit.fit();
  });
  if (host.value) observer.observe(host.value);
  stopTheme = onThemeChange(() => {
    const theme = terminalTheme();
    for (const item of instances.values()) item.terminal.options.theme = theme;
  });
  unsubscribe = onEvent((event) => {
    if (event.type !== 'terminal-output') return;
    const data = event.data as { id: string; data: string };
    instances.get(data.id)?.terminal.write(data.data);
  });
  if (selected.value) void select(selected.value);
});
onBeforeUnmount(() => {
  observer?.disconnect();
  stopTheme?.();
  unsubscribe?.();
  for (const item of instances.values()) item.terminal.dispose();
});
async function close(info: TerminalInfo) {
  // Closing a running agent command kills it mid-task; make sure that is intended.
  if (
    info.status === 'running' &&
    info.owner === 'agent' &&
    !(await confirmAction(
      t('Close terminal?'),
      t('Stop the agent\'s running "{title}" and close it?', { title: info.title }),
      t('Stop and close'),
    ))
  )
    return;
  try {
    await rpc('terminal.close', { terminalId: info.id });
  } catch (error) {
    report(error);
  }
}
async function create() {
  try {
    await rpc('terminal.create', { workspaceId: props.workspaceId });
  } catch (error) {
    report(error);
  }
}
async function control(info: TerminalInfo) {
  try {
    await rpc('terminal.control', {
      terminalId: info.id,
      owner: info.owner === 'agent' ? 'user' : 'agent',
    });
  } catch (error) {
    report(error);
  }
}
</script>

<template>
  <section
    class="terminal-panel"
    :aria-label="t('Terminals')"
  >
    <header class="terminal-tabs">
      <span class="panel-label"><Terminal :size="13" /> {{ t('TERMINAL') }}</span>
      <div class="terminal-tab-list">
        <div
          v-for="info in terminals"
          :key="info.id"
          class="terminal-tab"
          :class="{ active: selected === info.id, exited: info.status !== 'running' }"
          @auxclick.middle.prevent="close(info)"
        >
          <button
            class="terminal-tab-select"
            :title="`${t(terminalKind[info.kind])} · ${terminalState(info)} · ${info.cwd}`"
            @click="select(info.id)"
          >
            <component
              :is="kindIcon[info.kind]"
              :size="13"
              :aria-label="t(terminalKind[info.kind])"
            /><span class="terminal-tab-title">{{ info.title }}</span><span
              v-if="info.status !== 'running'"
              class="terminal-tab-exit"
            >{{
              info.exitCode === undefined ? t('exited') : t('exit {code}', { code: info.exitCode })
            }}</span>
          </button><button
            class="terminal-tab-close"
            :title="
              t(
                info.status === 'running'
                  ? 'Stop and close (middle-click)'
                  : 'Close (middle-click)',
              )
            "
            :aria-label="t('Close {name}', { name: info.title })"
            @click="close(info)"
          >
            <X :size="12" />
          </button>
        </div>
      </div>
      <button
        class="icon-button"
        :title="t('New user terminal')"
        @click="create"
      >
        <Plus :size="15" />
      </button>
      <button
        class="icon-button"
        :title="t('Collapse terminals')"
        @click="emit('collapse')"
      >
        <ChevronDown :size="16" />
      </button>
    </header>
    <template
      v-for="info in terminals.filter((item) => item.id === selected)"
      :key="info.id"
    >
      <div class="terminal-controls">
        <div class="terminal-meta">
          <span class="terminal-kind">
            <component
              :is="kindIcon[info.kind]"
              :size="12"
            />{{ t(terminalKind[info.kind]) }}</span>
          <span>{{ t(info.owner === 'agent' ? 'Agent in control' : 'You are in control') }}</span>
          <span
            v-if="info.kind === 'user'"
            class="terminal-scope"
            :title="
              t(
                'Agents cannot use this terminal or inherit its permissions. Files changed here may conflict with prompt revert.',
              )
            "
          >{{ t('Unsandboxed · your permissions') }}</span>
          <span
            class="terminal-state"
            :class="{
              running: info.status === 'running',
              failed: info.status !== 'running' && info.exitCode !== 0,
            }"
          >{{ terminalState(info) }}</span>
          <span
            class="terminal-cwd"
            :title="info.cwd"
          ><Folder :size="12" />{{ info.cwd }}</span>
        </div>
        <div
          v-if="info.status === 'running'"
          class="row"
        >
          <button
            v-if="info.runId"
            class="text-button"
            @click="control(info)"
          >
            <component
              :is="info.owner === 'agent' ? Hand : Bot"
              :size="13"
            />{{
              t(info.owner === 'agent' ? 'Take control' : 'Return to agent')
            }}
          </button>
          <button
            class="text-button"
            @click="rpc('terminal.stop', { terminalId: info.id }).catch(report)"
          >
            <Square :size="11" /> {{ t('Stop') }}
          </button>
        </div>
      </div>
    </template>
    <div
      ref="host"
      class="terminal-host"
    />
    <div
      v-if="!terminals.length"
      class="terminal-empty"
    >
      {{ t('Commands will appear here.') }}
      <button
        class="text-button"
        @click="create"
      >
        {{ t('Open a terminal') }}
      </button>
    </div>
  </section>
</template>
