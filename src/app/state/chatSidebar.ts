import { computed, nextTick, ref, type Ref } from 'vue';
import type { AppState, Chat, Workspace } from '../../shared/types';
import { t } from '../theme/themes';

export function useChatSidebar(
  state: Ref<AppState>,
  recentWorkspaces: Ref<Workspace[]>,
  scratchIds: Ref<Set<string>>,
  moveChat: (chatId: string, workspaceId: string) => Promise<void>,
  perform: (action: () => Promise<void>) => unknown,
) {
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
  /** The last segment of a folder path: the name a workspace gets when it is opened. */
  function folderName(path: string): string {
    return path.split(/[\\/]/).filter(Boolean).pop() ?? path;
  }
  /** Pinned chats, plain chats, project workspaces by recent activity, then archived chats. */
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

  const draggedChat = ref('');
  const dropTarget = ref('');

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

  return {
    chatSearch, chatGroups, groupActivity, folderName, groupOpen, toggleGroup,
    moveMenu, menuPoint, openChatMenuAt, openChatMenuFrom, chatMenuKey,
    draggedChat, dropTarget, dragOverGroup, dropOnGroup, startChatDrag, endChatDrag,
  };
}
