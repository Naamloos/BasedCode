<script setup lang="ts">
import { computed, ref, toRaw, watch } from 'vue';
import {
  Check,
  Copy,
  ExternalLink,
  LoaderCircle,
  Pencil,
  Plus,
  RefreshCw,
  Trash2,
} from '../../icons';
import type { LanguageConfig, LanguageServerStatus, Workspace } from '../../../shared/types';
import { rpc } from '../../services/api';
import { confirmAction } from '../../state/dialogs';
import { t } from '../../theme/themes';
import FormDialog from '../common/FormDialog.vue';

const servers = defineModel<LanguageConfig[]>({ required: true });
const props = defineProps<{
  workspace?: Workspace;
  /** Saves the settings; resolves to an error message, or '' when saved. */
  persist: () => Promise<string>;
}>();
const emit = defineEmits<{ saved: [] }>();

const npmDetail =
  'Requires Node.js and npm. Use the Set up button to install it into BasedCode storage, or install it yourself with this command.';
/** Known servers: install hints for missing ones and presets for the add dialog. */
const guides = [
  {
    name: 'C# / Roslyn',
    languages: ['csharp'],
    install: 'dotnet tool install --global roslyn-language-server --prerelease',
    command: 'roslyn-language-server',
    args: ['--stdio', '--autoLoadProjects'],
    detail:
      'Requires the .NET 10 runtime or later and the SDK needed by your project. Automatic project loading opens your solution or discovers .csproj files. Global .NET tools are also detected outside PATH.',
    docs: 'https://github.com/dotnet/roslyn/blob/main/src/LanguageServer/roslyn-language-server/README.md',
  },
  {
    name: 'TypeScript / JavaScript',
    languages: ['typescript', 'javascript', 'typescriptreact', 'javascriptreact'],
    install: 'npm install -g typescript-language-server typescript',
    command: 'typescript-language-server',
    args: ['--stdio'],
    detail:
      'Requires Node.js and npm. Both the server and TypeScript must be installed. Workspace packages are discovered automatically; keep tsconfig.json or jsconfig.json in your project.',
    docs: 'https://github.com/typescript-language-server/typescript-language-server',
  },
  {
    name: 'Python',
    languages: ['python'],
    install: 'npm install -g pyright',
    command: 'pyright-langserver',
    args: ['--stdio'],
    detail:
      'Requires Node.js and npm for this server. Configure your Python environment in pyrightconfig.json or pyproject.toml when automatic environment detection is insufficient.',
    docs: 'https://github.com/microsoft/pyright',
  },
  {
    name: 'Vue',
    languages: ['vue'],
    install: '',
    command: 'vue-language-server',
    args: ['--stdio'],
    detail:
      'BasedCode setup installs @vue/language-server 2.2.12 with TypeScript 5 and supplies the TypeScript SDK path. Vue server 3.x needs a separate TypeScript plugin bridge and is not supported by this standalone client.',
    docs: 'https://github.com/vuejs/language-tools',
  },
  {
    name: 'JSON / JSONC',
    languages: ['json', 'jsonc'],
    install: 'npm install -g vscode-langservers-extracted',
    command: 'vscode-json-language-server',
    args: ['--stdio'],
    detail:
      'Requires Node.js and npm. The package provides several servers; use the JSON executable shown here.',
    docs: 'https://github.com/hrsh7th/vscode-langservers-extracted',
  },
  {
    name: 'HTML',
    languages: ['html'],
    install: 'npm install -g vscode-langservers-extracted',
    command: 'vscode-html-language-server',
    args: ['--stdio'],
    detail: npmDetail,
    docs: 'https://github.com/hrsh7th/vscode-langservers-extracted',
  },
  {
    name: 'CSS / SCSS / Less',
    languages: ['css', 'scss', 'less'],
    install: 'npm install -g vscode-langservers-extracted',
    command: 'vscode-css-language-server',
    args: ['--stdio'],
    detail: npmDetail,
    docs: 'https://github.com/hrsh7th/vscode-langservers-extracted',
  },
  {
    name: 'YAML',
    languages: ['yaml'],
    install: 'npm install -g yaml-language-server',
    command: 'yaml-language-server',
    args: ['--stdio'],
    detail: npmDetail,
    docs: 'https://github.com/redhat-developer/yaml-language-server',
  },
  {
    name: 'Bash',
    languages: ['shellscript'],
    install: 'npm install -g bash-language-server',
    command: 'bash-language-server',
    args: ['start'],
    detail: npmDetail,
    docs: 'https://github.com/bash-lsp/bash-language-server',
  },
  {
    name: 'Dockerfile',
    languages: ['dockerfile'],
    install: 'npm install -g dockerfile-language-server-nodejs',
    command: 'docker-langserver',
    args: ['--stdio'],
    detail: npmDetail,
    docs: 'https://github.com/rcjsuen/dockerfile-language-server',
  },
  {
    name: 'Go',
    languages: ['go'],
    install: 'go install golang.org/x/tools/gopls@latest',
    command: 'gopls',
    args: [],
    detail:
      'Requires the Go toolchain. This command installs gopls into your Go bin folder, which BasedCode also checks outside PATH.',
    docs: 'https://go.dev/gopls/',
  },
  {
    name: 'Rust',
    languages: ['rust'],
    install: 'rustup component add rust-analyzer',
    command: 'rust-analyzer',
    args: [],
    detail:
      'Requires rustup. This command installs rust-analyzer for the active toolchain; BasedCode also checks the Cargo bin folder outside PATH.',
    docs: 'https://rust-analyzer.github.io/',
  },
  {
    name: 'C / C++',
    languages: ['c', 'cpp'],
    install: '',
    command: 'clangd',
    args: [],
    detail:
      'Install clangd with LLVM or your package manager and put it on PATH. It reads compile_commands.json or compile_flags.txt to understand your build.',
    docs: 'https://clangd.llvm.org/installation',
  },
  {
    name: 'Java',
    languages: ['java'],
    install: '',
    command: 'jdtls',
    args: [],
    detail:
      'Requires a recent JDK. Install the Eclipse JDT language server and put its jdtls launcher on PATH.',
    docs: 'https://github.com/eclipse-jdtls/eclipse.jdt.ls',
  },
  {
    name: 'Ruby',
    languages: ['ruby'],
    install: 'gem install ruby-lsp',
    command: 'ruby-lsp',
    args: [],
    detail:
      'Requires Ruby. This command installs the ruby-lsp executable; make sure your gem bin folder is on PATH.',
    docs: 'https://shopify.github.io/ruby-lsp/',
  },
  {
    name: 'PHP',
    languages: ['php'],
    install: 'npm install -g intelephense',
    command: 'intelephense',
    args: ['--stdio'],
    detail: 'Requires Node.js and npm. Install it yourself with this command; BasedCode then finds it on PATH.',
    docs: 'https://intelephense.com/',
  },
  {
    name: 'Lua',
    languages: ['lua'],
    install: '',
    command: 'lua-language-server',
    args: [],
    detail: 'Install lua-language-server from its releases page or your package manager and put it on PATH.',
    docs: 'https://luals.github.io/',
  },
];
// Custom installs often use a full path; match on the executable's base name.
const baseName = (command: string) =>
  command.split(/[\\/]/).pop()!.replace(/\.(exe|cmd|bat)$/i, '');
