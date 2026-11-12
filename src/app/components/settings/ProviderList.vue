<script setup lang="ts">
import { computed, ref, toRaw, watch } from 'vue';
import {
  Plus,
  Trash2,
  KeyRound,
  RefreshCw,
  ShieldAlert,
  Check,
  Pencil,
  GripVertical,
} from '../../icons';
import { kindNames, providerName, type ProviderConfig, type ProviderKind } from '../../../shared/types';
import { rpc } from '../../services/api';
import { confirmAction } from '../../state/dialogs';
import AppSelect from '../common/AppSelect.vue';
import FormDialog from '../common/FormDialog.vue';
import { t } from '../../theme/themes';

// Provider connections are app-wide: one list, one set of credentials, shared by every workspace.
const providers = defineModel<ProviderConfig[]>({ required: true });
const props = defineProps<{
  savedIds: string[];
  credentialIds: string[];
  storage: { available: boolean; detail: string };
  workspaceId?: string;
  /** Saves the settings; resolves to an error message, or '' when saved. */
  persist: () => Promise<string>;
}>();
const emit = defineEmits<{ error: [message: string]; changed: [] }>();
const modelOptions = ref<Record<string, string[]>>({});
const auth = ref<
  Record<
    string,
    { state: 'signed-in' | 'signed-out' | 'unknown'; detail: string; detected: boolean }
  >
>({});
const checkingAuth = ref<Record<string, boolean>>({});
type CliKind = 'codex' | 'claude' | 'antigravity';
const cli = (kind: ProviderKind): kind is CliKind =>
  kind === 'codex' || kind === 'claude' || kind === 'antigravity';
async function checkAuth(kind: ProviderKind) {
  if (!cli(kind) || checkingAuth.value[kind]) return;
  checkingAuth.value[kind] = true;
  try {
    auth.value[kind] = await rpc('provider.auth', { kind });
  } catch {
    auth.value[kind] = {
      state: 'unknown',
      detail: t('Unable to check authentication. Try again.'),
      detected: true,
    };
  } finally {
    checkingAuth.value[kind] = false;
  }
}
watch(
  () => providers.value.map((provider) => provider.kind),
  (kinds) => {
    for (const kind of new Set(kinds)) void checkAuth(kind);
  },
  { immediate: true },
);

const local = (kind: ProviderKind) => kind === 'ollama' || kind === 'lmstudio' || kind === 'openai';
const fail = (failure: unknown) =>
  emit('error', failure instanceof Error ? failure.message : String(failure));
const authText = (kind: ProviderKind) =>
  t(
    checkingAuth.value[kind]
      ? 'Checking sign-in…'
      : auth.value[kind]?.state === 'signed-in'
        ? 'Signed in'
        : auth.value[kind]?.state === 'signed-out'
          ? 'Not signed in'
          : 'Unable to check sign-in',
  );

const kinds: { kind: ProviderKind; detail: string }[] = [
  { kind: 'claude', detail: 'Your Claude subscription through the installed Claude Code CLI' },
  { kind: 'codex', detail: 'Your ChatGPT plan through the installed Codex CLI' },
  { kind: 'antigravity', detail: 'Google models through the installed Antigravity CLI' },
  { kind: 'ollama', detail: 'Local models served by Ollama' },
  { kind: 'lmstudio', detail: 'Local models served by LM Studio' },
  { kind: 'openai', detail: 'Any OpenAI-compatible API: OpenRouter, vLLM, a cloud key…' },
];
const kindOptions = kinds.map((option) => ({ value: option.kind, label: kindNames[option.kind] }));
const defaultEndpoints: Partial<Record<ProviderKind, string>> = {
  ollama: 'http://127.0.0.1:11434/v1',
  lmstudio: 'http://127.0.0.1:1234/v1',
};
const downloads: Record<CliKind, { url: string; name: string }> = {
  claude: { url: 'https://docs.anthropic.com/en/docs/claude-code/overview', name: 'Claude Code' },
  codex: { url: 'https://developers.openai.com/codex/cli', name: 'Codex CLI' },
  antigravity: { url: 'https://github.com/google-antigravity/antigravity-cli', name: 'Antigravity CLI' },
};
const summary = (provider: ProviderConfig) =>
  [
    providerName(provider) !== kindNames[provider.kind] ? kindNames[provider.kind] : '',
    provider.model || t(local(provider.kind) ? 'no model set' : 'account default'),
    provider.effort,
    local(provider.kind) ? provider.endpoint : '',
  ]
    .filter(Boolean)
    .join(' · ');

