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
  Wrench,
  Server,
  Keyboard,
  Globe,
  Plug,
  User,
  Upload,
  Trash2,
  Info,
} from '../../icons';
import {
  defaultRunBudget,
  type ApprovalMode,
  type GlobalSettings,
  type ProviderLimits,
  type Workspace,
} from '../../../shared/types';
import { rpc } from '../../services/api';
import { approvalModes } from '../../state/approvals';
import { confirmAction } from '../../state/dialogs';
import {
  applyAppearance,
  setAppLanguage,
  t,
} from '../../theme/themes';
import ProviderList from './ProviderList.vue';
import AppSelect from '../common/AppSelect.vue';
import RunPolicyFields from './RunPolicyFields.vue';
import UsageDashboard from '../usage/UsageDashboard.vue';
import RemoteAccessPanel from './RemoteAccessPanel.vue';
import SkillManager from './SkillManager.vue';
import LanguageServerPanel from './LanguageServerPanel.vue';
import McpMarketplace from './McpMarketplace.vue';
import AvatarCropper from './AvatarCropper.vue';
import AppInfoPanel from './AppInfoPanel.vue';
import AppearanceSettingsPanel from './AppearanceSettingsPanel.vue';
import KeybindingSettingsPanel from './KeybindingSettingsPanel.vue';

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
  { id: 'models', label: 'Providers', icon: SlidersHorizontal, words: 'model lineup provider fallback order codex claude antigravity ollama lm studio openai endpoint api key credentials' },
  { id: 'agent', label: 'Approvals & context', icon: ShieldCheck, words: 'approval permissions require approval workspace-external commands sandbox compaction context tokens budget notifications phone ntfy' },
  { id: 'appearance', label: 'Appearance', icon: Palette, words: 'theme mode light dark system language flames effects reduced motion palette colors' },
  { id: 'keybindings', label: 'Keybindings', icon: Keyboard, words: 'keyboard shortcuts keys bindings command palette ctrl' },
  { id: 'usage', label: 'Usage', icon: BarChart3, words: 'usage cost tokens limits spend dashboard' },
  { id: 'mcp', label: 'MCP servers', icon: Plug, words: 'mcp servers marketplace registry install' },
  { id: 'servers', label: 'Language servers', icon: Server, words: 'language servers lsp typescript vue python json c# roslyn' },
  { id: 'skills', label: 'Skills', icon: Sparkles, words: 'skills instructions slash commands claude codex agents skill.md' },
  { id: 'tools', label: 'Tools', icon: Wrench, words: 'tools enable disable files git browser terminal' },
  { id: 'system', label: 'CLIs & workspaces', icon: TerminalSquare, words: 'cli path executable codex claude cloudflared new workspace defaults' },
  { id: 'remote', label: 'Remote access', icon: Globe, words: 'remote access tunnel phone qr cloudflared' },
  { id: 'info', label: 'Info', icon: Info, words: 'info about version update check github source donate ko-fi support naamloos website' },
];
const {
  query: settingsSearch,
  body: settingsBody,
  visible: visibleSections,
} = useSettingsSearch(sections, tab);

const error = ref('');
const notice = ref('');
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
watch(
  tab,
  (currentTab) => {
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

function close() {
  applyAppearance(props.global.appearance);
  setAppLanguage(props.global.language);
  emit('close');
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
    await rpc('global.settings', { settings: settings.value });
    emit('saved');
    if (closeAfter) emit('close');
    return true;
  } catch (failure) {
    error.value = failure instanceof Error ? failure.message : String(failure);
    return false;
  }
}
/** Provider and language-server lists save as you edit them; the panel's own error line shows what went wrong. */
async function persistSettings() {
  return (await save(false)) ? '' : error.value || t('Settings could not be saved.');
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
            <h3>{{ t('Your providers') }}</h3>
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
              :persist="persistSettings"
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

          <LanguageServerPanel
            v-else-if="tab === 'servers'"
            v-model="settings.languageServers"
            :workspace="workspace"
            :persist="persistSettings"
            @saved="emit('saved')"
          />
          <AppearanceSettingsPanel
            v-else-if="tab === 'appearance'"
            v-model="settings"
          />

          <KeybindingSettingsPanel
            v-else-if="tab === 'keybindings'"
            v-model="settings.keybindings"
          />

          <UsageDashboard
            v-else-if="tab === 'usage'"
            :limits="limits"
            :providers="global.providers"
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

          <AppInfoPanel v-else-if="tab === 'info'" />

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