const guideFor = (config: LanguageConfig) =>
  guides.find((guide) => guide.command === baseName(config.command));

const statuses = ref<LanguageServerStatus[]>([]);
const discovering = ref(false);
const busy = ref('');
const progress = ref('');
const error = ref('');
const notice = ref('');
const expanded = ref<string>();
const copied = ref('');
const fail = (failure: unknown) => (error.value = failure instanceof Error ? failure.message : String(failure));

const rows = computed(() =>
  servers.value.map((config) => {
    const status = statuses.value.find((item) => item.id === config.id);
    const state = !status
      ? 'unknown'
      : status.running
        ? 'running'
        : status.available
          ? 'ready'
          : status.canInstall
            ? 'installable'
            : 'missing';
    return { config, status, state, guide: guideFor(config) };
  }),
);
const stateLabel: Record<string, string> = {
  unknown: 'Not checked',
  running: 'Running',
  ready: 'Ready',
  installable: 'Not installed',
  missing: 'Not found',
};
const readyCount = computed(() => rows.value.filter((row) => row.state === 'ready' || row.state === 'running').length);

async function discover() {
  const workspace = props.workspace;
  if (!workspace || discovering.value) return;
  discovering.value = true;
  try {
    const result = await rpc<LanguageServerStatus[]>('language.discover', { workspaceId: workspace.id });
    if (props.workspace?.id === workspace.id) statuses.value = result;
  } catch (failure) {
    fail(failure);
  } finally {
    discovering.value = false;
  }
}
watch(() => props.workspace?.id, () => {
  statuses.value = [];
  void discover();
}, { immediate: true });

