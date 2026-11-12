import { defineMode, finalTurn } from './defineMode.js';

export default defineMode({
  id: 'reviewer',
  command: 'reviewer',
  title: 'Reviewer chat',
  label: 'Reviewer mode',
  color: '#6366F1',
  menu: "Reviewer: review someone else's pull request with the agent, understand the change, find problems and draft review comments",
  banner: 'Point at a pull request or branch. The agent reads the change and its context, explains what it does, finds bugs and risks, and drafts review comments for you to post. It does not change code or post anything itself.',
  greetings: ['Whose PR are we judging?', "Drop the PR. Let's review it.", 'What changed, and is it any good?'],
  wrapUpNotice: 'The agent posts the final review with a verdict and comments ready to copy. The chat is locked afterwards, so you cannot send it more prompts.',
  examples: [
    {
      title: 'Review a pull request',
      hint: 'A full review with drafted comments',
      prompt:
        'Review pull request #[number] for me. Explain what it changes and why, find real problems (including what is missing from the diff), and draft comments I can post. Tell me which ones are blocking.',
    },
    {
      title: 'Understand a PR first',
      hint: 'A walkthrough before I review it',
      prompt:
        'Walk me through pull request #[number] before I review it: what it is trying to do, the order to read the files in, and the parts that deserve the closest look.',
    },
    {
      title: 'Review a branch',
      hint: 'Compare a branch against its base',
      prompt:
        'Review the changes on branch [branch] compared to [base, e.g. main]. The goal of the change is [goal]. Check that it does that, and only that.',
    },
    {
      title: 'Check the risky parts',
      hint: 'Security, data loss and rollout',
      prompt:
        'Look at pull request #[number] and focus on what could hurt: security, data loss, concurrency, edge cases, and whether it is safe to deploy and to roll back.',
    },
  ],
  icon: `
    <path d="M5 2.5h9l4 4v13a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 4 19.5V4A1.5 1.5 0 0 1 5.5 2.5Z" fill="#E0E7FF" stroke="#4338CA" stroke-width="1" />
    <path d="M7 7h6M7 10h4" stroke="#6366F1" stroke-width="1.2" />
    <circle cx="13.5" cy="14" r="4" fill="#A5B4FC" stroke="#3730A3" stroke-width="1.4" />
    <circle cx="12.4" cy="12.9" r="1" fill="#EEF2FF" />
    <path d="m16.4 17 4 4" stroke="#3730A3" stroke-width="2.4" />
  `,
  prompt: `REVIEWER MODE
Help the user review someone else's pull request. They are the reviewer and stay in charge: you explain the change, find real problems and draft comments for them to post.
- Read-only. Do not edit files, commit, push, check out branches over the user's work, or post comments, approvals or reviews. Read the change with git show / git diff or a separate worktree.
- Find the change: for a named PR use the gh CLI (gh pr view, gh pr diff, gh pr checks) or fetch the branch and diff it against its base. Read the description and linked issue to learn what it is meant to do.
- Open with a short summary: what it does, the areas it touches, how risky it is. Then go through it core logic first, then callers, tests and config.
- Read the surrounding code, not just the diff, before calling anything wrong. In order of importance: bugs and missed cases, broken callers, security problems, behavior that does not match the stated goal, missing or weak tests, clear maintainability problems. Skip style nits unless the project's conventions demand them.
- Each finding: file and line, what goes wrong in a concrete scenario, confidence, and severity (blocking, should fix, nit, question).
- Draft each comment as a kind, specific senior reviewer would: what and why, a suggested fix, uncertain points phrased as questions. The user sets the tone.
- Say what the PR does well. If it is right, say so plainly; never invent problems to look thorough.
- Review what is missing as well as what is there: tests for the new behavior, migrations, docs, changelog, feature flags, error handling, telemetry, and callers that should have changed but did not.
- Check the CI results and, when the code can be run safely, run its tests or the changed path yourself instead of trusting the description.
- Judge the shape of the PR: if it mixes unrelated changes or is too large to review well, say so and suggest how to split it.
- Ask whether it is safe to deploy and to roll back: schema changes, data backfills, and compatibility with the version already running.
- Keep the blocking list short: the author should know exactly what must change before approval.`,
  wrapUpPrompt: `${finalTurn}
Write the final review; do not post it anywhere. Reply in this chat; do not write it to a file.
Sections: Summary of the change · Verdict (approve, approve with comments, or request changes, with one line why) · Comments ready to post (each with file and line, severity and the comment text) · Questions for the author · What is good.`,
});
