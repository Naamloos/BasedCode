import { defineMode, finalTurn } from './defineMode.js';

export default defineMode({
  id: 'tests',
  command: 'tests',
  title: 'Test architect chat',
  label: 'Test architect mode',
  color: '#22C55E',
  menu: 'Test architect: say what you want covered and the agent designs a test plan and writes the tests for the feature',
  banner: 'Say which feature or behavior you want tested. The agent studies the code and existing tests, proposes a test plan, then writes and runs the tests.',
  greetings: ['What are we covering today?', 'What needs tests before it bites?', 'Show me the untested stuff.'],
  wrapUpNotice: 'The agent posts a coverage report for the tests written in this session. The chat is locked afterwards, so you cannot send it more prompts.',
  examples: [
    {
      title: 'Test a feature',
      hint: 'A plan first, then the tests',
      prompt:
        'I want tests for [feature] in [files]. Study the code and our existing tests, propose a test plan (behaviors, level, what to mock), and write the tests once I agree.',
    },
    {
      title: 'Cover the risky parts',
      hint: 'Find untested code that matters',
      prompt:
        'Find the riskiest untested code in [area or the whole project]: the paths where a bug would cost the most. Rank them, then write tests for the top ones.',
    },
    {
      title: 'Regression test for a bug',
      hint: 'Lock in a fix so it stays fixed',
      prompt:
        'We had a bug where [what happened] when [conditions]. The fix is in [file or commit]. Write a regression test that fails without the fix and passes with it, and show me both runs.',
    },
    {
      title: 'Test the edge cases',
      hint: 'Boundaries, bad input and failures',
      prompt:
        'Write edge case tests for [function or feature]: boundaries, empty and invalid input, very large input, error handling, and concurrent use if it applies. Report anything the code gets wrong instead of adapting the test.',
    },
  ],
  icon: `
    <path d="M9 2.5h6M10 2.5v6.2L4.2 18.8A1.8 1.8 0 0 0 5.8 21.5h12.4a1.8 1.8 0 0 0 1.6-2.7L14 8.7V2.5" fill="#E0F2FE" stroke="#475569" stroke-width="1" />
    <path d="M7.1 13.8h9.8l2.9 5a1.8 1.8 0 0 1-1.6 2.7H5.8a1.8 1.8 0 0 1-1.6-2.7Z" fill="#4ADE80" stroke="#15803D" stroke-width="1" />
    <circle cx="10" cy="17.4" r="1" fill="#DCFCE7" />
    <circle cx="13.6" cy="18.8" r=".7" fill="#DCFCE7" />
  `,
  prompt: `TEST ARCHITECT MODE
Design and build tests for what the user wants covered.
- Understand first: read the code under test, its callers, and the existing tests, framework, helpers and fixtures. Follow their conventions.
- Propose a plan with update_plan before writing anything: the behaviors to cover (happy paths, edge cases, boundaries, error handling, regressions), the level of each (unit, integration, end-to-end), and what to mock and why. Test behavior through public interfaces, not implementation details, and do not mock what runs for real cheaply.
- Get the user's go-ahead, then write the tests, run them and make them pass.
- A test that fails because the code is wrong is a finding: report it with the evidence. Never bend a test to pass, and never weaken, skip or delete an existing test to get green.
- Each test must be able to fail: check that it would catch the bug it guards against.
- Readable tests: names that state the behavior, one concern each, minimal setup.
- Tests should not flake: no real time, sleeps, network, randomness or dependence on test order unless the test controls them.
- Prove a key test bites: break the code under test on purpose, watch the test fail, then restore it.
- Where inputs form a large space (parsers, serializers, math, state machines), propose property-based or table-driven tests instead of a handful of examples.
- When code is hard to test, say what makes it so (hidden dependencies, global state, mixed concerns) and propose the smallest seam, rather than mocking around it.`,
  wrapUpPrompt: `${finalTurn}
First run the tests written in this session one last time. Then write a coverage report. Reply in this chat; do not write it to a file.
Sections: Tests added (with file links) · Behaviors covered · Bugs found · Gaps not covered yet · Final test run result.`,
});
