<script setup lang="ts">
import { ref, watch, onMounted, onBeforeUnmount } from 'vue';
import { Terminal as Xterm } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';
import { onEvent } from '../../services/api';
import { terminalTheme, onThemeChange } from '../../theme/terminalTheme';

// Read-only terminal view for a tool call: live output while a command's terminal is still running
// (via terminalId), or the captured, already-cleaned output once the terminal has closed.
const props = defineProps<{ terminalId?: string; output?: string }>();
const host = ref<HTMLDivElement>();
let terminal: Xterm | undefined;
let fit: FitAddon | undefined;
let observer: ResizeObserver | undefined;
let unsubscribe: (() => void) | undefined;
let stopTheme: (() => void) | undefined;

function mount() {
  if (!host.value || terminal) return;
  terminal = new Xterm({
    disableStdin: true,
    convertEol: true,
    cursorBlink: false,
    fontFamily: '"JetBrains Mono Variable", "JetBrains Mono", Consolas, monospace',
    fontSize: 12,
    scrollback: 5000,
    theme: terminalTheme(),
  });
  fit = new FitAddon();
  terminal.loadAddon(fit);
  terminal.open(host.value);
  if (props.output) terminal.write(props.output);
  fit.fit();
}

onMounted(() => {
  mount();
  observer = new ResizeObserver(() => fit?.fit());
  if (host.value) observer.observe(host.value);
  stopTheme = onThemeChange(() => {
    if (terminal) terminal.options.theme = terminalTheme();
  });
  unsubscribe = onEvent((event) => {
    if (event.type !== 'terminal-output' || !props.terminalId) return;
    const data = event.data as { id: string; data: string };
    if (data.id === props.terminalId) terminal?.write(data.data);
  });
});
onBeforeUnmount(() => {
  observer?.disconnect();
  stopTheme?.();
  unsubscribe?.();
  terminal?.dispose();
});

// Once the live terminal closes, the tool result arrives with the final output; show that instead.
watch(
  () => props.output,
  (text) => {
    if (text === undefined || !terminal) return;
    terminal.reset();
    terminal.write(text);
    fit?.fit();
  },
);
</script>

<template>
  <div
    ref="host"
    class="mini-terminal"
  />
</template>

<style scoped>
.mini-terminal {
  height: 220px;
  margin: 6px 0;
  border-radius: 6px;
  overflow: hidden;
  background: var(--bg);
  padding: 4px 0 0 4px;
}
.mini-terminal :deep(.xterm),
.mini-terminal :deep(.xterm-viewport) {
  background-color: var(--bg) !important;
}
</style>
