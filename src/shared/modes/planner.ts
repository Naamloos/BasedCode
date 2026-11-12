import { defineMode, finalTurn } from './defineMode.js';

export default defineMode({
  id: 'planner',
  command: 'plan',
  title: 'Planner chat',
  label: 'Planner mode',
  color: '#8B5CF6',
  menu: 'Planner: turn an idea into a written implementation plan with scope, design, ordered tasks and risks, before any code is written',
  banner:
    'Describe what you want to build or change. The agent studies the code, asks what it cannot find out itself, and writes an implementation plan you can hand to a normal chat. It does not write the code.',
  greetings: ["Big idea? Let's plan it first.", 'What are we scoping today?', 'Plan first, code later. What is it?'],
  wrapUpNotice:
    'The agent writes the final plan to a file and summarizes it here. The chat is locked afterwards, so you cannot send it more prompts.',
  examples: [
    {
      title: 'Plan a feature',
      hint: 'Scope, design and ordered tasks',
      prompt:
        'I want to add [feature] so that [who can do what]. Constraints: [deadline, things that must not change, tech to use or avoid]. Study the code, ask me what you cannot find out yourself, and write an implementation plan.',
    },
    {
      title: 'Plan a big change',
      hint: 'A safe order of steps',
      prompt:
        'I want to change [current structure] into [target structure] because [reason]. Plan how to get there in steps that each leave the app working and can ship on their own.',
    },
    {
      title: 'Break down a ticket',
      hint: 'Turn a vague request into tasks',
      prompt:
        'Here is the request as I got it: [paste the ticket]. Tell me what is unclear, state the assumptions you would make, and break it into tasks with acceptance criteria.',
    },
    {
      title: 'Compare approaches',
      hint: 'Options, tradeoffs and a recommendation',
      prompt:
        'I need to [goal]. I am considering [option A] and [option B]. Compare them against this codebase (effort, risk, how reversible each is), add an option I missed if there is one, and recommend one.',
    },
  ],
  icon: `
    <rect x="4" y="3.5" width="16" height="18" rx="2" fill="#EDE9FE" stroke="#5B21B6" stroke-width="1" />
    <rect x="8.5" y="2" width="7" height="3.4" rx="1" fill="#A78BFA" stroke="#5B21B6" stroke-width="1" />
    <path d="m7 10 1.3 1.3L10.6 9M7 15l1.3 1.3 2.3-2.3" fill="none" stroke="#7C3AED" stroke-width="1.3" />
    <path d="M12.5 10.3h4.5M12.5 15.3h4.5" stroke="#5B21B6" stroke-width="1.2" />
  `,
  prompt: `PLANNER MODE
Turn the user's idea into an implementation plan good enough that someone else, or a fresh chat, could build it without asking questions. Do not write the feature here: read, ask, and plan.
- Ground it in the code first: find where the change lands, the patterns it should follow, and what already exists that it can reuse. Cite files with links.
- Ask only what the code cannot tell you (intent, priorities, constraints, deadlines), one or two questions per turn. State the assumptions you are making for everything else.
- Pin down scope before design: the goal, who it is for, what done looks like as checkable acceptance criteria, and what is explicitly out of scope.
- When there is a real choice, give two or three approaches with tradeoffs (complexity, risk, reversibility, effort) and recommend one. Do not pad with options nobody would pick.
- Cut the work into ordered tasks small enough to review on their own. Each names the files it touches, what done looks like, how it is verified, and what it depends on. Put the riskiest unknown first, and mark tasks that can run in parallel.
- Prefer a thin end-to-end slice first, then widening, over building layer by layer.
- Call out what plans usually forget: data migration and backfill, backwards compatibility, error and empty states, permissions, tests, docs, rollout and rollback, and how you will know it works in production.
- Flag risks and open questions with who can answer them. Give rough sizes (S/M/L), not hour estimates.
- Track the plan with update_plan as it firms up. When it is agreed or the user asks, write it to a Markdown file (plan.md by default; ask before overwriting).`,
  wrapUpPrompt: `${finalTurn}
Write or update the plan as a Markdown file in the workspace (plan.md unless it already has another name). Sections: Goal · Acceptance criteria · Out of scope · Approach (and the alternatives rejected, with why) · Tasks (ordered, each with files, verification, dependencies and size) · Data, compatibility and rollout · Risks and open questions. Then reply here with a short summary and a link to the file.`,
});
