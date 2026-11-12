import { defineMode, finalTurn } from './defineMode.js';

export default defineMode({
  id: 'refactor',
  command: 'refactor',
  title: 'Refactor chat',
  label: 'Refactor mode',
  color: '#F59E0B',
  menu: 'Refactor: improve the structure of existing code in small steps that keep behavior identical, with tests proving it after each one',
  banner:
    'Point at code that is hard to change. The agent pins down its current behavior with tests, then restructures it in small steps, checking after each that nothing changed.',
  greetings: ['What mess are we cleaning up?', 'Point me at the spaghetti.', 'Same behavior, better code. Where?'],
  wrapUpNotice:
    'The agent posts a refactoring report: what was restructured, how it was verified and what is left. The chat is locked afterwards, so you cannot send it more prompts.',
  examples: [
    {
      title: 'Untangle a big file',
      hint: 'Split it along its real responsibilities',
      prompt:
        '[File] has grown too big and does too many things. Tell me what responsibilities you see in it, pin its behavior down with tests where they are missing, then split it in small steps with checks after each.',
    },
    {
      title: 'Remove duplication',
      hint: 'Find the copies, merge the ones that should be',
      prompt:
        'There is duplicated logic around [area]. Find the copies, tell me which are truly the same thing and which only look alike, and consolidate the ones worth merging.',
    },
    {
      title: 'Make it testable',
      hint: 'Add seams so the logic can be tested',
      prompt:
        '[Function or module] is hard to test because [database calls, global state, time, ...]. Restructure it so the logic can be tested on its own, without changing what it does.',
    },
    {
      title: 'Clean up before a feature',
      hint: 'Make the change easy, then make it',
      prompt:
        'I am about to add [feature] to [area]. Restructure the code first so that the feature becomes a small change, and stop there. Do not add the feature yet.',
    },
  ],
  icon: `
    <path d="M4 4h6v6H4ZM14 14h6v6h-6Z" fill="#FDE68A" stroke="#B45309" stroke-width="1" />
    <path d="M14 4h6v6h-6Z" fill="#FBBF24" stroke="#B45309" stroke-width="1" />
    <path d="M7 12.5v3.2a2 2 0 0 0 2 2h2.5" fill="none" stroke="#78350F" stroke-width="1.4" />
    <path d="m10 15.6 2 2.1-2 2.1" fill="none" stroke="#78350F" stroke-width="1.4" />
  `,
  prompt: `REFACTOR MODE
Improve the structure of existing code without changing what it does. Behavior stays identical; if a step changes behavior, it is not a refactoring.
- Understand before moving anything: read the code, its callers and its tests, and say in a few lines what it does and what makes it hard to change. Agree on the goal (readability, testability, room for a coming feature) so the work has a stopping point.
- Establish a safety net first: run the existing tests and record the result. Where the code is not covered, write characterization tests that pin down what it does today, quirks included, before touching it.
- Plan with update_plan as a sequence of small named steps (extract function, rename, move, inline, split module, introduce parameter). Each must leave the code working.
- One step at a time: make it, run the checks, and only then go on. Prefer the language server's rename and code actions over hand edits for mechanical changes. Suggest a commit after each green step.
- Keep refactoring and behavior changes apart. A bug you find is reported, not silently fixed; fix it as its own step if the user wants. No new features, no drive-by formatting.
- Keep public interfaces stable unless the user agrees to change them; when one changes, find and update every caller, including dynamic and string-based ones.
- Do not abstract on speculation: two near-copies may be fine, and the wrong shared abstraction is worse than duplication. Remove code that the change made dead.
- Stop when the goal is met. Say what you chose not to clean up and why.`,
  wrapUpPrompt: `${finalTurn}
First run the checks one last time. Then write a refactoring report. Reply in this chat; do not write it to a file.
Sections: Goal · What changed (structure before and after, with file links) · How behavior was verified · Bugs and oddities found (not fixed unless asked) · Left for later.`,
});
