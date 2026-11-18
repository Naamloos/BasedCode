<script setup lang="ts">
import { computed, ref, toRaw } from 'vue';
import {
  X,
  ChevronUp,
  ChevronDown,
  KeyRound,
  ShieldAlert,
  SlidersHorizontal,
  ScrollText,
  Sparkles,
} from '../../icons';
import { useSettingsSearch, type SettingsSection } from '../../state/settingsSearch';
import {
  defaultRunBudget,
  effectiveProviders,
  providerName,
  type GlobalSettings,
  type Workspace,
  type WorkspaceSettings,
} from '../../../shared/types';
import { rpc } from '../../services/api';
import { approvalModes } from '../../state/approvals';
import AppSelect from '../common/AppSelect.vue';
import ArgumentList from './ArgumentList.vue';
import VerificationResultView from '../common/VerificationResult.vue';
import { sameVerificationCheck, type VerificationResult } from '../../../shared/verification';
import { guidedMode, guidedModes } from '../../../shared/chatModes';
import RunPolicyFields from './RunPolicyFields.vue';
import SkillManager from './SkillManager.vue';
import { t } from '../../theme/themes';

const props = defineProps<{
  workspace: Workspace;
  global: GlobalSettings;
  sandboxDetail: string;
}>();
const emit = defineEmits<{ close: []; saved: []; error: [message: string] }>();
// structuredClone throws on Vue's reactive proxies, which left the panel unable to open; clone the raw object.
const settings = ref<WorkspaceSettings>(structuredClone(toRaw(props.workspace).settings));
const tab = ref('providers');
const sections: SettingsSection[] = [
  { id: 'providers', label: 'Fallback & approvals', icon: SlidersHorizontal, words: 'fallback order models providers approval mode permissions command rules budget' },
  { id: 'workspace', label: 'Checks & editor', icon: KeyRound, words: 'checks lint typecheck test commands editor external ide open' },
  { id: 'agent', label: 'Instructions & defaults', icon: ScrollText, words: 'instructions agents claude.md defaults model mode prompt' },
  { id: 'skills', label: 'Skills', icon: Sparkles, words: 'skills instructions slash commands claude codex agents skill.md' },
];
const {
  query: settingsSearch,
  body: settingsBody,
  visible: visibleSections,
} = useSettingsSearch(sections, tab);
function moveCheck(index: number, direction: number) {
  const checks = settings.value.checks;
  const target = index + direction;
  [checks[index], checks[target]] = [checks[target], checks[index]];
}

function setCheckTimeout(check: WorkspaceSettings['checks'][number], event: Event) {
  const input = event.target as HTMLInputElement;
  check.timeoutSeconds = input.value || input.validity.badInput ? input.valueAsNumber : undefined;
}
const error = ref('');
type Check = WorkspaceSettings['checks'][number];
const runningCheck = ref<Check>();
const checkResults = new WeakMap<Check, VerificationResult>();

function isSavedCheck(check: Check, index: number) {
  const saved = props.workspace.settings.checks[index];
  return !!saved && !!check.command.trim() && sameVerificationCheck(check, saved) &&
    check.timeoutSeconds === saved.timeoutSeconds;
}

async function runCheck(check: Check, index: number) {
  if (runningCheck.value || !isSavedCheck(check, index)) return;
  runningCheck.value = check;
  checkResults.delete(check);
  error.value = '';
  try {
    const [result] = await rpc<VerificationResult[]>('checks.run', {
      workspaceId: props.workspace.id, index, check,
    });
    if (result) checkResults.set(check, result);
  } catch (failure) {
    error.value = failure instanceof Error ? failure.message : String(failure);
  } finally {
    runningCheck.value = undefined;
  }
}

