import { defineMode, finalTurn } from './defineMode.js';

export default defineMode({
  id: 'docs',
  command: 'docs',
  title: 'Docs chat',
  label: 'Docs writer mode',
  color: '#0D9488',
  menu: 'Docs writer: write or fix documentation that is checked against the code, from READMEs and guides to API references and decision records',
  banner:
    'Say what needs documenting and who will read it. The agent reads the code, verifies every command and example, and writes documentation that matches what the project actually does.',
  greetings: ['What needs documenting?', "Let's write docs people actually read.", 'Docs that match the code. Where to?'],
  wrapUpNotice:
    'The agent posts a summary of the documentation written and what is still undocumented. The chat is locked afterwards, so you cannot send it more prompts.',
  examples: [
    {
      title: 'Write the README',
      hint: 'What it is, setup and first use',
      prompt:
        'Write a README for this project, for [who will read it]. Cover what it does, how to set it up and the first thing to try. Run every command yourself before you write it down.',
    },
    {
      title: 'Document a feature',
      hint: 'A guide checked against the code',
      prompt:
        'Write documentation for [feature], for [users / developers on this project]. Cover what it does, how to use it with a working example, and its limits and error cases.',
    },
    {
      title: 'Find outdated docs',
      hint: 'Compare the docs with the code',
      prompt:
        'Check the documentation in [folder or files] against the code. List what is wrong, out of date or missing, with the evidence for each, and ask me before fixing anything where the code might be the bug.',
    },
    {
      title: 'Record a decision',
      hint: 'Why we did it this way',
      prompt:
        'Write a decision record for choosing [what we chose] over [alternatives]. The context: [the problem and constraints at the time]. Cover the consequences, including the downsides we accepted.',
    },
  ],
  icon: `
    <path d="M4 4.5A1.5 1.5 0 0 1 5.5 3H11v16H5.5A1.5 1.5 0 0 0 4 20.5Z" fill="#99F6E4" stroke="#115E59" stroke-width="1" />
    <path d="M20 4.5A1.5 1.5 0 0 0 18.5 3H13v16h5.5a1.5 1.5 0 0 1 1.5 1.5Z" fill="#5EEAD4" stroke="#115E59" stroke-width="1" />
    <path d="M6.2 7h2.8M6.2 10h2.8M15 7h2.8M15 10h2.8" stroke="#0F766E" stroke-width="1.1" />
  `,
  prompt: `DOCS WRITER MODE
Write documentation that is true, useful to its reader, and short. The code is the source of truth: document what it does, not what it was meant to do.
- Start with the reader: who they are, what they already know, and what they are trying to get done. One or two questions if the user has not said. Then pick the kind of document and do not mix kinds: tutorial (learn by doing), how-to (solve one task), reference (look it up), explanation (understand why), or decision record.
- Read the code, config and existing docs first. Follow the project's existing doc structure, tone and format; extend a document that exists rather than starting a competing one.
- Verify everything you write down: run the commands, check that examples work, and confirm flags, defaults, paths and names against the source. What you could not verify, mark as unverified instead of guessing.
- Lead with what the reader needs first: what it is and how to get it working, then details. Show a working example before explaining options.
- Write plainly: short sentences, second person, present tense, one idea per paragraph, concrete over abstract. Define a term once and keep using the same word. No marketing, no filler, no restating the code line by line.
- Explain why where the code cannot: tradeoffs, constraints, and the non-obvious. Document limits, error cases and what is not supported.
- When you find docs that contradict the code, report it and ask which is right before changing either; the code may be the bug.
- Keep docs next to what they describe and link rather than duplicate, so there is one place to update. Do not change code in this mode beyond fixing a comment or docstring.
- Track the documents to write with update_plan. Ask before overwriting an existing file.`,
  wrapUpPrompt: `${finalTurn}
Write a documentation summary. Reply in this chat; do not write it to a file.
Sections: Documents written or changed (with file links) · What was verified and how · Mismatches found between docs and code · Still undocumented · Unverified claims to check.`,
});
