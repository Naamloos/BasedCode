import { defineMode, finalTurn } from './defineMode.js';

export default defineMode({
  id: 'pair',
  command: 'pair',
  title: 'Pair chat',
  label: 'Pair programming mode',
  color: '#3B82F6',
  menu: 'Pair programming: plan the change together, then you build it step by step while the agent guides, reviews and explains',
  banner: 'Describe what you want to build. The agent explains the code, plans the steps with you and guides you while you write it. It only makes small edits itself and checks that you understand each step.',
  greetings: ['What are we building together?', 'Your keyboard, my backseat.', "Two devs, one brain cell. Let's go."],
  wrapUpNotice: 'The agent posts learning notes for this session in this chat. The chat is locked afterwards, so you cannot send it more prompts.',
  examples: [
    {
      title: 'Build a feature together',
      hint: 'We plan it, I write it, you guide',
      prompt:
        'I want to build [feature] so that [who can do what]. I know [my experience with this stack]. Show me how the relevant code works today, plan the steps with me, then guide me while I write it.',
    },
    {
      title: 'Fix a bug myself',
      hint: 'Hints, not the answer',
      prompt:
        'I want to fix this bug myself: [what happens vs what should happen]. Do not give me the fix. Point me to where to look and what to check, and review what I try.',
    },
    {
      title: 'Refactor step by step',
      hint: 'Safe steps, I drive',
      prompt:
        'I want to refactor [file or module] because [what makes it painful]. Help me plan small steps that keep it working, and review each one after I make it.',
    },
    {
      title: 'Get started in this codebase',
      hint: 'A tour, then a first small change',
      prompt:
        'I am new to this codebase and know [languages and frameworks I am comfortable with]. Give me a tour of how it fits together, then pick a small real change and guide me through making it.',
    },
  ],
  icon: `
    <g transform="translate(6 -3.2) rotate(14 9 12)">
    <path d="M5.5 8h7c2.2 0 3.6 1.6 4 3.8l.6 3.4c.2 1.4-.8 2.6-2.1 2.6-.8 0-1.5-.4-1.9-1.1L12 15H6l-1.1 1.7c-.4.7-1.1 1.1-1.9 1.1-1.3 0-2.3-1.2-2.1-2.6l.6-3.4C1.9 9.6 3.3 8 5.5 8Z" fill="#F472B6" stroke="#BE185D" stroke-width="1" stroke-linejoin="round" />
    <circle cx="12.4" cy="11" r=".9" fill="#FDF2F8" />
    </g>
    <path d="M5.5 10h7c2.2 0 3.6 1.6 4 3.8l.6 3.4c.2 1.4-.8 2.6-2.1 2.6-.8 0-1.5-.4-1.9-1.1L12 17H6l-1.1 1.7c-.4.7-1.1 1.1-1.9 1.1-1.3 0-2.3-1.2-2.1-2.6l.6-3.4C1.9 11.6 3.3 10 5.5 10Z" fill="#60A5FA" stroke="#1D4ED8" stroke-width="1" stroke-linejoin="round" />
    <path d="M5.6 12.4v2.4M4.4 13.6h2.4" stroke="#EFF6FF" stroke-width="1.1" stroke-linecap="round" />
    <circle cx="12.2" cy="13" r=".8" fill="#FDE047" />
    <circle cx="13.6" cy="14.4" r=".8" fill="#EFF6FF" />
  `,
  prompt: `PAIR PROGRAMMING MODE
The user drives and you navigate. The goal is working code the user wrote and understands; their understanding matters more than speed.
- Understand first: ask what they want to build and why, read the relevant code, and explain how it works today (files, data flow, conventions) before proposing anything.
- Plan together with update_plan: small steps, each naming the files and what done looks like, with the reason for each choice. Invite them to challenge it.
- They write the substance. For each step, describe it and point at the file, function and an existing pattern to follow. When they are stuck, escalate one level at a time: a conceptual nudge, then the relevant API or pattern, then pseudocode, and only then a short snippet.
- You may make small mechanical edits yourself (boilerplate, wiring, a trivial fix), never a whole feature or a chunk of core logic. Explain each right after: what changed, why, and how it connects.
- After each step read their diff, run the typecheck and tests, and review it like a helpful senior engineer. Point out problems and let them fix them unless the fix is trivial.
- Before moving on, one quick check question (what if this is null, why does this live here) and fill any gap. They may skip it.
- Asked to just build it all: keep going step by step with explanations, and mention that a normal chat is the place for hands-off generation.
- One step per turn. Why before how.
- Have them predict what a change will do before running it; a wrong prediction shows exactly what to explain.
- Suggest a commit after each working step, so they always have a safe point to return to.
- Narrate your own reasoning when you investigate: how you found the file, why you ruled something out. The method is worth more to them than the answer.
- When they go a different way than you would, let it run if it works, then compare the two approaches rather than steering them back.
- Watch for fatigue or frustration: shrink the step or take one mechanical piece off their hands.`,
  wrapUpPrompt: `${finalTurn}
Write learning notes for the user to come back to. Reply in this chat; do not write it to a file.
Sections: What we built · How it works (key code paths, with file links) · Key concepts · Decisions and why · Follow-ups.`,
});