/** The order shown: this workspace's own list when it has one, otherwise the app order (read-only). */
const fallbackRows = computed(() =>
  effectiveProviders(props.global, { ...props.workspace, settings: settings.value }).map(
    (provider) => ({ provider, enabled: provider.enabled }),
  ),
);
function toggleOverride() {
  settings.value.fallback = settings.value.fallback
    ? undefined
    : props.global.providers.map((provider) => ({
        providerId: provider.id,
        enabled: provider.enabled,
      }));
}
function ensureFallback() {
  // Connections added to the app after this workspace saved its order join it at the end.
  settings.value.fallback = fallbackRows.value.map((row) => ({
    providerId: row.provider.id,
    enabled: row.enabled,
  }));
  return settings.value.fallback;
}
function setEnabled(providerId: string, enabled: boolean) {
  const entry = ensureFallback().find((item) => item.providerId === providerId);
  if (entry) entry.enabled = enabled;
}
function moveFallback(index: number, direction: number) {
  const list = ensureFallback();
  const next = index + direction;
  if (next < 0 || next >= list.length) return;
  [list[index], list[next]] = [list[next], list[index]];
}
function setApprovalMode(value: string) {
  settings.value.approvalMode = value ? (value as WorkspaceSettings['approvalMode']) : undefined;
}
async function save(close = true) {
  try {
    error.value = '';
    if (settings.value.checks.some(({ timeoutSeconds }) =>
      timeoutSeconds !== undefined &&
      (!Number.isInteger(timeoutSeconds) || timeoutSeconds < 1 || timeoutSeconds > 3600),
    )) {
      tab.value = 'workspace';
      throw new Error(t('Enter a whole-number timeout between 1 and 3600 seconds.'));
    }
    await rpc('workspace.settings', { workspaceId: props.workspace.id, settings: settings.value });
    emit('saved');
    if (close) emit('close');
  } catch (failure) {
    error.value = failure instanceof Error ? failure.message : String(failure);
    throw failure;
  }
}
</script>

