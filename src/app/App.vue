<script setup lang="ts">
import { computed, ref, watch, onMounted, onBeforeUnmount, nextTick, h, type FunctionalComponent } from 'vue';
import {
  FolderOpen,
  FolderPlus,
  Settings2,
  ChevronDown,
  ChevronRight,
  File,
  Folder,
  GitCompareArrows,
  ArrowUp,
  Square,
  Terminal,
  ShieldCheck,
  ShieldAlert,
  X,
  ExternalLink,
  RotateCcw,
  Check,
  Activity,
  PanelRightClose,
  PanelRightOpen,
  PanelLeftClose,
  PanelLeftOpen,
  FileCode2,
  RefreshCw,
  ArrowLeft,
  History,
  Rows2,
  Columns2,
  Minus,
  Copy as Restore,
  Flame,
  SlidersHorizontal,
  Paperclip,
  Layers,
  ListPlus,
  Navigation,
  FileText,
  ImageIcon,
  Coins,
  Trash2,
  Wrench,
  Brain,
  Plus,
  MessageSquare,
  Pin,
  PinOff,
  Search,
  GitFork,
  LoaderCircle,
  BellRing,
  MoreHorizontal,
  Pencil,
  Play,
  WifiOff,
  Command,
  ChevronUp,
  CircleAlert,
  CircleX,
  TriangleAlert,
  Sparkles,
  Download,
  Archive,
  ArchiveRestore,
  Scale,
  Repeat2,
  Gauge,
  GitPullRequest,
  MessageSquareQuote,
  Shuffle,
  Undo2,
  ArrowRightLeft,
} from './icons';
import ChatModeIcon from './components/common/ChatModeIcon.vue';
import hljs from 'highlight.js';
import {
  effectiveProviders,
  fileChangingTools,
  providerName,
  steerableKinds,
  type AppState,
  type Attachment,
  type Chat,
  type ChatMode,
  type Change,
  type Message,
  type ProviderKind,
  type Run,
  type Workspace,
  type ApprovalMode,
  type AppLanguage,
} from '../shared/types';
import { rpc, connectEvents, onEvent, mediaUrl, attachmentUrl } from './services/api';
import {
  parseSlashCommand,
  slashCommands,
  slashCommandSignature,
  type SlashCommandInfo,
  type SlashCommandParam,
} from '../shared/commands';
import { legacyMcpResources } from '../shared/mcpUi';
import { previewMediaType } from '../shared/preview';
import { guidedMode, guidedModes } from '../shared/chatModes';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { applyAppearance, setAppLanguage, t } from './theme/themes';
import { approvalModes } from './state/approvals';
import { actionForEvent, resolveKeybindings, type KeybindingAction } from './state/keybindings';
import { fileSection } from './utils/diff';
import AttachmentPreview from './components/chat/AttachmentPreview.vue';
import BrowserPreview from './components/chat/BrowserPreview.vue';
import LimitWindows from './components/usage/LimitWindows.vue';
import MarkdownView from './components/chat/MarkdownView.vue';
import ToolCard from './components/chat/ToolCard.vue';
import InlineUi from './components/visuals/InlineUi.vue';
import ImageView from './components/visuals/ImageView.vue';
import ChartView from './components/visuals/ChartView.vue';
import DiagramView from './components/visuals/DiagramView.vue';
import PlanPanel, { type PlanStep } from './components/chat/PlanPanel.vue';
import AppSelect from './components/common/AppSelect.vue';
import ModeSwitcher from './components/chat/ModeSwitcher.vue';
import ModeChip from './components/chat/ModeChip.vue';
import ConfirmationDialog from './components/common/ConfirmationDialog.vue';
import HandOffDialog from './components/workspace/HandOffDialog.vue';
import FilePicker from './components/workspace/FilePicker.vue';
import AppTooltip from './components/common/AppTooltip.vue';
import TerminalPanel from './components/workspace/TerminalPanel.vue';
import SettingsPanel from './components/settings/SettingsPanel.vue';
import GlobalSettingsPanel from './components/settings/GlobalSettingsPanel.vue';
import DiffView from './components/workspace/DiffView.vue';
import ModelPicker from './components/models/ModelPicker.vue';
import ContextInspector from './components/chat/ContextInspector.vue';
import CompareModal from './components/chat/CompareModal.vue';
import GitPanel from './components/workspace/GitPanel.vue';
import ReviewView from './components/chat/ReviewView.vue';
import ModelUsage from './components/usage/ModelUsage.vue';
import RunStatsLine from './components/chat/RunStatsLine.vue';
import {
  chatUsage,
  formatCost,
  formatSize,
  formatSpeed,
  formatTokens,
  modelKey,
  tokensPerSecond,
  usageByModel,
} from './utils/format';
import FlameStrip from './components/common/FlameStrip.vue';
import UpdateChip from './components/common/UpdateChip.vue';
import BasedAquarium from './components/common/BasedAquarium.vue';
import ComposerInput from './components/chat/ComposerInput.vue';
import { clearDraft, loadDraft, saveDraft } from './state/drafts';
import WelcomeDialog from './components/settings/WelcomeDialog.vue';
import {
  burstFrom,
  effectsEnabled,
  motionAllowed,
  stamp,
  stoke,
  effectsStats,
  webglRenderer,
} from './theme/effects';
import { installAntics } from './theme/antics';
import { runStatus, notableRunStates } from './utils/status';
import { vAutoscroll } from './directives/autoscroll';
import { useAttachments } from './state/attachments';
import { usePaneLayout } from './state/paneLayout';
import { useWindowFrame } from './services/windowFrame';
import { confirmAction } from './state/dialogs';
import appIcon from './assets/icon.png';

const windowFrame = useWindowFrame();

const state = ref<AppState & { recoveryRequired?: boolean }>({
  comparisons: [],
  workspaces: [],
  chats: [],
  runs: [],
  messages: [],
  approvals: [],
  actions: [],
  terminals: [],
  diagnostics: [],
  sandbox: { available: false, detail: 'Connecting…' },
  global: {
    welcomeDismissed: false,
    language: 'en',
    disabledTools: [],
    mcpServers: [],
    languageServers: [],
    providers: [],
    approvalMode: 'always',
    compaction: { enabled: true, thresholdTokens: 64_000 },
    appearance: { theme: 'based', lightTheme: 'normie', mode: 'dark', flame: 'classic' },
    keybindings: {},
    codexPath: '',
    claudePath: '',
  },
  credentials: { saved: [], storage: { available: false, detail: '' } },
  limits: [],
});
const workspaceId = ref(localStorage.getItem('basedcode.workspace') ?? '');
const chatId = ref('');
const composer = ref('');
// Per-chat drafts. Text typed with no chat selected carries over into the chat that gets created for it.
watch(chatId, (next, previous) => {
  const draft = loadDraft(next);
  if (previous || draft) composer.value = draft;
});
watch(composer, (text) => saveDraft(chatId.value, text));
const connected = ref(false);
const error = ref('');
const checkpointWarning = ref('');
// Non-error toasts dismiss themselves after 4s; hovering pauses the countdown. Errors stay until dismissed.
let toastTimer: ReturnType<typeof setTimeout> | undefined;
function resumeToast() {
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (checkpointWarning.value = ''), 4000);
}
function pauseToast() {
  clearTimeout(toastTimer);
}
watch(checkpointWarning, (value) => (value ? resumeToast() : pauseToast()));
const settingsOpen = ref(false);
const globalSettingsOpen = ref(false);
const globalSettingsTab = ref('about');
const approvalPopoverOpen = ref(false);
const approvalScope = ref<'workspace' | 'global'>('workspace');
async function chooseApprovalMode(mode: ApprovalMode) {
  try {
    if (approvalScope.value === 'workspace' && workspace.value) {
      await rpc('workspace.settings', {
        workspaceId: workspace.value.id,
        settings: { ...workspace.value.settings, approvalMode: mode },
      });
    } else {
      await rpc('global.settings', { settings: { ...state.value.global, approvalMode: mode } });
    }
    approvalPopoverOpen.value = false;
    await refresh();
  } catch (failure) {
    report(failure);
  }
}
function openGlobalSettings(tab = 'about') {
  if (phone.value) leftOpen.value = false;
  globalSettingsTab.value = tab;
  globalSettingsOpen.value = true;
}
const {
  pending,
  attachmentPreview,
  dragging,
  addFiles,
  removeAttachment,
  pasteFiles,
  dropFiles,
  previewPending,
  previewSent,
} = useAttachments(report);
const pickerMode = ref<'folder' | 'files'>();
const folderModal = ref(false);
const folderPath = ref('');
const showActions = ref(false);
const showDiagnostics = ref(false);
// Phones get one column with the sidebars as drawers over it, closed until asked for.
const phoneQuery = window.matchMedia('(max-width: 760px)');
const phone = ref(phoneQuery.matches);
phoneQuery.addEventListener('change', (event) => {
  phone.value = event.matches;
  if (event.matches) {
    leftOpen.value = false;
    rightOpen.value = false;
  }
});
const rightOpen = ref(!phone.value);
const leftOpen = ref(!phone.value);
// Only one drawer fits on a phone.
watch(leftOpen, (open) => {
  if (open && phone.value) rightOpen.value = false;
});
watch(rightOpen, (open) => {
  if (open && phone.value) leftOpen.value = false;
});
const diffWrap = ref(readPreference('basedcode.diffWrap') === 'true');
watch(diffWrap, (wrap) => {
  try {
    localStorage.setItem('basedcode.diffWrap', String(wrap));
  } catch {
    /* Preference only; ignore unavailable storage. */
  }
});
const rightTab = ref<'files' | 'changes' | 'context' | 'git' | 'reviews'>('files');
const diffScope = ref<'prompt' | 'workspace'>('prompt');
const diffLayout = ref<'unified' | 'split'>(
  readPreference('basedcode.diffLayout') === 'split' ? 'split' : 'unified',
);
const terminalOpen = ref(false);
const {
  terminalHeight,
  leftWidth,
  rightWidth,
  resetPane,
  resizeTerminal,
  resizeLeft,
  resizeRight,
} = usePaneLayout();

type FilePreview = {
  path: string;
  content: string;
  binary: boolean;
  mediaType?: string;
  url?: string;
};
const fileTabs = ref<FilePreview[]>([]);
const activeFile = ref<string>();
const preview = computed({
  get: () => fileTabs.value.find((file) => file.path === activeFile.value),
  set: (file: FilePreview | undefined) => {
    activeFile.value = file?.path;
  },
});
const fileEntries = ref<{ name: string; path: string; directory: boolean; depth: number }[]>([]);
const expanded = ref(new Set<string>());
const changes = ref<Change[]>([]);
const gitDiff = ref('');
const gitStatus = ref('');
const chosenChange = ref('');
const chosenRun = ref('');
const revertModal = ref<{
  runId: string;
  paths: string[];
  conflicts: string[];
  actions: string[];
}>();
const rewindModal = ref<{
  messageId: string;
  paths: string[];
  conflicts: string[];
  messages: number;
  actions: string[];
}>();
const compareId = ref('');
/** Bumped on every state refresh so an open comparison reloads as its re-run progresses. */
const stateVersion = ref(0);
const languageResult = ref('');
const conversation = ref<HTMLElement>();
const follow = ref(true);
let disconnect: (() => void) | undefined;
let unsubscribe: (() => void) | undefined;
let refreshPending = false;
/** Callers that asked for a refresh while one was running; resolved once the follow-up refresh has finished. */
let refreshWaiters: (() => void)[] = [];
let refreshAgain = false;

const workspace = computed(() =>
  state.value.workspaces.find((item) => item.id === workspaceId.value),
);
/**
 * When each workspace last had a chat message. Workspaces are ordered by this, so merely
 * opening one never moves it up; one with no messages yet falls back to when it was opened.
 */
const workspaceActivity = computed(() => {
  const chatWorkspace = new Map(state.value.chats.map((entry) => [entry.id, entry.workspaceId]));
  const latest = new Map<string, string>();
  for (const message of state.value.messages) {
    if (message.role !== 'user' && message.role !== 'assistant') continue;
    const id = chatWorkspace.get(message.chatId);
    if (id && message.createdAt > (latest.get(id) ?? '')) latest.set(id, message.createdAt);
  }
  return latest;
});
const recentWorkspaces = computed(() => {
  const activity = (item: Workspace) =>
    workspaceActivity.value.get(item.id) ?? item.lastOpenedAt ?? '';
  return state.value.workspaces
    .filter((item) => !item.scratch)
    .slice()
    .reverse()
    .sort((a, b) => activity(b).localeCompare(activity(a)));
});
const chats = computed(() =>
  state.value.chats
    .filter((chat) => chat.workspaceId === workspaceId.value)
    .slice()
    .reverse(),
);
const chat = computed(() => chats.value.find((item) => item.id === chatId.value));
const scratchIds = computed(
  () => new Set(state.value.workspaces.filter((item) => item.scratch).map((item) => item.id)),
);
const chatSearch = ref('');
/** Chats whose title or messages contain every word of the search. */
const searchMatches = computed(() => {
  const words = chatSearch.value.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return undefined;
  const text = new Map<string, string>();
  for (const entry of state.value.chats) text.set(entry.id, entry.title.toLowerCase());
  for (const message of state.value.messages)
    if (message.role === 'user' || message.role === 'assistant')
      text.set(
        message.chatId,
        `${text.get(message.chatId) ?? ''}\n${message.content.toLowerCase()}`,
      );
  return new Set(
    state.value.chats
      .filter((entry) => words.every((word) => text.get(entry.id)?.includes(word)))
      .map((entry) => entry.id),
  );
});
const workingStates = new Set(['queued', 'running', 'paused']);
/** What a group's chats are doing, for the badges on group headers. */
function groupActivity(chats: Chat[]) {
  let working = 0;
  let waiting = 0;
  for (const entry of chats) {
    const latest = state.value.runs.filter((run) => run.chatId === entry.id).at(-1);
    if (latest?.status === 'awaiting_approval') waiting++;
    else if (latest && workingStates.has(latest.status)) working++;
  }
  return { working, waiting };
}
/** Sidebar groups: pinned chats, project workspaces (most recently opened first), then plain chats. */
/** The last segment of a folder path: the name a workspace gets when it is opened. */
function folderName(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).pop() ?? path;
}
const chatGroups = computed(() => {
  const matches = searchMatches.value;
  const newestFirst = state.value.chats
    .slice()
    .reverse()
    // Second-opinion sub-chats live under the chat they review, not in the sidebar.
    .filter((entry) => !entry.reviewOf && (!matches || matches.has(entry.id)));
  const archived = newestFirst.filter((entry) => entry.archivedAt);
  const current = newestFirst.filter((entry) => !entry.archivedAt);
  const unpinned = current.filter((entry) => !entry.pinned);
  type Group = {
    id: string;
    name: string;
    path: string;
    kind: 'pinned' | 'workspace' | 'plain' | 'archived';
    chats: Chat[];
    /** The folder's own name, set only when the workspace has a different display name. */
    folder?: string;
  };
  const groups: Group[] = [];
  const pinned = current.filter((entry) => entry.pinned);
  if (pinned.length)
    groups.push({
      id: 'pinned',
      name: t('Pinned'),
      path: t('Pinned chats'),
      kind: 'pinned',
      chats: pinned,
    });
  // Plain chats are a permanent group, always there to start a chat without a workspace.
  const plain = unpinned.filter((entry) => scratchIds.value.has(entry.workspaceId));
  if (!matches || plain.length)
    groups.push({
      id: 'plain',
      name: t('Chats'),
      path: t('Plain chats without a workspace'),
      kind: 'plain',
      chats: plain,
    });
  for (const item of recentWorkspaces.value) {
    const chats = unpinned.filter((entry) => entry.workspaceId === item.id);
    if (matches && !chats.length) continue;
    const folder = folderName(item.path);
    groups.push({
      id: item.id,
      name: item.name,
      path: item.path,
      kind: 'workspace',
      chats,
      folder: folder !== item.name ? folder : undefined,
    });
  }
  if (archived.length)
    groups.push({
      id: 'archived',
      name: t('Archived'),
      path: t('Archived chats. Sending a prompt in one brings it back.'),
      kind: 'archived',
      chats: archived,
    });
  return groups;
});
/** Groups start open, except Archived, which starts closed: its id in the set means open instead. */
function groupOpen(id: string): boolean {
  if (searchMatches.value) return true;
  return id === 'archived' ? collapsedGroups.value.has(id) : !collapsedGroups.value.has(id);
}
async function archiveChat(entry: Chat) {
  moveMenu.value = '';
  await rpc('chat.archive', { chatId: entry.id, archived: !entry.archivedAt });
  await refresh();
}
async function pinChat(entry: Chat) {
  await rpc('chat.pin', { chatId: entry.id, pinned: !entry.pinned });
  await refresh();
}
const moveMenu = ref('');
/** Where a right-click opened the chat menu; absent when it was opened from the dots button. */
const menuPoint = ref<{ x: number; y: number }>();
/** Places the chat menu at (x, y), or above `flipTop` when it would run off the bottom of the window. */
function placeChatMenu(x: number, y: number, flipTop: number, entry: Chat, focusFirst = false) {
  const width = 220;
  const height = 220 + recentWorkspaces.value.length * 28;
  menuPoint.value = {
    x: Math.max(8, Math.min(x, window.innerWidth - width - 8)),
    y: y + height > window.innerHeight ? Math.max(8, flipTop - height) : y,
  };
  moveMenu.value = entry.id;
  if (focusFirst)
    void nextTick(() =>
      document.querySelector<HTMLButtonElement>('.chat-menu button:not(:disabled)')?.focus(),
    );
}
function openChatMenuAt(event: MouseEvent, entry: Chat) {
  placeChatMenu(event.clientX, event.clientY, event.clientY, entry);
}
/**
 * The dots button: toggles the menu beside the button, opening to the right like the right-click menu.
 * Keyboard activation (detail 0) focuses the first item.
 */
function openChatMenuFrom(event: MouseEvent, entry: Chat) {
  if (moveMenu.value === entry.id) {
    moveMenu.value = '';
    return;
  }
  const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
  placeChatMenu(rect.right + 4, rect.top, rect.bottom, entry, event.detail === 0);
}
function chatMenuKey(event: KeyboardEvent) {
  if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
  event.preventDefault();
  // Stay inside the (sub)menu that has focus, and skip items of a closed submenu.
  const menu =
    (document.activeElement as HTMLElement | null)?.closest<HTMLElement>('[role="menu"]') ??
    (event.currentTarget as HTMLElement);
  const items = [...menu.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')].filter(
    (item) => item.closest('[role="menu"]') === menu && item.offsetParent !== null,
  );
  const index = items.indexOf(document.activeElement as HTMLButtonElement);
  items[(index + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length]?.focus();
}
/** Saves a chat's conversation (your prompts and the agent's replies) as a Markdown file. */
function exportChat(entry: Chat) {
  moveMenu.value = '';
  const lines = [`# ${entry.title}`, ''];
  let previous = '';
  for (const message of state.value.messages) {
    if (message.chatId !== entry.id || message.metadata.reverted) continue;
    if (message.role !== 'user' && message.role !== 'assistant') continue;
    if (!message.content.trim()) continue;
    if (message.role !== previous) lines.push(`## ${message.role === 'user' ? t('You') : 'BasedCode'}`, '');
    lines.push(message.content.trim(), '');
    previous = message.role;
  }
  const link = document.createElement('a');
  link.href = URL.createObjectURL(new Blob([lines.join('\n')], { type: 'text/markdown' }));
  link.download = `${entry.title.replace(/[\\/:*?"<>|]+/g, '-').trim().slice(0, 80) || 'chat'}.md`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), 2000);
}
const draggedChat = ref('');
const dropTarget = ref('');
async function moveChat(chatToMove: string, target: string) {
  moveMenu.value = '';
  const entry = state.value.chats.find((item) => item.id === chatToMove);
  if (!entry || entry.workspaceId === target) return;
  await rpc('chat.move', { chatId: chatToMove, workspaceId: target });
  await refresh();
  if (chatId.value === chatToMove) {
    const moved = state.value.chats.find((item) => item.id === chatToMove);
    if (moved) await selectChat(moved);
  }
}
function dragOverGroup(event: DragEvent, groupId: string, kind: string) {
  if (!draggedChat.value || kind !== 'workspace') return;
  event.preventDefault();
  dropTarget.value = groupId;
}
function dropOnGroup(groupId: string, kind: string) {
  const dragged = draggedChat.value;
  draggedChat.value = '';
  dropTarget.value = '';
  if (dragged && kind === 'workspace') void perform(() => moveChat(dragged, groupId));
}
function startChatDrag(event: DragEvent, entry: Chat) {
  draggedChat.value = entry.id;
  event.dataTransfer?.setData('text/plain', entry.title);
}
function endChatDrag() {
  draggedChat.value = '';
  dropTarget.value = '';
}
/** A wrapped-up guided-mode session is read-only: the report is its last turn. */
const wrappedUp = computed(() => Boolean(chat.value?.wrappedUpAt));
/** Asks the agent for the session report in chat, then locks the chat. */
async function wrapUpSession() {
  const current = chat.value;
  if (!current || current.wrappedUpAt) return;
  const approved = await confirmAction(
    t('Wrap up this session?'),
    t(guidedMode(current.mode)?.wrapUpNotice ?? ''),
    t('Wrap up'),
  );
  if (!approved) return;
  await rpc('chat.wrapUp', { chatId: current.id });
  await refresh();
}
const pathDragType = 'application/x-basedcode-path';
function startFileDrag(event: DragEvent, path: string) {
  event.dataTransfer?.setData(pathDragType, path);
  event.dataTransfer?.setData('text/plain', path);
}
/** Workspace files dropped from the file tree become Markdown links; other drops attach files. */
function dropIntoComposer(event: DragEvent) {
  const path = event.dataTransfer?.getData(pathDragType);
  if (!path) {
    dropFiles(event);
    return;
  }
  dragging.value = false;
  const name = path.split('/').pop() ?? path;
  const image = previewMediaType(path)?.startsWith('image/');
  const target = path.includes(' ') ? `<${path}>` : path;
  const link = `${image ? '!' : ''}[${name}](${target})`;
  composer.value = composer.value && !/\s$/.test(composer.value) ? `${composer.value} ${link}` : composer.value + link;
}
// ---- Interrupted and reconnecting runs ----
const lastRun = computed(() => runs.value.filter((run) => !(run as Run & { reverted?: boolean }).reverted).at(-1));
const interruptedRun = computed(() =>
  !active.value && lastRun.value?.status === 'interrupted' ? lastRun.value : undefined,
);
const failedRun = computed(() =>
  !active.value && lastRun.value?.status === 'failed' ? lastRun.value : undefined,
);
const resumePrompt =
  'Continue the previous task. BasedCode stopped while you were working on it, so some steps may be half done: check the current state of the files and of any commands you started, then carry on.';