async function saveNow() {
  const message = await props.persist();
  if (message) error.value = message;
  return !message;
}

async function setup(config: LanguageConfig) {
  if (!props.workspace || busy.value) return;
  busy.value = config.id;
  error.value = notice.value = '';
  progress.value = t('Setting up {name}… Approve the installation if prompted, then wait for it to finish.', {
    name: config.name,
  });
  try {
    const result = await rpc<LanguageConfig>('language.setup', {
      workspaceId: props.workspace.id,
      serverId: config.id,
    });
    servers.value = servers.value.map((server) => (server.id === result.id ? result : server));
    await discover();
    notice.value = t('{name} is ready. The model can start it with language_query.', { name: result.name });
    emit('saved');
  } catch (failure) {
    fail(failure);
  } finally {
    busy.value = '';
    progress.value = '';
  }
}

async function copy(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    copied.value = text;
    setTimeout(() => {
      if (copied.value === text) copied.value = '';
    }, 1500);
  } catch (failure) {
    fail(failure);
  }
}
const openDocs = (url: string) => void rpc('external.open', { url }).catch(fail);

async function remove(config: LanguageConfig) {
  if (!(await confirmAction(t('Remove language server?'), t('{name} is no longer offered to the model.', { name: config.name }), t('Remove'))))
    return false;
  servers.value = servers.value.filter((server) => server.id !== config.id);
  if (await saveNow()) await discover();
  return true;
}

// Add/edit dialog over a text form: languages comma-separated, one argument per line.
interface Draft {
  originalId?: string;
  name: string;
  languages: string;
  command: string;
  args: string;
}
const draft = ref<Draft>();
const saving = ref(false);
const dialogError = ref('');
const slug = (name: string) =>
  name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'server';
const parsedDraft = computed<LanguageConfig | undefined>(() => {
  const value = draft.value;
  if (!value) return undefined;
  const languages = value.languages.split(/[\s,]+/).filter(Boolean);
  if (!value.name.trim() || !value.command.trim() || !languages.length) return undefined;
  let id = value.originalId ?? slug(value.name);
  for (let n = 2; !value.originalId && servers.value.some((server) => server.id === id); n++) id = `${slug(value.name)}-${n}`;
  return {
    id,
    name: value.name.trim(),
    languages,
    command: value.command.trim(),
    args: value.args.split(/\r?\n/).map((arg) => arg.trim()).filter(Boolean),
  };
});
const presets = computed(() =>
  guides.filter((guide) => !servers.value.some((server) => baseName(server.command) === guide.command)),
);
function openAdd() {
  dialogError.value = '';
  draft.value = { name: '', languages: '', command: '', args: '--stdio' };
}
function usePreset(guide: (typeof guides)[number]) {
  draft.value = { name: guide.name, languages: guide.languages.join(', '), command: guide.command, args: guide.args.join('\n') };
}
function openEdit(config: LanguageConfig) {
  dialogError.value = '';
  draft.value = {
    originalId: config.id,
    name: config.name,
    languages: config.languages.join(', '),
    command: config.command,
    args: config.args.join('\n'),
  };
}
async function closeDialog() {
  if (!saving.value) draft.value = undefined;
}
async function apply() {
  const config = parsedDraft.value;
  if (!config || saving.value) return;
  saving.value = true;
  dialogError.value = '';
  const previous = servers.value.slice();
  servers.value = draft.value?.originalId
    ? servers.value.map((server) => (server.id === config.id ? config : server))
    : [...servers.value, config];
  try {
    const message = await props.persist();
    if (message) {
      servers.value = previous;
      dialogError.value = message;
      return;
    }
    draft.value = undefined;
    await discover();
  } finally {
    saving.value = false;
  }
}
async function removeDraft() {
  const config = servers.value.find((server) => server.id === draft.value?.originalId);
  if (config && (await remove(config))) draft.value = undefined;
}