async function saveNow() {
  const message = await props.persist();
  if (message) emit('error', message);
  return !message;
}

// Drag to reorder. Only the grip arms a row, so text in the row stays selectable and buttons stay clickable.
const armed = ref(-1);
const dragging = ref(-1);
const over = ref(-1);
function moveTo(from: number, to: number) {
  if (from === to || from < 0 || to < 0 || to >= providers.value.length) return false;
  const [item] = providers.value.splice(from, 1);
  providers.value.splice(to, 0, item);
  return true;
}
function dragStart(event: DragEvent, index: number) {
  dragging.value = index;
  event.dataTransfer?.setData('text/plain', providers.value[index].id);
  if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move';
}
function dragOver(event: DragEvent, index: number) {
  if (dragging.value < 0) return;
  event.preventDefault();
  over.value = index;
}
function drop(index: number) {
  const moved = moveTo(dragging.value, index);
  dragEnd();
  if (moved) void saveNow();
}
function dragEnd() {
  armed.value = dragging.value = over.value = -1;
}
function gripKey(event: KeyboardEvent, index: number) {
  const step = event.key === 'ArrowUp' ? -1 : event.key === 'ArrowDown' ? 1 : 0;
  if (!step) return;
  event.preventDefault();
  if (!moveTo(index, index + step)) return;
  void saveNow();
  // Keep focus on the moved row's grip so repeated arrows keep moving it.
  requestAnimationFrame(() =>
    document.querySelectorAll<HTMLElement>('.provider-grip')[index + step]?.focus(),
  );
}
function setEnabled(provider: ProviderConfig, enabled: boolean) {
  provider.enabled = enabled;
  void saveNow();
}
async function remove(provider: ProviderConfig) {
  if (
    !(await confirmAction(
      t('Remove provider?'),
      t('{name} and its saved credential are removed from every workspace.', { name: providerName(provider) }),
      t('Remove'),
    ))
  )
    return false;
  providers.value = providers.value.filter((item) => item.id !== provider.id);
  await saveNow();
  return true;
}

