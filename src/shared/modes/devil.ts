import { defineMode, finalTurn } from './defineMode.js';

export default defineMode({
  id: 'devil',
  command: 'devil',
  title: "Devil's advocate chat",
  label: "Devil's advocate mode",
  color: '#EF4444',
  menu: "Devil's advocate: the agent argues against your design, questions assumptions, hunts edge cases and pitches competing designs",
  banner: 'Describe a design or decision. The agent will not just agree: it challenges your reasoning, finds edge cases and failure modes, and argues for alternatives until the design holds up.',
  greetings: ["Pitch me. I'll tear it apart.", 'Convince me this is a good idea.', 'Which design are we roasting?'],
  wrapUpNotice: 'The agent posts a design review with the surviving design, open risks and rejected alternatives. The chat is locked afterwards, so you cannot send it more prompts.',
  examples: [
    {
      title: 'Attack my design',
      hint: 'Find the flaws before users do',
      prompt:
        'Here is my design for [what]: [the design]. Its goals are [goals] and its constraints are [constraints]. Find its weakest points and tell me which one would actually sink it.',
    },
    {
      title: 'Challenge a decision',
      hint: 'Argue for the option I did not pick',
      prompt:
        'I chose [option] over [alternative] because [reasons]. Make the strongest honest case for the alternative, and tell me what evidence would settle it.',
    },
    {
      title: 'Pre-mortem',
      hint: 'It failed a year from now. Why?',
      prompt:
        'We are about to [plan]. Assume it is a year later and it failed. Write the most likely reasons, then check whether the plan defends against each.',
    },
    {
      title: 'Stress-test my assumptions',
      hint: 'Which ones is the plan resting on?',
      prompt:
        'My plan is to [plan]. List the assumptions it depends on, pick the shakiest, and show me what happens when each one turns out false.',
    },
  ],
  icon: `
    <path d="M5 9.5 3.2 3.5l5 3.3M19 9.5l1.8-6-5 3.3" fill="#B91C1C" stroke="#7F1D1D" stroke-width="1" />
    <circle cx="12" cy="13.5" r="8" fill="#EF4444" stroke="#991B1B" stroke-width="1" />
    <path d="m7.8 11.2 2.6 1.3M16.2 11.2l-2.6 1.3" stroke="#7F1D1D" stroke-width="1.3" fill="none" />
    <circle cx="9.3" cy="13.6" r="1" fill="#FEF2F2" />
    <circle cx="14.7" cy="13.6" r="1" fill="#FEF2F2" />
    <path d="M8.8 16.8c2 1.6 4.4 1.6 6.4 0" stroke="#7F1D1D" stroke-width="1.2" fill="none" />
  `,
  prompt: `DEVIL'S ADVOCATE MODE
Attack the user's design so that what survives is defensible. Agreement is earned, not the default. Do not change code unless asked.
- First restate the design and its goals in a few lines, so you attack the real thing. Ask for context only when you cannot reason without it. Read the codebase to ground objections in real constraints.
- Name the assumptions the design rests on and go after the shakiest: what happens when each is false?
- Hunt failure modes: concurrency, partial failure, scale, empty and huge inputs, security, migration and rollback, operating cost, and how it ages as requirements change.
- Argue honestly for at least one competing design a reasonable engineer would pick, and compare the tradeoffs.
- Rank objections by severity and lead with the one that actually threatens the design. A few strong objections beat a long list.
- Challenge the reasoning, not the person. When a point is answered well, concede it in a line and move on; never invent problems or reargue a settled point.
- Steelman first: state the strongest version of their design before attacking it, so the objections land on what they meant.
- Run a pre-mortem: it is a year later and this failed. Write the most likely reasons, then check whether the design defends against each.
- Weigh reversibility: a decision that is cheap to undo deserves less resistance than a one-way door (data formats, public APIs, schema, vendor lock-in). Say which this is.
- Ask what evidence would settle a disputed point, and propose the cheapest experiment or spike that produces it.`,
  wrapUpPrompt: `${finalTurn}
Write a design review. Reply in this chat; do not write it to a file.
Sections: The design as it stands · Objections resolved (and how) · Open risks (ranked) · Alternatives considered and why they lost · Recommendations.`,
});
