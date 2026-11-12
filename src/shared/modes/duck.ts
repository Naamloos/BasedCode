import { defineMode, finalTurn } from './defineMode.js';

export default defineMode({
  id: 'duck',
  command: 'duck',
  title: 'Duck chat',
  label: 'Rubber duck mode',
  color: '#E0A800',
  menu: 'Rubber duck debugging: explain your bug and the agent asks questions, reproduces and tests ideas with you, without changing code unless you ask',
  banner: 'Explain what should happen and what happens instead. The agent asks questions, reproduces the problem and tests ideas with you. It will not change your code unless you ask.',
  greetings: ["Quack. What's broken?", 'Talk me through the bug.', 'Explain it to the duck.'],
  wrapUpNotice: 'The agent cleans up temporary debug code and posts a debugging report in this chat. The chat is locked afterwards, so you cannot send it more prompts.',
  examples: [
    {
      title: 'It broke and I do not know why',
      hint: 'From symptom to cause, one test at a time',
      prompt:
        'Something is broken. Expected: [what should happen]. Actual: [what happens instead, with the exact error]. To reproduce: [steps]. Ask me what you need, then help me narrow it down with experiments instead of guesses.',
    },
    {
      title: 'Flaky test',
      hint: 'Pin down a test that only fails sometimes',
      prompt:
        'The test [name or file] fails about [how often], [locally / only in CI]. Help me find what differs between a passing and a failing run: timing, order, shared state or environment.',
    },
    {
      title: 'Worked yesterday',
      hint: 'Bisect to the change that broke it',
      prompt:
        '[Feature] worked [when / at which commit or version] and is broken now: [what happens]. Help me find the change that broke it, by bisecting if we have to.',
    },
    {
      title: 'Check my feature',
      hint: 'Talk it through and look for the holes',
      prompt:
        'I just built [feature] in [files]. I will explain how it works; stop me wherever my explanation does not match the code or misses a case (empty input, errors, concurrency, permissions).',
    },
  ],
  icon: `
    <path d="M4 14.2c0-.9.7-1.4 1.6-1.4H10c3 0 5.2-.4 7.4-2.2.6-.5 1.5-.3 1.8.4.9 2.2 1.8 4 1.8 5.8 0 3-3 5.2-7.4 5.2H9.2C6 22 4 19 4 14.2Z" fill="#FFD43B" stroke="#D99A00" stroke-width="1" stroke-linejoin="round" />
    <circle cx="9" cy="8.2" r="4.6" fill="#FFD43B" stroke="#D99A00" stroke-width="1" />
    <path d="M4.8 8c-1.5-.2-2.9.3-3.3 1.2 1 .8 2.5 1 3.8.5Z" fill="#FF8C1A" stroke="#D9650A" stroke-width=".7" stroke-linejoin="round" />
    <circle cx="8.3" cy="7.2" r="1.1" fill="#1F1F1F" />
    <circle cx="8.7" cy="6.8" r=".35" fill="#FFFFFF" />
    <path d="M10.4 14.4c.8 2.5 4.2 3.4 6.8 1.3-1.8.3-3.7-.1-5-1.4Z" fill="#F5B800" stroke="#D99A00" stroke-width=".7" stroke-linejoin="round" />
  `,
  prompt: `RUBBER DUCK MODE
You are the duck: help the user find the bug or verify the feature themselves. Ask and observe; do not take over. No fixes unless the user asks.
- Start with three things: what should happen, what happens instead, how to reproduce it. Ask at most two focused questions per turn.
- Have them walk the code path step by step. Restate it briefly and point at the gaps: assumptions, and places where expected and actual behavior can diverge.
- Prefer observation over guessing: read the code, run it, add temporary logging, run tests or a reproduction.
- Keep an explicit list of hypotheses with update_plan; mark each confirmed or ruled out, with the evidence.
- Propose small experiments that cut the search space in half.
- When the cause is found, explain it and propose the fix, then remove the temporary debugging code you added.
- Short turns: one observation or question at a time.
- "It worked before": find the last good commit and bisect (git bisect, or by hand) instead of theorizing.
- Shrink the reproduction to the smallest input or script that still fails; most bugs give themselves up on the way.
- Before any fix, capture the bug as a failing test, so the fix is proven and stays fixed.
- Once the cause is known, ask whether the same mistake exists elsewhere and search for its siblings.`,
  wrapUpPrompt: `${finalTurn}
First remove any temporary logging or debugging code you added (keep intended fixes). Then write a debugging report. Reply in this chat; do not write it to a file.
Sections: Symptom · Reproduction · Hypotheses (each confirmed or ruled out, with evidence) · Root cause · Fix (applied or proposed) · Follow-ups. If the cause was not found, say so and list the most promising next experiments.`,
});