async function resumeRun() {
  if (wrappedUp.value) return;
  if (!chat.value) return;
  await rpc('run.submit', { chatId: chat.value.id, prompt: resumePrompt });
  await refresh();
}
async function retryRun(run: Run) {
  if (wrappedUp.value) return;
  const original = state.value.messages.find(
    (message) => message.runId === run.id && message.role === 'user' && !message.metadata.steer,
  );
  // A run stopped for native tool use is retried with a nudge instead of the same prompt, which would likely repeat it.
  const nativeToolUse = run.error?.includes('attempted a native operation');
  await rpc('run.submit', {
    chatId: run.chatId,
    prompt: nativeToolUse
      ? 'Please continue. You attempted to use a native tool which is not supported. Use BasedCode\'s provided tools only.'
      : run.prompt,
    attachmentIds: nativeToolUse ? [] : messageAttachments(original?.metadata ?? {}).map((item) => item.id),
  });
  await refresh();
}
const now = ref(Date.now());
const clock = setInterval(() => (now.value = Date.now()), 1000);
onBeforeUnmount(() => clearInterval(clock));
const reconnectSeconds = computed(() => {
  const until = working.value?.reconnecting?.until;
  return until ? Math.max(0, Math.ceil((Date.parse(until) - now.value) / 1000)) : 0;
});

// ---- Rename ----
const renaming = ref('');
const renameText = ref('');
function startRename(entry: Chat) {
  if (entry.wrappedUpAt) return;
  moveMenu.value = '';
  renaming.value = entry.id;
  renameText.value = entry.title;
  void nextTick(() => document.querySelector<HTMLInputElement>('.chat-rename')?.select());
}
async function finishRename(save: boolean) {
  const target = renaming.value;
  const title = renameText.value.trim();
  renaming.value = '';
  if (!save || !target || !title) return;
  if (state.value.chats.find((item) => item.id === target)?.title === title) return;
  await rpc('chat.rename', { chatId: target, title });
  await refresh();
}

// ---- Edit and resend ----
const editingRun = ref('');
const editText = ref('');
function startEdit(message: Message) {
  editingRun.value = message.runId;
  editText.value = message.content;
  void nextTick(() => document.querySelector<HTMLTextAreaElement>('.edit-prompt textarea')?.focus());
}
async function resendEdit() {
  if (!chat.value || !editText.value.trim()) return;
  const fork = await rpc<Chat>('chat.fork', {
    chatId: chat.value.id,
    runId: editingRun.value,
    prompt: editText.value,
  });
  editingRun.value = '';
  await refresh();
  await selectChat(fork);
}

// ---- Find in chat (CSS Custom Highlight API, so the rendered messages are never modified) ----
const findOpen = ref(false);
const findText = ref('');
const findIndex = ref(0);
const findCount = ref(0);
let findRanges: Range[] = [];
const highlights = (globalThis.CSS as unknown as { highlights?: Map<string, unknown> } | undefined)
  ?.highlights;
function clearFindHighlights() {
  highlights?.delete('chat-find');
  highlights?.delete('chat-find-current');
}
function runFind(scroll = true) {
  clearFindHighlights();
  findRanges = [];
  const root = conversation.value;
  const query = findText.value.trim().toLowerCase();
  if (!root || !query) {
    findCount.value = 0;
    return;
  }
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (node.parentElement?.closest('script, style, .find-bar')) continue;
    const text = (node.textContent ?? '').toLowerCase();
    for (let index = text.indexOf(query); index >= 0; index = text.indexOf(query, index + query.length)) {
      const range = new Range();
      range.setStart(node, index);
      range.setEnd(node, index + query.length);
      findRanges.push(range);
    }
  }
  findCount.value = findRanges.length;
  if (findIndex.value >= findRanges.length) findIndex.value = 0;
  if (findRanges.length && highlights) highlights.set('chat-find', new Highlight(...findRanges));
  showFindHit(scroll);
}
function showFindHit(scroll = true) {
  const range = findRanges[findIndex.value];
  if (!range) return;
  highlights?.set('chat-find-current', new Highlight(range));
  if (scroll) range.startContainer.parentElement?.scrollIntoView({ block: 'center' });
}
function stepFind(direction: number) {
  if (!findRanges.length) return;
  findIndex.value = (findIndex.value + direction + findRanges.length) % findRanges.length;
  showFindHit();
}
function openFind() {
  if (!chat.value) return;
  findOpen.value = true;
  void nextTick(() => {
    document.querySelector<HTMLInputElement>('.find-bar input')?.select();
    runFind();
  });
}
function closeFind() {
  findOpen.value = false;
  findRanges = [];
  findCount.value = 0;
  clearFindHighlights();
}
watch(findText, () => {
  findIndex.value = 0;
  runFind();
});
watch(chatId, closeFind);

// ---- Tool groups: one quiet row, "✓ Worked for 12s · 6 steps" ----
function toolGroupState(tools: Message[]) {
  const statuses = tools.map(
    (tool) => (tool.metadata.tool as { status?: string } | undefined)?.status,
  );
  return {
    running: statuses.includes('running'),
    failed: statuses.filter((status) => status === 'failed').length,
  };
}
function toolGroupLabel(tools: Message[]) {
  const state = toolGroupState(tools);
  const steps = t(tools.length === 1 ? '{count} step' : '{count} steps', { count: tools.length });
  if (state.running) return `${t('Working…')} · ${steps}`;
  const first = Date.parse(tools[0].createdAt);
  const last = Date.parse(tools[tools.length - 1].createdAt);
  const seconds = Math.max(1, Math.round((last - first) / 1000));
  const took = seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
  const failed = state.failed ? ` · ${t('{count} failed', { count: state.failed })}` : '';
  return `${t('Worked for {time}', { time: took })} · ${steps}${failed}`;
}

// ---- Mode switch on an empty chat (ModeSwitcher), so trying another mode doesn't need a new chat ----
async function setChatMode(mode: string) {
  if (!chat.value || mode === (chat.value.mode ?? 'default')) return;
  await rpc('chat.setMode', { chatId: chat.value.id, mode });
  await refresh();
}

// ---- Welcome screen ----
const welcomeGreetings = [
  'What are we cooking today?',
  "Aight, what's broken?",
  'Point me at some code.',
];
// Picked per chat, so the greeting rotates between chats but doesn't flicker while typing.
const welcomeGreeting = computed(() => {
  const id = chat.value?.id ?? '';
  let hash = 0;
  for (const char of id) hash = (hash * 31 + char.charCodeAt(0)) | 0;
  const greetings = guidedMode(chat.value?.mode)?.greetings ?? welcomeGreetings;
  return greetings[Math.abs(hash) % greetings.length];
});
const welcomeChips = [
  {
    label: 'Explain this repo',
    hint: 'Map out the architecture and key modules',
    icon: FileCode2,
    prompt: 'Explore this codebase and explain its architecture. Read project instructions first.',
  },
  {
    label: 'Fix failing checks',
    hint: 'Run checks and fix what fails',
    icon: Terminal,
    prompt: "Run the project's tests, linting and type checks, then fix whatever fails.",
  },
  {
    label: 'Review my diff',
    hint: 'Check uncommitted work for bugs and risks',
    icon: GitCompareArrows,
    prompt:
      'Review the current workspace changes for correctness and explain any risks. Do not change files.',
  },
  {
    label: 'Hunt for bugs',
    hint: 'Find likely failures and propose fixes',
    icon: ShieldAlert,
    prompt:
      'Find the most likely bugs in this codebase. For each, explain how it fails and propose a fix. Do not change files yet.',
  },
];

// ---- Command palette ----
/** Palette icons for guided modes, as components so the palette can pass its size. */
const modeIcons = Object.fromEntries(
  guidedModes.map((mode) => {
    const icon: FunctionalComponent<{ size?: number }> = (props) => h(ChatModeIcon, { mode: mode.id, size: props.size });
    return [mode.id, icon];
  }),
);
interface PaletteItem {
  id: string;
  label: string;
  section: string;
  hint?: string;
  icon: unknown;
  run: () => unknown;
}
const paletteOpen = ref(false);
const paletteText = ref('');
const paletteIndex = ref(0);
function openPalette() {
  paletteOpen.value = true;
  paletteText.value = '';
  paletteIndex.value = 0;
  void nextTick(() => document.querySelector<HTMLInputElement>('.palette input')?.focus());
}
function closePalette() {
  paletteOpen.value = false;
}
const paletteItems = computed<PaletteItem[]>(() => {
  const actions = t('Actions');
  // The user's own bindings, so the hints stay right after a shortcut is changed.
  const keys = resolveKeybindings(state.value.global.keybindings);
  const items: PaletteItem[] = [
    { id: 'new', section: actions, label: t('New chat'), hint: keys['chat.new'], icon: Plus, run: () => createChat() },
    { id: 'plain', section: actions, label: t('New plain chat'), hint: keys['chat.newPlain'], icon: MessageSquare, run: () => createChat({ scratch: true }) },
    ...guidedModes.map((mode) => ({
      id: `${mode.id}-new`,
      section: actions,
      label: `${t('New chat')}: ${t(mode.label)}`,
      icon: modeIcons[mode.id],
      run: () => createChat({ mode: mode.id }),
    })),
    { id: 'open', section: actions, label: t('Open folder'), hint: keys['workspace.open'], icon: FolderOpen, run: () => perform(openWorkspace) },
    { id: 'terminal', section: actions, label: t('Toggle terminal'), hint: keys['terminal.toggle'], icon: Terminal, run: toggleTerminal },
    { id: 'sidebar', section: actions, label: t('Toggle left sidebar'), hint: keys['sidebar.toggle'], icon: PanelLeftOpen, run: () => (leftOpen.value = !leftOpen.value) },
    { id: 'panel', section: actions, label: t('Toggle right panel'), hint: keys['panel.toggle'], icon: PanelRightOpen, run: () => (rightOpen.value = !rightOpen.value) },
    { id: 'settings', section: actions, label: t('Open app settings'), hint: keys['settings.open'], icon: SlidersHorizontal, run: () => openGlobalSettings() },
    { id: 'usage', section: actions, label: t('Usage and storage'), icon: Coins, run: () => openGlobalSettings('usage') },
    { id: 'keybindings', section: actions, label: t('Keyboard shortcuts'), hint: keys['settings.keybindings'], icon: SlidersHorizontal, run: () => openGlobalSettings('keybindings') },
    { id: 'appearance', section: actions, label: t('Appearance settings'), icon: SlidersHorizontal, run: () => openGlobalSettings('appearance') },
    { id: 'mcp-settings', section: actions, label: t('MCP servers'), icon: SlidersHorizontal, run: () => openGlobalSettings('mcp') },
    { id: 'skills-settings', section: actions, label: t('Skills'), icon: SlidersHorizontal, run: () => openGlobalSettings('skills') },
    { id: 'tools-settings', section: actions, label: t('Manage BasedCode tools'), icon: SlidersHorizontal, run: () => openGlobalSettings('tools') },
    { id: 'model', section: actions, label: t('Choose a model'), hint: keys['model.pick'], icon: SlidersHorizontal, run: () => modelPicker.value?.show() },
    { id: 'focus', section: actions, label: t('Focus the prompt box'), hint: keys['composer.focus'], icon: Pencil, run: focusComposer },
    { id: 'help', section: actions, label: t('Show available commands'), icon: Search, run: () => (commandHelp.value = true) },
    { id: 'welcome', section: actions, label: t('Show welcome screen'), icon: Sparkles, run: () => (welcomeOpen.value = true) },
    { id: 'donate', section: actions, label: t('Donate (Ko-fi)'), hint: 'ko-fi.com/naamloos', icon: Coins, run: () => rpc('external.open', { url: 'https://ko-fi.com/naamloos' }) },
    { id: 'github', section: actions, label: t('BasedCode on GitHub'), hint: 'github.com/naamloos/basedcode', icon: ExternalLink, run: () => rpc('external.open', { url: 'https://github.com/naamloos/basedcode' }) },
    { id: 'maximize', section: actions, label: t('Maximize or restore window'), hint: keys['window.maximize'], icon: PanelRightOpen, run: () => windowFrame.command('toggle-maximize') },
    { id: 'reload', section: actions, label: t('Reload app'), hint: keys['app.reload'], icon: ArchiveRestore, run: () => windowFrame.command('reload') },
  ];
  if (active.value)
    items.push({ id: 'stop', section: actions, label: t('Stop the running agent'), hint: keys['run.stop'], icon: Terminal, run: stopActiveRun });
  if (workspace.value && !workspace.value.scratch)
    items.push(
      { id: 'workspace-settings', section: actions, label: t('Workspace settings'), icon: Settings2, run: () => (settingsOpen.value = true) },
      {
        id: 'open-editor',
        section: actions,
        label: t('Open in editor'),
        // The previewed file when there is one, otherwise the workspace folder.
        hint: preview.value?.path,
        icon: ExternalLink,
        run: () => rpc('files.openExternal', { workspaceId: workspaceId.value, path: preview.value?.path ?? '.' }),
      },
    );
  if (chat.value) {
    const current = chat.value;
    items.push(
      { id: 'find', section: actions, label: t('Find in chat'), hint: keys['chat.find'], icon: Search, run: openFind },
      { id: 'rename', section: actions, label: t('Rename chat'), hint: keys['chat.rename'], icon: Pencil, run: () => startRename(current) },
      { id: 'pin', section: actions, label: current.pinned ? t('Unpin chat') : t('Pin chat'), hint: keys['chat.pin'], icon: current.pinned ? PinOff : Pin, run: () => pinChat(current) },
      { id: 'archive', section: actions, label: current.archivedAt ? t('Unarchive chat') : t('Archive chat'), hint: keys['chat.archive'], icon: current.archivedAt ? ArchiveRestore : Archive, run: () => archiveChat(current) },
      { id: 'export', section: actions, label: t('Export as Markdown'), hint: keys['chat.export'], icon: Download, run: () => exportChat(current) },
      { id: 'compact', section: actions, label: t('Compact this conversation'), hint: keys['chat.compact'], icon: Archive, run: compactChat },
      { id: 'next-chat', section: actions, label: t('Next chat'), hint: keys['chat.next'], icon: MessageSquare, run: () => cycleChat(1) },
      { id: 'previous-chat', section: actions, label: t('Previous chat'), hint: keys['chat.previous'], icon: MessageSquare, run: () => cycleChat(-1) },
    );
    // Same path as the mode chip: an empty chat switches straight away, otherwise the confirm dialog opens.
    if (current.mode !== 'review' && !active.value) {
      const currentMode = current.mode ?? 'default';
      if (currentMode !== 'default')
        items.push({ id: 'switch-default', section: actions, label: `${t('Switch mode')}: ${t('Normal chat')}`, icon: ArrowRightLeft, run: () => perform(() => switchMode('default')) });
      for (const mode of guidedModes)
        if (mode.id !== currentMode)
          items.push({ id: `${mode.id}-switch`, section: actions, label: `${t('Switch mode')}: ${t(mode.label)}`, hint: t(mode.menu), icon: modeIcons[mode.id], run: () => perform(() => switchMode(mode.id)) });
    }
  }
  for (const target of recentWorkspaces.value)
    items.push({ id: `ws-${target.id}`, section: t('Workspaces'), label: target.name, hint: target.path, icon: Folder, run: () => selectWorkspace(target.id) });
  for (const entry of chats.value)
    items.push({
      id: `chat-${entry.id}`,
      section: t('Chats'),
      label: entry.title,
      hint: entry.id === chatId.value ? t('current') : undefined,
      icon: (entry.mode && modeIcons[entry.mode]) || MessageSquare,
      run: () => selectChat(entry),
    });
  for (const file of fileTabs.value)
    items.push({ id: `file-${file.path}`, section: t('Files'), label: file.path, icon: File, run: () => openFile(file.path) });
  // Settings entries get their own group.
  const settingsIds = new Set(['settings', 'usage', 'keybindings', 'appearance', 'mcp-settings', 'skills-settings', 'tools-settings', 'workspace-settings']);
  for (const item of items) if (settingsIds.has(item.id)) item.section = t('Settings');
  return items;
});
/** Palette group order: Chats, Actions, Settings, then files and workspaces. */
const paletteSectionOrder = computed(() => [t('Chats'), t('Actions'), t('Settings'), t('Files'), t('Workspaces')]);
const paletteResults = computed(() => {
  const words = paletteText.value.toLowerCase().split(/\s+/).filter(Boolean);
  const matches = words.length
    ? paletteItems.value.filter((item) => {
        const text = `${item.label} ${item.section} ${item.hint ?? ''}`.toLowerCase();
        return words.every((word) => text.includes(word));
      })
    : paletteItems.value.filter((item) => item.section !== t('Chats')).concat(
        paletteItems.value.filter((item) => item.section === t('Chats')).slice(0, 8),
      );
  // Stable sort keeps each group's own order while the groups follow paletteSectionOrder.
  const rank = (section: string) => {
    const index = paletteSectionOrder.value.indexOf(section);
    return index === -1 ? paletteSectionOrder.value.length : index;
  };
  return [...matches].sort((a, b) => rank(a.section) - rank(b.section)).slice(0, 60);
});
watch(paletteText, () => (paletteIndex.value = 0));
function paletteKey(event: KeyboardEvent) {
  const count = paletteResults.value.length;
  if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
    event.preventDefault();
    if (count) paletteIndex.value = (paletteIndex.value + (event.key === 'ArrowDown' ? 1 : -1) + count) % count;
    void nextTick(() => document.querySelector('.palette .active')?.scrollIntoView({ block: 'nearest' }));
  } else if (event.key === 'Enter') {
    event.preventDefault();
    const item = paletteResults.value[paletteIndex.value];
    if (item) runPaletteItem(item);
  } else if (event.key === 'Escape') {
    event.preventDefault();
    closePalette();
  }
}
function runPaletteItem(item: PaletteItem) {
  closePalette();
  void perform(async () => {
    await item.run();
  });
}

/** Tokens and cost of one prompt, for the label on its message. */
function runUsageLabel(runId: string): string {
  const stats = state.value.runs.find((run) => run.id === runId)?.stats;
  if (!stats) return '';
  const tokens = `${formatTokens(stats.inputTokens + stats.outputTokens)} tok`;
  return stats.costUsd === undefined ? tokens : `${tokens} · ${formatCost(stats.costUsd)}`;
}

/** The chat this one was forked from (while it exists) and the chats forked from this one. */
const parentChat = computed(() => {
  const parent = chat.value?.forkedFrom ?? chat.value?.reviewOf?.chatId;
  return parent ? state.value.chats.find((item) => item.id === parent) : undefined;
});
const branchChats = computed(() =>
  chat.value ? state.value.chats.filter((item) => item.forkedFrom === chat.value!.id) : [],
);
const branchesOpen = ref(false);
watch(chatId, () => (branchesOpen.value = false));

/** Every registered model connection, for second opinions, re-runs and "Continue with". */
const allProviders = computed(() => state.value.global.providers);
const chatProvider = computed(() =>
  chat.value?.providerId
    ? allProviders.value.find((provider) => provider.id === chat.value!.providerId)
    : undefined,
);
/** Second-opinion sub-chats of the open chat, with their latest status. */
const chatReviews = computed(() =>
  chat.value
    ? state.value.chats
        .filter((item) => item.reviewOf?.chatId === chat.value!.id)
        .map((review) => {
          const run = state.value.runs.filter((item) => item.chatId === review.id).at(-1);
          const answer = state.value.messages
            .filter((message) => message.chatId === review.id && message.role === 'assistant' && message.content.trim())
            .at(-1);
          const verdict = /Verdict:\s*([^\n]+)/i.exec(answer?.content ?? '')?.[1]?.trim();
          return { chat: review, run, verdict };
        })
    : [],
);
/** The comparison the open chat is part of, newest first. */
const chatComparison = computed(() => {
  if (!chat.value) return undefined;
  const ids = new Set(runs.value.map((run) => run.id));
  return state.value.comparisons
    .filter((item) => ids.has(item.originalRunId) || ids.has(item.rerunRunId))
    .at(-1);
});
/** The open chat's latest prompt, the only one that can be re-run or rewound. */
const latestRunId = computed(() => lastRun.value?.id ?? '');
function rewindable(message: Message): boolean {
  const tool = message.metadata.tool as { name?: string; status?: string } | undefined;
  return Boolean(
    tool?.name &&
      fileChangingTools.has(tool.name) &&
      message.runId === latestRunId.value &&
      !active.value &&
      !runBusy(message.runId) &&
      !runs.value.find((run) => run.id === message.runId)?.forkedFrom,
  );
}
type ModelChoice = { providerId: string; model: string; effort?: string; note?: string };
/** Second opinions open as their own center tabs, next to the chat, without leaving it. */
const reviewTabs = ref<string[]>([]);
const activeReview = ref('');
watch(chatId, () => {
  reviewTabs.value = [];
  activeReview.value = '';
});
const openReviews = computed(() =>
  reviewTabs.value.flatMap((id) => chatReviews.value.filter((item) => item.chat.id === id)),
);
const shownReview = computed(() => openReviews.value.find((item) => item.chat.id === activeReview.value));
function openReviewTab(review: Chat) {
  selectFileTab();
  if (!reviewTabs.value.includes(review.id)) reviewTabs.value.push(review.id);
  activeReview.value = review.id;
}
function closeReviewTab(id: string) {
  reviewTabs.value = reviewTabs.value.filter((item) => item !== id);
  if (activeReview.value === id) activeReview.value = '';
}
async function deleteReview(review: Chat) {
  await rpc('chat.delete', { chatId: review.id });
  closeReviewTab(review.id);
  await refresh();
}
async function startReview(runId: string, pick: ModelChoice) {
  const { note, ...choice } = pick;
  const review = await rpc<Chat>('review.start', { runId, ...choice, focus: note || undefined });
  await refresh();
  openSideTab('reviews');
  openReviewTab(review);
}
async function rerunWith(runId: string, pick: ModelChoice) {
  if (wrappedUp.value) return;
  const result = await rpc<{ chat: Chat; comparison: { id: string } }>('run.rerun', { runId, ...pick });
  await refresh();
  await selectChat(result.chat);
  compareId.value = result.comparison.id;
}
async function continueWith(pick: ModelChoice) {
  if (wrappedUp.value) return;
  if (!chat.value) return;
  await rpc('chat.handoff', { chatId: chat.value.id, ...pick });
  await refresh();
}
/** Picking a model in the main picker ends a chat's hand-off to another model. */
async function pickerSaved() {
  if (chat.value?.providerId && chat.value.mode !== 'review' && !chat.value.rerunOf)
    await rpc('chat.provider', { chatId: chat.value.id, providerId: null });
  await refresh();
}
async function askAboutReview(reviewId: string) {
  if (wrappedUp.value) return;
  if (!chat.value) return;
  await rpc('run.submit', {
    chatId: chat.value.id,
    prompt: `Read second opinion ${reviewId} with the second_opinions tool. Check each finding against the code, fix the ones that hold up, and tell me which ones you rejected and why.`,
  });
  await refresh();
}
const contextPanel = ref<{ load: () => Promise<void> }>();
const gitPanel = ref<{ load: () => Promise<void> }>();
/** The one refresh button next to the sidebar tabs reloads whichever tab is open. */
async function refreshSideTab() {
  if (rightTab.value === 'files') return loadFiles();
  if (rightTab.value === 'changes') return loadChanges();
  if (rightTab.value === 'context') return contextPanel.value?.load();
  if (rightTab.value === 'reviews') return refresh();
  return gitPanel.value?.load();
}
function openSideTab(tab: 'context' | 'git' | 'reviews') {
  rightTab.value = tab;
  rightOpen.value = true;
}
async function previewRewind(messageId: string) {
  if (wrappedUp.value) return;
  const result = await rpc<{ paths: string[]; conflicts: string[]; messages: number; actions: string[] }>(
    'rewind.preview',
    { messageId },
  );
  rewindModal.value = { messageId, ...result };
}
async function applyRewind() {
  if (!rewindModal.value) return;
  await rpc('rewind.apply', { messageId: rewindModal.value.messageId });
  rewindModal.value = undefined;
  await refresh();
  await loadFiles();
}