// Advanced: the raw list as JSON, applied explicitly so a half-typed edit never breaks the form.
const json = ref('');
const jsonError = ref('');
watch(servers, (value) => (json.value = JSON.stringify(value, null, 2)), { immediate: true, deep: true });
async function applyJson() {
  jsonError.value = '';
  let parsed: unknown;
  try {
    parsed = JSON.parse(json.value);
  } catch (failure) {
    jsonError.value = failure instanceof Error ? failure.message : String(failure);
    return;
  }
  const valid =
    Array.isArray(parsed) &&
    parsed.every(
      (item) =>
        item &&
        typeof item.id === 'string' &&
        typeof item.name === 'string' &&
        typeof item.command === 'string' &&
        Array.isArray(item.languages) &&
        item.languages.every((language: unknown) => typeof language === 'string') &&
        Array.isArray(item.args) &&
        item.args.every((arg: unknown) => typeof arg === 'string'),
    ) &&
    new Set(parsed.map((item: LanguageConfig) => item.id)).size === parsed.length;
  if (!valid) {
    jsonError.value = t('Expected an array of { id, name, languages[], command, args[] } with unique IDs.');
    return;
  }
  const previous = structuredClone(toRaw(servers.value));
  servers.value = parsed as LanguageConfig[];
  if (await saveNow()) {
    notice.value = t('Language-server settings saved.');
    await discover();
  } else servers.value = previous;
}
</script>

