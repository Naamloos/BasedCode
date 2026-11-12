import { defineMode, finalTurn } from './defineMode.js';

export default defineMode({
  id: 'archaeology',
  command: 'dig',
  title: 'Archaeology chat',
  label: 'Archaeology mode',
  color: '#D97706',
  menu: 'Archaeology: trace execution paths and dependencies, dig through git history to explain why the code is the way it is and what a change would break',
  banner: 'Ask why something works the way it does, where a value comes from, or what a change would break. The agent traces code paths and git history and explains with evidence. It does not change code.',
  greetings: ['What are we digging up today?', 'Who wrote this, and why?', 'Grab a shovel. Which code?'],
  wrapUpNotice: 'The agent posts a map of what was uncovered in this chat. The chat is locked afterwards, so you cannot send it more prompts.',
  examples: [
    {
      title: 'Why is it like this?',
      hint: 'The reason, from git history',
      prompt:
        'Why is [file, function or behavior] implemented this way? Find when and why it was done from the git history, and tell me whether that reason still holds today.',
    },
    {
      title: 'What would break?',
      hint: 'Every caller and dependency, ranked',
      prompt:
        'If I change or remove [function, field, endpoint or config], what breaks? Find every caller and dependency, including dynamic and string-based references, and rank them by impact.',
    },
    {
      title: 'Trace a path',
      hint: 'From entry point to effect',
      prompt:
        'Trace what happens from [trigger, e.g. the user clicks Save] until [effect, e.g. the row is written], step by step with file links. Mark every process, network and storage boundary on the way.',
    },
    {
      title: 'Map the system',
      hint: 'A mental model I can keep',
      prompt:
        'Help me build a mental model of [this project / this subsystem]: the main components, how they talk to each other, where the data lives, and the three files I should read first. A diagram is welcome.',
    },
  ],
  icon: `
    <path d="M4.2 19.8 15 9" stroke="#78350F" stroke-width="3.6" />
    <path d="M4.2 19.8 15 9" stroke="#D97706" stroke-width="2.2" />
    <path d="M10.5 3.5Q21 3 20.5 13.5Q18.5 5.5 10.5 3.5Z" fill="#CBD5E1" stroke="#475569" stroke-width="1" />
    <rect x="13.9" y="7" width="3.2" height="3.2" rx=".7" transform="rotate(45 15.5 8.6)" fill="#94A3B8" stroke="#475569" stroke-width="1" />
  `,
  prompt: `ARCHAEOLOGY MODE
Explain the system as it is and why it got that way, with evidence. Read-only: no edits, and only commands that observe (git log/blame/show, git log -S/-G/--follow, dependency listings, running the app or tests to watch behavior).
- "How does it work": trace from entry point to effect, naming each file and function with links, and mark every boundary crossed (process, network, storage, async).
- "Why is it like this": find the commits that introduced or changed it and read their messages, diffs and linked issues or PRs. Separate what the history proves from what you infer, and say so when the reason was never recorded.
- "What breaks if": find every caller, importer, config, test and runtime path that depends on it, including dynamic and string-based references, and rank them by impact.
- Every claim carries its evidence (file:line or commit). Anything unverified is labelled a guess.
- Answer the question first, then show the trail. A Mermaid diagram beats a paragraph for flows and dependencies. Track components found and open questions with update_plan.
- Chesterton's fence: for anything that looks odd, say whether the reason it was built that way still holds today, or whether it is now safe to remove.
- Point out landmines you pass on the way: dead code, misleading names, comments that contradict the code, load-bearing hacks, and behavior that only works by accident.
- Note who knows: the authors with the most commits in an area are the people to ask what the history does not record.`,
  wrapUpPrompt: `${finalTurn}
Remove nothing and change nothing. Write a field report. Reply in this chat; do not write it to a file.
Sections: Questions asked · System map (components and paths, with file links) · Historical findings (each design choice with its commit or evidence) · Impact analysis (if asked) · Open questions.`,
});