<template>
  <div
    class="modal-backdrop"
    @click.self="emit('close')"
  >
    <section
      class="settings-modal"
      role="dialog"
      aria-modal="true"
      aria-labelledby="settings-title"
    >
      <header class="modal-header">
        <div>
          <h2 id="settings-title">
            {{ t('{name} settings', { name: workspace.name }) }}
          </h2>
        </div>
        <button
          class="icon-button"
          :aria-label="t('Close settings')"
          @click="emit('close')"
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
        >
          <template v-if="tab === 'providers'">
            <h3>{{ t('Fallback order for {name}', { name: workspace.name }) }}</h3>
            <p class="muted">
              {{
                t(
                  'Models, endpoints and keys are app-wide (App settings → Models). Here you can only change which of them this workspace uses, and in what order.',
                )
              }}
            </p>
            <label class="checkbox"><input
                                      autocomplete="off"
                                      type="checkbox"
                                      :checked="!settings.fallback"
                                      @change="toggleOverride"
                                    >
              {{ t("Follow the app's order") }}</label>
            <article
              v-for="(entry, index) in fallbackRows"
              :key="entry.provider.id"
              class="provider-card compact"
              :class="{ inherited: !settings.fallback }"
            >
              <header>
                <span class="order-number">{{ index + 1 }}</span><label class="checkbox"><input
                                                                                           autocomplete="off"
                                                                                           type="checkbox"
                                                                                           :checked="entry.enabled"
                                                                                           :disabled="!settings.fallback"
                                                                                           @change="
                                                                                             setEnabled(entry.provider.id, ($event.target as HTMLInputElement).checked)
                                                                                           "
                                                                                         >
                  {{ providerName(entry.provider)
                  }}<span class="muted">
                    · {{ entry.provider.model || t('default')
                    }}{{ entry.provider.effort ? ` · ${entry.provider.effort}` : '' }}</span></label><span class="spacer" /><button
                  class="icon-button"
                  :title="t('Move up')"
                  :disabled="!settings.fallback || index === 0"
                  @click="moveFallback(index, -1)"
                >
                  <ChevronUp :size="15" />
                </button><button
                  class="icon-button"
                  :title="t('Move down')"
                  :disabled="!settings.fallback || index === fallbackRows.length - 1"
                  @click="moveFallback(index, 1)"
                >
                  <ChevronDown :size="15" />
                </button>
              </header>
            </article>
            <p
              v-if="!fallbackRows.length"
              class="muted"
            >
              {{ t('No providers are configured. Add them in App settings → Models.') }}
            </p>

            <h3>{{ t('Approvals') }}</h3>
            <p class="muted">
              {{
                t(
                  'Decides what the agent may do in this workspace without asking. Automatic decisions are still recorded.',
                )
              }}
            </p>
            <label>{{ t('Approval mode')
            }}<AppSelect
              :model-value="settings.approvalMode ?? ''"
              :options="[
                {
                  value: '',
                  label: t('Use the app default ({mode})', {
                    mode: t(approvalModes[global.approvalMode].name),
                  }),
                },
                ...Object.entries(approvalModes).map(([value, mode]) => ({
                  value,
                  label: t(mode.name),
                })),
              ]"
              @update:model-value="setApprovalMode"
            /></label>
            <p class="muted small">
              {{ t(approvalModes[settings.approvalMode ?? global.approvalMode].detail) }}
            </p>
            <div
              v-if="(settings.approvalMode ?? global.approvalMode) === 'allow-all'"
              class="inline-warning"
            >
              <ShieldAlert :size="15" /><span>{{ t('Commands will run without asking, with your full user permissions:') }}
                {{ sandboxDetail }}</span>
            </div>
            <RunPolicyFields
              v-model:command-rules="settings.commandRules"
              v-model:budget="settings.budget"
              :inherited-budget="global.budget ?? defaultRunBudget"
              :inherited-rules="global.commandRules"
            />
          </template>
          <SkillManager
            v-else-if="tab === 'skills'"
            :workspace="workspace"
          />
          <template v-else-if="tab === 'agent'">
            <h3>{{ t('Workspace instructions') }}</h3>
            <p class="muted">
              {{
                t(
                  'Added to every prompt in this workspace, after project files like AGENTS.md and CLAUDE.md. Use it for preferences you do not want to commit to the repository.',
                )
              }}
            </p>
            <textarea
              class="instructions-input"
              :value="settings.instructions ?? ''"
              rows="10"
              maxlength="20000"
              :placeholder="t('For example: Use pnpm. Write tests with Vitest. Answer in Dutch.')"
              @input="
                settings.instructions = ($event.target as HTMLTextAreaElement).value || undefined
              "
            />
            <h3>{{ t('New chats') }}</h3>
            <label>{{ t('Mode for new chats')
            }}<AppSelect
              :model-value="settings.defaultMode ?? 'default'"
              :options="[
                { value: 'default', label: t('Normal chat') },
                ...guidedModes.map((mode) => ({ value: mode.id, label: t(mode.label) })),
              ]"
              @update:model-value="
                (value: string) => (settings.defaultMode = guidedMode(value)?.id)
              "
            /></label>
            <p class="muted small">
              {{
                t(
                  'Models and fallback order for this workspace are on the Fallback & approvals tab.',
                )
              }}
            </p>
          </template>
          <template v-else>
            <h3>{{ t('Workspace checks') }}</h3>
            <p class="muted">
              {{ t('Check commands are subject to command approval.') }}
            </p>
            <fieldset
              v-for="(check, index) in settings.checks"
              :key="index"
              class="provider-card check-fields"
            >
              <legend>{{ check.name || t('Check {number}', { number: index + 1 }) }}</legend>
              <div class="form-grid">
                <label>{{ t('Name') }}
                  <input v-model="check.name">
                </label>
                <label>{{ t('Command') }}
                  <input
                    v-model="check.command"
                    placeholder="npm run typecheck"
                    spellcheck="false"
                  >
                </label>
                <label>{{ t('Timeout in seconds') }}
                  <input
                    type="number"
                    min="1"
                    max="3600"
                    step="1"
                    placeholder="120"
                    :value="check.timeoutSeconds"
                    @input="setCheckTimeout(check, $event)"
                  >
                </label>
                <label class="check-automatic">
                  <input
                    type="checkbox"
                    :checked="check.automatic !== false"
                    @change="check.automatic = ($event.target as HTMLInputElement).checked"
                  >
                  {{ t('Run automatically') }}
                </label>
                <label v-if="check.automatic !== false">{{ t('Run timing') }}
                  <AppSelect
                    :model-value="check.timing ?? 'after-run'"
                    :options="[
                      { value: 'after-run', label: t('After the agent finishes') },
                      { value: 'before-run', label: t('Before the agent starts') },
                    ]"
                    @update:model-value="(value) => (check.timing = value === 'before-run' ? 'before-run' : 'after-run')"
                  />
                </label>
              </div>
              <p
                v-if="check.automatic !== false && check.timing === 'before-run'"
                class="muted"
              >
                {{ t('The agent starts only if this check passes.') }}
              </p>
              <div class="check-actions">
                <button
                  type="button"
                  class="secondary-button"
                  :disabled="!!runningCheck || !isSavedCheck(check, index)"
                  :title="isSavedCheck(check, index) ? undefined : t('Save the check before running it.')"
                  @click="runCheck(check, index)"
                >
                  {{ t(runningCheck === check ? 'Running…' : 'Run now') }}
                </button>
                <button
                  type="button"
                  class="secondary-button"
                  :disabled="index === 0"
                  @click="moveCheck(index, -1)"
                >
                  {{ t('Move up') }}
                </button>
                <button
                  type="button"
                  class="secondary-button"
                  :disabled="index === settings.checks.length - 1"
                  @click="moveCheck(index, 1)"
                >
                  {{ t('Move down') }}
                </button>
                <button
                  type="button"
                  class="secondary-button danger-action"
                  @click="settings.checks.splice(index, 1)"
                >
                  {{ t('Remove') }}
                </button>
              </div>
              <VerificationResultView
                v-if="isSavedCheck(check, index) && checkResults.has(check)"
                :result="checkResults.get(check)!"
              />
            </fieldset>
            <button
              type="button"
              class="secondary-button"
              :disabled="settings.checks.length >= 30"
              @click="settings.checks.push({ name: '', command: '' })"
            >
              {{ t('Add check') }}
            </button>
            <label>{{
              t(
                'When checks fail at the end of a run, give the failures back to the model for one fix-up round',
              )
            }}<AppSelect
              :model-value="
                settings.fixFailedChecks === undefined ? '' : String(settings.fixFailedChecks)
              "
              :options="[
                {
                  value: '',
                  label: t('Use the app default ({mode})', {
                    mode: t(global.fixFailedChecks === false ? 'Off' : 'On'),
                  }),
                },
                { value: 'true', label: t('On') },
                { value: 'false', label: t('Off') },
              ]"
              @update:model-value="
                (value) => (settings.fixFailedChecks = value === '' ? undefined : value === 'true')
              "
            /></label>
            <h3>{{ t('External editor') }}</h3>
            <label>{{ t('Executable') }}
              <input
                v-model="settings.editor.command"
                autocomplete="off"
                placeholder="code"
              >
            </label>
            <ArgumentList v-model="settings.editor.args" />
            <p class="muted small">
              {{
                t(
                  'Use {file} or {workspace} placeholders. Previews inside BasedCode stay read-only.',
                  { file: '{file}', workspace: '{workspace}' },
                )
              }}
            </p>
          </template>
          <p
            v-if="error"
            class="error-box"
            role="alert"
          >
            {{ error }}
          </p>
        </div>
      </div>
      <footer class="modal-footer">
        <span class="muted small">{{ t('Settings belong to this workspace.') }}</span><button
          class="secondary-button"
          @click="emit('close')"
        >
          {{ t('Cancel') }}
        </button><button
          class="primary-button"
          @click="save().catch(() => undefined)"
        >
          {{ t('Save settings') }}
        </button>
      </footer>
    </section>
  </div>
</template>

<style scoped>
.check-fields {
  min-width: 0;
}
.check-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 10px;
}
.form-grid .check-automatic {
  display: flex;
  align-items: center;
  flex-direction: row;
  align-self: end;
}
.instructions-input {
  display: block;
  width: 100%;
  box-sizing: border-box;
}
</style>