<template>
  <h3>{{ t('Language intelligence') }}</h3>
  <p class="muted">
    {{
      t(
        'Language servers give the model diagnostics, go-to-definition, references and rename. They are discovered in workspace packages, PATH and .NET tools. Missing default servers can be installed into BasedCode storage with approval; starting a server also asks for approval.',
      )
    }}
  </p>
  <div class="lsp-toolbar">
    <span
      v-if="workspace && statuses.length"
      class="muted small"
    >{{ t('{ready} of {total} ready in {workspace}', { ready: readyCount, total: servers.length, workspace: workspace.name }) }}</span>
    <span
      v-else-if="!workspace"
      class="muted small"
    >{{ t('Open a workspace to check which servers are installed.') }}</span>
    <span class="spacer" />
    <button
      type="button"
      class="icon-button"
      :title="t('Check again')"
      :aria-label="t('Check again')"
      :disabled="!workspace || discovering || !!busy"
      @click="discover"
    >
      <RefreshCw
        :size="14"
        :class="{ spin: discovering }"
      />
    </button>
    <button
      type="button"
      class="primary-button"
      @click="openAdd"
    >
      <Plus :size="14" /> {{ t('Add server') }}
    </button>
  </div>
  <p
    v-if="progress"
    class="muted small"
    role="status"
  >
    <LoaderCircle
      :size="13"
      class="spin"
    /> {{ progress }}
  </p>
  <p
    v-if="error"
    class="error-box"
    role="alert"
  >
    {{ error }}
  </p>
  <p
    v-if="notice"
    class="muted small"
    role="status"
  >
    {{ notice }}
  </p>

  <ul class="lsp-list">
    <li
      v-for="row in rows"
      :key="row.config.id"
      class="lsp-card"
    >
      <header>
        <span
          class="lsp-dot"
          :class="row.state"
        />
        <strong
          class="lsp-name"
          :title="row.config.name"
        >{{ row.config.name }}</strong>
        <span
          class="lsp-state"
          :class="row.state"
        >{{ t(stateLabel[row.state]) }}</span>
        <span class="lsp-actions">
          <button
            v-if="row.state === 'installable'"
            type="button"
            class="secondary-button"
            :disabled="!!busy || !workspace"
            :aria-busy="busy === row.config.id"
            @click="setup(row.config)"
          >
            <LoaderCircle
              v-if="busy === row.config.id"
              :size="14"
              class="spin"
            />{{ t(busy === row.config.id ? 'Setting up…' : 'Set up') }}
          </button>
          <button
            v-if="row.guide && row.state !== 'ready' && row.state !== 'running'"
            type="button"
            class="text-button"
            :aria-expanded="expanded === row.config.id"
            @click="expanded = expanded === row.config.id ? undefined : row.config.id"
          >
            {{ t(expanded === row.config.id ? 'Hide help' : 'Install help') }}
          </button>
          <button
            type="button"
            class="icon-button"
            :title="t('Edit server')"
            :aria-label="t('Edit server')"
            @click="openEdit(row.config)"
          >
            <Pencil :size="14" />
          </button>
          <button
            type="button"
            class="icon-button"
            :title="t('Remove server')"
            :aria-label="t('Remove server')"
            @click="remove(row.config)"
          >
            <Trash2 :size="14" />
          </button>
        </span>
      </header>
      <div class="lsp-languages">
        <code
          v-for="language in row.config.languages"
          :key="language"
        >{{ language }}</code>
      </div>
      <p
        class="lsp-command"
        :title="row.status?.resolved ?? [row.config.command, ...row.config.args].join(' ')"
      >
        {{ row.status?.resolved ?? [row.config.command, ...row.config.args].join(' ') }}
      </p>
      <div
        v-if="row.guide && expanded === row.config.id"
        class="lsp-help"
      >
        <p class="muted small">
          {{ t(row.guide.detail) }}
        </p>
        <div
          v-if="row.guide.install"
          class="lsp-install"
        >
          <code>{{ row.guide.install }}</code>
          <button
            type="button"
            class="icon-button"
            :title="t('Copy command')"
            :aria-label="t('Copy command')"
            @click="copy(row.guide.install)"
          >
            <Check
              v-if="copied === row.guide.install"
              :size="14"
            /><Copy
              v-else
              :size="14"
            />
          </button>
        </div>
        <p
          v-else-if="row.guide.command === 'vue-language-server'"
          class="muted small"
        >
          {{ t('Use the Set up button to install the standalone-compatible server and TypeScript.') }}
        </p>
        <button
          type="button"
          class="text-button"
          @click="openDocs(row.guide.docs)"
        >
          <ExternalLink :size="12" /> {{ t('Documentation') }}
        </button>
      </div>
    </li>
  </ul>
  <p
    v-if="!servers.length"
    class="lsp-empty muted"
  >
    {{ t('No language servers configured. Add one to give the model code intelligence.') }}
  </p>
  <p class="muted small">
    {{
      t(
        'Restart BasedCode after changing PATH. Roslyn loads project files that may execute MSBuild logic, so open only trusted projects. If a server is found but fails to start, check its required runtime and the error in chat.',
      )
    }}
  </p>

  <details class="provider-card">
    <summary>{{ t('Advanced: JSON config') }}</summary>
    <textarea
      v-model="json"
      class="code-input lsp-json"
      autocomplete="off"
      rows="14"
      spellcheck="false"
      :aria-label="t('Language servers · JSON')"
    />
    <p
      v-if="jsonError"
      class="error-box"
      role="alert"
    >
      {{ jsonError }}
    </p>
    <div class="lsp-toolbar">
      <span class="spacer" />
      <button
        type="button"
        class="secondary-button"
        @click="json = JSON.stringify(servers, null, 2); jsonError = ''"
      >
        {{ t('Revert') }}
      </button>
      <button
        type="button"
        class="primary-button"
        @click="applyJson"
      >
        {{ t('Apply JSON') }}
      </button>
    </div>
  </details>

  <FormDialog
    v-if="draft"
    :title="draft.originalId ? t('Edit {name}', { name: draft.name || t('server') }) : t('Add language server')"
    @close="closeDialog"
    @submit="apply"
  >
    <div
      v-if="!draft.originalId && presets.length"
      class="lsp-presets"
    >
      <span class="muted small">{{ t('Start from a preset') }}</span>
      <button
        v-for="guide in presets"
        :key="guide.command"
        type="button"
        class="secondary-button"
        @click="usePreset(guide)"
      >
        {{ guide.name }}
      </button>
    </div>
    <label>{{ t('Name') }}
      <input
        v-model="draft.name"
        maxlength="80"
        autocomplete="off"
        required
        autofocus
      >
    </label>
    <label>{{ t('Language IDs') }}
      <input
        v-model="draft.languages"
        autocomplete="off"
        spellcheck="false"
        placeholder="typescript, javascript"
        required
      >
      <small class="muted">{{ t('Comma-separated LSP language IDs this server handles.') }}</small>
    </label>
    <label>{{ t('Command') }}
      <input
        v-model="draft.command"
        autocomplete="off"
        spellcheck="false"
        placeholder="typescript-language-server"
        required
      >
      <small class="muted">{{ t('An executable on PATH, or its full path for a custom install.') }}</small>
    </label>
    <label>{{ t('Arguments') }}
      <textarea
        v-model="draft.args"
        class="code-input"
        rows="3"
        spellcheck="false"
        placeholder="--stdio"
      />
      <small class="muted">{{ t('One argument per line.') }}</small>
    </label>
    <p
      v-if="dialogError"
      class="error-box"
      role="alert"
    >
      {{ dialogError }}
    </p>
    <template #footer>
      <button
        v-if="draft.originalId"
        type="button"
        class="secondary-button danger-action"
        :disabled="saving"
        @click="removeDraft"
      >
        <Trash2 :size="14" /> {{ t('Remove') }}
      </button>
      <button
        type="button"
        class="secondary-button"
        :disabled="saving"
        @click="closeDialog"
      >
        {{ t('Cancel') }}
      </button>
      <button
        type="submit"
        class="primary-button"
        :disabled="saving || !parsedDraft"
      >
        {{ saving ? t('Saving…') : draft.originalId ? t('Save changes') : t('Add server') }}
      </button>
    </template>
  </FormDialog>
