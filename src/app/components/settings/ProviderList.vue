<script setup lang="ts">
import { ref, watch } from 'vue';
import {
  ChevronUp,
  ChevronDown,
  Plus,
  Trash2,
  KeyRound,
  RefreshCw,
  ShieldAlert,
  Check,
} from '../../icons';
import { kindNames, type ProviderConfig } from '../../../shared/types';
import { rpc } from '../../services/api';
import AppSelect from '../common/AppSelect.vue';
import { t } from '../../theme/themes';

// Provider connections are app-wide: one list, one set of credentials, shared by every workspace.
const providers = defineModel<ProviderConfig[]>({ required: true });
const props = defineProps<{
  savedIds: string[];
  credentialIds: string[];
  storage: { available: boolean; detail: string };
  workspaceId?: string;
}>();
const emit = defineEmits<{ error: [message: string]; changed: [] }>();
const modelOptions = ref<Record<string, string[]>>({});
const secrets = ref<Record<string, string>>({});
const savingSecret = ref('');
const auth = ref<
  Record<
    string,
    { state: 'signed-in' | 'signed-out' | 'unknown'; detail: string; detected: boolean }
  >
>({});
const checkingAuth = ref<Record<string, boolean>>({});
async function checkAuth(kind: ProviderConfig['kind']) {
  if (kind !== 'codex' && kind !== 'claude' && kind !== 'antigravity') return;
  if (checkingAuth.value[kind]) return;
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

const local = (provider: ProviderConfig) =>
  provider.kind === 'ollama' || provider.kind === 'lmstudio' || provider.kind === 'openai';
const fail = (failure: unknown) =>
  emit('error', failure instanceof Error ? failure.message : String(failure));

function move(index: number, direction: number) {
  const next = index + direction;
  if (next < 0 || next >= providers.value.length) return;
  const list = providers.value;
  [list[index], list[next]] = [list[next], list[index]];
}
function add() {
  providers.value.push({
    id: crypto.randomUUID(),
    kind: 'ollama',
    model: '',
    endpoint: 'http://127.0.0.1:11434/v1',
    enabled: true,
    requireConsent: false,
  });
}
async function discover(provider: ProviderConfig) {
  try {
    modelOptions.value[provider.id] = await rpc<string[]>('provider.models', {
      providerId: provider.id,
    });
  } catch (failure) {
    fail(failure);
  }
}
async function saveSecret(provider: ProviderConfig, value: string) {
  savingSecret.value = provider.id;
  try {
    await rpc('provider.credential', { providerId: provider.id, value });
    secrets.value[provider.id] = '';
    emit('changed');
  } catch (failure) {
    fail(failure);
  } finally {
    savingSecret.value = '';
  }
}
async function login(provider: ProviderConfig) {
  if (!props.workspaceId) {
    emit('error', t('Open a workspace first; sign-in runs in its terminal panel.'));
    return;
  }
  try {
    await rpc('provider.login', { workspaceId: props.workspaceId, provider: provider.kind });
  } catch (failure) {
    fail(failure);
  }
}
</script>

<template>
  <article
    v-for="(provider, index) in providers"
    :key="provider.id"
    class="provider-card"
  >
    <header>
      <span class="order-number">{{ index + 1 }}</span><label class="checkbox"><input
                                                                                 v-model="provider.enabled"
                                                                                 autocomplete="off"
                                                                                 type="checkbox"
                                                                               >
        {{ t('Enabled by default') }}</label><span class="spacer" /><button
        class="icon-button"
        :title="t('Move up')"
        :disabled="index === 0"
        @click="move(index, -1)"
      >
        <ChevronUp :size="15" />
      </button><button
        class="icon-button"
        :title="t('Move down')"
        :disabled="index === providers.length - 1"
        @click="move(index, 1)"
      >
        <ChevronDown :size="15" />
      </button><button
        class="icon-button"
        :title="t('Remove provider (also removes its saved credential)')"
        @click="providers.splice(index, 1)"
      >
        <Trash2 :size="14" />
      </button>
    </header>
    <div class="form-grid">
      <label class="full-width">{{ t('Name')
      }}<input
        v-model="provider.name"
        autocomplete="off"
        maxlength="60"
        :placeholder="kindNames[provider.kind]"
      ></label>
      <label>{{ t('Provider')
      }}<AppSelect
        v-model="provider.kind"
        :options="[
          { value: 'ollama', label: 'Ollama' },
          { value: 'lmstudio', label: 'LM Studio' },
          { value: 'openai', label: 'OpenAI-compatible' },
          { value: 'claude', label: 'Claude Code' },
          { value: 'codex', label: 'Codex' },
          { value: 'antigravity', label: 'Antigravity' },
        ]"
      /></label>
      <label>{{ t('Model') }}
        <div class="input-action">
          <AppSelect
            v-model="provider.model"
            editable
            :options="(modelOptions[provider.id] ?? []).map((value) => ({ value, label: value }))"
            :placeholder="t(local(provider) ? 'Model ID' : 'Account default')"
          /><button
            v-if="local(provider) || provider.kind === 'antigravity'"
            class="icon-button"
            :disabled="!savedIds.includes(provider.id)"
            :title="t(savedIds.includes(provider.id) ? 'Discover models' : 'Save settings first')"
            @click="discover(provider)"
          >
            <RefreshCw :size="14" />
          </button></div></label>
      <label
        v-if="local(provider)"
        class="full-width"
      >{{ t('API endpoint')
      }}<input
        v-model="provider.endpoint"
        autocomplete="off"
        placeholder="http://127.0.0.1:11434/v1"
      ></label>
      <div
        v-if="local(provider)"
        class="full-width credential-row"
      >
        <label>{{ t('API key') }}
          <span
            v-if="credentialIds.includes(provider.id)"
            class="saved-badge"
          ><Check :size="11" /> {{ t(storage.available ? 'saved' : 'this session') }}</span><input
            v-model="secrets[provider.id]"
            type="password"
            autocomplete="off"
            :placeholder="
              t(credentialIds.includes(provider.id) ? 'Enter a new key to replace it' : 'Optional')
            "
          ></label><button
          class="secondary-button"
          :disabled="
            !secrets[provider.id] || savingSecret === provider.id || !savedIds.includes(provider.id)
          "
          :title="savedIds.includes(provider.id) ? '' : t('Save settings first')"
          @click="saveSecret(provider, secrets[provider.id])"
        >
          {{ t('Save key') }}
        </button><button
          v-if="credentialIds.includes(provider.id)"
          class="secondary-button"
          :disabled="savingSecret === provider.id"
          @click="saveSecret(provider, '')"
        >
          {{ t('Forget') }}
        </button>
      </div>
    </div>
    <div
      v-if="provider.kind === 'codex'"
      class="inline-warning"
    >
      <ShieldAlert :size="15" /><span>{{
        t(
          'Runs through the Codex CLI AI SDK provider with native shell, patch, web, browser, plugin and sub-agent tools disabled. BasedCode tools reach Codex over a per-run loopback MCP server. Any non-BasedCode tool call stops the run.',
        )
      }}</span>
    </div>
    <div
      v-if="provider.kind === 'antigravity'"
      class="inline-warning"
    >
      <ShieldAlert :size="15" /><span>{{
        t('Uses the unofficial eve-antigravity adapter and your installed agy CLI. Native CLI tools are disabled; BasedCode executes tool calls. Images and binary files are not sent to the model.')
      }}</span>
    </div>
    <div
      v-if="!local(provider)"
      class="row"
    >
      <button
        class="secondary-button"
        @click="login(provider)"
      >
        <KeyRound :size="13" />
        {{
          t(
            auth[provider.kind]?.state === 'signed-in'
              ? 'Sign in again'
              : 'Sign in with installed CLI',
          )
        }}
      </button><span
        role="status"
        :title="auth[provider.kind]?.detail"
        :class="auth[provider.kind]?.state === 'signed-in' ? 'saved-badge' : 'muted'"
      >{{
        t(
          checkingAuth[provider.kind]
            ? 'Checking sign-in…'
            : auth[provider.kind]?.state === 'signed-in'
              ? 'Signed in'
              : auth[provider.kind]?.state === 'signed-out'
                ? 'Not signed in'
                : 'Unable to check sign-in',
        )
      }}</span><button
        class="icon-button"
        :title="t('Refresh sign-in status')"
        :disabled="checkingAuth[provider.kind]"
        @click="checkAuth(provider.kind)"
      >
        <RefreshCw :size="14" />
      </button><small class="muted">{{
        t('Uses your existing CLI login; nothing is stored by BasedCode.')
      }}</small><a
        v-if="auth[provider.kind]?.detected === false"
        class="small"
        :href="
          provider.kind === 'antigravity'
            ? 'https://github.com/google-antigravity/antigravity-cli'
            : provider.kind === 'claude'
              ? 'https://docs.anthropic.com/en/docs/claude-code/overview'
              : 'https://developers.openai.com/codex/cli'
        "
        rel="noopener noreferrer"
        @click.prevent="
          rpc('external.open', { url: ($event.currentTarget as HTMLAnchorElement).href }).catch(
            fail,
          )
        "
      >{{
        t('Download {name}', { name: provider.kind === 'antigravity' ? 'Antigravity CLI' : provider.kind === 'claude' ? 'Claude Code' : 'Codex CLI' })
      }}</a>
    </div>
    <label class="checkbox"><input
                              v-model="provider.requireConsent"
                              autocomplete="off"
                              type="checkbox"
                            >
      {{ t('Ask before falling back to this provider') }}</label>
  </article>
  <button
    class="secondary-button"
    @click="add"
  >
    <Plus :size="14" /> {{ t('Add provider') }}
  </button>
  <p class="muted small">
    {{ storage.detail }}
    {{
      t(
        'The fallback list may transfer conversation and code between local and cloud models; extra consent is optional per entry.',
      )
    }}
  </p>
</template>
