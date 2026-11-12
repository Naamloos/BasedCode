/** App-wide keyboard shortcuts. Settings store only the bindings a user changed; everything else uses these defaults. */
export const keybindingActions = [
  { id: 'terminal.toggle', name: 'Toggle terminal', defaultKey: 'Ctrl+`' },
  { id: 'sidebar.toggle', name: 'Toggle left sidebar', defaultKey: 'Ctrl+B' },
  { id: 'panel.toggle', name: 'Toggle right panel', defaultKey: 'Ctrl+Alt+B' },
  { id: 'chat.new', name: 'New chat', defaultKey: 'Ctrl+N' },
  { id: 'chat.newPlain', name: 'New plain chat', defaultKey: 'Ctrl+Shift+N' },
  { id: 'chat.next', name: 'Next chat', defaultKey: 'Alt+ArrowDown' },
  { id: 'chat.previous', name: 'Previous chat', defaultKey: 'Alt+ArrowUp' },
  { id: 'chat.rename', name: 'Rename chat', defaultKey: 'F2' },
  { id: 'chat.pin', name: 'Pin or unpin chat', defaultKey: '' },
  { id: 'chat.archive', name: 'Archive or unarchive chat', defaultKey: '' },
  { id: 'chat.export', name: 'Export as Markdown', defaultKey: 'Ctrl+Shift+E' },
  { id: 'chat.compact', name: 'Compact this conversation', defaultKey: '' },
  { id: 'run.stop', name: 'Stop the running agent', defaultKey: 'Ctrl+.' },
  { id: 'composer.focus', name: 'Focus the prompt box', defaultKey: 'Ctrl+L' },
  { id: 'model.pick', name: 'Choose a model', defaultKey: 'Ctrl+Shift+M' },
  { id: 'palette.open', name: 'Command palette', defaultKey: 'Ctrl+P' },
  { id: 'chat.find', name: 'Find in chat', defaultKey: 'Ctrl+F' },
  { id: 'workspace.open', name: 'Open folder', defaultKey: 'Ctrl+O' },
  { id: 'workspace.settings', name: 'Workspace settings', defaultKey: '' },
  { id: 'settings.open', name: 'Open app settings', defaultKey: 'Ctrl+,' },
  { id: 'settings.keybindings', name: 'Keyboard shortcuts', defaultKey: 'Ctrl+Shift+K' },
  { id: 'window.maximize', name: 'Maximize or restore window', defaultKey: 'F11' },
  { id: 'app.quit', name: 'Quit app', defaultKey: 'Ctrl+Q' },
  { id: 'app.reload', name: 'Reload app', defaultKey: 'Ctrl+R' },
] as const;

export type KeybindingAction = (typeof keybindingActions)[number]['id'];

const modifierKeys = new Set(['Control', 'Shift', 'Alt', 'Meta']);

/** Turns a key event into a combo like "Ctrl+Shift+K", or '' while only modifiers are held. */
export function comboFromEvent(event: KeyboardEvent): string {
  if (modifierKeys.has(event.key)) return '';
  // event.code keeps the backtick stable across layouts and Shift; letters and digits come out uppercase.
  let key =
    event.code === 'Backquote' ? '`' : event.key.length === 1 ? event.key.toUpperCase() : event.key;
  if (key === ' ') key = 'Space';
  const parts = [
    event.ctrlKey && 'Ctrl',
    event.altKey && 'Alt',
    event.shiftKey && 'Shift',
    event.metaKey && 'Meta',
  ].filter(Boolean);
  return [...parts, key].join('+');
}

/** The effective binding for every action; an empty string means the user unbound it. */
export function resolveKeybindings(
  overrides: Record<string, string> = {},
): Record<KeybindingAction, string> {
  return Object.fromEntries(
    keybindingActions.map((action) => [action.id, overrides[action.id] ?? action.defaultKey]),
  ) as Record<KeybindingAction, string>;
}

export function actionForEvent(
  event: KeyboardEvent,
  overrides: Record<string, string> = {},
): KeybindingAction | undefined {
  const combo = comboFromEvent(event);
  if (!combo) return undefined;
  const bindings = resolveKeybindings(overrides);
  const bound = keybindingActions.find((action) => bindings[action.id] === combo)?.id;
  if (bound) return bound;
  // Fixed aliases apply only while the user hasn't given that combo to another action.
  return keybindingAliases[combo];
}

/** Extra combos that always trigger an action, on top of its configurable binding. */
const keybindingAliases: Record<string, KeybindingAction> = { 'Ctrl+K': 'palette.open' };