</template>

<style scoped>
.lsp-toolbar {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 12px 0;
}
.lsp-list {
  list-style: none;
  margin: 0 0 12px;
  padding: 0;
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: 8px;
}
/* min-width: 0 lets the nowrap command line ellipsize instead of widening the card. */
.lsp-card {
  min-width: 0;
  padding: 10px 12px;
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  background: var(--bg);
}
.lsp-card > header {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px 8px;
  min-width: 0;
}
.lsp-name {
  flex: 0 1 auto;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.lsp-actions {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  flex-shrink: 0;
  margin-inline-start: auto;
}
.lsp-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  flex-shrink: 0;
  background: var(--faint);
}
.lsp-dot.ready,
.lsp-dot.running {
  background: var(--success);
}
.lsp-dot.installable {
  background: var(--accent);
}
.lsp-dot.missing {
  background: var(--danger);
}
.lsp-state {
  flex-shrink: 0;
  white-space: nowrap;
  padding: 1px 7px;
  border-radius: 999px;
  background: var(--tint-hover);
  color: var(--muted);
  font-size: var(--fs-xs);
}
.lsp-state.ready,
.lsp-state.running {
  background: color-mix(in srgb, var(--success) 14%, transparent);
  color: var(--success);
}
.lsp-state.installable {
  background: var(--accent-soft);
  color: var(--accent);
}
.lsp-state.missing {
  background: color-mix(in srgb, var(--danger) 12%, transparent);
  color: var(--danger);
}
.lsp-languages {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  margin: 8px 0 4px 16px;
}
.lsp-languages code {
  padding: 1px 6px;
  border-radius: var(--radius-sm);
  background: var(--surface-raised);
  font-size: var(--fs-xs);
}
.lsp-command {
  margin: 4px 0 0 16px;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-family: var(--mono);
  font-size: var(--fs-xs);
  color: var(--faint);
}
.lsp-help {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: 8px;
  justify-items: start;
  margin: 10px 0 0 16px;
  padding-top: 10px;
  border-top: 1px solid var(--border);
}
.lsp-help p {
  margin: 0;
}
.lsp-install {
  display: flex;
  align-items: center;
  gap: 6px;
  box-sizing: border-box;
  width: 100%;
  min-width: 0;
  padding: 6px 6px 6px 10px;
  border-radius: var(--radius-sm);
  background: var(--surface-raised);
}
.lsp-install code {
  flex: 1;
  min-width: 0;
  overflow-x: auto;
  white-space: nowrap;
  font-size: var(--fs-xs);
}
.lsp-empty {
  padding: 18px;
  border: 1px dashed var(--border);
  border-radius: var(--radius);
  text-align: center;
}
.lsp-json {
  width: 100%;
  box-sizing: border-box;
  margin-top: 10px;
}
.lsp-presets {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
}
</style>