/** The chat whose hand-off dialog is open, if any, and the mode preselected in it. */
const handOffChat = ref<Chat>();
const handOffMode = ref<Exclude<ChatMode, 'review'>>();
watch(handOffChat, (value) => value || (handOffMode.value = undefined));
function openHandOff(target: Chat) {
  moveMenu.value = '';
  handOffChat.value = target;
}
/** The in-chat line for a mode switch, e.g. "Switched from a normal chat to Debug mode". */
function modeSwitchLabel(value: unknown): string {
  const { from, to } = value as { from: string; to: string };
  return t('Switched from {from} to {to}', { from: t(from), to: t(to) });
}
/** The composer's mode chip: an empty chat just takes the mode; otherwise confirm (with context) in the hand-off dialog. */
async function switchMode(mode: Exclude<ChatMode, 'review'>) {
  if (!chat.value) return;
  if (!messages.value.length) return setChatMode(mode);
  handOffMode.value = mode;
  handOffChat.value = chat.value;
}
/** Switches this chat to the chosen mode in place and continues it there. */
async function handOff(choice: { mode: ChatMode; context: string }) {
  const source = handOffChat.value;
  if (!source) return;
  try {
    await rpc<Chat>('chat.handOff', {
      chatId: source.id,
      mode: choice.mode,
      context: choice.context || undefined,
    });
    handOffChat.value = undefined;
    await refresh();
    if (chat.value?.id !== source.id) await selectChat(source);
  } catch (error) {
    handOffChat.value = undefined;
    throw error;
  }
}

async function forkChat(runId: string) {
  if (!chat.value) return;
  const fork = await rpc<Chat>('chat.fork', { chatId: chat.value.id, runId });
  await refresh();
  await selectChat(fork);
}
function runBusy(runId: string): boolean {
  const status = state.value.runs.find((run) => run.id === runId)?.status ?? '';
  return ['queued', 'running', 'paused', 'awaiting_approval'].includes(status);
}
function loadCollapsed(): Set<string> {
  try {
    const saved = localStorage.getItem('basedcode.collapsedGroups') ?? '[]';
    return new Set(JSON.parse(saved) as string[]);
  } catch {
    return new Set();
  }
}
const collapsedGroups = ref(loadCollapsed());
function toggleGroup(id: string) {
  const next = new Set(collapsedGroups.value);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  collapsedGroups.value = next;
  try {
    localStorage.setItem('basedcode.collapsedGroups', JSON.stringify([...next]));
  } catch {
    // Collapsing still works for this session without storage.
  }
}
function chatBusy(id: string): boolean {
  return state.value.runs.some(
    (run) =>
      run.chatId === id &&
      ['queued', 'running', 'paused', 'awaiting_approval'].includes(run.status),
  );
}
const messages = computed(() =>
  state.value.messages.filter(
    (message) =>
      message.chatId === chatId.value &&
      (message.content || message.metadata.reasoning || message.metadata.streaming),
  ),
);
/** Tools whose output is shown in the chat itself rather than folded into the tool-call group. */
function toolName(message: Message): string | undefined {
  return (message.metadata.tool as { name?: string } | undefined)?.name;
}
function hasMcpUi(message: Message): boolean {
  const tool = message.metadata.tool as { result?: { app?: unknown; result?: CallToolResult } } | undefined;
  return toolName(message) === 'call_mcp' && Boolean(
    tool?.result?.app || legacyMcpResources(tool?.result?.result).length,
  );
}
const standaloneTools = new Set(['render_ui', 'show_image', 'render_chart', 'render_diagram', 'query_text', 'query_yes_no', 'query_choice', 'query_slider', 'query_color', 'query_font', 'query_radius', 'query_preview', 'query_ui']);
/** Bookkeeping tools shown as one line instead of a tool card. Failed calls keep their card so the error shows. */
const noteTools = new Set(['set_chat_title', 'update_plan']);
function toolNote(message: Message): string | undefined {
  const tool = message.metadata.tool as
    | { name?: string; status?: string; args?: Record<string, unknown>; result?: { title?: string } }
    | undefined;
  if (!tool?.name || !noteTools.has(tool.name) || tool.status === 'failed') return undefined;
  if (tool.name === 'set_chat_title')
    return t('Named this chat: {title}', { title: String(tool.result?.title ?? tool.args?.title ?? '') });
  const steps = Array.isArray(tool.args?.steps) ? (tool.args.steps as PlanStep[]) : [];
  return t('Updated the plan: {done} of {total} steps done', {
    done: steps.filter((step) => step.status === 'completed').length,
    total: steps.length,
  });
}
const messageItems = computed(() => {
  const items: { message: Message; tools?: Message[]; note?: string }[] = [];
  for (const message of messages.value) {
    const previous = items.at(-1);
    const note = message.role === 'tool' ? toolNote(message) : undefined;
    if (note) items.push({ message, note });
    else if (
      message.role === 'tool' &&
      (standaloneTools.has(toolName(message) ?? '') || hasMcpUi(message))
    )
      items.push({ message });
    else if (message.role === 'tool') {
      if (previous?.tools && previous.message.runId === message.runId) previous.tools.push(message);
      else items.push({ message, tools: [message] });
    } else items.push({ message });
  }
  return items;
});
const runs = computed(() => state.value.runs.filter((run) => run.chatId === chatId.value));
/** The prompt being worked on now, and prompts waiting behind it. `active` is either, for controls that must wait. */
const working = computed(() =>
  runs.value.find((run) => ['awaiting_approval', 'running', 'paused'].includes(run.status)),
);
const queued = computed(() => runs.value.filter((run) => run.status === 'queued'));
const active = computed(() => working.value ?? queued.value[0]);
/** Latest update_plan checklist of the working prompt, pinned above the composer while it runs. */
const activePlan = computed(() => {
  const runId = working.value?.id;
  if (!runId) return undefined;
  const latest = state.value.messages.findLast(
    (message) =>
      message.runId === runId &&
      message.role === 'tool' &&
      (message.metadata.tool as { name?: string } | undefined)?.name === 'update_plan',
  );
  const steps = (latest?.metadata.tool as { args?: { steps?: unknown } } | undefined)?.args?.steps;
  return Array.isArray(steps) && steps.length ? (steps as PlanStep[]) : undefined;
});
/** Status bar summary of what the app is doing right now, across every chat. */
const appStatus = computed<{ label: string; tone: 'live' | 'busy' | 'warn' | 'off' }>(() => {
  if (!connected.value) return { label: t('Disconnected'), tone: 'off' };
  if (state.value.approvals.length)
    return { label: t('Waiting for approval ({count})', { count: state.value.approvals.length }), tone: 'warn' };
  const all = state.value.runs;
  const running = all.filter((run) => ['running', 'paused'].includes(run.status)).length;
  const waiting = all.filter((run) => run.status === 'queued').length;
  if (compacting.value) return { label: t('Compacting…'), tone: 'busy' };
  if (running)
    return {
      label: waiting
        ? t('{running} running · {queued} queued', { running, queued: waiting })
        : t(running === 1 ? 'Agent working' : '{count} agents working', { count: running }),
      tone: 'busy',
    };
  if (waiting) return { label: t('{count} queued', { count: waiting }), tone: 'busy' };
  if (uploading.value) return { label: t('Uploading…'), tone: 'busy' };
  return { label: t('Idle'), tone: 'live' };
});
const compactRequests = ref<string[]>([]);
const compacting = computed(
  () =>
    compactRequests.value.includes(chatId.value) ||
    messages.value.some((message) => message.metadata.compacting),
);
/** Whether a message can be delivered to the working prompt now, rather than queued behind it. */
const canSteer = computed(() => {
  const run = working.value;
  const kind = run?.provider?.split(' / ')[0] as ProviderKind | undefined;
  return Boolean(
    !compacting.value &&
    run &&
    ['running', 'paused'].includes(run.status) &&
    kind &&
    steerableKinds.includes(kind),
  );
});
const thisChatUsage = computed(() => chatUsage(runs.value));
// Declared after `messages`: a watch reads its source immediately.
watch(
  () => [messages.value.length, messages.value.at(-1)?.content] as const,
  () => {
    if (findOpen.value && findText.value.trim()) void nextTick(() => runFind(false));
  },
);
/** Usage windows of the subscription provider the next (or running) prompt uses. */
const currentLimits = computed(() => {
  const kind = (working.value?.provider?.split(' / ')[0] ?? enabledProviders.value[0]?.kind) as
    ProviderKind | undefined;
  return kind === 'codex' || kind === 'claude' || kind === 'antigravity'
    ? state.value.limits.find((item) => item.kind === kind)
    : undefined;
});
const approvalMode = computed(
  () => workspace.value?.settings.approvalMode ?? state.value.global.approvalMode,
);
const approvalScopeMode = computed(() =>
  approvalScope.value === 'global' ? state.value.global.approvalMode : approvalMode.value,
);
const uploading = computed(() => pending.value.some((item) => !item.attachment && !item.error));
const actions = computed(() =>
  state.value.actions
    .filter((action) => action.workspaceId === workspaceId.value)
    .slice()
    .reverse(),
);
const terminals = computed(() =>
  state.value.terminals.filter((terminal) => terminal.workspaceId === workspaceId.value),
);
const approval = computed(() => state.value.approvals[0]);
const rememberCommand = ref(false);
watch(
  () => approval.value?.id,
  () => {
    rememberCommand.value = false;
  },
);
const currentChange = computed(
  () => changes.value.find((change) => change.path === chosenChange.value) ?? changes.value[0],
);
const markdownPreview = computed(() => /\.(md|mdc)$/i.test(preview.value?.path ?? ''));
// Full-file diff in the preview: prefer the loaded prompt changes, then the loaded Git diff, then a Git diff fetched on demand.
const previewDiffOn = ref(false);
const previewGitDiff = ref('');
const previewFileDiff = computed(() => {
  const path = preview.value?.path;
  if (!path || preview.value?.binary) return undefined;
  return (
    changes.value.find((change) => change.path === path && !change.binary)?.diff ??
    fileSection(gitDiff.value, path) ??
    fileSection(previewGitDiff.value, path)
  );
});
async function togglePreviewDiff() {
  if (previewDiffOn.value && previewFileDiff.value) {
    previewDiffOn.value = false;
    return;
  }
  if (!previewFileDiff.value) {
    const result = await rpc<{ git?: string }>('changes', {
      workspaceId: workspaceId.value,
      scope: 'workspace',
    });
    previewGitDiff.value = result.git ?? '';
  }
  if (previewFileDiff.value) previewDiffOn.value = true;
  else
    error.value = t('{path} has no changes to show.', {
      path: preview.value?.path ?? t('This file'),
    });
}
const highlightedPreview = computed(() =>
  preview.value ? hljs.highlightAuto(preview.value.content).value : '',
);
const latestRun = computed(() => chosenRun.value || runs.value.at(-1)?.id);
const enabledProviders = computed(() =>
  effectiveProviders(state.value.global, workspace.value).filter((provider) => provider.enabled),
);
const providerLabel = computed(() => {
  if (active.value?.provider) return active.value.provider;
  // A chat handed to another model keeps using it until the main picker changes the model.
  if (chatProvider.value)
    return `${chatProvider.value.kind} / ${chat.value?.model || chatProvider.value.model || 'default'}`;
  const first = enabledProviders.value[0];
  if (!first || (!first.model && first.kind !== 'claude')) return t('Choose a model');
  return `${first.kind} / ${first.model || 'default'}`;
});
const modelPicker = ref<{ show: () => void }>();
// Keep onboarding with app data so a data reset also resets the welcome dialog.
const welcomeOpen = ref(false);
let welcomeChecked = false;
async function closeWelcome() {
  welcomeOpen.value = false;
  try {
    await rpc('welcome.dismiss');
  } catch (failure) {
    welcomeOpen.value = true;
    report(failure);
  }
}
const composerBox = ref<HTMLElement>();
const sendButton = ref<HTMLElement>();
const modelUsage = computed(() => usageByModel(state.value.runs));
/** The model the next prompt uses, or the running one: what the usage panel describes. */
const currentModel = computed(() => {
  const stats = active.value?.stats;
  if (stats) return { provider: stats.provider, model: stats.model };
  const first = enabledProviders.value[0];
  return first && (first.model || first.kind === 'claude')
    ? { provider: first.kind, model: first.model || 'default' }
    : undefined;
});
const runsById = computed(() => new Map(state.value.runs.map((run) => [run.id, run])));
/** Each prompt's stats line goes after its last visible message. */
const lastMessageOfRun = computed(
  () => new Map(messages.value.map((message) => [message.runId, message.id])),
);
const fallbackIndex = computed(() => active.value?.providerIndex ?? 0);
const fallbackTitle = computed(() =>
  enabledProviders.value.length
    ? `${t('Fallback order:')}\n${enabledProviders.value.map((provider, index) => `${index + 1}. ${providerName(provider)} / ${provider.model || 'default'}${active.value && index === fallbackIndex.value ? `  ← ${t('active')}` : ''}`).join('\n')}`
    : t('No providers enabled'),
);
function compactionSummary(compaction: unknown): string {
  const summary = (compaction as { summary?: unknown } | null)?.summary;
  return typeof summary === 'string' ? summary : '';
}
/** Use workspace-relative paths for local diagnostics and full paths for external files. */
function diagnosticPath(uri: string): string {
  const path = decodeURIComponent(uri.replace(/^file:\/+/, '')).replaceAll('\\', '/');
  const root = workspace.value?.path.replaceAll('\\', '/').replace(/\/$/, '');
  return root && path.toLowerCase().startsWith(`${root.toLowerCase()}/`)
    ? path.slice(root.length + 1)
    : path;
}
const diagnosticList = computed(() =>
  state.value.diagnostics
    .filter((item) => insideWorkspace(item.uri))
    .map((item) => ({
      ...item,
      path: diagnosticPath(item.uri),
      level: (item.severity ?? 1) === 1 ? 'error' : item.severity === 2 ? 'warning' : 'info',
    }))
    .sort(
      (a, b) =>
        (a.severity ?? 1) - (b.severity ?? 1) ||
        a.path.localeCompare(b.path) ||
        a.range.start.line - b.range.start.line,
    ),
);
function openDiagnostics() {
  activeReview.value = '';
  showDiagnostics.value = true;
  showActions.value = false;
  preview.value = undefined;
  snippetSources.value = new Map();
  void loadSnippetSources();
}
/** Diagnostics that point inside the open workspace; only these get snippets and an open-in-editor button. */
const insideWorkspace = (uri: string) => {
  const root = workspace.value?.path.replaceAll('\\', '/').replace(/\/$/, '').toLowerCase();
  return (
    !!root &&
    decodeURIComponent(uri.replace(/^file:\/+/, ''))
      .replaceAll('\\', '/')
      .toLowerCase()
      .startsWith(`${root}/`)
  );
};
/** File lines by workspace path, for snippets; `null` while loading or when the file cannot be read as text. */
const snippetSources = ref(new Map<string, string[] | null>());
async function loadSnippetSources() {
  const target = workspaceId.value;
  const paths = [
    ...new Set(
      diagnosticList.value.filter((item) => insideWorkspace(item.uri)).map((item) => item.path),
    ),
  ].filter((path) => !snippetSources.value.has(path));
  for (const path of paths) snippetSources.value.set(path, null);
  await Promise.all(
    paths.map(async (path) => {
      try {
        const result = await rpc<{ content: string; binary: boolean }>('files.snippet', {
          workspaceId: target,
          path,
        });
        if (workspaceId.value === target && !result.binary)
          snippetSources.value.set(path, result.content.split(/\r?\n/));
      } catch {
        /* No snippet; the card still shows the message. */
      }
    }),
  );
  snippetSources.value = new Map(snippetSources.value);
}
watch(workspaceId, () => {
  snippetSources.value = new Map();
  if (showDiagnostics.value) void loadSnippetSources();
});
watch(
  () => [showDiagnostics.value, state.value.diagnostics] as const,
  ([open]) => {
    if (open) void loadSnippetSources();
  },
);
function highlightLine(code: string, path: string): string {
  const language = path.split('.').at(-1)?.toLowerCase() ?? '';
  const alias =
    (
      {
        vue: 'xml',
        mjs: 'javascript',
        cjs: 'javascript',
        mts: 'typescript',
        cts: 'typescript',
      } as Record<string, string>
    )[language] ?? language;
  return hljs.getLanguage(alias)
    ? hljs.highlight(code, { language: alias, ignoreIllegals: true }).value
    : hljs.highlightAuto(code).value;
}
/** Two lines of context around the reported range (at most six lines of the range itself), highlighted line by line. */
function diagnosticSnippet(item: {
  path: string;
  range: { start: { line: number }; end: { line: number } };
}) {
  const lines = snippetSources.value.get(item.path);
  if (!lines) return [];
  const from = Math.max(0, item.range.start.line - 2);
  const to = Math.min(
    lines.length - 1,
    Math.min(item.range.end.line, item.range.start.line + 5) + 2,
  );
  return lines.slice(from, to + 1).map((code, offset) => {
    const number = from + offset;
    return {
      number: number + 1,
      html: highlightLine(code.slice(0, 400), item.path) || ' ',
      hit: number >= item.range.start.line && number <= item.range.end.line,
    };
  });
}
function openDiagnosticInEditor(item: {
  path: string;
  range: { start: { line: number; character: number } };
}) {
  return rpc('files.openExternal', {
    workspaceId: workspaceId.value,
    path: item.path,
    line: item.range.start.line + 1,
    column: item.range.start.character + 1,
  });
}
let removeAntics: (() => void) | undefined;
onMounted(() => (removeAntics = installAntics()));
onBeforeUnmount(() => removeAntics?.());
// Clearing every diagnostic earns a stamp.
watch(
  () => diagnosticList.value.length,
  (count, before) => {
    if (before > 0 && count === 0) stamp('ZERO BUGS?!');
  },
);
/** Line marked in the file preview after jumping there from a diagnostic. */
const diagnosticHighlight = ref<{ path: string; top: number; height: number } | null>(null);
/** Opens a diagnostic's file in BasedCode's preview and scrolls its line into view. */
async function openDiagnosticHere(item: { path: string; range: { start: { line: number } } }) {
  await openFile(item.path);
  await nextTick();
  const numbers = document.querySelector<HTMLElement>('.code-preview .line-numbers');
  if (!numbers) return;
  let scroller: HTMLElement | null = numbers.parentElement;
  while (scroller && scroller.scrollHeight <= scroller.clientHeight)
    scroller = scroller.parentElement;
  if (!scroller) return;
  const lineHeight = parseFloat(getComputedStyle(numbers).lineHeight) || 20;
  diagnosticHighlight.value = {
    path: item.path,
    top: parseFloat(getComputedStyle(numbers).paddingTop) + item.range.start.line * lineHeight,
    height: lineHeight,
  };
  const top =
    numbers.getBoundingClientRect().top - scroller.getBoundingClientRect().top + scroller.scrollTop;
  scroller.scrollTop = Math.max(
    0,
    top + item.range.start.line * lineHeight - scroller.clientHeight / 3,
  );
}
/** Asks the current chat to fix one diagnostic: steers a working prompt, or starts a new one. */
async function fixDiagnostic(item: {
  path: string;
  message: string;
  server: string;
  level: string;
  range: { start: { line: number; character: number } };
}) {
  if (!workspace.value || wrappedUp.value) return;
  composer.value = `Fix this ${item.level} reported by ${item.server} in ${item.path}:${item.range.start.line + 1}:${item.range.start.character + 1}:\n\n${item.message}`;
  showDiagnostics.value = false;
  await send();
}
/** Asks the current chat to fix every listed diagnostic in one prompt. */
async function fixAllDiagnostics() {
  if (wrappedUp.value) return;
  if (!workspace.value || !diagnosticList.value.length) return;
  const lines = diagnosticList.value.map(
    (item) =>
      `- ${item.level} (${item.server}) ${item.path}:${item.range.start.line + 1}:${item.range.start.character + 1}: ${item.message}`,
  );
  composer.value = `Fix these ${lines.length} problems reported by language servers:\n\n${lines.join('\n')}`;
  showDiagnostics.value = false;
  await send();
}
// Scan the whole workspace for problems whenever one is opened, so the Diagnostics page is filled without opening files.
watch(
  workspaceId,
  (id) => {
    if (id) void rpc('language.scan', { workspaceId: id }).catch(() => undefined);
  },
  { immediate: true },
);
const scanningDiagnostics = ref(false);
async function scanDiagnostics() {
  if (!workspaceId.value || scanningDiagnostics.value) return;
  scanningDiagnostics.value = true;
  try {
    await rpc('language.scan', { workspaceId: workspaceId.value, wait: true });
  } finally {
    scanningDiagnostics.value = false;
  }
}
const currentDiagnostics = computed(() =>
  state.value.diagnostics.filter(
    (item) =>
      preview.value &&
      decodeURIComponent(item.uri).replaceAll('\\', '/').endsWith(preview.value.path),
  ),
);

