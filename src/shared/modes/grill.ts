import { defineMode, finalTurn } from './defineMode.js';

export default defineMode({
  id: 'grill',
  command: 'grill',
  title: 'Grill chat',
  label: 'Grill mode',
  color: '#F97316',
  menu: 'Grill mode: the agent interrogates you about your design, one hard question at a time, until every gap is answered',
  banner: 'Share your design. The agent grills you with pointed questions, one at a time, and keeps pressing on vague answers until the design is fully thought through.',
  greetings: ["Grill's hot. What's the design?", 'Sit down. I have questions.', "Hope you prepared. What's the plan?"],
  wrapUpNotice: 'The agent posts a summary of the decisions you defended and the questions still open. The chat is locked afterwards, so you cannot send it more prompts.',
  examples: [
    {
      title: 'Grill my design',
      hint: 'One hard question at a time',
      prompt:
        'I am designing [what] for [who]: [short description]. Grill me, one question at a time, until there are no gaps left. Do not let vague answers slide.',
    },
    {
      title: 'Grill my plan',
      hint: 'Find the gaps before I start',
      prompt:
        'Here is my plan to [goal]: [the plan]. Grill me on it before I start building: scope, order of work, risks, and what I am choosing not to do.',
    },
    {
      title: 'Grill my API',
      hint: 'Interrogate an interface design',
      prompt:
        'I am designing this API: [endpoints or signatures]. Its callers are [who]. Grill me on naming, errors, versioning, pagination, auth, and what happens when a caller misuses it.',
    },
    {
      title: 'Grill my data model',
      hint: 'Tables, relations and invariants',
      prompt:
        'Here is my data model for [what]: [tables or types]. Grill me on invariants, deletion, migrations, growth, and the queries it has to serve.',
    },
  ],
  icon: `
    <path d="M12 2c.6 3 3 4.6 4.6 6.6A8 8 0 0 1 12 22a7 7 0 0 1-7-7.2c0-2.6 1.4-4.4 3-5.8.2 1.6.8 2.8 2 3.4C9.6 8.4 10.6 4.6 12 2Z" fill="#FB923C" stroke="#C2410C" stroke-width="1" />
    <path d="M12 12c.4 1.6 1.8 2.4 2.4 3.6A3.4 3.4 0 0 1 12 20.6a3.2 3.2 0 0 1-3-3.4c0-1.6 1-2.6 1.8-3.2.1.8.4 1.4 1 1.6-.2-1.4 0-2.6.2-3.6Z" fill="#FDE047" stroke="#CA8A04" stroke-width=".8" />
  `,
  prompt: `GRILL MODE
Interrogate the user about their design, plan or idea until it is fully thought through. Tough, not hostile. Do not change code.
- Exactly one pointed question per turn, then wait. Never a list of questions.
- Start broad (goal, who it is for, what success looks like), then drill down: data model, interfaces, failure handling, edge cases, testing, rollout, and what they chose not to do.
- A vague, hand-wavy or contradictory answer gets a follow-up, not a pass. Quote the earlier statement it conflicts with.
- Read the codebase to ask sharper questions, and point at real code that contradicts an answer.
- Do not propose your own design or answer your own questions. One clause on why a question matters is fine.
- Track topics covered, answered and open with update_plan.
- Ask what would change their mind, and what they would cut first if they had half the time. Both expose what the design really depends on.
- Ask for numbers where they matter (load, data size, latency, cost, team size) and press on "it depends".
- Probe the unglamorous parts people skip: observability, on-call, data migration, permissions, deletion, and who maintains it in a year.
- When a topic is answered solidly, say so and close it. Stop when every topic is closed instead of inventing more questions.`,
  wrapUpPrompt: `${finalTurn}
Write a summary. Reply in this chat; do not write it to a file.
Sections: The design · Decisions defended (with the reasoning given) · Weak spots found · Questions still open.`,
});
