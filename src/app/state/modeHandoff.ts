import { ref, watch, type Ref } from 'vue';
import type { Chat, ChatMode } from '../../shared/types';
import { rpc } from '../services/api';
import { t } from '../theme/themes';

interface HandoffActions {
  hasMessages: () => boolean;
  setChatMode: (mode: Exclude<ChatMode, 'review'>) => Promise<void>;
  closeMenu: () => void;
  refresh: () => Promise<void>;
  selectChat: (chat: Chat) => Promise<void>;
}

export function useModeHandoff(chat: Ref<Chat | undefined>, actions: HandoffActions) {
  const { hasMessages, setChatMode, closeMenu, refresh, selectChat } = actions;

  /** The chat whose hand-off dialog is open, if any, and the mode preselected in it. */
  const handOffChat = ref<Chat>();
  const handOffMode = ref<Exclude<ChatMode, 'review'>>();
  watch(handOffChat, (value) => value || (handOffMode.value = undefined));
  function openHandOff(target: Chat) {
    closeMenu();
    handOffChat.value = target;
  }
  /** The in-chat line for a mode switch, e.g. "Switched from a normal chat to Debug mode". */
  function modeSwitchLabel(value: unknown): string {
    const { from, to } = value as { from: string; to: string };
    return t('Switched from {from} to {to}', { from: t(from), to: t(to) });
  }
  const handOffContextMarker = '\n\nContext from the user for this hand-off:\n';
  /** The context typed for a mode switch. Older switches only have it inside the hand-off prompt. */
  function modeSwitchContext(message: { content: string; metadata: Record<string, unknown> }): string {
    const stored = (message.metadata.modeSwitch as { context?: unknown } | undefined)?.context;
    if (typeof stored === 'string') return stored;
    const at = message.content.indexOf(handOffContextMarker);
    return at < 0 ? '' : message.content.slice(at + handOffContextMarker.length).trim();
  }
  /** The composer's mode chip: an empty chat just takes the mode; otherwise confirm (with context) in the hand-off dialog. */
  async function switchMode(mode: Exclude<ChatMode, 'review'>) {
    if (!chat.value) return;
    if (!hasMessages()) return setChatMode(mode);
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
  return { handOffChat, handOffMode, openHandOff, modeSwitchLabel, modeSwitchContext, switchMode, handOff };
}