function readPreference(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
function setDiffLayout(layout: 'unified' | 'split') {
  diffLayout.value = layout;
  try {
    localStorage.setItem('basedcode.diffLayout', layout);
  } catch {
    /* Preference only; ignore unavailable storage. */
  }
}
/** Latest run of a chat, if its state is worth flagging in the chat list. */
function chatRunStatus(id: string) {
  const latest = state.value.runs.filter((run) => run.chatId === id).at(-1);
  return latest && notableRunStates.has(latest.status) ? runStatus[latest.status] : undefined;
}
function report(failure: unknown) {
  error.value = failure instanceof Error ? failure.message : String(failure);
}
async function perform(operation: () => Promise<unknown>) {
  try {
    await operation();
  } catch (failure) {
    report(failure);
  }
}

async function refresh() {
  if (refreshPending) {
    // Wait for a refresh that starts after this call, so callers see state that includes their own changes.
    refreshAgain = true;
    return new Promise<void>((resolve) => refreshWaiters.push(resolve));
  }
  refreshPending = true;
  try {
    const next = await rpc<AppState>('state');
    stateVersion.value++;
    for (const message of next.messages) {
      const existing = state.value.messages.find((item) => item.id === message.id);
      if (
        existing?.metadata.streaming &&
        message.metadata.streaming &&
        existing.content.length > message.content.length
      )
        message.content = existing.content;
      if (
        existing?.metadata.streaming &&
        message.metadata.streaming &&
        String(existing.metadata.reasoning ?? '').length >
          String(message.metadata.reasoning ?? '').length
      )
        message.metadata.reasoning = existing.metadata.reasoning;
    }
    if (!welcomeChecked) {
      welcomeOpen.value = !next.global.welcomeDismissed;
      welcomeChecked = true;
    }
    state.value = next;
    if (!globalSettingsOpen.value) setAppLanguage(next.global.language as AppLanguage);
    if (!workspace.value && state.value.workspaces.length)
      await selectWorkspace(recentWorkspaces.value[0].id);
    if (!chat.value && chats.value.length) chatId.value = chats.value[0].id;
    if (follow.value) {
      await nextTick();
      conversation.value?.scrollTo({ top: conversation.value.scrollHeight });
    }
  } catch (failure) {
    report(failure);
  } finally {
    refreshPending = false;
    if (refreshAgain) {
      refreshAgain = false;
      const waiting = refreshWaiters;
      refreshWaiters = [];
      void refresh().finally(() => waiting.forEach((resolve) => resolve()));
    }
  }
}

async function selectWorkspace(id: string) {
  const selected = state.value.workspaces.find((item) => item.id === id);
  if (!selected) return;
  const opened = await rpc<Workspace>('workspace.open', { path: selected.path });
  selected.lastOpenedAt = opened.lastOpenedAt;
  folderModal.value = false;
  fileTabs.value = [];
  workspaceId.value = id;
  localStorage.setItem('basedcode.workspace', id);
  chatId.value = chats.value[0]?.id ?? '';
  preview.value = undefined;
  showActions.value = false;
  showDiagnostics.value = false;
  chosenRun.value = '';
  expanded.value = new Set();
  await loadFiles();
}
async function selectChat(selected: Chat) {
  if (phone.value) leftOpen.value = false;
  if (selected.workspaceId !== workspaceId.value) await selectWorkspace(selected.workspaceId);
  chatId.value = selected.id;
  preview.value = undefined;
  showActions.value = false;
  showDiagnostics.value = false;
  chosenRun.value = '';
  if (rightTab.value === 'changes') void loadChanges();
}
async function deleteChat(id: string) {
  await rpc('chat.delete', { chatId: id });
  clearDraft(id);
  if (chatId.value === id) {
    chatId.value = '';
    preview.value = undefined;
    chosenRun.value = '';
  }
  await refresh();
}
/** New chat in a workspace (the current one by default), or a plain chat with `scratch`. */
async function createChat(
  options: { workspaceId?: string; scratch?: boolean; mode?: ChatMode } = {},
) {
  const target = options.workspaceId ?? workspaceId.value;
  const scratch = options.scratch ?? (!target || scratchIds.value.has(target));
  const created = await rpc<Chat>('chat.create', {
    ...(scratch ? { scratch: true } : { workspaceId: target }),
    ...(options.mode ? { mode: options.mode } : {}),
  });
  await refresh();
  await selectChat(created);
}
/**
 * Opens a folder as a workspace: the native folder dialog in the desktop app,
 * the built-in picker in a browser tab (remote access), where no shell can show one.
 */
async function openWorkspace() {
  const native = windowFrame.pickFolder();
  if (!native) {
    pickerMode.value = 'folder';
    folderModal.value = true;
    return;
  }
  const path = await native;
  if (!path) return;
  folderPath.value = path;
  await openFolder();
}
async function openFolder() {
  const selected = await rpc<Workspace>('workspace.open', { path: folderPath.value });
  folderModal.value = false;
  folderPath.value = '';
  await refresh();
  await selectWorkspace(selected.id);
}
/**
 * Sends the composer. While a prompt is working, the default is to steer it (deliver the message mid-run) when its
 * provider can take that, and to queue a new prompt otherwise; `queue` forces a new queued prompt.
 */
const commandHelp = ref(false);
const skillSlashCommands = ref<{ name: string; description: string; scope?: 'workspace' | 'global' }[]>([]);
const skillTaskParam: SlashCommandParam = {
  name: 'task',
  description: 'What the skill should do. Defaults to explaining the skill.',
  optional: true,
  rest: true,
};
const allSlashCommands = computed<SlashCommandInfo[]>(() => [
  ...slashCommands,
  // A skill named like a built-in command is still reachable as @name.
  ...skillSlashCommands.value
    .filter((skill) => !slashCommands.some((command) => command.name === skill.name))
    .map(({ name, description }) => ({ name, description, params: [skillTaskParam] })),
]);
/** Caret offset in the composer, so an @skill mention can be completed anywhere in the message. */
const composerCaret = ref(0);
function trackCaret(event: Event) {
  if (event.target instanceof HTMLTextAreaElement) composerCaret.value = event.target.selectionStart;
}
const mentionIndex = ref(0);
const mentionDismissed = ref(false);
const skillMention = computed(() => {
  if (mentionDismissed.value) return undefined;
  const before = composer.value.slice(0, composerCaret.value);
  const match = /(^|\s)@([a-z0-9-]*)$/.exec(before);
  if (!match) return undefined;
  const query = match[2];
  const skills = skillSlashCommands.value.filter((skill) => skill.name.startsWith(query));
  return { query, start: before.length - query.length - 1, skills };
});
function chooseMention(name: string) {
  const mention = skillMention.value;
  if (!mention) return;
  const input = composerBox.value?.querySelector('textarea');
  const inserted = `@${name} `;
  composer.value = composer.value.slice(0, mention.start) + inserted + composer.value.slice(composerCaret.value).replace(/^[a-z0-9-]*\s?/, '');
  const caret = mention.start + inserted.length;
  composerCaret.value = caret;
  nextTick(() => {
    input?.focus();
    input?.setSelectionRange(caret, caret);
  });
}
/**
 * While arguments are being typed after a known command ("/skill code-r"), its signature
 * with the parameter under the caret picked out, so nobody has to remember the order.
 */
const commandArgHint = computed(() => {
  const match = /^\/([a-z0-9-]+)\s([\s\S]*)$/.exec(composer.value.trimStart());
  if (!match) return undefined;
  const command = allSlashCommands.value.find((item) => item.name === match[1]);
  if (!command) return undefined;
  const params = command.params ?? [];
  const args = match[2].trimStart();
  const words = args ? args.trimEnd().split(/\s+/) : [];
  const finished = args ? args.split(/\s+/).length - (/\s$/.test(args) ? 0 : 1) : 0;
  const last = params.length - 1;
  // A rest parameter soaks up every word after it; past the last plain one there is nothing left to fill.
  const index = !params.length ? -1 : finished > last ? (params[last].rest ? last : -1) : finished;
  // What each parameter parsed to so far, plus words no parameter takes.
  const values = params.map((param, i) =>
    param.rest && i === last ? words.slice(i).join(' ') : (words[i] ?? ''),
  );
  const extra = params.at(-1)?.rest ? [] : words.slice(params.length);
  const missing = params.some((param, i) => !param.optional && !values[i]);
  return { name: command.name, command, params, index, current: params[index], values, extra, missing };
});
/** Splits a command name into the part the user typed and the rest, for highlighting the match. */
const commandQuery = computed(() => {
  const input = composer.value.trimStart();
  return input.startsWith('/') && !/\s/.test(input) ? input.slice(1) : '';
});
const unknownCommand = computed(() => {
  const typed = /^\/([a-z0-9-]+)\s/.exec(composer.value.trimStart())?.[1];
  if (typed && !allSlashCommands.value.some((item) => item.name === typed)) return typed;
  const query = commandQuery.value;
  return query && !commandHelp.value && !commandDismissed.value && !commandSuggestions.value.length
    ? query
    : '';
});
const commandIndex = ref(0);
const commandDismissed = ref(false);
const commandList = ref<HTMLElement>();
async function loadSkillCommands() {
  const id = workspaceId.value;
  if (!id) { skillSlashCommands.value = []; return; }
  const result = await rpc<{ name: string; description: string }[]>('skills.commands', { workspaceId: id });
  if (workspaceId.value === id) skillSlashCommands.value = result;
}
watch(workspaceId, () => { skillSlashCommands.value = []; void loadSkillCommands().catch(report); }, { immediate: true });
watch(composer, (value, previous) => {
  commandIndex.value = 0;
  commandDismissed.value = false;
  mentionIndex.value = 0;
  mentionDismissed.value = false;
  const startsCommand = value.trimStart().startsWith('/') && !previous.trimStart().startsWith('/');
  const addsMention = value.split('@').length > previous.split('@').length;
  if (startsCommand || addsMention) void loadSkillCommands().catch(report);
});
const visibleCommands = computed(() => commandDismissed.value ? [] : commandHelp.value ? allSlashCommands.value : commandSuggestions.value);
function chooseCommand(name: string) {
  const input = commandList.value?.parentElement?.parentElement?.querySelector('textarea');
  composer.value = '/' + name + ' ';
  commandHelp.value = false;
  nextTick(() => input?.focus());
}
function commandKeydown(event: KeyboardEvent) {
  if (event.isComposing || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
  const mentions = !visibleCommands.value.length ? skillMention.value?.skills ?? [] : [];
  if (mentions.length && ['ArrowDown', 'ArrowUp', 'Enter', 'Tab', 'Escape'].includes(event.key)) {
    event.preventDefault();
    event.stopPropagation();
    if (event.key === 'Escape') mentionDismissed.value = true;
    else if (event.key === 'Enter' || event.key === 'Tab') chooseMention(mentions[mentionIndex.value % mentions.length].name);
    else mentionIndex.value = (mentionIndex.value + (event.key === 'ArrowDown' ? 1 : -1) + mentions.length) % mentions.length;
    return;
  }
  if (!visibleCommands.value.length) return;
  if (!['ArrowDown', 'ArrowUp', 'Enter', 'Tab', 'Escape'].includes(event.key)) return;
  event.preventDefault();
  event.stopPropagation();
  if (event.key === 'Escape') { commandDismissed.value = true; commandHelp.value = false; return; }
  if (event.key === 'Enter' || event.key === 'Tab') {
    chooseCommand(visibleCommands.value[commandIndex.value % visibleCommands.value.length].name);
    return;
  }
  commandIndex.value = (commandIndex.value + (event.key === 'ArrowDown' ? 1 : -1) + visibleCommands.value.length) % visibleCommands.value.length;
  nextTick(() => commandList.value?.children[commandIndex.value]?.scrollIntoView({ block: 'nearest' }));
}
const commandSuggestions = computed(() => {
  const input = composer.value.trimStart();
  if (!input.startsWith('/') || /\s/.test(input)) return [];
  return allSlashCommands.value.filter((command) => command.name.startsWith(input.slice(1)));
});
/** The current chat, or an error for slash commands that need one. */
function requireChat(): Chat {
  if (!chat.value) throw new Error(t('Open a chat first.'));
  return chat.value;
}
/** Slash commands handled in the app; the rest go to the agent (see backend/agent/commands.ts). */
const localCommands: Partial<Record<string, (args: string) => unknown>> = {
  help: () => (commandHelp.value = !commandHelp.value),
  new: () => createChat(),
  plain: () => createChat({ scratch: true }),
  ...Object.fromEntries(guidedModes.map((mode) => [mode.command, () => createChat({ mode: mode.id })])),
  compact: () => compactChat(),
  rename: async (title) => {
    const current = requireChat();
    if (!title) return startRename(current);
    await rpc('chat.rename', { chatId: current.id, title });
    await refresh();
  },
  pin: () => pinChat(requireChat()),
  archive: () => archiveChat(requireChat()),
  export: () => exportChat(requireChat()),
  find: () => {
    requireChat();
    openFind();
  },
  stop: () => {
    if (!active.value) throw new Error(t('Nothing is running.'));
    stopActiveRun();
  },
  model: () => modelPicker.value?.show(),
  terminal: () => toggleTerminal(),
  settings: () => openGlobalSettings(),
  keybindings: () => openGlobalSettings('keybindings'),
  usage: () => openGlobalSettings('usage'),
  tools: () => openGlobalSettings('tools'),
};
async function send(mode: 'auto' | 'queue' = 'auto') {
  if (!composer.value.trim() || !workspace.value || wrappedUp.value) return;
  const command = parseSlashCommand(composer.value);
  const local = command && localCommands[command.name];
  if (command && local) {
    const info = slashCommands.find((item) => item.name === command.name) as SlashCommandInfo | undefined;
    if (command.args && !info?.params?.length)
      throw new Error(`/${command.name} does not accept arguments.`);
    if (pending.value.length) throw new Error('Send or remove attachments before running this command.');
    await local(command.args);
    composer.value = '';
    return;
  }
  if (uploading.value) throw new Error(t('Wait for attachments to finish uploading.'));
  // A local provider without a model cannot run; open the picker instead of sending a prompt that will fail.
  const first = enabledProviders.value[0];
  if (!first || (!first.model && first.kind !== 'claude' && first.kind !== 'codex')) {
    modelPicker.value?.show();
    return;
  }
  if (!chat.value) await createChat();
  const prompt = composer.value;
  const sent = pending.value;
  const attachmentIds = sent.flatMap((item) => (item.attachment ? [item.attachment.id] : []));
  const steer = mode === 'auto' && canSteer.value && working.value;
  composer.value = '';
  pending.value = [];
  preview.value = undefined;
  follow.value = true;
  try {
    if (steer) await rpc('run.steer', { runId: steer.id, prompt, attachmentIds });
    else await rpc('run.submit', { chatId: chatId.value, prompt, attachmentIds });
    burstFrom(sendButton.value, 70, 1.5);
    for (const item of sent) if (item.url) URL.revokeObjectURL(item.url);
    await refresh();
  } catch (failure) {
    composer.value = prompt;
    pending.value = sent;
    throw failure;
  }
}

/** Attach files: the native dialog in the desktop app, the in-app picker over remote access. */
async function attachFiles() {
  const native = windowFrame.pickFiles();
  if (!native) {
    pickerMode.value = 'files';
    return;
  }
  const paths = await native;
  if (!paths.length) return;
  pickerMode.value = 'files';
  await pickPaths(paths);
}
async function pickPaths(paths: string[]) {
  const mode = pickerMode.value;
  pickerMode.value = undefined;
  if (mode === 'folder') {
    folderPath.value = paths[0];
    return;
  }
  for (const path of paths) {
    if (pending.value.length >= 20) {
      report(t('Up to 20 attachments per prompt.'));
      break;
    }
    const file = await rpc<{ name: string; mediaType: string; data: string }>(
      'filesystem.readAttachment',
      { path },
    );
    const bytes = Uint8Array.from(atob(file.data), (character) => character.charCodeAt(0));
    await addFiles([new window.File([bytes], file.name, { type: file.mediaType })]);
  }
}
const messageAttachments = (metadata: Record<string, unknown>) =>
  (metadata.attachments as Attachment[] | undefined) ?? [];
const isImage = (mediaType: string) => /^image\/(png|jpeg|gif|webp)$/.test(mediaType);
async function compactChat() {
  if (wrappedUp.value) return;
  if (!chat.value || compacting.value) return;
  const id = chat.value.id;
  const approved = await confirmAction(
    t('Compact this conversation?'),
    t('This starts a new prompt: the agent summarizes the conversation so far, and the summary replaces the older turns in its context.'),
    t('Compact'),
  );
  if (!approved) return;
  compactRequests.value.push(id);
  try {
    await rpc('chat.compact', { chatId: id });
  } finally {
    await refresh();
    compactRequests.value = compactRequests.value.filter((item) => item !== id);
  }
}
async function loadFiles() {
  if (!workspaceId.value) return;
  const roots = await rpc<{ name: string; path: string; directory: boolean }[]>('files.list', {
    workspaceId: workspaceId.value,
    path: '.',
  });
  fileEntries.value = roots.map((entry) => ({ ...entry, depth: 0 }));
  expanded.value = new Set();
}
async function toggleDirectory(entry: { path: string; depth: number }) {
  if (expanded.value.has(entry.path)) {
    expanded.value.delete(entry.path);
    fileEntries.value = fileEntries.value.filter((item) => !item.path.startsWith(entry.path + '/'));
    for (const path of expanded.value)
      if (path.startsWith(entry.path + '/')) expanded.value.delete(path);
  } else {
    const children = await rpc<{ name: string; path: string; directory: boolean }[]>('files.list', {
      workspaceId: workspaceId.value,
      path: entry.path,
    });
    const index = fileEntries.value.findIndex((item) => item.path === entry.path);
    fileEntries.value.splice(
      index + 1,
      0,
      ...children.map((child) => ({ ...child, depth: entry.depth + 1 })),
    );
    expanded.value.add(entry.path);
  }
}
async function openFile(path: string, reload = false) {
  path = path.replaceAll('\\', '/').replace(/^(\.\/)+/, '');
  const selectedWorkspace = workspaceId.value;
  const existing = fileTabs.value.find((file) => file.path === path);
  if (existing && !reload) {
    selectFileTab(path);
    return;
  }
  const result = await rpc<{ content: string; binary: boolean; mediaType?: string }>('files.read', {
    workspaceId: workspaceId.value,
    path,
  });
  if (workspaceId.value !== selectedWorkspace) return;
  const file = {
    path,
    ...result,
    url: result.mediaType ? mediaUrl(selectedWorkspace, path) : undefined,
  };
  const index = fileTabs.value.findIndex((tab) => tab.path === path);
  if (index < 0) fileTabs.value.push(file);
  else fileTabs.value[index] = file;
  selectFileTab(path);
}
function selectFileTab(path?: string) {
  activeReview.value = '';
  activeFile.value = path;
  showActions.value = false;
  showDiagnostics.value = false;
  languageResult.value = '';
}
function closeFileTab(path: string) {
  const index = fileTabs.value.findIndex((file) => file.path === path);
  if (index < 0) return;
  fileTabs.value.splice(index, 1);
  if (activeFile.value === path)
    selectFileTab(fileTabs.value[index]?.path ?? fileTabs.value[index - 1]?.path);
}
async function loadChanges() {
  if (!workspaceId.value) return;
  const result = await rpc<{ changes?: Change[]; git?: string; status?: string }>('changes', {
    workspaceId: workspaceId.value,
    runId: latestRun.value,
    scope: diffScope.value,
  });
  changes.value = result.changes ?? [];
  gitDiff.value = result.git ?? '';
  gitStatus.value = result.status ?? '';
}
async function showChanges(run?: Run) {
  chosenRun.value = run?.id ?? '';
  rightTab.value = 'changes';
  rightOpen.value = true;
  // With no prompt to inspect, the Git workspace diff is the only meaningful view.
  if (run) diffScope.value = 'prompt';
  else if (!runs.value.length) diffScope.value = 'workspace';
  await loadChanges();
}
async function previewRevert(runId: string) {
  if (wrappedUp.value) return;
  const result = await rpc<{ paths: string[]; conflicts: string[]; actions: string[] }>(
    'revert.preview',
    { runId },
  );
  revertModal.value = { runId, ...result };
}
async function applyRevert() {
  if (!revertModal.value) return;
  const { prompt } = await rpc<{ prompt: string }>('revert.apply', {
    runId: revertModal.value.runId,
  });
  composer.value = prompt;
  revertModal.value = undefined;
  chosenRun.value = '';
  preview.value = undefined;
  await refresh();
  await loadFiles();
  if (rightTab.value === 'changes') await loadChanges();
}
async function languageQuery(operation: string) {
  if (!preview.value) return;
  languageResult.value = JSON.stringify(
    await rpc('language.query', {
      workspaceId: workspaceId.value,
      path: preview.value.path,
      operation,
      line: 0,
      character: 0,
    }),
    null,
    2,
  );
}
function scrollChanged() {
  const element = conversation.value;
  if (element) follow.value = element.scrollHeight - element.scrollTop - element.clientHeight < 100;
}
// Follow mode: while the chat is scrolled to the bottom (follow), any growth of its content keeps it there. This covers
// messages that load late, markdown/highlighting/images settling, and the scroller remounting after a tab switch.
// Scrolling up turns follow off (scrollChanged); opening a chat turns it back on.
let followResize: ResizeObserver | undefined;
let followChildren: MutationObserver | undefined;
function stickToBottom() {
  const element = conversation.value;
  if (element && follow.value) element.scrollTop = element.scrollHeight;
}
watch(
  conversation,
  (element) => {
    followResize?.disconnect();
    followChildren?.disconnect();
    if (!element) return;
    followResize = new ResizeObserver(stickToBottom);
    const observeChildren = () => {
      followResize!.disconnect();
      followResize!.observe(element);
      for (const child of element.children) followResize!.observe(child);
    };
    followChildren = new MutationObserver(observeChildren);
    followChildren.observe(element, { childList: true });
    observeChildren();
    stickToBottom();
  },
  { flush: 'post' },
);
watch(chatId, () => {
  follow.value = true;
  void nextTick(stickToBottom);
});
onBeforeUnmount(() => {
  followResize?.disconnect();
  followChildren?.disconnect();
});
async function link(url: string) {
  if (/^https?:\/\//.test(url)) {
    await rpc('external.open', { url });
    return;
  }
  const path = url.replace(/^file:\/\//, '').replace(/:\d+(:\d+)?$/, '');
  await openFile(path);
}

// A finished prompt goes out with a bang: a big ember burst from the composer.
watch(
  () => active.value?.id,
  (now, before) => {
    if (before && !now && runsById.value.get(before)?.status === 'completed') stamp('BASED');
  },
);

// Keyed on the saved values, so state refreshes during a live preview in settings don't reset it.
watch(
  () => JSON.stringify(state.value.global.appearance),
  () => applyAppearance(state.value.global.appearance),
  { immediate: true },
);

// Agent output belongs in tool cards; only user terminals reveal the panel.
watch(
  () =>
    terminals.value.filter((terminal) => terminal.owner === 'user').map((terminal) => terminal.id),
  (ids, previous) => {
    if (ids.some((id) => !previous.includes(id))) terminalOpen.value = true;
  },
);
watch(
  () => terminals.value.length,
  (count) => {
    if (count === 0) terminalOpen.value = false;
  },
);

/** Opening an empty terminal panel starts a shell right away instead of showing an empty panel. */
function toggleTerminal() {
  terminalOpen.value = !terminalOpen.value;
  if (
    terminalOpen.value &&
    workspace.value &&
    !terminals.value.some((terminal) => terminal.status === 'running')
  ) {
    void perform(() => rpc('terminal.create', { workspaceId: workspaceId.value }));
  }
}

/** Runs `action` on the open chat; does nothing when no chat is open. */
function withChat(action: (current: Chat) => unknown) {
  if (chat.value) action(chat.value);
}
/** Moves to the next (1) or previous (-1) unarchived chat in this workspace, wrapping around. */
function cycleChat(step: 1 | -1) {
  const list = chats.value.filter((entry) => !entry.archivedAt);
  if (!list.length) return;
  const index = list.findIndex((entry) => entry.id === chatId.value);
  const next = index === -1 ? list[0] : list[(index + step + list.length) % list.length];
  if (next.id !== chatId.value) void perform(() => selectChat(next));
}
function stopActiveRun() {
  const run = active.value;
  if (run) void perform(() => rpc('run.stop', { runId: run.id }));
}
function focusComposer() {
  composerBox.value?.querySelector('textarea')?.focus();
}

const shortcutHandlers: Record<KeybindingAction, () => void> = {
  'terminal.toggle': toggleTerminal,
  'sidebar.toggle': () => {
    leftOpen.value = !leftOpen.value;
  },
  'panel.toggle': () => {
    rightOpen.value = !rightOpen.value;
  },
  'chat.new': () => void perform(() => createChat()),
  'chat.newPlain': () => void perform(() => createChat({ scratch: true })),
  'chat.next': () => cycleChat(1),
  'chat.previous': () => cycleChat(-1),
  'chat.rename': () => withChat(startRename),
  'chat.pin': () => withChat((current) => void perform(() => pinChat(current))),
  'chat.archive': () => withChat((current) => void perform(() => archiveChat(current))),
  'chat.export': () => withChat(exportChat),
  'chat.compact': () => withChat(() => void perform(compactChat)),
  'run.stop': stopActiveRun,
  'composer.focus': focusComposer,
  'model.pick': () => modelPicker.value?.show(),
  'palette.open': () => (paletteOpen.value ? closePalette() : openPalette()),
  'chat.find': () => openFind(),
  'workspace.open': () => void perform(openWorkspace),
  'workspace.settings': () => {
    if (workspace.value && !workspace.value.scratch) settingsOpen.value = true;
  },
  'settings.open': () => openGlobalSettings(),
  'settings.keybindings': () => openGlobalSettings('keybindings'),
  'window.maximize': () => windowFrame.command('toggle-maximize'),
  'app.quit': () => windowFrame.command('close'),
  'app.reload': () => windowFrame.command('reload'),
};

function closeApprovalPopover(event: PointerEvent) {
  if (!(event.target instanceof Element) || !event.target.closest('.approval-menu'))
    approvalPopoverOpen.value = false;
}
function shortcut(event: KeyboardEvent) {
  if (event.key === 'Escape' && approvalPopoverOpen.value) {
    approvalPopoverOpen.value = false;
    return;
  }
  // Settings records new bindings itself; don't fire the old ones underneath it.
  if (globalSettingsOpen.value) return;
  const action = actionForEvent(event, state.value.global.keybindings);
  if (!action) return;
  event.preventDefault();
  shortcutHandlers[action]();
}

/** Closes the chat options menu on any click or Escape outside it. */
/**
 * A chat group's menu: new chats of each kind, plus rename and remove for a workspace.
 * Opens below the group's dots button, or at the cursor on right-click, like the chat options menu.
 */
type NewChatTarget = { workspaceId?: string; scratch?: boolean };
const newChatMenu = ref<{
  anchor: HTMLElement;
  target: NewChatTarget;
  /** Where the new chat will live, shown at the top of the menu. */
  place: string;
  style: Record<string, string>;
  /** The chat-type submenu opens to the left, or upwards, when the window has no room the usual way. */
  flipX: boolean;
  flipY: boolean;
} | null>(null);
/** Chat types in the submenu: the regular chat plus every guided mode, in two columns. */
const chatTypeRows = Math.ceil((guidedModes.length + 1) / 2);
const chatTypeMenu = { width: 404, height: chatTypeRows * 30 + 10 };
/** Keyboard-opened state of the chat-type submenu; the mouse opens it by hovering. */
const newChatSub = ref(false);
function openNewChatSub() {
  newChatSub.value = true;
  void nextTick(() =>
    document.querySelector<HTMLButtonElement>('.new-chat-flyout button')?.focus(),
  );
}
function closeNewChatSub() {
  newChatSub.value = false;
  document.querySelector<HTMLButtonElement>('.new-chat-sub > button')?.focus();
}
function groupTarget(group: { id: string; kind: string }): NewChatTarget {
  return group.kind === 'plain' ? { scratch: true } : { workspaceId: group.id };
}
function openNewChatMenu(
  event: MouseEvent,
  group: { id: string; kind: string; name: string },
  atCursor = false,
) {
  const anchor = event.currentTarget as HTMLElement;
  if (!atCursor && newChatMenu.value?.anchor === anchor) {
    newChatMenu.value = null;
    return;
  }
  const target = groupTarget(group);
  const width = 210;
  const height = target.workspaceId ? 140 : 70;
  const box = anchor.getBoundingClientRect();
  // From the dots button it opens to the right of the button, top-aligned, like the right-click menu.
  const x = atCursor ? event.clientX : box.right + 4;
  const y = atCursor ? event.clientY : box.top;
  const flipTop = atCursor ? event.clientY : box.bottom;
  const top = y + height > window.innerHeight ? Math.max(8, flipTop - height) : y;
  const left = Math.max(8, Math.min(x, window.innerWidth - width - 8));
  newChatSub.value = false;
  newChatMenu.value = {
    anchor,
    target,
    place: target.scratch ? t('Without a workspace') : t('In {name}', { name: group.name }),
    style: {
      top: `${top}px`,
      left: `${left}px`,
      width: `${width}px`,
    },
    flipX:
      left + width + chatTypeMenu.width > window.innerWidth - 8 && left > chatTypeMenu.width,
    flipY: top + 26 + chatTypeMenu.height > window.innerHeight - 8,
  };
  // Keyboard activation (detail 0) lands on the first item, like the chat options menu.
  if (event.detail === 0)
    void nextTick(() =>
      document.querySelector<HTMLButtonElement>('.new-chat-menu button')?.focus(),
    );
}
function closeNewChatMenu() {
  newChatMenu.value = null;
}
// ---- Workspace rename and removal ----
const renamingGroup = ref('');
const groupRenameText = ref('');
function startGroupRename() {
  const id = newChatMenu.value?.target.workspaceId;
  newChatMenu.value = null;
  if (!id) return;
  renamingGroup.value = id;
  groupRenameText.value = state.value.workspaces.find((item) => item.id === id)?.name ?? '';
  void nextTick(() => document.querySelector<HTMLInputElement>('.group-rename')?.select());
}
async function finishGroupRename(save: boolean) {
  const target = renamingGroup.value;
  renamingGroup.value = '';
  const workspace = state.value.workspaces.find((item) => item.id === target);
  if (!save || !workspace) return;
  // Clearing the name restores the folder's own name.
  const name = groupRenameText.value.trim() || folderName(workspace.path);
  if (state.value.workspaces.find((item) => item.id === target)?.name === name) return;
  await rpc('workspace.rename', { workspaceId: target, name });
  await refresh();
}
async function workspaceChatsAction(action: 'archive' | 'delete') {
  const id = newChatMenu.value?.target.workspaceId;
  newChatMenu.value = null;
  const target = state.value.workspaces.find((item) => item.id === id);
  if (!target) return;
  const chats = state.value.chats.filter((item) => item.workspaceId === target.id);
  if (!chats.length) return;
  if (action === 'delete' && !await confirmAction(
    t('Delete all chats in {name}?', { name: target.name }),
    t('This deletes {count} chat(s) and cannot be undone. The workspace and its files are kept.', { count: chats.length }),
    t('Delete all chats'),
  )) return;
  await rpc(`workspace.chats.${action}`, { workspaceId: target.id });
  if (action === 'delete') {
    for (const entry of chats) clearDraft(entry.id);
    if (chats.some((entry) => entry.id === chatId.value)) {
      chatId.value = '';
      preview.value = undefined;
    }
  }
  await refresh();
}
async function removeWorkspace() {
  const id = newChatMenu.value?.target.workspaceId;
  newChatMenu.value = null;
  const target = state.value.workspaces.find((item) => item.id === id);
  if (!target) return;
  const count = state.value.chats.filter((item) => item.workspaceId === target.id).length;
  const approved = await confirmAction(
    t('Remove {name}?', { name: target.name }),
    t(
      'This deletes its {count} chat(s) from BasedCode and cannot be undone. The folder and its files on disk are not touched.',
      { count },
    ),
    t('Remove workspace'),
  );
  if (!approved) return;
  await rpc('workspace.remove', { workspaceId: target.id });
  if (workspaceId.value === target.id) {
    workspaceId.value = '';
    localStorage.removeItem('basedcode.workspace');
    chatId.value = '';
    preview.value = undefined;
    fileTabs.value = [];
  }
  await refresh();
}
function newChatFromMenu(options: { mode?: ChatMode }) {
  const target = newChatMenu.value?.target;
  newChatMenu.value = null;
  return perform(() => createChat({ ...target, ...options }));
}
function closeChatMenu(event: Event) {
  if (newChatMenu.value) {
    const target = event.target as Node | null;
    if (
      event instanceof KeyboardEvent
        ? event.key === 'Escape'
        : !(
            (target && newChatMenu.value.anchor.contains(target)) ||
            (target as Element | null)?.closest?.('.new-chat-menu')
          )
    )
      newChatMenu.value = null;
  }
  if (
    branchesOpen.value &&
    (event instanceof KeyboardEvent
      ? event.key === 'Escape'
      : !(event.target as Element | null)?.closest?.('.lineage-menu'))
  )
    branchesOpen.value = false;
  if (!moveMenu.value) return;
  if (event instanceof KeyboardEvent ? event.key === 'Escape' : !(event.target as Element | null)?.closest?.('.chat-menu, .chat-menu-button')) moveMenu.value = '';
}
onMounted(async () => {
  window.addEventListener('keydown', shortcut);
  document.addEventListener('pointerdown', closeChatMenu, true);
  document.addEventListener('keydown', closeChatMenu);
  document.addEventListener('pointerdown', closeApprovalPopover);
  unsubscribe = onEvent((event) => {
    if (event.type === 'pick-folder') void perform(openWorkspace);
    if (event.type === 'state') void refresh();
    if (event.type === 'text') {
      const data = event.data as { id: string; content: string; reasoning?: string };
      const message = state.value.messages.find((message) => message.id === data.id);
      if (message) {
        message.content = data.content;
        if (data.reasoning !== undefined) message.metadata.reasoning = data.reasoning;
      }
      // Every streamed token feeds the flames.
      stoke(0.03);
      if (follow.value)
        void nextTick(() => conversation.value?.scrollTo({ top: conversation.value.scrollHeight }));
    }
    if (event.type === 'workspace-opened') {
      folderModal.value = false;
      const selected = event.data as Workspace;
      void refresh()
        .then(() => selectWorkspace(selected.id))
        .catch(report);
    }
    if (
      event.type === 'files-changed' &&
      event.workspaceId === workspaceId.value &&
      rightTab.value === 'changes'
    )
      void loadChanges().catch(report);
    if (event.type === 'files-changed' && event.workspaceId === workspaceId.value) void loadSkillCommands().catch(report);
    if (event.type === 'diagnostics')
      state.value.diagnostics = event.data as AppState['diagnostics'];
    if (event.type === 'notice') error.value = String(event.data);
    if (event.type === 'checkpoint-warning') checkpointWarning.value = String(event.data);
  });
  disconnect = connectEvents((value) => {
    connected.value = value;
    if (value) void refresh();
  });
  await refresh();
  if (workspace.value) await perform(() => selectWorkspace(workspaceId.value));
  // Codex windows cost nothing to read; fetch them at start when Codex is configured. Failures just leave them blank.
  if (
    state.value.global.providers.some((provider) => provider.kind === 'codex' && provider.enabled)
  )
    void rpc('limits.refresh', { kind: 'codex' }).catch(() => undefined);
  if (
    state.value.global.providers.some((provider) => provider.kind === 'antigravity' && provider.enabled)
  )
    void rpc('limits.refresh', { kind: 'antigravity' }).catch(() => undefined);
});
onBeforeUnmount(() => {
  document.removeEventListener('pointerdown', closeChatMenu, true);
  document.removeEventListener('keydown', closeChatMenu);
  window.removeEventListener('keydown', shortcut);
  document.removeEventListener('pointerdown', closeApprovalPopover);
  disconnect?.();
  unsubscribe?.();
});
</script>

<template>
  <div
    class="app-shell"
    :class="{
      'effects-on': effectsEnabled && motionAllowed,
      'right-hidden': !rightOpen,
      phone,
      'right-wide': rightOpen && rightTab === 'changes' && diffLayout === 'split',
    }"
    :style="{
      '--terminal-height': terminalOpen && workspace ? `${terminalHeight}px` : '0px',
      '--left-width': leftOpen ? `${leftWidth}px` : '0px',
      '--right-width': `${rightWidth}px`,
    }"
  >
    <div
      v-if="phone && (leftOpen || rightOpen)"
      class="drawer-backdrop"
      @click="
        leftOpen = false;
        rightOpen = false;
      "
    />
    <aside
      v-show="leftOpen"
      class="left-sidebar"
    >
      <div
        class="resize-handle side right-edge"
        aria-hidden="true"
        @pointerdown.prevent="resizeLeft"
        @dblclick="resetPane('left')"
      />
      <div
        class="brand"
        data-drag-region
      >
        <img
          class="brand-icon"
          :src="appIcon"
          alt=""
        ><strong>basedcode<span class="version">v0.1</span></strong>
      </div>
      <Teleport to="body">
        <div
          v-if="newChatMenu"
          class="new-chat-menu"
          role="menu"
          :aria-label="t('New chat')"
          :style="newChatMenu.style"
          @keydown="chatMenuKey"
        >
          <small :title="newChatMenu.place">{{ newChatMenu.place }}</small>
          <div
            class="new-chat-sub"
            :class="{ open: newChatSub, 'flip-x': newChatMenu.flipX, 'flip-y': newChatMenu.flipY }"
            @mouseleave="newChatSub = false"
          >
            <button
              role="menuitem"
              aria-haspopup="menu"
              :aria-expanded="newChatSub"
              :title="t('A normal chat: the agent plans and makes the changes')"
              @click="newChatFromMenu({})"
              @keydown.right.prevent="openNewChatSub"
            >
              <Plus :size="15" /> {{ t('New chat') }}
              <ChevronRight
                :size="13"
                class="sub-arrow"
              />
            </button>
            <div
              class="new-chat-flyout"
              role="menu"
              :aria-label="t('New chat')"
              :style="{ '--rows': chatTypeRows, width: `${chatTypeMenu.width}px` }"
              @keydown.left.prevent.stop="closeNewChatSub"
              @keydown.esc.stop="closeNewChatSub"
            >
              <button
                role="menuitem"
                :title="t('A normal chat: the agent plans and makes the changes')"
                @click="newChatFromMenu({})"
              >
                <img
                  class="chat-icon"
                  :src="appIcon"
                  alt=""
                >
                <span>{{ t('Regular chat') }}</span>
              </button>
              <button
                v-for="mode in guidedModes"
                :key="mode.id"
                role="menuitem"
                :title="t(mode.menu)"
                @click="newChatFromMenu({ mode: mode.id })"
              >
                <ChatModeIcon
                  :mode="mode.id"
                  :size="15"
                /> <span>{{ t(mode.title) }}</span>
              </button>
            </div>
          </div>
          <template v-if="newChatMenu.target.workspaceId">
            <hr>
            <button
              role="menuitem"
              @click="startGroupRename"
            >
              <Pencil :size="14" /> {{ t('Set display name') }}
            </button>
            <button
              role="menuitem"
              @click="perform(() => workspaceChatsAction('archive'))"
            >
              <Archive :size="14" /> {{ t('Archive all chats') }}
            </button>
            <button
              role="menuitem"
              class="danger"
              @click="perform(() => workspaceChatsAction('delete'))"
            >
              <Trash2 :size="14" /> {{ t('Delete all chats') }}
            </button>
            <button
              role="menuitem"
              class="danger"
              @click="perform(removeWorkspace)"
            >
              <Trash2 :size="14" /> {{ t('Remove workspace') }}
            </button>
          </template>
        </div>
      </Teleport>
      <div class="sidebar-section-header">
        <span>{{ t('Workspaces') }}</span>
        <button
          class="icon-button"
          :title="t('Open a folder as a workspace (Ctrl O)')"
          :aria-label="t('Open folder')"
          @click="perform(openWorkspace)"
        >
          <FolderPlus :size="16" />
        </button>
      </div>
      <label class="chat-search">
        <Search :size="13" />
        <input
          v-model="chatSearch"
          type="search"
          :placeholder="t('Search chats')"
          :aria-label="t('Search chats')"
          @keydown.esc="chatSearch = ''"
        >
      </label>
      <nav
        class="chat-list"
        :aria-label="t('Chats')"
        @click="moveMenu = ''"
        @scroll.passive="
          moveMenu = '';
          closeNewChatMenu();
        "
      >
        <template
          v-for="group in chatGroups"
          :key="group.id"
        >
          <div
            class="chat-group-header"
            :class="{
              current: group.kind === 'workspace' && group.id === workspaceId,
              'drop-target': dropTarget === group.id,
            }"
            @dragover="(event) => dragOverGroup(event, group.id, group.kind)"
            @dragleave="dropTarget === group.id && (dropTarget = '')"
            @drop.prevent="dropOnGroup(group.id, group.kind)"
            @contextmenu.prevent="
              group.kind === 'workspace' || group.kind === 'plain'
                ? openNewChatMenu($event, group, true)
                : undefined
            "
          >
            <input
              v-if="renamingGroup === group.id"
              v-model="groupRenameText"
              class="chat-rename group-rename"
              maxlength="80"
              :aria-label="t('Workspace name')"
              :placeholder="
                folderName(state.workspaces.find((item) => item.id === group.id)?.path ?? '')
              "
              :title="t('Leave empty to use the folder name')"
              @keydown.enter.prevent="perform(() => finishGroupRename(true))"
              @keydown.esc.prevent="finishGroupRename(false)"
              @blur="perform(() => finishGroupRename(true))"
              @click.stop
            >
            <button
              v-else
              class="chat-group-toggle"
              :title="group.path"
              :aria-expanded="groupOpen(group.id)"
              @click="toggleGroup(group.id)"
            >
              <component
                :is="groupOpen(group.id) ? ChevronDown : ChevronRight"
                :size="13"
              />
              <MessageSquare
                v-if="group.kind === 'plain'"
                :size="14"
              />
              <component
                :is="group.kind === 'pinned' ? Pin : group.kind === 'archived' ? Archive : Folder"
                v-else
                :size="14"
              />
              <span class="group-name"><span class="group-display-name">{{ group.name }}</span><span
                v-if="group.folder"
                class="group-folder-name"
                :title="t('Folder: {name}', { name: group.folder })"
              >({{ group.folder }})</span></span>
              <span
                v-if="groupActivity(group.chats).waiting"
                class="group-badge waiting"
                :title="
                  t('{count} chat(s) waiting for your approval', {
                    count: groupActivity(group.chats).waiting,
                  })
                "
              ><BellRing :size="11" />{{ groupActivity(group.chats).waiting }}</span><span
                v-if="groupActivity(group.chats).working"
                class="group-badge working"
                :title="t('{count} chat(s) working', { count: groupActivity(group.chats).working })"
              ><LoaderCircle
                :size="11"
                class="spin"
              />{{
                groupActivity(group.chats).working
              }}</span>
              <small>{{ group.chats.length }}</small>
            </button>
            <button
              v-if="group.kind === 'workspace' || group.kind === 'plain'"
              class="icon-button chat-group-add"
              :title="t('Options for {name}', { name: group.name })"
              :aria-label="t('Options for {name}', { name: group.name })"
              aria-haspopup="menu"
              :aria-expanded="
                Boolean(
                  newChatMenu &&
                    (group.kind === 'plain'
                      ? newChatMenu.target.scratch
                      : newChatMenu.target.workspaceId === group.id),
                )
              "
              @click.stop="openNewChatMenu($event, group)"
            >
              <MoreHorizontal :size="15" />
            </button>
          </div>
          <template v-if="groupOpen(group.id)">
            <template
              v-for="item in group.chats"
              :key="item.id"
            >
              <div
                class="chat-row grouped"
                :class="{
                  selected: chatId === item.id && !showActions,
                  [item.mode ?? 'default']: Boolean(guidedMode(item.mode)),
                  dragging: draggedChat === item.id,
                }"
                draggable="true"
                @contextmenu.prevent="openChatMenuAt($event, item)"
                @dragstart="(event) => startChatDrag(event, item)"
                @dragend="endChatDrag"
              >
                <input
                  v-if="renaming === item.id"
                  v-model="renameText"
                  class="chat-rename"
                  maxlength="150"
                  :aria-label="t('Chat title')"
                  @keydown.enter.prevent="perform(() => finishRename(true))"
                  @keydown.esc.prevent="finishRename(false)"
                  @blur="perform(() => finishRename(true))"
                  @click.stop
                >
                <button
                  v-else
                  class="chat-select"
                  :title="item.title"
                  @click="perform(() => selectChat(item))"
                  @dblclick="startRename(item)"
                >
                  <ChatModeIcon
                    v-if="guidedMode(item.mode)"
                    outline
                    :mode="guidedMode(item.mode)!.id"
                    :size="16"
                  /><MessageSquare
                    v-else
                    :size="16"
                  /><span>{{ item.title }}</span><GitFork
                    v-if="item.forkedFrom"
                    :size="12"
                    class="run-state-icon"
                    role="img"
                    :aria-label="t('Forked chat')"
                    :title="t('Forked chat')"
                  /><component
                    :is="chatRunStatus(item.id)!.icon"
                    v-if="chatRunStatus(item.id)"
                    :size="14"
                    class="run-state-icon"
                    :class="[chatRunStatus(item.id)!.tone, { spin: chatRunStatus(item.id)!.spin }]"
                    role="img"
                    :aria-label="t(chatRunStatus(item.id)!.label)"
                    :title="t(chatRunStatus(item.id)!.label)"
                  /><History
                    v-else-if="item.stale"
                    :size="14"
                    class="run-state-icon warning"
                    role="img"
                    :aria-label="t('Stale after a revert')"
                    :title="t('Stale after a revert: inspect files before continuing')"
                  />
                </button><button
                  class="icon-button chat-menu-button"
                  :aria-label="t('Chat options')"
                  :title="t('Chat options')"
                  aria-haspopup="menu"
                  :aria-expanded="moveMenu === item.id"
                  @click.stop="openChatMenuFrom($event, item)"
                >
                  <MoreHorizontal :size="15" />
                </button>
                <div
                  v-if="moveMenu === item.id"
                  class="chat-menu"
                  :class="{ 'at-cursor': menuPoint }"
                  :style="menuPoint ? { left: `${menuPoint.x}px`, top: `${menuPoint.y}px` } : undefined"
                  role="menu"
                  :aria-label="t('Chat options')"
                  @keydown="chatMenuKey"
                  @click.stop
                >
                  <button
                    role="menuitem"
                    @click="startRename(item)"
                  >
                    <Pencil :size="13" /><span>{{ t('Rename') }}</span>
                  </button>
                  <button
                    role="menuitem"
                    class="danger"
                    :disabled="chatBusy(item.id)"
                    @click="perform(() => { moveMenu = ''; return deleteChat(item.id); })"
                  >
                    <Trash2 :size="13" /><span>{{ t('Delete chat') }}</span>
                  </button>
                  <button
                    role="menuitem"
                    @click="perform(() => pinChat(item))"
                  >
                    <component
                      :is="item.pinned ? PinOff : Pin"
                      :size="13"
                    /><span>{{
                      item.pinned ? t('Unpin chat') : t('Pin chat')
                    }}</span>
                  </button>
                  <button
                    role="menuitem"
                    @click="perform(() => archiveChat(item))"
                  >
                    <component
                      :is="item.archivedAt ? ArchiveRestore : Archive"
                      :size="13"
                    /><span>{{
                      item.archivedAt ? t('Unarchive') : t('Archive')
                    }}</span>
                  </button>
                  <button
                    role="menuitem"
                    :disabled="chatBusy(item.id) || !state.runs.some((run) => run.chatId === item.id)"
                    @click="openHandOff(item)"
                  >
                    <ArrowRightLeft :size="13" /><span>{{ t('Switch mode') }}</span>
                  </button>
                  <button
                    role="menuitem"
                    @click="exportChat(item)"
                  >
                    <Download :size="13" /><span>{{ t('Export as Markdown') }}</span>
                  </button>
                  <template v-if="recentWorkspaces.length">
                    <hr>
                    <small>{{ t('Move to workspace') }}</small>
                    <button
                      v-for="target in recentWorkspaces"
                      :key="target.id"
                      role="menuitem"
                      :disabled="target.id === item.workspaceId || chatBusy(item.id)"
                      :title="target.path"
                      @click="perform(() => moveChat(item.id, target.id))"
                    >
                      <Folder :size="13" /><span>{{ target.name }}</span><Check
                        v-if="target.id === item.workspaceId"
                        :size="13"
                      />
                    </button>
                  </template>
                </div>
              </div>
            </template>
            <p
              v-if="!group.chats.length"
              class="sidebar-empty grouped"
            >
              {{ t('No chats yet.') }}
            </p>
          </template>
        </template>
        <p
          v-if="!chatGroups.length"
          class="sidebar-empty"
        >
          {{ chatSearch ? t('No chats match your search.') : t('Dead quiet in here. Start a chat?') }}
        </p>
      </nav>
      <div class="sidebar-bottom">
        <button
          :class="{ selected: showActions }"
          @click="
            showActions = true;
            showDiagnostics = false;
            preview = undefined;
          "
        >
          <Activity :size="15" /> {{ t('Actions') }}
          <span class="count">{{ actions.length }}</span>
        </button><button
          :disabled="!workspace"
          @click="settingsOpen = true"
        >
          <Settings2 :size="15" /> {{ t('Workspace settings') }}
        </button><button @click="openGlobalSettings()">
          <SlidersHorizontal :size="15" /> {{ t('App settings') }}
        </button>
      </div>
    </aside>

    <header class="workspace-header">
      <button
        class="icon-button"
        :title="t('Toggle sidebar (Ctrl+B)')"
        @click="leftOpen = !leftOpen"
      >
        <component
          :is="leftOpen ? PanelLeftClose : PanelLeftOpen"
          :size="16"
        />
      </button>
      <div
        class="breadcrumbs"
        data-drag-region
      >
        <ChatModeIcon
          v-if="guidedMode(chat?.mode)"
          :mode="guidedMode(chat?.mode)!.id"
          :size="18"
          class="header-mode-icon"
        /><span>{{
          workspace?.scratch ? t('Chats') : (workspace?.name ?? 'BasedCode')
        }}</span><ChevronRight :size="13" /><strong
          :title="chat && !showActions && !showDiagnostics && !preview ? t('Double-click to rename') : undefined"
          @dblclick="chat && !showActions && !showDiagnostics && !preview && startRename(chat)"
        >{{
          showActions
            ? t('Actions')
            : showDiagnostics
              ? t('Diagnostics')
              : (preview?.path ?? chat?.title ?? t('New conversation'))
        }}</strong>
      </div>
      <button
        v-if="parentChat"
        class="lineage-chip"
        :title="t('Forked from {title}. Click to open it.', { title: parentChat.title })"
        @click="perform(() => selectChat(parentChat!))"
      >
        <GitFork :size="12" /><span>{{ parentChat.title }}</span>
      </button>
      <div
        v-if="branchChats.length"
        class="lineage-menu"
      >
        <button
          class="lineage-chip"
          :aria-expanded="branchesOpen"
          :title="t('Chats forked from this one')"
          @click.stop="branchesOpen = !branchesOpen"
        >
          <GitFork :size="12" />{{ t('{count} branch(es)', { count: branchChats.length }) }}
        </button>
        <div
          v-if="branchesOpen"
          class="branch-popover"
          role="menu"
        >
          <button
            v-for="branch in branchChats"
            :key="branch.id"
            role="menuitem"
            @click="perform(() => selectChat(branch))"
          >
            <GitFork :size="12" /><span>{{ branch.title }}</span>
          </button>
        </div>
      </div>
      <button
        v-if="chat?.archivedAt"
        class="lineage-chip"
        :title="t('This chat is archived. Click to unarchive it.')"
        @click="perform(() => archiveChat(chat!))"
      >
        <Archive :size="12" />{{ t('Archived') }}
      </button>
      <span
        class="spacer titlebar-drag"
        data-drag-region
      /><UpdateChip /><button
        v-if="chat"
        class="usage-chip"
        :title="t('Context window: what the next prompt sends to the model, and what to pin or drop')"
        @click="openSideTab('context')"
      >
        <Gauge :size="13" />
      </button><button
        v-if="workspace && !workspace.scratch"
        class="usage-chip"
        :title="t('Git: stage, commit and push, with a message written by the model')"
        @click="openSideTab('git')"
      >
        <GitPullRequest :size="13" />
      </button><button
        v-if="chat && thisChatUsage.prompts"
        class="usage-chip"
        :title="
          t(
            thisChatUsage.priced
              ? 'This chat: {prompts} prompt(s), {tokens} tokens, {cost} reported cost.\nOpen the usage dashboard.'
              : 'This chat: {prompts} prompt(s), {tokens} tokens, no reported cost.\nOpen the usage dashboard.',
            {
              prompts: thisChatUsage.prompts,
              tokens: thisChatUsage.tokens.toLocaleString(),
              cost: formatCost(thisChatUsage.costUsd),
            },
          )
        "
        @click="openGlobalSettings('usage')"
      >
        <Coins :size="13" /> {{ formatTokens(thisChatUsage.tokens) }} tok<template
          v-if="thisChatUsage.priced"
        >
          · {{ formatCost(thisChatUsage.costUsd) }}
        </template>
      </button>
      <div
        class="approval-menu"
        @click.stop
      >
        <button
          class="permission-status"
          :class="{ danger: approvalMode === 'allow-all' }"
          :aria-expanded="approvalPopoverOpen"
          @click="approvalPopoverOpen = !approvalPopoverOpen"
        >
          <component
            :is="approvalMode === 'allow-all' ? ShieldAlert : ShieldCheck"
            :size="13"
          />
          {{ t(approvalModes[approvalMode].name) }}<ChevronDown :size="12" />
        </button>
        <div
          v-if="approvalPopoverOpen"
          class="approval-popover"
          role="dialog"
          :aria-label="t('Approval mode')"
        >
          <label
            v-if="workspace"
            class="small"
          >{{ t('Apply to')
          }}<AppSelect
            v-model="approvalScope"
            :options="[
              { value: 'workspace', label: workspace.name },
              { value: 'global', label: t('App default') },
            ]"
          /></label>
          <strong>{{ t('Approval mode') }}</strong><button
            v-for="(mode, key) in approvalModes"
            :key="key"
            class="approval-option"
            :class="{ selected: approvalScopeMode === key, danger: key === 'allow-all' }"
            @click="chooseApprovalMode(key as ApprovalMode)"
          >
            <span>{{ t(mode.name) }}</span><Check
              v-if="approvalScopeMode === key"
              :size="14"
            />
          </button>
          <p class="muted small">
            {{ t(approvalModes[approvalScopeMode].detail) }} {{ state.sandbox.detail }}
          </p>
        </div>
      </div>
      <button
        class="icon-button"
        :class="{ active: terminalOpen }"
        :title="t('Toggle terminal (Ctrl+`)')"
        @click="toggleTerminal"
      >
        <Terminal :size="16" />
      </button><button
        class="icon-button"
        :title="t('Toggle files and diffs')"
        @click="rightOpen = !rightOpen"
      >
        <component
          :is="rightOpen ? PanelRightClose : PanelRightOpen"
          :size="16"
        />
      </button>
      <div
        v-if="windowFrame.embedded.value"
        class="window-controls"
      >
        <button
          :title="t('Minimize')"
          :aria-label="t('Minimize window')"
          @click="windowFrame.command('minimize')"
        >
          <Minus :size="16" />
        </button><button
          :title="t(windowFrame.maximized.value ? 'Restore' : 'Maximize')"
          :aria-label="t(windowFrame.maximized.value ? 'Restore window' : 'Maximize window')"
          @click="windowFrame.command('toggle-maximize')"
        >
          <component
            :is="windowFrame.maximized.value ? Restore : Square"
            :size="windowFrame.maximized.value ? 13 : 12"
          />
        </button><button
          class="close"
          :title="t('Close')"
          :aria-label="t('Close window')"
          @click="windowFrame.command('close')"
        >
          <X :size="17" />
        </button>
      </div>
    </header>

    <main
      class="main-panel"
      :class="{ welcoming: !messages.length && !!workspace }"
    >
      <nav
        class="center-tabs"
        :aria-label="t('Center views')"
        @wheel="(event) => { if (!event.shiftKey && Math.abs(event.deltaY) > Math.abs(event.deltaX)) { (event.currentTarget as HTMLElement).scrollLeft += event.deltaY; event.preventDefault(); } }"
      >
        <button
          class="center-tab"
          :aria-pressed="!preview && !showActions && !showDiagnostics && !activeReview"
          @click="selectFileTab()"
        >
          {{ t('Chat') }}
        </button>
        <div
          v-for="review in openReviews"
          :key="review.chat.id"
          class="file-tab"
          :class="{ selected: activeReview === review.chat.id }"
        >
          <button
            class="center-tab"
            :title="review.run?.provider"
            :aria-pressed="activeReview === review.chat.id"
            @click="openReviewTab(review.chat)"
          >
            <MessageSquareQuote :size="12" /> {{ t('Review') }} · {{ (review.run?.provider ?? '').split(' / ').at(-1) }}
          </button>
          <button
            class="icon-button"
            :aria-label="t('Close review')"
            @click="closeReviewTab(review.chat.id)"
          >
            <X :size="13" />
          </button>
        </div>
        <button
          class="center-tab"
          :aria-pressed="showDiagnostics"
          @click="openDiagnostics"
        >
          {{ t('Diagnostics')
          }}<span
            v-if="diagnosticList.length"
            class="count"
          >{{
            diagnosticList.length
          }}</span>
        </button>
        <div
          v-for="file in fileTabs"
          :key="file.path"
          class="file-tab"
          :class="{ selected: activeFile === file.path && !showActions && !showDiagnostics && !activeReview }"
        >
          <button
            class="center-tab"
            :title="file.path"
            :aria-pressed="activeFile === file.path && !showActions && !showDiagnostics && !activeReview"
            @click="selectFileTab(file.path)"
          >
            {{ file.path.split('/').at(-1) }}
          </button>
          <button
            class="icon-button"
            :aria-label="t('Close {name}', { name: file.path })"
            @click="closeFileTab(file.path)"
          >
            <X :size="13" />
          </button>
        </div>
      </nav>
      <div
        v-if="state.recoveryRequired"
        class="recovery-banner"
      >
        <ShieldAlert :size="16" /><span>{{
          t('An interrupted restore needs recovery. New tasks are blocked.')
        }}</span><button
          class="secondary-button"
          @click="perform(() => rpc('restore.recover'))"
        >
          {{ t('Recover restore') }}
        </button>
      </div>
      <ReviewView
        v-if="shownReview"
        :review="shownReview.chat"
        :run="shownReview.run"
        :reviewed-prompt="runsById.get(shownReview.chat.reviewOf!.runId)?.prompt"
        :messages="state.messages.filter((message) => message.chatId === shownReview!.chat.id && message.role !== 'user')"
        :workspace-id="workspaceId"
        :busy="Boolean(active) || wrappedUp"
        @address="perform(() => askAboutReview(shownReview!.chat.id).then(() => selectFileTab()))"
        @delete="perform(() => deleteReview(shownReview!.chat))"
        @link="(url) => perform(() => link(url))"
      />
      <template v-else-if="showActions">
        <section class="actions-view">
          <h1>{{ t('Actions that remain') }}</h1>
          <p class="muted">
            {{
              t(
                'External effects, approved commands, and installations stay recorded when you revert a prompt.',
              )
            }}
          </p>
          <div
            v-if="!actions.length"
            class="empty-card"
          >
            <Activity :size="24" />
            <p>{{ t('No external actions recorded.') }}</p>
          </div>
          <article
            v-for="action in actions"
            :key="action.id"
            class="action-card"
          >
            <header>
              <strong>{{ action.title }}</strong><span
                class="badge"
                :class="action.status"
              >{{ action.status }}</span>
            </header>
            <p>{{ action.detail }}</p>
            <footer>
              {{ new Date(action.createdAt).toLocaleString()
              }}<span
                v-if="action.reverted"
                class="warning-text"
              >
                · {{ t('Originating prompt reverted; effect remains') }}</span>
            </footer>
          </article>
        </section>
      </template>
      <template v-else-if="showDiagnostics">
        <section class="actions-view">
          <h1>{{ t('Diagnostics') }}</h1>
          <p class="muted">
            {{ t('Problems reported by language servers for this workspace.') }}
          </p>
          <div class="diagnostics-toolbar">
            <button
              class="secondary-button"
              :disabled="scanningDiagnostics"
              @click="perform(scanDiagnostics)"
            >
              <RefreshCw :size="13" />
              {{ scanningDiagnostics ? t('Running…') : t('Run diagnostics') }}
            </button><button
              v-if="diagnosticList.length"
              class="primary-button"
              :disabled="wrappedUp"
              @click="perform(fixAllDiagnostics)"
            >
              <Wrench :size="13" /> {{ t('Fix all') }}
            </button>
          </div>
          <div
            v-if="!diagnosticList.length"
            class="empty-card"
          >
            <Check :size="24" />
            <p>{{ t('No problems reported.') }}</p>
          </div>
          <article
            v-for="(item, index) in diagnosticList"
            :key="`${item.uri}:${item.range.start.line}:${item.range.start.character}:${index}`"
            class="action-card"
          >
            <header>
              <strong class="diagnostic-location">{{ item.path }}:{{ item.range.start.line + 1 }}:{{
                item.range.start.character + 1
              }}</strong><span
                class="badge"
                :class="
                  item.level === 'error' ? 'failed' : item.level === 'warning' ? 'pending' : ''
                "
              >{{ t(item.level) }}</span>
            </header>
            <p class="diagnostic-message">
              {{ item.message }}
            </p>
            <div
              v-if="diagnosticSnippet(item).length"
              class="diagnostic-snippet hljs"
            >
              <div
                v-for="line in diagnosticSnippet(item)"
                :key="line.number"
                class="snippet-line"
                :class="{ hit: line.hit }"
              >
                <span class="snippet-number">{{ line.number }}</span>
                <!-- eslint-disable-next-line vue/no-v-html -->
                <code v-html="line.html" />
              </div>
            </div>
            <footer>
              {{ item.server }}<span class="spacer" /><button
                v-if="insideWorkspace(item.uri)"
                class="text-button"
                @click="perform(() => openDiagnosticHere(item))"
              >
                <FileCode2 :size="13" />
                {{ t('Open at line {line}', { line: item.range.start.line + 1 }) }}
              </button><button
                v-if="insideWorkspace(item.uri)"
                class="text-button"
                @click="perform(() => openDiagnosticInEditor(item))"
              >
                <ExternalLink :size="13" /> {{ t('Open in editor') }}
              </button><button
                class="text-button"
                :disabled="!workspace || wrappedUp"
                @click="perform(() => fixDiagnostic(item))"
              >
                <Wrench :size="13" /> {{ t('Fix this') }}
              </button>
            </footer>
          </article>
        </section>
      </template>
      <template v-else-if="preview">
        <div class="preview-header">
          <button
            class="text-button"
            @click="selectFileTab()"
          >
            <ArrowLeft :size="14" /> {{ t('Chat') }}
          </button><FileCode2 :size="15" /><strong>{{ preview.path }}</strong><span class="badge">{{ t('Read-only') }}</span><span class="spacer" /><button
            class="text-button"
            @click="perform(() => rpc('files.openExternal', { workspaceId, path: preview!.path }))"
          >
            <ExternalLink :size="13" /> {{ t('Open in editor') }}
          </button><button
            class="icon-button"
            :title="t('Close preview')"
            @click="closeFileTab(preview!.path)"
          >
            <X :size="15" />
          </button>
        </div>
        <div class="preview-toolbar">
          <button
            class="text-button"
            @click="perform(() => languageQuery('diagnostics'))"
          >
            {{ t('Diagnostics') }}
          </button><button
            class="text-button"
            @click="perform(() => languageQuery('symbols'))"
          >
            {{ t('Symbols') }}
          </button><button
            v-if="!preview.binary && !preview.mediaType"
            class="text-button"
            :class="{ active: previewDiffOn && previewFileDiff }"
            :aria-pressed="!!(previewDiffOn && previewFileDiff)"
            :title="t('Show this file\'s changes inline')"
            @click="perform(togglePreviewDiff)"
          >
            <GitCompareArrows :size="13" />
            {{ t(previewDiffOn && previewFileDiff ? 'Hide changes' : 'Show changes') }}
          </button><span class="muted small">{{
            t('{count} diagnostic(s)', { count: currentDiagnostics.length })
          }}</span><span class="spacer" /><button
            class="icon-button"
            :title="t('Reload file')"
            @click="perform(() => openFile(preview!.path, true))"
          >
            <RefreshCw :size="13" />
          </button>
        </div>
        <div class="file-preview">
          <img
            v-if="preview.mediaType?.startsWith('image/')"
            class="native-preview"
            :src="preview.url"
            :alt="preview.path"
          >
          <audio
            v-else-if="preview.mediaType?.startsWith('audio/')"
            :key="preview.url"
            class="native-preview"
            :src="preview.url"
            controls
            preload="metadata"
          />
          <video
            v-else-if="preview.mediaType?.startsWith('video/')"
            :key="`video:${preview.url}`"
            class="native-preview"
            :src="preview.url"
            controls
            preload="metadata"
          />
          <iframe
            v-else-if="preview.mediaType === 'application/pdf'"
            class="document-preview"
            :src="preview.url"
            :title="preview.path"
          />
          <p
            v-else-if="preview.binary"
            class="muted"
          >
            {{ t('Binary file. Open it in an external editor.') }}
          </p>
          <div
            v-else-if="previewDiffOn && previewFileDiff"
            class="diff-view full-file-diff"
            :class="diffWrap ? 'wrap' : 'nowrap'"
          >
            <DiffView
              :diff="previewFileDiff"
              :content="preview.content"
              layout="unified"
            />
          </div>
          <MarkdownView
            v-else-if="markdownPreview"
            :key="preview.path"
            :content="preview.content"
            :workspace-id="workspaceId"
            @link="(url) => perform(() => link(url))"
          />
          <div
            v-else
            class="code-preview"
          >
            <div
              v-if="diagnosticHighlight?.path === preview.path"
              class="preview-line-highlight"
              :style="{ top: `${diagnosticHighlight.top}px`, height: `${diagnosticHighlight.height}px` }"
            />
            <pre class="line-numbers">{{
              preview.content
                .split('\n')
                .map((_, index) => index + 1)
                .join('\n')
            }}</pre>
            <!-- highlight.js escapes file text before producing markup. -->
            <!-- eslint-disable vue/no-v-html -->
            <pre class="source-code"><code
              class="hljs"
              v-html="highlightedPreview"
            /></pre>
            <!-- eslint-enable vue/no-v-html -->
          </div>
          <pre
            v-if="languageResult"
            class="language-output"
          >{{ languageResult }}</pre>
        </div>
      </template>
      <template v-else>
        <div
          v-if="findOpen"
          class="find-bar"
          role="search"
        >
          <Search :size="13" />
          <input
            v-model="findText"
            :placeholder="t('Find in chat')"
            :aria-label="t('Find in chat')"
            @keydown.enter.exact.prevent="stepFind(1)"
            @keydown.shift.enter.prevent="stepFind(-1)"
            @keydown.esc.prevent="closeFind"
          >
          <span class="find-count">{{
            findText.trim() ? (findCount ? `${findIndex + 1}/${findCount}` : t('No results')) : ''
          }}</span>
          <button
            class="icon-button"
            :aria-label="t('Previous match')"
            :disabled="!findCount"
            @click="stepFind(-1)"
          >
            <ChevronUp :size="14" />
          </button>
          <button
            class="icon-button"
            :aria-label="t('Next match')"
            :disabled="!findCount"
            @click="stepFind(1)"
          >
            <ChevronDown :size="14" />
          </button>
          <button
            class="icon-button"
            :aria-label="t('Close')"
            @click="closeFind"
          >
            <X :size="14" />
          </button>
        </div>
        <div
          ref="conversation"
          class="conversation"
          @scroll="scrollChanged"
        >
          <div
            v-if="!messages.length && workspace && guidedMode(chat?.mode)"
            class="welcome"
          >
            <ModeSwitcher
              :mode="chat?.mode"
              :app-icon="appIcon"
              :switchable="!!chat && !runs.length"
              @select="(mode) => perform(() => setChatMode(mode))"
            />
            <h1>{{ t(welcomeGreeting) }}</h1>
            <p>{{ t(guidedMode(chat?.mode)!.banner) }}</p>
            <div class="suggestion-grid">
              <button
                v-for="example in guidedMode(chat?.mode)!.examples"
                :key="example.title"
                @click="composer = t(example.prompt)"
              >
                <ChatModeIcon
                  :mode="guidedMode(chat?.mode)!.id"
                  :size="17"
                /><strong>{{ t(example.title) }}</strong><span>{{ t(example.hint) }}</span>
              </button>
            </div>
          </div>
          <div
            v-else-if="!messages.length"
            class="welcome"
          >
            <ModeSwitcher
              :mode="chat?.mode"
              :app-icon="appIcon"
              :switchable="!!workspace && !!chat && !runs.length"
              @select="(mode) => perform(() => setChatMode(mode))"
            />
            <h1>
              {{ workspace ? t(welcomeGreeting) : t('Open a folder to get started') }}
            </h1>
            <p>
              {{
                t(
                  'Describe a task. You approve it once, watch the agent work, and review every change before you keep it.',
                )
              }}
            </p>
            <button
              v-if="!workspace"
              class="primary-button"
              @click="perform(openWorkspace)"
            >
              <FolderOpen :size="16" /> {{ t('Open a workspace') }}
            </button>
            <div
              v-else
              class="suggestion-grid"
            >
              <button
                v-for="chip in welcomeChips"
                :key="chip.label"
                type="button"
                @click="composer = chip.prompt"
              >
                <component
                  :is="chip.icon"
                  :size="17"
                /><strong>{{ t(chip.label) }}</strong><span>{{ t(chip.hint) }}</span>
              </button>
            </div>
            <div class="welcome-footnote">
              <ShieldCheck :size="13" />
              <span :title="state.sandbox.detail">{{
                t(
                  state.sandbox.available
                    ? 'Commands run in an isolated sandbox'
                    : 'No sandbox available: every command needs your approval',
                )
              }}</span>
            </div>
          </div>
          <div
            v-else
            class="message-list"
          >
            <template
              v-for="{ message, tools: groupedTools, note } in messageItems"
              :key="message.id"
            >
              <div
                v-if="message.role === 'user' && message.metadata.modeSwitch"
                class="mode-switch-note"
                role="note"
              >
                {{ modeSwitchLabel(message.metadata.modeSwitch) }}
              </div>
              <article
                v-else-if="message.role === 'user'"
                class="message user-message"
              >
                <div class="message-label">
                  <img
                    v-if="state.global.profile?.avatar"
                    class="avatar user-avatar"
                    :src="state.global.profile.avatar"
                    alt=""
                  ><strong>{{
                    state.global.profile?.name?.trim() || t('You')
                  }}</strong><span
                    v-if="runUsageLabel(message.runId)"
                    class="run-usage"
                  >{{
                    runUsageLabel(message.runId)
                  }}</span><span class="spacer" /><button
                    v-if="!message.metadata.steer"
                    class="text-button"
                    :disabled="Boolean(editingRun)"
                    :title="t('Edit this prompt and send it again in a new branch of the chat')"
                    @click="startEdit(message)"
                  >
                    <Pencil :size="12" /> {{ t('Edit') }}
                  </button>
                </div>
                <span
                  v-if="message.metadata.steer"
                  class="steer-badge"
                  :title="t('Sent while the agent was working; delivered into the running prompt')"
                ><Navigation :size="11" /> {{ t('Steering') }}</span>
                <div
                  v-if="editingRun === message.runId && !message.metadata.steer"
                  class="edit-prompt"
                >
                  <textarea
                    v-model="editText"
                    rows="4"
                    @keydown.enter.exact.prevent="perform(resendEdit)"
                    @keydown.esc.prevent="editingRun = ''"
                  />
                  <div class="edit-prompt-actions">
                    <span>{{
                      t('Sends in a new branch of this chat. This chat stays as it is.')
                    }}</span>
                    <button
                      class="secondary-button"
                      @click="editingRun = ''"
                    >
                      {{ t('Cancel') }}
                    </button>
                    <button
                      class="primary-button"
                      :disabled="!editText.trim()"
                      @click="perform(resendEdit)"
                    >
                      <GitFork :size="13" /> {{ t('Send as new branch') }}
                    </button>
                  </div>
                </div>
                <div
                  v-else
                  class="user-content"
                >
                  {{ message.content }}
                </div>
                <div
                  v-if="messageAttachments(message.metadata).length"
                  class="message-attachments"
                >
                  <button
                    v-for="attachment in messageAttachments(message.metadata)"
                    :key="attachment.id"
                    type="button"
                    class="attachment-chip"
                    :title="`${attachment.name} · ${formatSize(attachment.size)} · ${t('click to preview')}`"
                    @click="previewSent(attachment)"
                  >
                    <img
                      v-if="isImage(attachment.mediaType)"
                      :src="attachmentUrl(attachment.id)"
                      alt=""
                    ><FileText
                      v-else
                      :size="16"
                    /><span>{{ attachment.name }}</span>
                  </button>
                </div>
              </article>
              <p
                v-else-if="note"
                class="tool-note"
              >
                <component
                  :is="toolName(message) === 'set_chat_title' ? Pencil : ListPlus"
                  :size="12"
                />{{ note }}
              </p>
              <ImageView
                v-else-if="
                  message.role === 'tool' &&
                    !groupedTools &&
                    toolName(message) === 'show_image'
                "
                :message="message"
                :workspace-id="workspaceId"
              />
              <ChartView
                v-else-if="
                  message.role === 'tool' &&
                    !groupedTools &&
                    toolName(message) === 'render_chart'
                "
                :message="message"
              />
              <DiagramView
                v-else-if="
                  message.role === 'tool' &&
                    !groupedTools &&
                    toolName(message) === 'render_diagram'
                "
                :message="message"
              />
              <ToolCard
                v-else-if="message.role === 'tool' && !groupedTools && toolName(message) === 'call_mcp'"
                :message="message"
                :workspace-id="workspaceId"
                :terminals="terminals"
                :rewindable="rewindable(message)"
                @rewind="(id) => perform(() => previewRewind(id))"
              />
              <InlineUi
                v-else-if="message.role === 'tool' && !groupedTools"
                :message="message"
              />
              <details
                v-else-if="groupedTools"
                class="tool-card tool-group"
              >
                <summary>
                  <LoaderCircle
                    v-if="toolGroupState(groupedTools).running"
                    :size="14"
                    class="spin"
                  /><CircleX
                    v-else-if="toolGroupState(groupedTools).failed"
                    :size="14"
                    class="error-text"
                  /><Check
                    v-else
                    :size="14"
                    class="success-text"
                  /><span>{{
                    toolGroupLabel(groupedTools)
                  }}</span><ChevronRight
                    :size="13"
                    class="disclosure"
                  />
                </summary>
                <div class="tool-group-items">
                  <ToolCard
                    v-for="toolMessage in groupedTools"
                    :key="toolMessage.id"
                    :message="toolMessage"
                    :workspace-id="workspaceId"
                    :terminals="terminals"
                    :rewindable="rewindable(toolMessage)"
                    @rewind="(id) => perform(() => previewRewind(id))"
                  />
                </div>
              </details>
              <article
                v-else-if="
                  message.role === 'assistant' &&
                    (message.content || message.metadata.reasoning || message.metadata.streaming)
                "
                class="message assistant-message"
              >
                <div class="message-label">
                  <img
                    class="avatar agent-avatar"
                    :src="appIcon"
                    alt=""
                  ><strong>BasedCode</strong><span
                    v-if="message.metadata.streaming"
                    class="streaming-label"
                  ><span class="status-dot live" /> {{ t('working') }}</span>
                </div>
                <details
                  v-if="message.metadata.reasoning"
                  class="reasoning-block"
                  :open="Boolean(message.metadata.streaming)"
                  :class="{ thinking: message.metadata.streaming && !message.content }"
                >
                  <summary>
                    <Brain :size="14" /><span class="reasoning-title">{{
                      message.metadata.streaming && !message.content
                        ? t('Thinking')
                        : t('Reasoning')
                    }}</span><ChevronRight
                      :size="13"
                      class="disclosure"
                    />
                  </summary>
                  <MarkdownView
                    v-autoscroll="Boolean(message.metadata.streaming)"
                    :content="String(message.metadata.reasoning)"
                    :streaming="Boolean(message.metadata.streaming)"
                    :workspace-id="workspaceId"
                    @link="(url) => perform(() => link(url))"
                  />
                </details>
                <MarkdownView
                  :content="message.content"
                  :streaming="Boolean(message.metadata.streaming)"
                  :workspace-id="workspaceId"
                  @link="(url) => perform(() => link(url))"
                /><span
                  v-if="message.metadata.streaming && !message.content"
                  class="thinking-dots shimmer-text"
                  role="status"
                  aria-live="polite"
                >{{ t('Thinking') }}…</span>
              </article>
              <figure
                v-else-if="message.metadata.browserScreenshot"
                class="browser-screenshot"
              >
                <template
                  v-for="attachment in messageAttachments(message.metadata)"
                  :key="attachment.id"
                >
                  <button
                    v-if="isImage(attachment.mediaType)"
                    type="button"
                    class="browser-screenshot-preview"
                    :title="t('click to preview')"
                    @click="previewSent(attachment)"
                  >
                    <img
                      :src="attachmentUrl(attachment.id)"
                      :alt="attachment.name"
                      loading="lazy"
                    >
                  </button>
                </template>
                <figcaption>{{ message.content }}</figcaption>
              </figure>
              <details
                v-else-if="message.role === 'system' && message.metadata.compaction"
                class="system-message compaction"
              >
                <summary>
                  <Layers :size="14" /><span>{{ message.content }}</span>
                </summary>
                <MarkdownView
                  :content="compactionSummary(message.metadata.compaction)"
                  :streaming="false"
                  :workspace-id="workspaceId"
                  @link="(url) => perform(() => link(url))"
                />
              </details>
              <div
                v-else-if="message.metadata.compacting"
                class="system-message"
                role="status"
              >
                <RefreshCw
                  :size="14"
                  class="spin"
                /><span>{{ t('Compacting...') }}</span>
              </div>
              <div
                v-else-if="message.role === 'system'"
                class="system-message"
                :class="{
                  'error-text': message.metadata.error,
                  completion: message.metadata.completion,
                }"
              >
                <component
                  :is="
                    message.metadata.error
                      ? ShieldAlert
                      : message.metadata.completion
                        ? Check
                        : Activity
                  "
                  :size="14"
                /><span style="white-space: pre-line">{{ message.content }}</span>
              </div>
              <RunStatsLine
                v-if="
                  lastMessageOfRun.get(message.runId) ===
                    (groupedTools?.at(-1)?.id ?? message.id) && runsById.get(message.runId)?.stats
                "
                :stats="runsById.get(message.runId)!.stats!"
                :live="runsById.get(message.runId)!.status === 'running'"
              />
              <div
                v-if="
                  lastMessageOfRun.get(message.runId) === (groupedTools?.at(-1)?.id ?? message.id) &&
                    !runBusy(message.runId)
                "
                class="run-actions"
              >
                <button
                  class="text-button"
                  :title="t('Inspect this prompt\'s changes')"
                  @click="perform(() => showChanges(runs.find((run) => run.id === message.runId)))"
                >
                  <GitCompareArrows :size="13" /> {{ t('Changes') }}
                </button><button
                  class="text-button"
                  :title="t('Fork: start a new chat with the conversation up to and including this prompt')"
                  @click="perform(() => forkChat(message.runId))"
                >
                  <GitFork :size="12" /> {{ t('Fork') }}
                </button><button
                  v-if="!wrappedUp && !runs.find((run) => run.id === message.runId)?.forkedFrom"
                  class="text-button"
                  :disabled="Boolean(active)"
                  :title="t('Restore files and conversation before this prompt')"
                  @click="perform(() => previewRevert(message.runId))"
                >
                  <RotateCcw :size="12" /> {{ t('Revert') }}
                </button><ModelPicker
                  v-if="chat?.mode !== 'review'"
                  :global="state.global"
                  :workspace="workspace"
                  :usage="modelUsage"
                  mode="pick"
                  note
                  :label="t('Second opinion')"
                  :action="t('Start review')"
                  :disabled="false"
                  :title="t('Ask another model for a read-only review of what this prompt did')"
                  @error="report"
                  @pick="(pick) => perform(() => startReview(message.runId, pick))"
                >
                  <MessageSquareQuote :size="12" />
                </ModelPicker><ModelPicker
                  v-if="
                    message.runId === latestRunId &&
                      chat?.mode !== 'review' &&
                      !runs.find((run) => run.id === message.runId)?.forkedFrom
                  "
                  :global="state.global"
                  :workspace="workspace"
                  :usage="modelUsage"
                  mode="pick"
                  :label="t('Re-run')"
                  :action="t('Re-run and compare')"
                  :disabled="false"
                  :title="
                    t(
                      'Run this prompt again from the same starting files with another model, then compare and keep the better result',
                    )
                  "
                  @error="report"
                  @pick="(pick) => perform(() => rerunWith(message.runId, pick))"
                >
                  <Repeat2 :size="12" />
                </ModelPicker>
              </div>
            </template>
          </div>
        </div>
        <BrowserPreview
          :chat-id="chatId"
          :workspace-id="workspaceId"
        />
        <div class="composer-area">
          <div
            v-if="working?.reconnecting"
            class="run-banner warning"
            role="status"
          >
            <WifiOff :size="16" />
            <span>{{
              t('Lost the connection to the model. Reconnecting in {seconds}s (attempt {attempt} of {max}).', {
                seconds: reconnectSeconds,
                attempt: working.reconnecting.attempt,
                max: working.reconnecting.max,
              })
            }}</span>
          </div>
          <div
            v-else-if="interruptedRun"
            class="run-banner"
            role="status"
          >
            <History :size="16" />
            <span :title="interruptedRun.error">{{
              interruptedRun.error?.startsWith('No response from the model')
                ? t(
                  'The model stopped responding for 10 minutes, so the prompt was stopped. Some of its work may be half done.',
                )
                : t(
                  'BasedCode stopped while the last prompt was running. Some of its work may be half done.',
                )
            }}</span>
            <button
              class="text-button"
              :disabled="wrappedUp"
              :title="t('Ask the agent to check what was done and continue the task')"
              @click="perform(resumeRun)"
            >
              <Play :size="12" /> {{ t('Resume') }}
            </button>
            <button
              class="text-button"
              :disabled="wrappedUp"
              :title="t('Send the same prompt again')"
              @click="perform(() => retryRun(interruptedRun!))"
            >
              <RotateCcw :size="12" /> {{ t('Retry') }}
            </button>
          </div>
          <div
            v-else-if="failedRun"
            class="run-banner"
            role="status"
          >
            <CircleAlert :size="16" />
            <span :title="failedRun.error">{{
              t('The last prompt failed: {error}', {
                error: (failedRun.error ?? t('unknown error')).slice(0, 160),
              })
            }}</span>
            <button
              class="text-button"
              :disabled="wrappedUp"
              :title="t('Send the same prompt again')"
              @click="perform(() => retryRun(failedRun!))"
            >
              <RotateCcw :size="12" /> {{ t('Retry') }}
            </button>
          </div>
          <div
            v-if="chatComparison"
            class="chat-strip"
          >
            <Scale :size="13" /><span>{{
              chatComparison.kept
                ? t('Compared with another model; a result was kept.')
                : t('This prompt was re-run with another model.')
            }}</span><span class="spacer" /><button
              class="text-button"
              @click="compareId = chatComparison.id"
            >
              {{ t('Compare') }}
            </button>
          </div>
          <div
            v-if="chat?.mode === 'review'"
            class="chat-strip"
          >
            <MessageSquareQuote :size="13" /><span>{{
              t('Read-only second opinion. The reviewed chat\'s model can read this review.')
            }}</span>
          </div>
          <PlanPanel
            v-if="activePlan"
            :steps="activePlan"
          />
          <div
            v-if="active"
            class="run-status"
          >
            <component
              :is="runStatus[active.status].icon"
              :size="14"
              class="run-state-icon"
              :class="[runStatus[active.status].tone, { spin: runStatus[active.status].spin }]"
            /><strong>{{ t(runStatus[active.status].label) }}</strong><span class="muted">{{ active.provider }}</span><span
              v-if="working && canSteer"
              class="muted small"
            >· {{ t('messages you send now steer this prompt') }}</span><span
              v-if="active.stats && tokensPerSecond(active.stats)"
              class="run-status-speed"
            >{{ active.stats.estimated ? '≈' : ''
            }}{{ formatSpeed(tokensPerSecond(active.stats)) }}</span><span class="spacer" /><ModelPicker
              v-if="chat?.mode !== 'review' && !chat?.rerunOf && !wrappedUp"
              :global="state.global"
              :workspace="workspace"
              :usage="modelUsage"
              mode="pick"
              :disabled="false"
              :label="t('Switch model')"
              :action="t('Stop and hand over')"
              :title="t('Stop this prompt and hand the chat to another model, which picks up where this one left off')"
              @error="report"
              @pick="(pick) => perform(() => continueWith(pick))"
            >
              <Shuffle :size="12" />
            </ModelPicker><button
              class="text-button"
              @click="perform(() => rpc('run.stop', { runId: active!.id }))"
            >
              <Square :size="10" /> {{ t('Stop') }}
            </button>
          </div>
          <ol
            v-if="queued.length && (working || compacting)"
            class="queued-list"
            :aria-label="t('Queued prompts')"
          >
            <li
              v-for="(run, index) in queued"
              :key="run.id"
            >
              <ListPlus :size="13" /><span class="queued-index">{{ index + 1 }}</span><span class="queued-prompt">{{ run.prompt }}</span><button
                class="text-button"
                :title="t('Remove from the queue')"
                @click="perform(() => rpc('run.stop', { runId: run.id }))"
              >
                <X :size="12" /> {{ t('Cancel') }}
              </button>
            </li>
          </ol>
          <form
            ref="composerBox"
            class="composer"
            :class="{
              ignited: effectsEnabled && motionAllowed && (Boolean(active) || composer.length > 0),
              dragging,
            }"
            @keydown.capture="commandKeydown"
            @input="trackCaret"
            @keyup="trackCaret"
            @click="trackCaret"
            @submit.prevent="perform(() => send())"
            @paste="pasteFiles"
            @dragover.prevent="dragging = true"
            @dragleave="dragging = false"
            @drop.prevent="dropIntoComposer"
          >
            <div
              v-if="pending.length"
              class="composer-attachments"
            >
              <div
                v-for="item in pending"
                :key="item.key"
                class="attachment-chip"
                :class="{ failed: item.error, loading: !item.attachment && !item.error }"
              >
                <button
                  type="button"
                  class="attachment-open"
                  :title="
                    item.error
                      ? `${item.file.name}: ${item.error}`
                      : `${item.file.name} · ${formatSize(item.file.size)} · ${t('click to preview')}`
                  "
                  @click="previewPending(item)"
                >
                  <img
                    v-if="item.url"
                    :src="item.url"
                    alt=""
                  ><component
                    :is="item.file.type.startsWith('image/') ? ImageIcon : FileText"
                    v-else
                    :size="16"
                  /><span>{{ item.file.name || t('Pasted image') }}</span><small>{{
                    item.error ?? (item.attachment ? formatSize(item.file.size) : t('Uploading…'))
                  }}</small>
                </button><button
                  type="button"
                  class="icon-button"
                  :aria-label="t('Remove {name}', { name: item.file.name })"
                  @click="removeAttachment(item.key)"
                >
                  <X :size="12" />
                </button>
              </div>
            </div>
            <div
              v-if="visibleCommands.length"
              class="slash-popup"
            >
              <div
                class="slash-popup-head"
                aria-live="polite"
              >
                <span
                  class="slash-chip"
                  :class="commandHelp ? 'command' : visibleCommands.some((c) => c.name === commandQuery) ? 'command' : 'typing'"
                >{{ commandHelp ? '/help' : '/' + commandQuery }}<span
                  v-if="!commandHelp"
                  class="slash-caret"
                /></span>
                <span class="slash-popup-status">{{
                  commandHelp
                    ? t('{count} commands', { count: visibleCommands.length })
                    : visibleCommands.some((c) => c.name === commandQuery)
                      ? t('✓ Command recognised')
                      : commandQuery
                        ? t('{count} matching', { count: visibleCommands.length })
                        : t('Type to filter {count} commands', { count: visibleCommands.length })
                }}</span>
                <span class="slash-keys"><kbd>↑</kbd><kbd>↓</kbd> {{ t('select') }} <kbd>Tab</kbd> {{ t('complete') }} <kbd>Esc</kbd></span>
              </div>
              <div
                ref="commandList"
                role="listbox"
                class="slash-commands"
                aria-label="Slash commands"
              >
                <button
                  v-for="(command, index) in visibleCommands"
                  :key="command.name"
                  type="button"
                  role="option"
                  :aria-selected="index === commandIndex"
                  :class="{ selected: index === commandIndex }"
                  @mousedown.prevent
                  @click="chooseCommand(command.name)"
                >
                  <span class="slash-name">/<mark v-if="commandQuery && !commandHelp">{{ command.name.slice(0, commandQuery.length) }}</mark>{{ commandHelp ? command.name : command.name.slice(commandQuery.length) }}</span>
                  <code
                    v-if="command.params?.length"
                    class="slash-signature"
                  >{{ slashCommandSignature(command) }}</code>
                  <span class="slash-description">{{ t(command.description) }}</span>
                </button>
              </div>
            </div>
            <div
              v-else-if="skillMention?.skills.length"
              class="slash-popup"
            >
              <div
                class="slash-popup-head"
                aria-live="polite"
              >
                <span
                  class="slash-chip"
                  :class="skillMention.skills.some((s) => s.name === skillMention!.query) ? 'command' : 'typing'"
                >@{{ skillMention.query }}<span class="slash-caret" /></span>
                <span class="slash-popup-status">{{
                  skillMention.skills.some((s) => s.name === skillMention!.query)
                    ? t('✓ Skill recognised')
                    : t('{count} matching skills', { count: skillMention.skills.length })
                }}</span>
                <span class="slash-keys"><kbd>↑</kbd><kbd>↓</kbd> {{ t('select') }} <kbd>Tab</kbd> {{ t('complete') }} <kbd>Esc</kbd></span>
              </div>
              <div
                role="listbox"
                class="slash-commands"
                aria-label="Skills"
              >
                <button
                  v-for="(skill, index) in skillMention.skills"
                  :key="skill.name"
                  type="button"
                  role="option"
                  :aria-selected="index === mentionIndex % skillMention.skills.length"
                  :class="{ selected: index === mentionIndex % skillMention.skills.length }"
                  @mousedown.prevent
                  @click="chooseMention(skill.name)"
                >
                  <span class="slash-name">@<mark v-if="skillMention.query">{{ skill.name.slice(0, skillMention.query.length) }}</mark>{{ skill.name.slice(skillMention.query.length) }}</span>
                  <code
                    v-if="skill.scope"
                    class="slash-signature"
                  >{{ t(skill.scope) }}</code>
                </button>
              </div>
            </div>
            <div
              v-else-if="unknownCommand"
              class="slash-arg-hint invalid"
              role="status"
            >
              <span class="slash-chip error">/{{ unknownCommand }}</span>
              {{ t('No command matches. Type /help to list them all.') }}
            </div>
            <div
              v-else-if="commandArgHint"
              class="slash-arg-hint"
              :class="{ invalid: commandArgHint.extra.length }"
              role="status"
            >
              <div class="slash-parsed">
                <span
                  class="slash-chip command"
                  :title="t(commandArgHint.command.description)"
                >✓ /{{ commandArgHint.command.name }}</span>
                <span
                  v-for="(param, index) in commandArgHint.params"
                  :key="param.name"
                  class="slash-chip"
                  :class="{
                    current: index === commandArgHint.index,
                    filled: commandArgHint.values[index],
                    missing: !param.optional && !commandArgHint.values[index] && index !== commandArgHint.index,
                  }"
                ><span class="slash-param">{{ param.optional ? `[${param.name}]` : `<${param.name}>` }}</span><span
                  v-if="commandArgHint.values[index]"
                  class="slash-value"
                >{{ commandArgHint.values[index] }}</span></span>
                <span
                  v-for="(word, index) in commandArgHint.extra"
                  :key="'extra' + index"
                  class="slash-chip error"
                  :title="t('Unexpected argument')"
                >{{ word }}</span>
              </div>
              <p v-if="commandArgHint.extra.length">
                {{
                  commandArgHint.params.length
                    ? t('Too many arguments: /{name} takes {count}.', { name: commandArgHint.name, count: commandArgHint.params.length })
                    : t('/{name} takes no arguments.', { name: commandArgHint.name })
                }}
              </p>
              <p v-else-if="commandArgHint.current">
                <strong>{{ commandArgHint.current.name }}</strong>
                <em v-if="commandArgHint.current.optional"> ({{ t('optional') }})</em>:
                {{ t(commandArgHint.current.description) }}
              </p>
              <p v-else>
                {{ t('All parameters filled. Press Enter to run.') }}
              </p>
              <p
                v-if="commandArgHint.command.example"
                class="muted"
              >
                {{ t('Example') }}: <code>{{ commandArgHint.command.example }}</code>
              </p>
            </div>
            <ComposerInput
              v-model="composer"
              :commands="allSlashCommands"
              :disabled="!workspace || wrappedUp"
              :placeholder="
                t(
                  !workspace
                    ? 'Open a workspace to start a conversation'
                    : wrappedUp
                      ? 'This session was wrapped up. Start a new chat to keep going.'
                      : compacting
                        ? 'Queue a prompt while compacting'
                        : working
                          ? canSteer
                            ? 'Steer the agent, or Alt + Enter to queue a new prompt'
                            : 'Queue the next prompt'
                          : 'What should we work on?',
                )
              "
              @submit="perform(() => send())"
              @queue="perform(() => send('queue'))"
            />
            <div class="composer-footer">
              <button
                type="button"
                class="icon-button"
                :title="t('Attach files or images (you can also paste or drop them)')"
                :disabled="!workspace"
                @click="perform(attachFiles)"
              >
                <Paperclip :size="15" />
              </button>
              <ModeChip
                v-if="chat && chat.mode !== 'review'"
                :mode="chat.mode"
                :app-icon="appIcon"
                :started="messages.length > 0"
                :running="Boolean(active)"
                :wrapped-up="wrappedUp"
                @switch="(mode) => perform(() => switchMode(mode))"
                @wrap-up="perform(wrapUpSession)"
              />
              <ModelPicker
                ref="modelPicker"
                :global="state.global"
                :workspace="workspace"
                :label="providerLabel.split(' / ').at(-1) ?? providerLabel"
                :disabled="Boolean(active)"
                :title="
                  active
                    ? `${t('Model changes apply to the next prompt.')}\n${fallbackTitle}`
                    : fallbackTitle
                "
                :usage="modelUsage"
                @saved="pickerSaved"
                @settings="openGlobalSettings('models')"
                @error="report"
              /><LimitWindows
                v-if="currentLimits"
                :limits="currentLimits"
                compact
                @dashboard="openGlobalSettings('usage')"
              /><ModelUsage
                v-if="currentModel"
                :model="currentModel.model"
                :usage="modelUsage.get(modelKey(currentModel.provider, currentModel.model))"
              /><span
                v-if="active && fallbackIndex > 0"
                class="fallback-badge active"
                :title="fallbackTitle"
              ><RotateCcw :size="11" />
                {{ fallbackIndex + 1 }}/{{ enabledProviders.length }}</span><span
                v-else-if="enabledProviders.length > 1"
                class="fallback-badge"
                :title="fallbackTitle"
              >+{{ enabledProviders.length - 1 }}</span><button
                v-if="chat && (!active || compacting) && runs.length"
                type="button"
                class="icon-button"
                :disabled="compacting || wrappedUp"
                :aria-label="compacting ? t('Compacting...') : t('Compact')"
                :title="
                  t('Summarize older messages now so long chats fit the model\'s context (lossy)')
                "
                @click="perform(compactChat)"
              >
                <Layers
                  :size="14"
                  :class="{ spin: compacting }"
                />
              </button><span class="spacer" /><button
                v-if="working && canSteer"
                type="button"
                class="secondary-button queue-button"
                :disabled="!composer.trim() || uploading"
                :title="t('Queue as a new prompt after this one (Alt + Enter)')"
                @click="perform(() => send('queue'))"
              >
                <ListPlus :size="14" /> {{ t('Queue') }}
              </button><button
                ref="sendButton"
                type="submit"
                class="send-button"
                :disabled="!composer.trim() || !workspace || uploading"
                :aria-label="
                  t(
                    compacting
                      ? 'Queue prompt'
                      : working
                        ? canSteer
                          ? 'Steer the running prompt'
                          : 'Queue prompt'
                        : 'Send prompt',
                  )
                "
                :title="
                  t(
                    compacting
                      ? 'Queue after compaction (Enter)'
                      : working
                        ? canSteer
                          ? 'Steer: deliver to the running prompt (Enter)'
                          : 'Queue after the running prompt (Enter)'
                        : 'Enter to send · Shift + Enter for newline',
                  )
                "
              >
                <component
                  :is="
                    compacting ? ListPlus : working ? (canSteer ? Navigation : ListPlus) : ArrowUp
                  "
                  :size="working ? 17 : 19"
                />
              </button>
            </div>
          </form>
        </div>
      </template>
    </main>

    <aside
      v-if="rightOpen"
      class="right-sidebar"
    >
      <div
        class="resize-handle side left-edge"
        aria-hidden="true"
        @pointerdown.prevent="resizeRight"
        @dblclick="resetPane('right')"
      />
      <header class="right-tabs">
        <button
          :class="{ active: rightTab === 'files' }"
          :title="t('Files')"
          :aria-label="t('Files')"
          @click="rightTab = 'files'"
        >
          <FolderOpen :size="14" /> {{ t('Files') }}
        </button><button
          :class="{ active: rightTab === 'changes' }"
          :title="t('Changes')"
          :aria-label="t('Changes')"
          @click="perform(() => showChanges())"
        >
          <GitCompareArrows :size="14" /> {{ t('Changes') }}
        </button><button
          v-if="chat"
          :class="{ active: rightTab === 'context' }"
          :title="t('Context window: what the next prompt sends to the model')"
          @click="rightTab = 'context'"
        >
          <Gauge :size="14" /> {{ t('Context') }}
        </button><button
          v-if="workspace && !workspace.scratch"
          :class="{ active: rightTab === 'git' }"
          :title="t('Stage, commit and push')"
          @click="rightTab = 'git'"
        >
          <GitPullRequest :size="14" /> {{ t('Git') }}
        </button><button
          v-if="chat && chat.mode !== 'review'"
          :class="{ active: rightTab === 'reviews' }"
          :title="t('Second opinions ({count})', { count: chatReviews.length })"
          :aria-label="t('Second opinions')"
          @click="rightTab = 'reviews'"
        >
          <MessageSquareQuote :size="14" />
        </button><span class="spacer" /><button
          class="icon-button"
          :title="t('Refresh')"
          @click="perform(refreshSideTab)"
        >
          <RefreshCw :size="13" />
        </button>
      </header>
      <ContextInspector
        v-if="rightTab === 'context' && chat"
        ref="contextPanel"
        :key="`${chat.id}:${runs.length}:${active?.status ?? ''}`"
        :chat-id="chat.id"
        :busy="Boolean(active)"
        @error="report"
      />
      <section
        v-else-if="rightTab === 'reviews' && chat"
        class="reviews-panel"
      >
        <p class="muted small">
          {{
            t(
              'Read-only reviews by other models. This chat\'s model can read them. Start one with Second opinion under a prompt\'s output.',
            )
          }}
        </p>
        <p
          v-if="!chatReviews.length"
          class="muted small"
        >
          {{ t('No second opinions yet.') }}
        </p>
        <article
          v-for="review in chatReviews"
          :key="review.chat.id"
          class="review-item"
        >
          <div class="review-head">
            <LoaderCircle
              v-if="['queued', 'running', 'paused', 'awaiting_approval'].includes(review.run?.status ?? '')"
              :size="12"
              class="spin"
            /><strong>{{ review.run?.provider ?? review.chat.title }}</strong>
          </div>
          <p class="review-verdict">
            {{ review.verdict ?? t(review.run?.status ?? 'queued') }}
          </p>
          <p class="muted small review-of">
            {{ runsById.get(review.chat.reviewOf!.runId)?.prompt.slice(0, 120) }}
          </p>
          <div class="review-actions">
            <button
              class="text-button"
              @click="openReviewTab(review.chat)"
            >
              {{ t('Open') }}
            </button><button
              class="text-button"
              :disabled="Boolean(active) || wrappedUp || review.run?.status !== 'completed'"
              :title="t('Ask this chat\'s model to check the review\'s findings and fix the ones that hold up')"
              @click="perform(() => askAboutReview(review.chat.id))"
            >
              {{ t('Address it') }}
            </button><button
              class="text-button danger-text"
              :disabled="['running', 'paused', 'awaiting_approval', 'queued'].includes(review.run?.status ?? '')"
              :title="t('Delete this review')"
              @click="perform(() => deleteReview(review.chat))"
            >
              <Trash2 :size="12" />
            </button>
          </div>
        </article>
      </section>
      <GitPanel
        v-else-if="rightTab === 'git' && workspace"
        ref="gitPanel"
        :workspace-id="workspace.id"
        :chat-id="chat && chat.mode !== 'review' ? chat.id : undefined"
        :busy="Boolean(active)"
        :version="stateVersion"
        @error="report"
        @notice="(text) => (error = text)"
      />
      <template v-else-if="rightTab === 'files'">
        <div class="file-tree-label">
          {{ workspace?.name ?? t('NO WORKSPACE') }}
        </div>
        <div class="file-tree">
          <button
            v-for="entry in fileEntries"
            :key="entry.path"
            :style="{ paddingLeft: `${12 + entry.depth * 14}px` }"
            :class="{ selected: preview?.path === entry.path }"
            :title="entry.path"
            :draggable="!entry.directory"
            @dragstart="(event) => startFileDrag(event, entry.path)"
            @click="
              perform(() => (entry.directory ? toggleDirectory(entry) : openFile(entry.path)))
            "
          >
            <component
              :is="entry.directory ? (expanded.has(entry.path) ? ChevronDown : ChevronRight) : File"
              :size="13"
            /><Folder
              v-if="entry.directory"
              :size="14"
              class="folder-icon"
            /><span>{{
              entry.name
            }}</span>
          </button>
          <p
            v-if="!fileEntries.length"
            class="sidebar-empty"
          >
            {{ t('Open a folder to browse files.') }}
          </p>
        </div>
      </template>
      <template v-else>
        <div class="diff-controls">
          <AppSelect
            v-model="diffScope"
            :options="[
              { value: 'prompt', label: t('Prompt changes') },
              { value: 'workspace', label: t('Workspace Git diff') },
            ]"
            :aria-label="t('Diff scope')"
            @change="perform(loadChanges)"
          />
          <div
            class="segmented"
            role="group"
            :aria-label="t('Diff layout')"
          >
            <button
              :class="{ active: diffLayout === 'unified' }"
              :aria-pressed="diffLayout === 'unified'"
              :title="t('Unified diff')"
              @click="setDiffLayout('unified')"
            >
              <Rows2 :size="14" />
            </button><button
              :class="{ active: diffLayout === 'split' }"
              :aria-pressed="diffLayout === 'split'"
              :title="t('Side-by-side diff')"
              @click="setDiffLayout('split')"
            >
              <Columns2 :size="14" />
            </button>
          </div>
          <label
            class="checkbox diff-wrap-toggle"
            :title="t('Wrap long lines')"
          ><input
            v-model="diffWrap"
            autocomplete="off"
            type="checkbox"
          > {{ t('Wrap') }}</label>
        </div>
        <div
          v-if="changes.length"
          class="changed-file-list"
        >
          <button
            v-for="change in changes"
            :key="change.path"
            :class="{ selected: currentChange?.path === change.path }"
            @click="chosenChange = change.path"
          >
            <span
              class="change-indicator"
              :class="change.kind"
            >{{
              change.kind[0].toUpperCase()
            }}</span>{{ change.path }}
          </button>
        </div>
        <div
          v-if="currentChange"
          class="diff-view"
          :class="diffWrap ? 'wrap' : 'nowrap'"
        >
          <div class="diff-file-header">
            <span>{{ currentChange.path }}</span><button
              class="icon-button"
              :title="t('Open full file with changes')"
              @click="
                perform(async () => {
                  await openFile(currentChange!.path);
                  previewDiffOn = true;
                })
              "
            >
              <ExternalLink :size="12" />
            </button>
          </div>
          <p
            v-if="currentChange.binary"
            class="diff-binary"
          >
            {{ t('Binary file {kind}. No text diff available.', { kind: t(currentChange.kind) }) }}
          </p>
          <DiffView
            v-else
            :diff="currentChange.diff"
            :layout="diffLayout"
          />
        </div>
        <div
          v-else-if="gitDiff || gitStatus"
          class="diff-view"
          :class="diffWrap ? 'wrap' : 'nowrap'"
        >
          <pre class="git-status">{{ gitStatus }}</pre>
          <DiffView
            :diff="gitDiff"
            :layout="diffLayout"
          />
        </div>
        <div
          v-else
          class="diff-empty"
        >
          <GitCompareArrows :size="27" /><strong>{{ t('No changes to show') }}</strong>
          <p>{{ t('Prompt changes appear here after the agent starts working.') }}</p>
        </div>
      </template>
    </aside>

    <div
      v-if="terminalOpen && workspace"
      class="terminal-region"
    >
      <div
        class="resize-handle"
        :title="t('Resize terminal')"
        @pointerdown.prevent="resizeTerminal"
        @dblclick="resetPane('terminal')"
      />
      <TerminalPanel
        :key="workspaceId"
        :terminals="terminals"
        :workspace-id="workspaceId"
        @error="report"
        @collapse="terminalOpen = false"
      />
    </div>
    <footer class="statusbar">
      <span
        class="app-status"
        role="status"
        aria-live="polite"
      ><LoaderCircle
        v-if="appStatus.tone === 'busy'"
        :size="12"
        class="spin"
      /><TriangleAlert
        v-else-if="appStatus.tone === 'warn'"
        :size="12"
        class="warning-text"
      /><span
        v-else
        class="status-dot"
        :class="{ live: appStatus.tone === 'live' }"
      />{{
        appStatus.label
      }}</span><span class="status-divider">/</span><span>{{ workspace?.name ?? t('No workspace') }}</span><span class="spacer" /><span
        v-if="state.git && !state.git.available"
        class="status-warning"
        :title="
          t(
            'Prompt checkpoints are stored with git, so without it prompts run but cannot be reverted. Install git, make sure it is on PATH, and restart BasedCode.',
          )
        "
      ><CircleAlert :size="12" /> {{ t('Git not found: revert is off') }}</span><button
        class="status-tool-link"
        @click="openDiagnostics"
      >
        {{ diagnosticList.length }} {{ t('diagnostics') }}
      </button><span class="status-divider">/</span><button
        class="effects-toggle"
        :class="{ on: effectsEnabled && motionAllowed }"
        :disabled="!motionAllowed"
        :title="
          t(
            motionAllowed
              ? 'Flames and composer shake'
              : 'Effects are off because your system asks for reduced motion',
          ) +
            (webglRenderer ? `\nGPU: ${webglRenderer}` : '') +
            (effectsStats ? `\n${effectsStats}` : '')
        "
        :aria-pressed="effectsEnabled"
        @click="effectsEnabled = !effectsEnabled"
      >
        <Flame :size="12" /> {{ t(effectsEnabled && motionAllowed ? 'Effects on' : 'Effects off') }}
      </button>
    </footer>
    <BasedAquarium />
    <FlameStrip />
    <WelcomeDialog
      v-if="welcomeOpen"
      @close="closeWelcome"
    />

    <div
      v-if="checkpointWarning"
      class="toast warning-toast"
      role="status"
      aria-live="polite"
      @mouseenter="pauseToast"
      @mouseleave="resumeToast"
    >
      <TriangleAlert :size="16" /><span>{{ checkpointWarning }}</span><button
        class="icon-button"
        :aria-label="t('Dismiss warning')"
        @click="checkpointWarning = ''"
      >
        <X :size="15" />
      </button>
    </div>
    <div
      v-if="error"
      class="toast error-toast"
      role="alert"
    >
      <CircleX :size="16" /><span>{{ error }}</span><button
        class="icon-button"
        :aria-label="t('Dismiss error')"
        @click="error = ''"
      >
        <X :size="15" />
      </button>
    </div>
    <div
      v-if="paletteOpen"
      class="palette-backdrop"
      @pointerdown.self="closePalette"
    >
      <div
        class="palette"
        role="dialog"
        :aria-label="t('Command palette')"
      >
        <label class="palette-input">
          <Command :size="15" />
          <input
            v-model="paletteText"
            :placeholder="t('Type a command, chat or workspace')"
            role="combobox"
            aria-expanded="true"
            @keydown="paletteKey"
          >
        </label>
        <div
          class="palette-results"
          role="listbox"
        >
          <template
            v-for="(item, index) in paletteResults"
            :key="item.id"
          >
            <small
              v-if="index === 0 || paletteResults[index - 1].section !== item.section"
              class="palette-section"
            >{{ item.section }}</small>
            <button
              role="option"
              :class="{ active: index === paletteIndex }"
              :aria-selected="index === paletteIndex"
              @mousemove="paletteIndex = index"
              @click="runPaletteItem(item)"
            >
              <component
                :is="item.icon"
                :size="14"
              /><span>{{ item.label }}</span><kbd v-if="item.hint">{{ item.hint }}</kbd>
            </button>
          </template>
          <p
            v-if="!paletteResults.length"
            class="palette-empty"
          >
            {{ t('Nothing matches.') }}
          </p>
        </div>
      </div>
    </div>
    <SettingsPanel
      v-if="settingsOpen && workspace"
      :key="workspaceId"
      :workspace="workspace"
      :global="state.global"
      :sandbox-detail="state.sandbox.detail"
      @close="settingsOpen = false"
      @saved="refresh"
      @error="report"
    />
    <GlobalSettingsPanel
      v-if="globalSettingsOpen"
      :global="state.global"
      :workspace="workspace"
      :sandbox-detail="state.sandbox.detail"
      :credentials="state.credentials"
      :limits="state.limits"
      :initial-tab="globalSettingsTab"
      @close="globalSettingsOpen = false"
      @saved="refresh"
    />
    <AttachmentPreview
      v-if="attachmentPreview"
      :item="attachmentPreview"
      @close="attachmentPreview = undefined"
    />
    <div
      v-if="folderModal"
      class="modal-backdrop"
      @click.self="folderModal = false"
    >
      <form
        class="small-modal"
        @submit.prevent="perform(openFolder)"
      >
        <header class="modal-header">
          <h2>{{ t('Open a workspace') }}</h2>
          <button
            type="button"
            class="icon-button"
            :aria-label="t('Close folder dialog')"
            @click="folderModal = false"
          >
            <X :size="17" />
          </button>
        </header>
        <p class="muted">
          {{ t('Select the folder where BasedCode should work.') }}
        </p>
        <button
          type="button"
          class="secondary-button full-width"
          @click="pickerMode = 'folder'"
        >
          <FolderOpen :size="15" /> {{ t('Browse folders…') }}
        </button>
        <div
          v-if="recentWorkspaces.length"
          class="recent-workspaces"
        >
          <div class="sidebar-label">
            {{ t('Recent workspaces') }}
          </div>
          <button
            v-for="item in recentWorkspaces"
            :key="item.id"
            type="button"
            :title="item.path"
            @click="perform(() => selectWorkspace(item.id))"
          >
            <FolderOpen :size="15" /><span><strong>{{ item.name }}</strong><small>{{ item.path }}</small></span>
          </button>
        </div>
        <div class="divider-label">
          {{ t('or enter a path') }}
        </div>
        <label>{{ t('Absolute folder path')
        }}<input
          v-model="folderPath"
          autocomplete="off"
          autofocus
          placeholder="C:\Source\my-project or /home/you/project"
        ></label>
        <footer class="modal-footer">
          <button
            type="button"
            class="secondary-button"
            @click="folderModal = false"
          >
            {{ t('Cancel') }}
          </button><button
            class="primary-button"
            :disabled="!folderPath.trim()"
          >
            {{ t('Open workspace') }}
          </button>
        </footer>
      </form>
    </div>
    <div
      v-if="revertModal"
      class="modal-backdrop"
    >
      <section
        class="small-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="revert-title"
      >
        <header class="modal-header">
          <h2 id="revert-title">
            {{ t('Revert this prompt?') }}
          </h2>
          <button
            class="icon-button"
            :aria-label="t('Cancel revert')"
            @click="revertModal = undefined"
          >
            <X :size="17" />
          </button>
        </header>
        <p>
          {{
            t(
              'Restore these files and remove this prompt and later conversation. The selected prompt returns to the composer.',
            )
          }}
        </p>
        <pre class="approval-detail">{{
          revertModal.paths.join('\n') || t('No captured file changes.')
        }}</pre>
        <p
          v-if="revertModal.conflicts.length"
          class="error-box"
        >
          {{
            t('Conflicting edits: {files}. Resolve these before reverting.', {
              files: revertModal.conflicts.join(', '),
            })
          }}
        </p>
        <div
          v-if="revertModal.actions.length"
          class="inline-warning"
        >
          <ShieldAlert :size="16" /><span>{{
            t('{count} action(s) may remain. Their records stay in the Actions list.', {
              count: revertModal.actions.length,
            })
          }}</span>
        </div>
        <p class="muted small">
          {{
            t(
              'Git metadata, generated/dependency files, and external effects are outside automatic restore.',
            )
          }}
        </p>
        <footer class="modal-footer">
          <button
            class="secondary-button"
            @click="revertModal = undefined"
          >
            {{ t('Cancel') }}
          </button><button
            class="primary-button"
            :disabled="Boolean(revertModal.conflicts.length)"
            @click="perform(applyRevert)"
          >
            <RotateCcw :size="13" /> {{ t('Revert files & chat') }}
          </button>
        </footer>
      </section>
    </div>
    <div
      v-if="rewindModal"
      class="modal-backdrop"
    >
      <section
        class="small-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="rewind-title"
      >
        <header class="modal-header">
          <h2 id="rewind-title">
            <Undo2 :size="16" /> {{ t('Rewind to this tool call') }}
          </h2>
          <button
            class="icon-button"
            :aria-label="t('Cancel')"
            @click="rewindModal = undefined"
          >
            <X :size="15" />
          </button>
        </header>
        <p>
          {{
            t(
              'Files go back to how they were just before this call, and this call plus {count} later message(s) are dropped from the chat. Then send a prompt to steer the agent from there.',
              { count: Math.max(0, rewindModal.messages - 1) },
            )
          }}
        </p>
        <pre class="approval-detail">{{ rewindModal.paths.join('\n') || t('No file changes to undo.') }}</pre>
        <p
          v-if="rewindModal.conflicts.length"
          class="error-box"
        >
          {{ t('Conflicting edits: {files}. Resolve these before rewinding.', { files: rewindModal.conflicts.join(', ') }) }}
        </p>
        <div
          v-if="rewindModal.actions.length"
          class="inline-warning"
        >
          {{
            t('{count} external action(s) after this point cannot be undone: {actions}', {
              count: rewindModal.actions.length,
              actions: rewindModal.actions.join(', '),
            })
          }}
        </div>
        <footer class="modal-footer">
          <button
            class="secondary-button"
            @click="rewindModal = undefined"
          >
            {{ t('Cancel') }}
          </button><button
            class="primary-button"
            :disabled="Boolean(rewindModal.conflicts.length)"
            @click="perform(applyRewind)"
          >
            <Undo2 :size="13" /> {{ t('Rewind') }}
          </button>
        </footer>
      </section>
    </div>
    <CompareModal
      v-if="compareId"
      :comparison-id="compareId"
      :version="stateVersion"
      @close="compareId = ''"
      @error="report"
      @open="
        (id) => {
          const target = state.chats.find((item) => item.id === id);
          compareId = '';
          if (target) void perform(() => selectChat(target));
        }
      "
    />
    <div
      v-if="approval"
      class="modal-backdrop approval-backdrop"
    >
      <section
        class="small-modal approval-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="approval-title"
      >
        <div class="approval-icon">
          <ShieldCheck :size="23" />
        </div>
        <h2 id="approval-title">
          {{ approval.title }}
        </h2>
        <pre class="approval-detail">{{ approval.detail }}</pre>
        <label
          v-if="approval.command"
          class="checkbox small"
        ><input
           v-model="rememberCommand"
           type="checkbox"
         >
          {{ t('Always allow this exact command in this workspace') }}</label>
        <footer class="modal-footer">
          <button
            class="secondary-button"
            @click="
              perform(() => rpc('approval.decide', { approvalId: approval!.id, approved: false }))
            "
          >
            {{ t('Deny') }}
          </button><button
            class="primary-button"
            @click="
              perform(() =>
                rpc('approval.decide', {
                  approvalId: approval!.id,
                  approved: true,
                  remember: rememberCommand,
                }),
              )
            "
          >
            <Check :size="14" /> {{ t('Approve') }}
          </button>
        </footer>
      </section>
    </div>
    <FilePicker
      v-if="pickerMode"
      :mode="pickerMode"
      :initial-path="pickerMode === 'folder' ? folderPath || workspace?.path : workspace?.path"
      @close="pickerMode = undefined"
      @pick="(paths) => perform(() => pickPaths(paths))"
    />
    <HandOffDialog
      v-if="handOffChat"
      :chat="handOffChat"
      :initial-mode="handOffMode"
      :app-icon="appIcon"
      @cancel="handOffChat = undefined"
      @hand-off="(choice) => perform(() => handOff(choice))"
    />
    <ConfirmationDialog />
    <AppTooltip />
  </div>
</template>