// Add/edit dialog. The draft is a copy, so Cancel leaves the list untouched.
const draft = ref<ProviderConfig>();
const creating = ref(false);
const secret = ref('');
const busy = ref(false);
const dialogError = ref('');
const draftSaved = computed(() => !!draft.value && props.savedIds.includes(draft.value.id));
function openAdd() {
  creating.value = true;
  secret.value = dialogError.value = '';
  draft.value = {
    id: crypto.randomUUID(),
    kind: 'claude',
    model: '',
    endpoint: '',
    enabled: true,
    requireConsent: false,
  };
}
function openEdit(provider: ProviderConfig) {
  creating.value = false;
  secret.value = dialogError.value = '';
  draft.value = structuredClone(toRaw(provider));
}
function pickKind(kind: ProviderKind) {
  const current = draft.value;
  if (!current) return;
  // Swap in the new kind's default endpoint unless the user typed their own.
  const typed = current.endpoint && !Object.values(defaultEndpoints).includes(current.endpoint);
  current.kind = kind;
  current.model = '';
  current.effort = undefined;
  if (!typed) current.endpoint = defaultEndpoints[kind] ?? '';
  void checkAuth(kind);
}
const draftValid = computed(
  () => !!draft.value && (!local(draft.value.kind) || /^https?:\/\/\S+$/.test(draft.value.endpoint.trim())),
);
const dirty = computed(() => {
  if (!draft.value) return false;
  if (creating.value || secret.value) return true;
  const saved = providers.value.find((provider) => provider.id === draft.value!.id);
  return JSON.stringify(saved) !== JSON.stringify(draft.value);
});
async function closeDialog() {
  if (busy.value) return;
  if (dirty.value && !creating.value && !(await confirmAction(t('Discard provider changes?'), t('Your edits to this provider will be lost.'), t('Discard'))))
    return;
  draft.value = undefined;
}
async function apply() {
  const next = draft.value;
  if (!next || !draftValid.value || busy.value) return;
  busy.value = true;
  dialogError.value = '';
  const cleaned: ProviderConfig = {
    ...structuredClone(toRaw(next)),
    name: next.name?.trim() || undefined,
    endpoint: next.endpoint.trim(),
  };
  const index = providers.value.findIndex((provider) => provider.id === next.id);
  const previous = providers.value.slice();
  if (index < 0) providers.value.push(cleaned);
  else providers.value.splice(index, 1, cleaned);
  try {
    const message = await props.persist();
    if (message) {
      providers.value = previous;
      dialogError.value = message;
      return;
    }
    if (secret.value) {
      await rpc('provider.credential', { providerId: cleaned.id, value: secret.value });
      emit('changed');
    }
    draft.value = undefined;
  } catch (failure) {
    dialogError.value = failure instanceof Error ? failure.message : String(failure);
  } finally {
    busy.value = false;
  }
}
async function forgetKey() {
  if (!draft.value) return;
  busy.value = true;
  try {
    await rpc('provider.credential', { providerId: draft.value.id, value: '' });
    emit('changed');
  } catch (failure) {
    dialogError.value = failure instanceof Error ? failure.message : String(failure);
  } finally {
    busy.value = false;
  }
}
async function removeDraft() {
  const saved = providers.value.find((provider) => provider.id === draft.value?.id);
  if (saved && (await remove(saved))) draft.value = undefined;
}
async function discover() {
  if (!draft.value) return;
  const id = draft.value.id;
  try {
    modelOptions.value[id] = await rpc<string[]>('provider.models', { providerId: id });
  } catch (failure) {
    dialogError.value = failure instanceof Error ? failure.message : String(failure);
  }
}
async function login(kind: ProviderKind) {
  if (!props.workspaceId) {
    dialogError.value = t('Open a workspace first; sign-in runs in its terminal panel.');
    return;
  }
  try {
    await rpc('provider.login', { workspaceId: props.workspaceId, provider: kind });
  } catch (failure) {
    dialogError.value = failure instanceof Error ? failure.message : String(failure);
  }
}
function openDownload(kind: CliKind) {
  rpc('external.open', { url: downloads[kind].url }).catch(fail);
}
</script>

