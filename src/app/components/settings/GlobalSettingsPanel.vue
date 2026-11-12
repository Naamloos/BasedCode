<script setup lang="ts">
import { computed, ref, toRaw, watch } from 'vue';
import { useSettingsSearch, type SettingsSection } from '../../state/settingsSearch';
import {
  X,
  TerminalSquare,
  FolderPlus,
  Sparkles,
  SlidersHorizontal,
  ShieldCheck,
  BarChart3,
  Palette,
  Check,
  Wrench,
  Server,
  Plus,
  LoaderCircle,
  Keyboard,
  RotateCcw,
  Globe,
  Plug,
  User,
  Upload,
  Trash2,
  Info,
  Coins,
  ExternalLink,
} from '../../icons';
import {
  comboFromEvent,
  keybindingActions,
  resolveKeybindings,
  type KeybindingAction,
} from '../../state/keybindings';
import {
  defaultRunBudget,
  type AppLanguage,
  type ApprovalMode,
  type GlobalSettings,
  type LanguageConfig,
  type LanguageServerStatus,
  type ProviderLimits,
  type Workspace,
} from '../../../shared/types';
import { rpc } from '../../services/api';
import { effectsEnabled } from '../../theme/effects';
import { approvalModes } from '../../state/approvals';
import { confirmAction } from '../../state/dialogs';
import {
  activeSlot,
  availableThemes,
  applyAppearance,
  flamePalettes,
  setAppLanguage,
  t,
  themes,
} from '../../theme/themes';
import type { CustomTheme, ThemeMode } from '../../../shared/types';
import ProviderList from './ProviderList.vue';
import ThemeEditorDialog from './ThemeEditorDialog.vue';
import AppSelect from '../common/AppSelect.vue';
import RunPolicyFields from './RunPolicyFields.vue';
import UsageDashboard from '../usage/UsageDashboard.vue';
import RemoteAccessPanel from './RemoteAccessPanel.vue';
import SkillManager from './SkillManager.vue';
import McpMarketplace from './McpMarketplace.vue';
import AvatarCropper from './AvatarCropper.vue';
import packageJson from '../../../../package.json';

const props = defineProps<{
  global: GlobalSettings;
  workspace?: Workspace;
  sandboxDetail: string;
  credentials: { saved: string[]; storage: { available: boolean; detail: string } };
  limits: ProviderLimits[];
  initialTab?: string;
}>();
const emit = defineEmits<{ close: []; saved: [] }>();
const settings = ref<GlobalSettings>(structuredClone(toRaw(props.global)));
// Edited in place; always present while the panel is open so the form can bind to it.
settings.value.notifications ??= {
  enabled: false,
  url: '',
  format: 'ntfy',
  approvals: true,
  finished: true,
};
const notifications = computed(() => settings.value.notifications!);
const notifyStatus = ref('');
async function testNotification() {
  notifyStatus.value = t('Sending…');
  try {
    await rpc('global.settings', { settings: settings.value });
    await rpc('notifications.test');
    notifyStatus.value = t('Sent. Check your phone.');
  } catch (error) {
    notifyStatus.value = error instanceof Error ? error.message : String(error);
  }
}
// Show the built-in budget as editable values; saving it stores what is shown.
settings.value.budget ??= { ...defaultRunBudget };
setAppLanguage(settings.value.language);
watch(() => settings.value.language, setAppLanguage);
function setLanguage(value: string): void {
  settings.value.language = value as AppLanguage;
}
settings.value.profile ??= {};
const profile = computed(() => settings.value.profile!);
const cropSource = ref('');
function pickAvatar(event: Event) {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = '';
  if (!file) return;
  if (cropSource.value) URL.revokeObjectURL(cropSource.value);
  cropSource.value = URL.createObjectURL(file);
}
function finishCrop(dataUrl?: string) {
  if (dataUrl) profile.value.avatar = dataUrl;
  URL.revokeObjectURL(cropSource.value);
  cropSource.value = '';
}
const tab = ref(props.initialTab ?? 'about');

// Section nav. Each section lists the words its settings use, so search can find a setting in any section.
const sections: SettingsSection[] = [
  { id: 'about', label: 'About you', icon: User, words: 'about user name occupation job experience voice tone personalization avatar picture photo profile' },
  { id: 'models', label: 'Models', icon: SlidersHorizontal, words: 'model lineup provider fallback order codex claude antigravity ollama lm studio openai endpoint api key credentials' },
  { id: 'agent', label: 'Approvals & context', icon: ShieldCheck, words: 'approval permissions require approval workspace-external commands sandbox compaction context tokens budget notifications phone ntfy' },
  { id: 'appearance', label: 'Appearance', icon: Palette, words: 'theme mode light dark system language flames effects reduced motion palette colors' },
  { id: 'keybindings', label: 'Keybindings', icon: Keyboard, words: 'keyboard shortcuts keys bindings command palette ctrl' },
  { id: 'usage', label: 'Usage', icon: BarChart3, words: 'usage cost tokens limits spend dashboard' },
  { id: 'mcp', label: 'MCP servers', icon: Plug, words: 'mcp servers marketplace registry install' },
  { id: 'servers', label: 'Language servers', icon: Server, words: 'language servers lsp typescript vue python json c# roslyn' },
  { id: 'skills', label: 'Skills', icon: Sparkles, words: 'skills instructions' },
  { id: 'tools', label: 'Tools', icon: Wrench, words: 'tools enable disable files git browser terminal' },
  { id: 'system', label: 'CLIs & workspaces', icon: TerminalSquare, words: 'cli path executable codex claude cloudflared new workspace defaults' },
  { id: 'remote', label: 'Remote access', icon: Globe, words: 'remote access tunnel phone qr cloudflared' },
  { id: 'info', label: 'Info', icon: Info, words: 'info about version update check github source donate ko-fi support naamloos website' },
];
const appVersion = ref('');
const checkingUpdate = ref(false);
const updateAvailable = ref(false);
const installingUpdate = ref(false);
async function installUpdate() {
  if (installingUpdate.value) return;
  installingUpdate.value = true;
  try {
    await rpc('update.install');
  } catch (error) {
    updateStatus.value = error instanceof Error ? error.message : String(error);
    installingUpdate.value = false;
  }
}
const updateStatus = ref('');
async function checkForUpdates() {
  if (checkingUpdate.value) return;
  checkingUpdate.value = true;
  updateStatus.value = '';
  try {
    const info = await rpc<{ current: string; supported: boolean; available: boolean; latest?: string; error?: string }>('update.check');
    appVersion.value = info.current;
    updateAvailable.value = info.supported && info.available && !info.error;
    updateStatus.value = info.error || (!info.supported
      ? t('Automatic updates are only available in the installed Windows app.')
      : info.available
        ? t('Version {version} is available.', { version: info.latest ?? '' })
        : t('You are up to date.'));
  } catch (error) {
    updateStatus.value = error instanceof Error ? error.message : String(error);
  } finally {
    checkingUpdate.value = false;
  }
}
const appIcon = new URL('../../assets/icon.png', import.meta.url).href;
rpc<{ current: string }>('update.check')
  .then((info) => (appVersion.value = info.current))
  .catch(() => (appVersion.value = '?'));
