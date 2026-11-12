/** A starter shown on an empty chat. Clicking it puts the prompt in the composer to edit before sending. */
export interface ModeExample {
  title: string;
  hint: string;
  prompt: string;
}

/**
 * Everything about one guided chat mode, in one place. The app (menus, palette, slash commands, banner,
 * icon, settings, welcome screen) and the agent (system prompt, wrap-up) all read from this.
 * To add a mode: create a file next to this one and list it in shared/chatModes.ts.
 */
export interface ChatModeDefinition<Id extends string = string> {
  /** Stored on the chat. Never rename an existing id: saved chats refer to it. */
  id: Id;
  /** Slash command that starts a new chat in this mode, without the slash. */
  command: string;
  /** Title of a new chat in this mode, and its name in the new-chat menu. */
  title: string;
  /** Name of the mode, shown on the banner and in settings. */
  label: string;
  /** Accent colour for the banner above the composer; matches the icon. */
  color: string;
  /** Tooltip in the new-chat menu. */
  menu: string;
  /** What to expect, shown on the banner tooltip and the empty chat. */
  banner: string;
  /** Headings for the empty chat; one is picked per chat. */
  greetings: readonly string[];
  /** Confirmation text for the Wrap up button. */
  wrapUpNotice: string;
  examples: readonly ModeExample[];
  /** Inner SVG markup for a 24x24 viewBox: a filled, two-tone drawing (light fill, darker outline). */
  icon: string;
  /** Added to the agent's system prompt for every turn in this mode. */
  prompt: string;
  /** Sent once by the Wrap up button; the chat is locked after it, so the report has to stand alone. */
  wrapUpPrompt: string;
}

/** Opens every wrap-up prompt: the chat locks after this turn, so the report has to stand alone. */
export const finalTurn =
  'Wrap up this session. This is the final turn and the chat locks after it: ask nothing and offer no next steps.';

/** Identity helper that keeps the literal `id` type, so the list of modes gives a union of ids. */
export function defineMode<Id extends string>(mode: ChatModeDefinition<Id>): ChatModeDefinition<Id> {
  return mode;
}