<template>
  <ol
    v-if="providers.length"
    class="provider-list"
    :aria-label="t('Fallback order')"
  >
    <li
      v-for="(provider, index) in providers"
      :key="provider.id"
      class="provider-row"
      :class="{
        off: !provider.enabled,
        dragging: dragging === index,
        'drop-before': over === index && dragging > index,
        'drop-after': over === index && dragging >= 0 && dragging < index,
      }"
      :draggable="armed === index"
      @dragstart="dragStart($event, index)"
      @dragover="dragOver($event, index)"
      @drop.prevent="drop(index)"
      @dragend="dragEnd"
    >
      <button
        type="button"
        class="provider-grip"
        :title="t('Drag to reorder, or focus and use the arrow keys')"
        :aria-label="t('Reorder {name}', { name: providerName(provider) })"
        @pointerdown="armed = index"
        @pointerup="armed = -1"
        @keydown="gripKey($event, index)"
      >
        <GripVertical :size="16" />
      </button>
      <span class="order-number">{{ index + 1 }}</span>
      <span
        class="model-dot"
        :class="provider.kind"
      />
      <button
        type="button"
        class="provider-row-main"
        :title="t('Edit provider')"
        @click="openEdit(provider)"
      >
        <strong>{{ providerName(provider) }}</strong>
        <small>{{ summary(provider) }}</small>
      </button>
      <span
        v-if="cli(provider.kind)"
        class="provider-auth"
        :class="auth[provider.kind]?.state"
        :title="auth[provider.kind]?.detail"
      >{{ authText(provider.kind) }}</span>
      <span
        v-else-if="credentialIds.includes(provider.id)"
        class="provider-auth signed-in"
      ><KeyRound :size="11" /> {{ t('Key saved') }}</span>
      <input
        class="switch"
        type="checkbox"
        role="switch"
        :checked="provider.enabled"
        :title="t(provider.enabled ? 'Enabled by default' : 'Disabled by default')"
        :aria-label="t('Enable {name}', { name: providerName(provider) })"
        @change="setEnabled(provider, ($event.target as HTMLInputElement).checked)"
      >
      <button
        type="button"
        class="icon-button"
        :title="t('Edit provider')"
        :aria-label="t('Edit provider')"
        @click="openEdit(provider)"
      >
        <Pencil :size="14" />
      </button>
      <button
        type="button"
        class="icon-button"
        :title="t('Remove provider (also removes its saved credential)')"
        :aria-label="t('Remove provider (also removes its saved credential)')"
        @click="remove(provider)"
      >
        <Trash2 :size="14" />
      </button>
    </li>
  </ol>
  <p
    v-else
    class="provider-empty muted"
  >
    {{ t('No providers yet. Add one to start chatting.') }}
  </p>
  <button
    type="button"
    class="primary-button"
    @click="openAdd"
  >
    <Plus :size="14" /> {{ t('Add provider') }}
  </button>
  <p class="muted small">
    {{ t('Changes in this list save immediately.') }}
    {{ storage.detail }}
    {{
      t(
        'The fallback list may transfer conversation and code between local and cloud models; extra consent is optional per entry.',
      )
    }}
  </p>

  <FormDialog
    v-if="draft"
    :title="creating ? t('Add provider') : t('Edit {name}', { name: providerName(draft) })"
    wide
    @close="closeDialog"
    @submit="apply"
  >
    <div
      v-if="creating"
      class="provider-kinds"
      role="radiogroup"
      :aria-label="t('Provider')"
    >
      <button
        v-for="option in kinds"
        :key="option.kind"
        type="button"
        role="radio"
        class="provider-kind"
        :aria-checked="draft.kind === option.kind"
        @click="pickKind(option.kind)"
      >
        <span
          class="model-dot"
          :class="option.kind"
        />
        <span>
          <strong>{{ kindNames[option.kind] }}</strong>
          <small>{{ t(option.detail) }}</small>
        </span>
      </button>
    </div>
    <div class="form-grid">
      <label>{{ t('Name') }}
        <input
          v-model="draft.name"
          autocomplete="off"
          maxlength="60"
          :placeholder="kindNames[draft.kind]"
        >
      </label>
      <label v-if="!creating">{{ t('Provider') }}
        <AppSelect
          :model-value="draft.kind"
          :options="kindOptions"
          @update:model-value="(value: string) => pickKind(value as ProviderKind)"
        />
      </label>
      <label :class="{ 'full-width': !creating }">{{ t('Model') }}
        <div class="input-action">
          <AppSelect
            v-model="draft.model"
            editable
            :options="(modelOptions[draft.id] ?? []).map((value) => ({ value, label: value }))"
            :placeholder="t(local(draft.kind) ? 'Model ID' : 'Account default')"
          /><button
            v-if="local(draft.kind) || draft.kind === 'antigravity'"
            type="button"
            class="icon-button"
            :disabled="!draftSaved"
            :title="t(draftSaved ? 'Discover models' : 'Add the provider first, then discover its models')"
            @click="discover"
          >
            <RefreshCw :size="14" />
          </button>
        </div>
      </label>
      <label
        v-if="local(draft.kind)"
        class="full-width"
      >{{ t('API endpoint') }}
        <input
          v-model="draft.endpoint"
          autocomplete="off"
          required
          :placeholder="defaultEndpoints[draft.kind] ?? 'https://api.example.com/v1'"
        >
      </label>
      <label
        v-if="local(draft.kind)"
        class="full-width"
      >
        <span>{{ t('API key') }}<span
          v-if="credentialIds.includes(draft.id)"
          class="saved-badge"
        ><Check :size="11" /> {{ t(storage.available ? 'saved' : 'this session') }}</span></span>
        <div class="input-action">
          <input
            v-model="secret"
            type="password"
            autocomplete="off"
            :placeholder="t(credentialIds.includes(draft.id) ? 'Enter a new key to replace it' : 'Optional')"
          ><button
            v-if="credentialIds.includes(draft.id)"
            type="button"
            class="secondary-button"
            :disabled="busy"
            @click="forgetKey"
          >
            {{ t('Forget') }}
          </button>
        </div>
      </label>
    </div>

    <div
      v-if="cli(draft.kind)"
      class="provider-signin"
    >
      <span
        class="provider-auth"
        :class="auth[draft.kind]?.state"
        role="status"
        :title="auth[draft.kind]?.detail"
      >{{ authText(draft.kind) }}</span>
      <button
        type="button"
        class="icon-button"
        :title="t('Refresh sign-in status')"
        :disabled="checkingAuth[draft.kind]"
        @click="checkAuth(draft.kind)"
      >
        <RefreshCw :size="14" />
      </button>
      <button
        type="button"
        class="secondary-button"
        @click="login(draft.kind)"
      >
        <KeyRound :size="13" />
        {{ t(auth[draft.kind]?.state === 'signed-in' ? 'Sign in again' : 'Sign in with installed CLI') }}
      </button>
      <button
        v-if="auth[draft.kind]?.detected === false"
        type="button"
        class="text-button"
        @click="openDownload(draft.kind as CliKind)"
      >
        {{ t('Download {name}', { name: downloads[draft.kind as CliKind].name }) }}
      </button>
      <small class="muted full-width">{{ t('Uses your existing CLI login; nothing is stored by BasedCode.') }}</small>
    </div>
    <div
      v-if="draft.kind === 'codex'"
      class="inline-warning"
    >
      <ShieldAlert :size="15" /><span>{{
        t(
          'Runs through the Codex CLI AI SDK provider with native shell, patch, web, browser, plugin and sub-agent tools disabled. BasedCode tools reach Codex over a per-run loopback MCP server. Any non-BasedCode tool call stops the run.',
        )
      }}</span>
    </div>
    <div
      v-if="draft.kind === 'antigravity'"
      class="inline-warning"
    >
      <ShieldAlert :size="15" /><span>{{
        t('Uses the unofficial eve-antigravity adapter and your installed agy CLI. Native CLI tools are disabled; BasedCode executes tool calls. Images and binary files are not sent to the model.')
      }}</span>
    </div>

    <div class="setting-group">
      <label class="setting-row">
        <span class="setting-row-text">
          <strong>{{ t('Enabled by default') }}</strong>
          <small>{{ t('Part of the fallback order unless a workspace turns it off') }}</small>
        </span>
        <input
          v-model="draft.enabled"
          class="switch"
          type="checkbox"
        >
      </label>
      <label class="setting-row">
        <span class="setting-row-text">
          <strong>{{ t('Ask before falling back to this provider') }}</strong>
          <small>{{ t('Confirm before conversation and code move to this provider mid-run') }}</small>
        </span>
        <input
          v-model="draft.requireConsent"
          class="switch"
          type="checkbox"
        >
      </label>
    </div>
    <p
      v-if="dialogError"
      class="error-box"
      role="alert"
    >
      {{ dialogError }}
    </p>
    <template #footer>
      <button
        v-if="!creating"
        type="button"
        class="secondary-button danger-action"
        :disabled="busy"
        @click="removeDraft"
      >
        <Trash2 :size="14" /> {{ t('Remove') }}
      </button>
      <button
        type="button"
        class="secondary-button"
        :disabled="busy"
        @click="closeDialog"
      >
        {{ t('Cancel') }}
      </button>
      <button
        type="submit"
        class="primary-button"
        :disabled="busy || !draftValid || !dirty"
      >
        {{ busy ? t('Saving…') : creating ? t('Add provider') : t('Save changes') }}
      </button>
    </template>
  </FormDialog>
</template>