const infoLinks = [
  { label: 'BasedCode on GitHub', url: 'https://github.com/naamloos/basedcode', icon: ExternalLink },
  { label: 'Donate (Ko-fi)', url: 'https://ko-fi.com/naamloos', icon: Coins },
  { label: 'Main Developer', url: 'https://naamloos.dev', icon: Globe },
  { label: 'License', url: 'https://github.com/naamloos/basedcode/blob/HEAD/LICENSE', icon: ExternalLink },
];
function openLink(url: string) {
  void rpc('external.open', { url });
}
// Credits come straight from package.json, so they stay current as dependencies change.
// Versions are the ranges package.json asks for, shown without the ^/~ prefix.
function creditList(packages: Record<string, string>) {
  return Object.entries(packages)
    .map(([name, range]) => ({ name, version: range.replace(/^[\^~]/, '') }))
    .sort((a, b) => a.name.localeCompare(b.name));
}
const creditGroups = [
  { title: 'Used by the app', packages: creditList(packageJson.dependencies) },
  { title: 'Development tools', packages: creditList(packageJson.devDependencies) },
];
const {
  query: settingsSearch,
  body: settingsBody,
  visible: visibleSections,
} = useSettingsSearch(sections, tab);

const error = ref('');
const notice = ref('');
const languageJson = ref(JSON.stringify(settings.value.languageServers, null, 2));
const languageServers = ref<LanguageServerStatus[]>([]);
const toolCatalog = ref<{ name: string; description: string }[]>([]);
const toolFilter = ref('');
/** Display groups for the tools tab, matched by name; anything unmatched lands in "Other". */
const toolCategories: { name: string; match: (tool: string) => boolean }[] = [
  {
    name: 'Files',
    match: (tool) =>
      [
        'file_info',
        'list_files',
        'make_directory',
        'delete_directory',
        'view_image',
        'read_file',
        'read_files',
        'search',
        'find_files',
        'file_outline',
        'write_file',
        'apply_patch',
        'edit_lines',
        'move_file',
        'delete_file',
      ].includes(tool),
  },
  {
    name: 'Terminal & checks',
    match: (tool) =>
      ['run_command', 'run_checks', 'stop_terminal'].includes(tool) || tool.startsWith('terminal_'),
  },
  { name: 'Git', match: (tool) => tool === 'git' || tool.startsWith('git_') },
  { name: 'Language servers', match: (tool) => tool.startsWith('language_') },
  { name: 'MCP & installs', match: (tool) => tool.includes('mcp') || tool === 'install_server' },
  { name: 'Web', match: (tool) => tool.startsWith('web_') },
  { name: 'Planning', match: (tool) => tool === 'update_plan' },
];
const toolGroups = computed(() => {
  const query = toolFilter.value.trim().toLowerCase();
  const visible = toolCatalog.value.filter(
    (tool) => !query || tool.name.includes(query) || tool.description.toLowerCase().includes(query),
  );
  const groups = toolCategories.map((category) => ({
    name: category.name,
    tools: visible.filter((tool) => category.match(tool.name)),
  }));
  const other = visible.filter(
    (tool) => !toolCategories.some((category) => category.match(tool.name)),
  );
  return [...groups, { name: 'Other', tools: other }].filter((group) => group.tools.length);
});
const enabledToolCount = computed(
  () =>
    toolCatalog.value.filter((tool) => !settings.value.disabledTools?.includes(tool.name)).length,
);
function toolEnabled(name: string) {
  return !settings.value.disabledTools?.includes(name);
}
function setTools(names: string[], enabled: boolean) {
  const others = (settings.value.disabledTools ?? []).filter((name) => !names.includes(name));
  settings.value.disabledTools = enabled ? others : [...others, ...names];
}
const languageBusy = ref(false);
const settingUpLanguage = ref('');
const languageProgress = ref('');
const languageSetup = [
  {
    name: 'C# / Roslyn',
    languages: 'csharp',
    install: 'dotnet tool install --global roslyn-language-server --prerelease',
    command: 'roslyn-language-server',
    args: ['--stdio', '--autoLoadProjects'],
    detail:
      'Requires the .NET 10 runtime or later and the SDK needed by your project. Automatic project loading opens your solution or discovers .csproj files. Global .NET tools are also detected outside PATH.',
    docs: 'https://github.com/dotnet/roslyn/blob/main/src/LanguageServer/roslyn-language-server/README.md',
  },
  {
    name: 'TypeScript / JavaScript',
    languages: 'typescript, javascript, typescriptreact, javascriptreact',
    install: 'npm install -g typescript-language-server typescript',
    command: 'typescript-language-server',
    args: ['--stdio'],
    detail:
      'Requires Node.js and npm. Both the server and TypeScript must be installed. Workspace packages are discovered automatically; keep tsconfig.json or jsconfig.json in your project.',
    docs: 'https://github.com/typescript-language-server/typescript-language-server',
  },
  {
    name: 'Python',
    languages: 'python',
    install: 'npm install -g pyright',
    command: 'pyright-langserver',
    args: ['--stdio'],
    detail:
      'Requires Node.js and npm for this server. Configure your Python environment in pyrightconfig.json or pyproject.toml when automatic environment detection is insufficient.',
    docs: 'https://github.com/microsoft/pyright',
  },
  {
    name: 'Vue',
    languages: 'vue',
    install: 'Use the Set up button to install the standalone-compatible server and TypeScript.',
    command: 'vue-language-server',
    args: ['--stdio'],
    detail:
      'BasedCode setup installs @vue/language-server 2.2.12 with TypeScript 5 and supplies the TypeScript SDK path. Vue server 3.x needs a separate TypeScript plugin bridge and is not supported by this standalone client.',
    docs: 'https://github.com/vuejs/language-tools',
  },
  {
    name: 'JSON / JSONC',
    languages: 'json, jsonc',
    install: 'npm install -g vscode-langservers-extracted',
    command: 'vscode-json-language-server',
    args: ['--stdio'],
    detail:
      'Requires Node.js and npm. The package provides several servers; use the JSON executable shown here.',
    docs: 'https://github.com/hrsh7th/vscode-langservers-extracted',
  },
];
async function discoverLanguages(persist = true) {
  if (!props.workspace || languageBusy.value) return;
  languageBusy.value = true;
  languageProgress.value = t('Discovering language servers…');
  try {
    if (persist && !(await save(false))) return;
    languageServers.value = await rpc('language.discover', { workspaceId: props.workspace.id });
  } catch (failure) {
    error.value = failure instanceof Error ? failure.message : String(failure);
  } finally {
    languageBusy.value = false;
  }
}
async function setupLanguage(serverId: string) {
  if (!props.workspace || languageBusy.value) return;
  languageBusy.value = true;
  settingUpLanguage.value = serverId;
  languageProgress.value = t('Saving language-server settings…');
  try {
    if (!(await save(false))) return;
    const name =
      languageServers.value.find((server) => server.id === serverId)?.name ?? t('language server');
    languageProgress.value = t(
      'Setting up {name}… Approve the installation if prompted, then wait for it to finish.',
      { name },
    );
    const config = await rpc<LanguageConfig>('language.setup', {
      workspaceId: props.workspace.id,
      serverId,
    });
    settings.value.languageServers = settings.value.languageServers.map((server) =>
      server.id === config.id ? config : server,
    );
    languageJson.value = JSON.stringify(settings.value.languageServers, null, 2);
    languageProgress.value = t('Refreshing discovered servers…');
    languageServers.value = await rpc('language.discover', { workspaceId: props.workspace.id });
    notice.value = t('{name} is ready. The model can start it with language_query.', {
      name: config.name,
    });
    emit('saved');
  } catch (failure) {
    error.value = failure instanceof Error ? failure.message : String(failure);
  } finally {
    languageBusy.value = false;
    settingUpLanguage.value = '';
  }
}
watch(
  [tab, () => props.workspace?.id],
  ([currentTab]) => {
    if (currentTab === 'servers') void discoverLanguages(false);
    if (currentTab === 'tools')
      void rpc<{ name: string; description: string }[]>('tools.catalog')
        .then((items) => (toolCatalog.value = items))
        .catch((failure) => (error.value = String(failure)));
  },
  { immediate: true },
);

