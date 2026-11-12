import { defineMode, finalTurn } from './defineMode.js';

export default defineMode({
  id: 'performance',
  command: 'perf',
  title: 'Performance chat',
  label: 'Performance detective mode',
  color: '#0EA5E9',
  menu: 'Performance detective: measure first, find the real bottleneck, then fix it with you and prove the improvement',
  banner: 'Describe what feels slow. The agent sets up a measurement, profiles to find the real bottleneck, proposes fixes ranked by impact and verifies each with numbers.',
  greetings: ["Aight, what's slow?", 'Where are the milliseconds going?', "Measure first. What's dragging?"],
  wrapUpNotice: 'The agent posts a performance report with before and after numbers. The chat is locked afterwards, so you cannot send it more prompts.',
  examples: [
    {
      title: 'Something feels slow',
      hint: 'Measure it and find the bottleneck',
      prompt:
        '[What] feels slow: it takes about [how long] when [doing what, with how much data], and it should take [target]. Set up a repeatable measurement first, then find where the time goes.',
    },
    {
      title: 'Speed up startup',
      hint: 'Profile how the app starts',
      prompt:
        'The app takes [how long] to start on [machine or environment]. Profile startup, show me where the time goes as a breakdown, and rank what is worth fixing.',
    },
    {
      title: 'Slow page or screen',
      hint: 'Rendering, network and data loading',
      prompt:
        'The [screen] is slow to [load / respond to input] with [amount of data]. Find out whether the time goes to the network, the data layer or rendering, with numbers for each.',
    },
    {
      title: 'Memory or bundle size',
      hint: 'Find what is taking up the space',
      prompt:
        '[The process uses too much memory / the bundle is too large]: currently [number], and I want [target]. Measure what takes up the space and rank what to cut by size saved against effort.',
    },
  ],
  icon: `
    <path d="M2.5 17a9.5 9.5 0 1 1 19 0 1.5 1.5 0 0 1-1.5 1.5H4A1.5 1.5 0 0 1 2.5 17Z" fill="#38BDF8" stroke="#0369A1" stroke-width="1" />
    <path d="M5.2 16a6.8 6.8 0 0 1 13.6 0" fill="none" stroke="#E0F2FE" stroke-width="1.6" stroke-dasharray="2 1.6" />
    <path d="m12 16 4.4-5" stroke="#B91C1C" stroke-width="1.8" />
    <circle cx="12" cy="16" r="1.6" fill="#1E293B" />
  `,
  prompt: `PERFORMANCE DETECTIVE MODE
Make the app measurably faster, guided by numbers and never by guesses.
- Pin down the symptom: what is slow, for whom, how slow, and what fast enough means. Turn it into a measurable target.
- Measure before changing anything: a repeatable benchmark or profile (profilers, timing logs, browser performance tools, query plans, bundle analysis). Record the baseline, with run-to-run variation.
- Find the bottleneck from the data. Track suspects with update_plan and rule each in or out with evidence. Usual culprits: repeated work, N+1 queries, blocking I/O, needless rendering, large payloads, missing caches or indexes, algorithmic complexity.
- Propose fixes ranked by expected impact against cost, with their tradeoffs (complexity, memory, staleness).
- One change at a time, once the user agrees; re-measure the same way and report before and after. Revert what does not help.
- Remove temporary instrumentation when you are done with it.
- Measure in a production-like build with realistic data sizes; debug builds and toy data point at the wrong bottleneck.
- Look at the distribution (p50, p95, worst case), not only the average: users feel the tail.
- Estimate the ceiling before optimizing: if the suspect is 5% of the time, fixing it cannot matter. Say so and move on.
- After each fix, confirm the behavior is unchanged (run the tests); faster and wrong is a regression.
- Leave a guard behind: a benchmark, a performance test or a budget check, so the gain does not rot.`,
  wrapUpPrompt: `${finalTurn}
First remove temporary instrumentation you added (keep intended fixes). Then write a performance report. Reply in this chat; do not write it to a file.
Sections: Symptom and target · Measurement method · Bottlenecks found (with evidence) · Changes made · Before and after numbers · Remaining opportunities.`,
});
