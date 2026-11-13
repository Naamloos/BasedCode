import { computed, nextTick, ref, watch, type Ref } from 'vue';
import { slashCommands, type SlashCommandInfo, type SlashCommandParam } from '../../shared/commands';
import { rpc } from '../services/api';

export function useComposerCommands(
  composer: Ref<string>,
  workspaceId: Ref<string>,
  composerBox: Ref<HTMLElement | undefined>,
  report: (failure: unknown) => void,
) {
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
    const before = composer.value.slice(0, mention.start);
    const after = composer.value.slice(composerCaret.value).replace(/^[a-z0-9-]*\s?/, '');
    composer.value = before + inserted + after;
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
    let index = -1;
    if (params.length) {
      if (finished <= last) index = finished;
      else if (params[last].rest) index = last;
    }
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
    if (!id) {
      skillSlashCommands.value = [];
      return;
    }
    const result = await rpc<{ name: string; description: string }[]>('skills.commands', { workspaceId: id });
    if (workspaceId.value === id) skillSlashCommands.value = result;
  }
  watch(
    workspaceId,
    () => {
      skillSlashCommands.value = [];
      void loadSkillCommands().catch(report);
    },
    { immediate: true },
  );
  watch(composer, (value, previous) => {
    commandIndex.value = 0;
    commandDismissed.value = false;
    mentionIndex.value = 0;
    mentionDismissed.value = false;
    const startsCommand = value.trimStart().startsWith('/') && !previous.trimStart().startsWith('/');
    const addsMention = value.split('@').length > previous.split('@').length;
    if (startsCommand || addsMention) void loadSkillCommands().catch(report);
  });
  const visibleCommands = computed(() => {
    if (commandDismissed.value) return [];
    return commandHelp.value ? allSlashCommands.value : commandSuggestions.value;
  });
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
    if (event.key === 'Escape') {
      commandDismissed.value = true;
      commandHelp.value = false;
      return;
    }
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

  return {
    commandHelp, allSlashCommands, trackCaret, mentionIndex, skillMention, chooseMention,
    commandArgHint, commandQuery, unknownCommand, commandIndex, commandList,
    loadSkillCommands, visibleCommands, chooseCommand, commandKeydown,
  };
}