// Appearance previews live while the panel is open; Cancel puts the saved look back.
watch(
  () => settings.value.appearance,
  (appearance) => applyAppearance(appearance),
  { deep: true },
);
// Theme picker: two slots, the mode picks which one is live.
const modeOptions: { value: ThemeMode; label: string }[] = [
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
  { value: 'system', label: 'System' },
];
const themeSlot = ref<'dark' | 'light'>(activeSlot(settings.value.appearance));
const themeQuery = ref('');
const allThemes = computed(() => availableThemes(settings.value.appearance));
const editingThemeId = ref('');
const editingTheme = ref<CustomTheme>();
function createTheme() {
  const base = allThemes.value.find((theme) => theme.id === slotTheme.value) ?? themes[0];
  const tokens = { ...base.tokens };
  for (const key of Object.keys(tokens) as (keyof typeof tokens)[]) {
    if (!/^#[0-9a-f]{6}([0-9a-f]{2})?$/i.test(tokens[key])) tokens[key] = themes[0].tokens[key];
  }
  editingThemeId.value = '';
  editingTheme.value = {
    id: 'custom-' + crypto.randomUUID().replaceAll('-', '').slice(0, 32),
    name: base.name.slice(0, 55) + ' copy',
    scheme: base.scheme,
    tokens,
  };
}
const themeMenu = ref<{ id: string; x: number; y: number }>();
function openThemeMenu(event: MouseEvent, id: string) {
  themeMenu.value = { id, x: Math.min(event.clientX, window.innerWidth - 180), y: Math.min(event.clientY, window.innerHeight - 90) };
}
function closeThemeMenu() {
  themeMenu.value = undefined;
}
function editTheme(id = slotTheme.value) {
  closeThemeMenu();
  const theme = settings.value.appearance.customThemes?.find((item) => item.id === id);
  if (!theme) return;
  editingThemeId.value = theme.id;
  editingTheme.value = structuredClone(toRaw(theme));
}
function closeThemeEditor() {
  editingTheme.value = undefined;
  editingThemeId.value = '';
}
function saveTheme(theme: CustomTheme) {
  const appearance = settings.value.appearance;
  appearance.customThemes = [...(appearance.customThemes ?? []).filter((item) => item.id !== theme.id), theme];
  themeQuery.value = '';
  pickTheme(theme.id);
  closeThemeEditor();
}
function deleteTheme(id = editingThemeId.value) {
  closeThemeMenu();
  const appearance = settings.value.appearance;
  appearance.customThemes = appearance.customThemes?.filter((theme) => theme.id !== id);
  if (appearance.theme === id) appearance.theme = 'based';
  if (appearance.lightTheme === id) appearance.lightTheme = 'normie';
  closeThemeEditor();
}
const slotTheme = computed(() =>
  themeSlot.value === 'dark' ? settings.value.appearance.theme : settings.value.appearance.lightTheme,
);
function themeName(id: string) {
  return allThemes.value.find((theme) => theme.id === id)?.name ?? id;
}
function pickTheme(id: string) {
  if (themeSlot.value === 'dark') settings.value.appearance.theme = id;
  else settings.value.appearance.lightTheme = id;
}
const themeGroups = computed(() => {
  const words = themeQuery.value.toLowerCase().split(/\s+/).filter(Boolean);
  const matches = allThemes.value.filter((theme) => {
    const text = `${theme.name} ${theme.tagline} ${theme.id}`.toLowerCase();
    return words.every((word) => text.includes(word));
  });
  return [
    { label: 'BasedCode originals', items: matches.filter((x) => x.origin === 'original' && x.scheme === 'dark') },
    { label: 'Popular ports', items: matches.filter((x) => x.origin === 'port' && x.scheme === 'dark') },
    { label: 'Light', items: matches.filter((x) => x.origin !== 'custom' && x.scheme === 'light') },
    { label: 'Custom themes', items: matches.filter((x) => x.origin === 'custom') },
  ];
});

function close() {
  applyAppearance(props.global.appearance);
  setAppLanguage(props.global.language);
  emit('close');
}

// Shortcuts: click a binding, press the new combo. Escape cancels, Backspace unbinds.
const recording = ref<KeybindingAction | ''>('');
const bindings = computed(() => resolveKeybindings(settings.value.keybindings));
function conflictFor(id: KeybindingAction) {
  const combo = bindings.value[id];
  return combo
    ? keybindingActions.find((action) => action.id !== id && bindings.value[action.id] === combo)
    : undefined;
}
function setBinding(id: KeybindingAction, combo: string) {
  const fallback = keybindingActions.find((action) => action.id === id)?.defaultKey;
  if (combo === fallback) delete settings.value.keybindings[id];
  else settings.value.keybindings[id] = combo;
}
function record(event: KeyboardEvent, id: KeybindingAction) {
  event.preventDefault();
  event.stopPropagation();
  if (event.key === 'Escape') {
    recording.value = '';
    return;
  }
  if (event.key === 'Backspace' || event.key === 'Delete') {
    setBinding(id, '');
    recording.value = '';
    return;
  }
  const combo = comboFromEvent(event);
  if (!combo) return;
  setBinding(id, combo);
  recording.value = '';
}

async function save(closeAfter = true) {
  try {
    error.value = '';
    if (settings.value.appearance.customThemes?.some((theme) =>
      !theme.name.trim() || Object.values(theme.tokens).some((color) => !/^#[0-9a-f]{6}([0-9a-f]{2})?$/i.test(color))
    )) throw new Error('Custom themes need a name and valid hex colors (#RRGGBB or #RRGGBBAA).');
    const newlyDisabled = (settings.value.disabledTools ?? []).filter(
      (name) => !props.global.disabledTools?.includes(name),
    );
    if (
      newlyDisabled.length &&
      !(await confirmAction(
        t('Disable BasedCode tools?'),
        t(
          'The model will no longer be able to use: {tools}. This may prevent it from completing tasks.',
          { tools: newlyDisabled.join(', ') },
        ),
        t('Disable tools'),
      ))
    )
      return false;
    settings.value.languageServers = JSON.parse(languageJson.value);
    await rpc('global.settings', { settings: settings.value });
    emit('saved');
    if (closeAfter) emit('close');
    return true;
  } catch (failure) {
    error.value = failure instanceof Error ? failure.message : String(failure);
    return false;
  }
}
async function useCurrentWorkspace() {
  if (!props.workspace) return;
  const template = structuredClone(toRaw(props.workspace).settings);
  // The template carries checks and editor settings; a workspace's own fallback order stays with that workspace.
  delete template.fallback;
  settings.value.newWorkspace = template;
  await save(false);
  notice.value = t("New workspaces now start with {name}'s checks, editor and approval mode.", {
    name: props.workspace.name,
  });
}
async function resetTemplate() {
  delete settings.value.newWorkspace;
  await save(false);
  notice.value = t('New workspaces now start with the built-in defaults.');
}
</script>

<template>
  <div
    class="modal-backdrop"
    @click.self="close"
  >
    <section
      class="settings-modal"
      role="dialog"
      aria-modal="true"
      aria-labelledby="global-settings-title"
    >
      <header class="modal-header">
        <div>
          <h2 id="global-settings-title">
            {{ t('App settings') }}
          </h2>
        </div>
        <button
          class="icon-button"
          :aria-label="t('Close settings')"
          @click="close"
        >
          <X :size="19" />
        </button>
      </header>
      <div class="settings-layout">
        <nav
          class="settings-tabs"
          :aria-label="t('Settings sections')"
        >
          <input
            v-model="settingsSearch"
            class="settings-search"
            type="search"
            autocomplete="off"
            :placeholder="t('Search settings')"
            :aria-label="t('Search settings')"
          >
          <button
            v-for="section in visibleSections"
            :key="section.id"
            :class="{ active: tab === section.id }"
            :aria-current="tab === section.id ? 'page' : undefined"
            @click="tab = section.id"
          >
            <component
              :is="section.icon"
              :size="16"
            /> {{ t(section.label) }}
          </button>
          <select
            v-if="visibleSections.length"
            class="settings-section-select"
            :value="tab"
            :aria-label="t('Settings sections')"
            @change="tab = ($event.target as HTMLSelectElement).value"
          >
            <option
              v-for="section in visibleSections"
              :key="section.id"
              :value="section.id"
            >
              {{ t(section.label) }}
            </option>
          </select>
          <p
            v-if="!visibleSections.length"
            class="settings-search-empty"
          >
            {{ t('Nothing matches. Try another word?') }}
          </p>
        </nav>
        <div
          ref="settingsBody"
          class="settings-body"
          :class="{ 'settings-body-info': tab === 'info' }"
        >
          <template v-if="tab === 'about'">
            <h3>{{ t('About you') }}</h3>
            <p class="muted">
              {{ t('Tells the agent who it works with. Filled-in fields are added to the system prompt of every chat; the avatar is only shown next to your messages.') }}
            </p>
            <div class="avatar-field">
              <AvatarCropper
                v-if="cropSource"
                :source="cropSource"
                @done="finishCrop"
                @cancel="finishCrop()"
              />
              <template v-else>
                <img
                  v-if="profile.avatar"
                  class="avatar-preview"
                  :src="profile.avatar"
                  alt=""
                >
                <div
                  v-else
                  class="avatar-preview empty"
                >
                  <User :size="28" />
                </div>
                <label class="secondary-button avatar-upload">
                  <Upload :size="15" /> {{ profile.avatar ? t('Change avatar') : t('Add avatar') }}
                  <input
                    type="file"
                    accept="image/png,image/jpeg,image/webp,image/gif"
                    hidden
                    @change="pickAvatar"
                  >
                </label>
                <button
                  v-if="profile.avatar"
                  class="secondary-button"
                  @click="profile.avatar = undefined"
                >
                  <Trash2 :size="15" /> {{ t('Remove') }}
                </button>
              </template>
            </div>
            <label>{{ t('Name') }}
              <input
                v-model="profile.name"
                maxlength="100"
                autocomplete="name"
              >
            </label>
            <label>{{ t('Occupation') }}
              <input
                v-model="profile.occupation"
                maxlength="200"
                :placeholder="t('e.g. Backend developer')"
              >
            </label>
            <label>{{ t('Experience') }}
              <AppSelect
                :model-value="profile.experience ?? ''"
                :options="[
                  { value: '', label: t('Not set') },
                  { value: 'beginner', label: t('Beginner: explain things') },
                  { value: 'intermediate', label: t('Intermediate') },
                  { value: 'expert', label: t('Expert: skip the basics') },
                ]"
                @update:model-value="(value: string) => (profile.experience = value as 'beginner' | 'intermediate' | 'expert' | '')"
              />
            </label>
            <label>{{ t('Voice') }}
              <AppSelect
                :model-value="profile.voice ?? 'based'"
                :options="[
                  { value: 'based', label: t('Based clanker (default)') },
                  { value: 'plain', label: t('Plain and professional') },
                ]"
                @update:model-value="(value: string) => (profile.voice = value as 'based' | 'plain')"
              />
            </label>
            <label>{{ t('Anything else the agent should know') }}
              <textarea
                v-model="profile.about"
                rows="5"
                maxlength="4000"
                :placeholder="t('Preferred stack, conventions, how you like answers…')"
              />
            </label>
          </template>

          <template v-else-if="tab === 'models'">
            <h3>{{ t('Your model lineup') }}</h3>
            <p class="muted">
              {{
                t(
                  'App-wide. Enabled providers run top to bottom; confirmed usage exhaustion moves to the next one and authentication errors pause work. A workspace can reorder or switch off entries in its own settings.',
                )
              }}
            </p>
            <ProviderList
              v-model="settings.providers"
              :saved-ids="global.providers.map((provider) => provider.id)"
              :credential-ids="credentials.saved"
              :storage="credentials.storage"
              :workspace-id="workspace?.id"
              @error="(message) => (error = message)"
              @changed="emit('saved')"
            />
          </template>

          <SkillManager
            v-else-if="tab === 'skills'"
            :workspace="workspace"
          />
          <McpMarketplace
            v-else-if="tab === 'mcp'"
            v-model:settings="settings"
            :workspace="workspace"
            @save="(done) => save(false).then(done)"
            @error="(message) => (error = message)"
          />

          <template v-else-if="tab === 'tools'">
            <h3>{{ t('BasedCode tools') }}</h3>
            <p class="muted">
              {{ t('Choose which tools the model can use. New tools are enabled by default.') }}
            </p>
            <div class="tool-toolbar">
              <input
                v-model="toolFilter"
                type="search"
                autocomplete="off"
                :placeholder="t('Filter tools')"
                :aria-label="t('Filter tools')"
              >
              <span class="muted small">{{
                t('{enabled} of {total} enabled', {
                  enabled: String(enabledToolCount),
                  total: String(toolCatalog.length),
                })
              }}</span>
              <button
                class="secondary-button"
                :disabled="!settings.disabledTools?.length"
                @click="settings.disabledTools = []"
              >
                {{ t('Enable all') }}
              </button>
            </div>
            <label class="checkbox"><input
                                      :checked="settings.deferTools !== false"
                                      type="checkbox"
                                      @change="settings.deferTools = ($event.target as HTMLInputElement).checked"
                                    >
              {{
                t(
                  'Load rarely used tool groups (browser, visuals, design pickers, Git writes, MCP, skills) only when the model asks for them. Saves several thousand tokens on every model request; turn off if a model struggles to reach those tools.',
                )
              }}</label>
            <section
              v-for="group in toolGroups"
              :key="group.name"
              class="tool-option-group"
            >
              <header>
                <h4>{{ t(group.name) }}</h4>
                <span class="muted small">{{ group.tools.filter((tool) => toolEnabled(tool.name)).length }}/{{
                  group.tools.length
                }}</span>
                <span class="spacer" />
                <button
                  class="text-button"
                  @click="
                    setTools(
                      group.tools.map((tool) => tool.name),
                      !group.tools.every((tool) => toolEnabled(tool.name)),
                    )
                  "
                >
                  {{
                    t(
                      group.tools.every((tool) => toolEnabled(tool.name))
                        ? 'Disable group'
                        : 'Enable group',
                    )
                  }}
                </button>
              </header>
              <div class="tool-option-grid">
                <label
                  v-for="tool in group.tools"
                  :key="tool.name"
                  class="tool-option"
                  :class="{ off: !toolEnabled(tool.name) }"
                  :title="tool.description"
                >
                  <span class="tool-option-text">
                    <code>{{ tool.name }}</code>
                    <small>{{ tool.description }}</small>
                  </span>
                  <input
                    class="switch"
                    type="checkbox"
                    role="switch"
                    :checked="toolEnabled(tool.name)"
                    :aria-label="tool.name"
                    @change="setTools([tool.name], ($event.target as HTMLInputElement).checked)"
                  >
                </label>
              </div>
            </section>
            <p
              v-if="toolCatalog.length && !toolGroups.length"
              class="muted"
            >
              {{ t('No tools match this filter.') }}
            </p>
          </template>
          <template v-else-if="tab === 'agent'">
            <h3>{{ t('Default approval mode') }}</h3>
            <p class="muted">
              {{
                t(
                  "Used by every workspace that doesn't pick its own (Workspace settings → Fallback & approvals).",
                )
              }}
            </p>
            <div
              class="choice-list"
              role="radiogroup"
              :aria-label="t('Default approval mode')"
            >
              <label
                v-for="(mode, key) in approvalModes"
                :key="key"
                class="choice"
                :class="{ selected: settings.approvalMode === key }"
              ><input
                v-model="settings.approvalMode"
                autocomplete="off"
                type="radio"
                name="approval-mode"
                :value="key as ApprovalMode"
              ><span><strong>{{ t(mode.name) }}</strong><small class="muted">{{ t(mode.detail) }}</small></span></label>
            </div>
            <div
              v-if="settings.approvalMode === 'allow-all'"
              class="inline-warning"
            >
              <ShieldCheck :size="15" /><span>{{ t('Commands will run without asking, with your full user permissions:') }}
                {{ sandboxDetail }}</span>
            </div>

            <RunPolicyFields
              v-model:command-rules="settings.commandRules"
              v-model:budget="settings.budget"
            />
            <div class="setting-group">
              <label class="setting-row">
                <span class="setting-row-text">
                  <strong>{{ t('Fix failed checks') }}</strong>
                  <small>{{
                    t(
                      'When checks fail at the end of a run, give the failures back to the model for one fix-up round',
                    )
                  }}</small>
                </span>
                <input
                  class="switch"
                  :checked="settings.fixFailedChecks !== false"
                  type="checkbox"
                  @change="settings.fixFailedChecks = ($event.target as HTMLInputElement).checked"
                >
              </label>
              <label class="setting-row">
                <span class="setting-row-text">
                  <strong>{{ t('Guard secrets') }}</strong>
                  <small>{{
                    t(
                      'Ask before a command, fetch, browser or MCP call sends what looks like a secret (API keys, tokens, private keys, .env values) off this machine. This approval is never skipped by the approval mode.',
                    )
                  }}</small>
                </span>
                <input
                  class="switch"
                  :checked="settings.secretGuard !== false"
                  type="checkbox"
                  @change="settings.secretGuard = ($event.target as HTMLInputElement).checked"
                >
              </label>
            </div>
            <p class="muted small">
              {{
                t(
                  "Workspaces use these unless they set their own (Workspace settings). App-wide command rules always apply, together with a workspace's rules.",
                )
              }}
            </p>

            <h3>{{ t('Context compaction') }}</h3>
            <p class="muted">
              {{
                t(
                  'When a conversation gets long, older messages are replaced by a summary written by the active model before the next call. The originals stay in the chat; the model just stops receiving them. Summaries lose detail, and the chat says when one happened. A context-window error always triggers one compaction and a retry.',
                )
              }}
            </p>
            <label class="checkbox"><input
                                      v-model="settings.compaction.enabled"
                                      autocomplete="off"
                                      type="checkbox"
                                    >
              {{ t('Compact automatically') }}</label>
            <label>{{ t('Compact when the prompt passes about') }}
              <div class="input-action">
                <input
                  v-model.number="settings.compaction.thresholdTokens"
                  autocomplete="off"
                  type="number"
                  min="4000"
                  step="1000"
                  :disabled="!settings.compaction.enabled"
                ><span class="muted">{{ t('tokens') }}</span>
              </div></label>
            <p class="muted small">
              {{
                t(
                  "Pick something below your smallest model's context window. 100,000 suits most cloud models; local models often need 8,000–32,000.",
                )
              }}
            </p>
          </template>

          <template v-else-if="tab === 'servers'">
            <h3>{{ t('Language intelligence') }}</h3>
            <p class="muted">
              {{
                t(
                  'Servers are discovered in workspace packages, PATH, and .NET tools. Missing default servers can be installed into BasedCode storage with approval. Starting a server also asks for approval.',
                )
              }}
            </p>
            <button
              type="button"
              class="secondary-button"
              :disabled="!workspace || languageBusy"
              @click="discoverLanguages()"
            >
              {{ t(languageBusy ? 'Working…' : 'Refresh discovered servers') }}
            </button>
            <p
              v-if="languageBusy"
              class="muted"
              role="status"
            >
              {{ languageProgress }}
            </p>
            <div
              v-for="server in languageServers"
              :key="server.id"
              class="provider-card"
            >
              <header>
                <span>{{ server.name }} · {{ t(server.available ? 'Found' : 'Not installed') }}</span><span class="spacer" />
                <button
                  v-if="!server.available && server.canInstall"
                  type="button"
                  class="secondary-button"
                  :disabled="languageBusy"
                  :aria-busy="settingUpLanguage === server.id"
                  @click="setupLanguage(server.id)"
                >
                  <LoaderCircle
                    v-if="settingUpLanguage === server.id"
                    :size="14"
                    class="spin"
                  />{{
                    t(settingUpLanguage === server.id ? 'Setting up…' : 'Set up')
                  }}
                </button>
              </header>
            </div>
            <details class="provider-card">
              <summary>{{ t('Setup guide for common languages') }}</summary>
              <p class="muted">
                {{
                  t(
                    'Discover servers first, then use Set up for missing defaults or install manually with the commands below. Restart BasedCode after changing PATH. For a custom installation, set command to the full executable path and keep each argument as a separate JSON array entry. Setup downloads executable server code into app storage; it does not add project dependencies.',
                  )
                }}
              </p>
              <article
                v-for="guide in languageSetup"
                :key="guide.command"
                class="provider-card"
              >
                <header>
                  <strong>{{ guide.name }}</strong><span class="spacer" /><button
                    type="button"
                    class="text-button"
                    @click="
                      rpc('external.open', { url: guide.docs }).catch(
                        (failure) => (error = String(failure)),
                      )
                    "
                  >
                    {{ t('Documentation') }}
                  </button>
                </header>
                <p class="muted">
                  {{ t(guide.detail) }}
                </p>
                <pre class="catalog-output">{{ t(guide.install) }}</pre>
                <p>
                  <strong>{{ t('Language IDs:') }}</strong> <code>{{ guide.languages }}</code>
                </p>
                <p>
                  <strong>{{ t('Command:') }}</strong> <code>{{ guide.command }}</code>
                </p>
                <p>
                  <strong>{{ t('Arguments:') }}</strong> <code>{{ JSON.stringify(guide.args) }}</code>
                </p>
              </article>
              <p class="muted">
                {{
                  t(
                    'Roslyn loads project files that may execute MSBuild logic. Open only trusted projects. If a server is found but fails to start, check its required runtime and the error in chat.',
                  )
                }}
              </p>
            </details>
            <details class="provider-card">
              <summary>{{ t('Advanced: JSON config') }}</summary>
              <label>{{ t('Language servers · JSON')
              }}<textarea
                v-model="languageJson"
                autocomplete="off"
                class="code-input"
                :disabled="languageBusy"
                rows="16"
                spellcheck="false"
              />
              </label>
            </details>
          </template>
          <template v-else-if="tab === 'appearance'">
            <h3>{{ t('Language') }}</h3>
            <AppSelect
              :model-value="settings.language ?? 'en'"
              :aria-label="t('Language')"
              :options="[
                { value: 'en', label: t('English') },
                { value: 'nl', label: t('Dutch') },
                { value: 'based', label: t('Based') },
              ]"
              @update:model-value="setLanguage"
            />
            <h3>{{ t('Mode') }}</h3>
            <div
              class="seg-control"
              role="radiogroup"
              :aria-label="t('Mode')"
              :style="{ '--seg-count': 3, '--seg-index': modeOptions.findIndex((o) => o.value === settings.appearance.mode) }"
            >
              <button
                v-for="option in modeOptions"
                :key="option.value"
                type="button"
                role="radio"
                :aria-checked="settings.appearance.mode === option.value"
                @click="settings.appearance.mode = option.value"
              >
                {{ t(option.label) }}
              </button>
            </div>
            <h3>{{ t('Theme') }}</h3>
            <div class="theme-editor-actions">
              <button
                type="button"
                class="secondary-button"
                :disabled="(settings.appearance.customThemes?.length ?? 0) >= 100"
                @click="createTheme"
              >
                <Plus :size="14" /> {{ t('Create theme') }}
              </button>
              <button
                v-if="settings.appearance.customThemes?.some((theme) => theme.id === slotTheme)"
                type="button"
                class="secondary-button"
                @click="editTheme()"
              >
                <Palette :size="14" /> {{ t('Edit theme') }}
              </button>
            </div>
            <ThemeEditorDialog
              v-if="editingTheme"
              :theme="editingTheme"
              :existing="!!editingThemeId"
              @close="closeThemeEditor"
              @save="saveTheme"
              @delete="deleteTheme()"
            />
            <div
              class="seg-control"
              role="tablist"
              :aria-label="t('Theme slot')"
              :style="{ '--seg-count': 2, '--seg-index': themeSlot === 'dark' ? 0 : 1 }"
            >
              <button
                type="button"
                role="tab"
                :aria-selected="themeSlot === 'dark'"
                @click="themeSlot = 'dark'"
              >
                {{ t('Dark theme') }} · {{ themeName(settings.appearance.theme) }}
              </button>
              <button
                type="button"
                role="tab"
                :aria-selected="themeSlot === 'light'"
                @click="themeSlot = 'light'"
              >
                {{ t('Light theme') }} · {{ themeName(settings.appearance.lightTheme) }}
              </button>
            </div>
            <input
              v-model="themeQuery"
              class="theme-search"
              type="search"
              autocomplete="off"
              :placeholder="t('Search themes')"
              :aria-label="t('Search themes')"
            >
            <template
              v-for="group in themeGroups"
              :key="group.label"
            >
              <h4
                v-if="group.items.length"
                class="section-label"
              >
                {{ t(group.label) }}
              </h4>
              <div
                v-if="group.items.length"
                class="theme-grid"
              >
                <button
                  v-for="theme in group.items"
                  :key="theme.id"
                  type="button"
                  class="theme-card"
                  :class="{
                    selected: slotTheme === theme.id,
                    rgb: theme.tokens['--accent'].includes('--rgb-hue'),
                  }"
                  :style="{
                    ...theme.tokens,
                    background: theme.tokens['--surface'],
                    color: theme.tokens['--text'],
                  }"
                  :aria-pressed="slotTheme === theme.id"
                  @click="pickTheme(theme.id)"
                  @contextmenu="theme.origin === 'custom' && ($event.preventDefault(), openThemeMenu($event, theme.id))"
                >
                  <span
                    class="theme-preview"
                    :style="{ background: theme.tokens['--bg'] }"
                  >
                    <span
                      class="theme-preview-surface"
                      :style="{ background: theme.tokens['--surface-raised'] }"
                    >
                      <span
                        class="theme-preview-line"
                        :style="{ background: theme.tokens['--text'] }"
                      />
                      <span
                        class="theme-preview-line short"
                        :style="{ background: theme.tokens['--muted'] }"
                      />
                      <span class="theme-preview-foot">
                        <span
                          class="theme-preview-button"
                          :style="{ background: theme.tokens['--accent'] }"
                        />
                        <span
                          class="theme-preview-dot"
                          :style="{ background: theme.tokens['--success'] }"
                        />
                        <span
                          class="theme-preview-dot"
                          :style="{ background: theme.tokens['--danger'] }"
                        />
                      </span>
                    </span>
                  </span>
                  <strong>{{ theme.name }}<Check
                    v-if="slotTheme === theme.id"
                    :size="13"
                  /></strong>
                  <small :style="{ color: theme.tokens['--muted'] }">{{ t(theme.tagline) }}</small>
                </button>
              </div>
            </template>
            <Teleport
              v-if="themeMenu"
              to="body"
            >
              <div
                class="theme-menu-backdrop"
                @click="closeThemeMenu"
                @contextmenu.prevent="closeThemeMenu"
                @keydown.esc="closeThemeMenu"
              />
              <div
                class="chat-menu at-cursor theme-menu"
                role="menu"
                :style="{ left: `${themeMenu.x}px`, top: `${themeMenu.y}px` }"
              >
                <button
                  type="button"
                  role="menuitem"
                  @click="editTheme(themeMenu.id)"
                >
                  <Palette :size="14" /> {{ t('Edit theme') }}
                </button>
                <button
                  type="button"
                  role="menuitem"
                  class="danger"
                  @click="deleteTheme(themeMenu.id)"
                >
                  <Trash2 :size="14" /> {{ t('Delete theme') }}
                </button>
              </div>
            </Teleport>

            <h3><Sparkles :size="15" /> {{ t('Flames') }}</h3>
            <label class="checkbox"><input
                                      v-model="effectsEnabled"
                                      autocomplete="off"
                                      type="checkbox"
                                    >
              {{ t("Flame effects (follows your system's reduced-motion setting)") }}</label>
            <div class="flame-grid">
              <button
                v-for="palette in flamePalettes"
                :key="palette.id"
                type="button"
                class="flame-card"
                :class="{ selected: settings.appearance.flame === palette.id }"
                :aria-pressed="settings.appearance.flame === palette.id"
                @click="settings.appearance.flame = palette.id"
              >
                <span
                  class="flame-swatch"
                  :style="{
                    background: palette.rainbow
                      ? 'linear-gradient(to top, #f00, #ff0, #0f0, #0ff, #00f, #f0f)'
                      : `linear-gradient(to top, ${palette.colors[0]}, ${palette.colors[1]} 40%, ${palette.colors[2]} 75%, ${palette.colors[3]})`,
                  }"
                />{{ t(palette.name) }}
              </button>
            </div>
          </template>

          <template v-else-if="tab === 'keybindings'">
            <h3><Keyboard :size="15" /> {{ t('Keyboard shortcuts') }}</h3>
            <p class="muted">
              {{
                t(
                  'Click a shortcut, then press the new key combination. Escape cancels; Backspace removes the shortcut.',
                )
              }}
            </p>
            <div class="keybinding-list">
              <div
                v-for="action in keybindingActions"
                :key="action.id"
                class="keybinding-row"
              >
                <span>{{ t(action.name)
                }}<small
                  v-if="conflictFor(action.id)"
                  class="error-text"
                >
                  ·
                  {{
                    t('also used by {name}', { name: t(conflictFor(action.id)?.name ?? '') })
                  }}</small></span>
                <button
                  type="button"
                  class="keybinding-key"
                  :class="{ recording: recording === action.id }"
                  :aria-label="t('Change shortcut for {name}', { name: t(action.name) })"
                  @click="recording = action.id"
                  @blur="recording === action.id && (recording = '')"
                  @keydown="recording === action.id && record($event, action.id)"
                >
                  {{
                    recording === action.id ? t('Press keys…') : bindings[action.id] || t('Unbound')
                  }}
                </button><button
                  type="button"
                  class="icon-button"
                  :title="t('Reset to default')"
                  :disabled="!(action.id in settings.keybindings)"
                  @click="delete settings.keybindings[action.id]"
                >
                  <RotateCcw :size="14" />
                </button>
              </div>
            </div>
          </template>

          <UsageDashboard
            v-else-if="tab === 'usage'"
            :limits="limits"
            @refreshed="emit('saved')"
          />

          <template v-else-if="tab === 'remote'">
            <RemoteAccessPanel v-model:cloudflared-path="settings.cloudflaredPath" />
            <h3>{{ t('Push notifications') }}</h3>
            <p class="muted">
              {{
                t(
                  'Get a phone notification when a prompt needs your approval or finishes, so long runs can go unattended. Use an ntfy topic (install the ntfy app and subscribe to the same topic) or any webhook that takes JSON. Only the title and a one-line summary are sent; never file contents or the remote access link.',
                )
              }}
            </p>
            <label class="checkbox"><input
              v-model="notifications.enabled"
              type="checkbox"
            > {{ t('Send notifications') }}</label>
            <label>{{ t('URL') }}
              <input
                v-model.trim="notifications.url"
                type="url"
                placeholder="https://ntfy.sh/your-private-topic"
              >
            </label>
            <label>{{ t('Format') }}
              <AppSelect
                v-model="notifications.format"
                :options="[
                  { value: 'ntfy', label: t('ntfy (plain text, title header)') },
                  { value: 'json', label: t('JSON webhook') },
                  { value: 'discord', label: t('Discord webhook') },
                  { value: 'slack', label: t('Slack incoming webhook') },
                  { value: 'telegram', label: t('Telegram bot (sendMessage URL with chat_id)') },
                  { value: 'gotify', label: t('Gotify (message URL with token)') },
                ]"
              />
            </label>
            <label class="checkbox"><input
              v-model="notifications.approvals"
              type="checkbox"
            > {{ t('When a prompt waits for approval') }}</label>
            <label class="checkbox"><input
              v-model="notifications.finished"
              type="checkbox"
            > {{ t('When a prompt finishes or fails') }}</label>
            <p class="muted small">
              {{ t('Pick a hard-to-guess ntfy topic name: anyone who knows a public topic can read it.') }}
            </p>
            <div>
              <button
                class="secondary-button"
                :disabled="!notifications.url"
                @click="testNotification"
              >
                {{ t('Save and send a test') }}
              </button>
              <span class="muted small"> {{ notifyStatus }}</span>
            </div>
          </template>

          <template v-else-if="tab === 'info'">
            <div class="settings-info">
              <div style="display: flex; flex-direction: column; align-items: center; gap: 10px; text-align: center">
                <img
                  :src="appIcon"
                  alt="BasedCode"
                  width="72"
                  height="72"
                >
                <strong style="font-size: 1.3em">BasedCode</strong>
                <span class="muted">{{ t('Version') }} {{ appVersion || '…' }}</span>
                <button
                  class="secondary-button"
                  :disabled="checkingUpdate || installingUpdate"
                  @click="checkForUpdates"
                >
                  <LoaderCircle
                    v-if="checkingUpdate"
                    :size="14"
                  />
                  {{ checkingUpdate ? t('Checking for updates…') : t('Check for updates') }}
                </button>
                <button
                  v-if="updateAvailable"
                  class="secondary-button"
                  :disabled="installingUpdate || checkingUpdate"
                  @click="installUpdate"
                >
                  {{ installingUpdate ? t('Updating…') : t('Install update and restart') }}
                </button>
                <span
                  v-if="updateStatus"
                  class="muted small"
                  role="status"
                >{{ updateStatus }}</span>
              </div>
              <div
                style="display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; width: min(100%, 380px); margin: 20px auto 0"
              >
                <button
                  v-for="link in infoLinks"
                  :key="link.url"
                  class="secondary-button"
                  style="justify-content: center"
                  :title="link.url"
                  @click="openLink(link.url)"
                >
                  <component
                    :is="link.icon"
                    :size="14"
                  /> {{ t(link.label) }}
                </button>
              </div>
              <div class="package-credits">
                <h4>{{ t('Built with') }}</h4>
                <p class="muted small">
                  {{ t('BasedCode stands on these open source packages.') }}
                </p>
                <section
                  v-for="group in creditGroups"
                  :key="group.title"
                  class="package-credit-group"
                >
                  <h5>{{ t(group.title) }} <span class="muted">({{ group.packages.length }})</span></h5>
                  <ul class="package-credit-list">
                    <li
                      v-for="item in group.packages"
                      :key="item.name"
                    >
                      <button
                        class="package-credit"
                        :title="`https://www.npmjs.com/package/${item.name}`"
                        @click="openLink(`https://www.npmjs.com/package/${item.name}`)"
                      >
                        {{ item.name }}
                      </button>
                      <span class="package-credit-version">{{ item.version }}</span>
                    </li>
                  </ul>
                </section>
              </div>
            </div>
          </template>

          <template v-else>
            <h3><TerminalSquare :size="15" /> {{ t('Agent CLIs') }}</h3>
            <p class="muted">
              {{
                t(
                  'Codex and Claude Code run through their installed CLIs and your existing sign-in. Leave a path empty to use the one on PATH (Codex) or the copy bundled with the Claude Agent SDK.',
                )
              }}
            </p>
            <div class="form-grid">
              <label class="full-width">{{ t('Codex executable')
              }}<input
                v-model="settings.codexPath"
                autocomplete="off"
                placeholder="codex"
                spellcheck="false"
              ></label>
              <label class="full-width">{{ t('Claude Code executable')
              }}<input
                v-model="settings.claudePath"
                autocomplete="off"
                placeholder="claude"
                spellcheck="false"
              ></label>
              <label class="full-width">{{ t('Antigravity executable')
              }}<input
                v-model="settings.antigravityPath"
                autocomplete="off"
                placeholder="agy"
                spellcheck="false"
              ></label>
            </div>

            <h3><FolderPlus :size="15" /> {{ t('New workspaces') }}</h3>
            <p class="muted">
              {{
                t(
                  settings.newWorkspace
                    ? 'New folders start from a saved template of checks, editor and approval mode.'
                    : 'New folders start with the built-in defaults: no checks, VS Code as the editor, and the app approval mode.',
                )
              }}
              {{
                t(
                  'Models always come from the app lineup. Existing workspaces keep their own settings.',
                )
              }}
            </p>
            <div class="row">
              <button
                class="secondary-button"
                :disabled="!workspace"
                :title="workspace ? '' : t('Open a workspace first')"
                @click="useCurrentWorkspace"
              >
                {{
                  t("Use {name}'s settings", { name: workspace?.name ?? t('current workspace') })
                }}
              </button><button
                class="secondary-button"
                :disabled="!settings.newWorkspace"
                @click="resetTemplate"
              >
                {{ t('Reset to built-in defaults') }}
              </button>
            </div>
            <p
              v-if="notice"
              class="muted"
            >
              {{ notice }}
            </p>
          </template>
        </div>
      </div>
      <footer class="modal-footer">
        <span :class="error ? 'error-text' : 'muted small'">{{
          error || t('Settings apply to every workspace.')
        }}</span><button
          class="secondary-button"
          @click="close"
        >
          {{ t('Cancel') }}
        </button><button
          class="primary-button"
          @click="save()"
        >
          {{ t('Save') }}
        </button>
      </footer>
    </section>
  </div>
</template>
