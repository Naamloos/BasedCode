import { defineMode, finalTurn } from './defineMode.js';

export default defineMode({
  id: 'incident',
  command: 'incident',
  title: 'Incident chat',
  label: 'Incident mode',
  color: '#DC2626',
  menu: 'Incident: something is broken in production. Stop the bleeding first, then find the cause from logs and recent changes, and end with a postmortem',
  banner:
    'Say what is broken and who is affected. The agent helps you stabilize first, then works from logs, recent changes and evidence to the cause, and keeps a timeline for the postmortem. It asks before running anything risky.',
  greetings: ['Prod on fire? Talk to me.', "What's down, and since when?", "Stay calm. What's broken in prod?"],
  wrapUpNotice:
    'The agent posts a blameless postmortem with the timeline, root cause and follow-up actions. The chat is locked afterwards, so you cannot send it more prompts.',
  examples: [
    {
      title: 'Production is down',
      hint: 'Stabilize first, diagnose after',
      prompt:
        'Production is broken: [what users see] since [time]. Affected: [who and how many]. Recent changes: [deploys, config, migrations]. Help me stop the harm first, then find the cause.',
    },
    {
      title: 'Errors spiked after a deploy',
      hint: 'Find which change did it',
      prompt:
        'Errors went up after the deploy at [time] ([version or commit range]). Here is what I see: [error messages, logs, graphs]. Tell me whether to roll back, and find the change that caused it.',
    },
    {
      title: 'Read these logs',
      hint: 'Make sense of a stack trace or log dump',
      prompt:
        'Here are the logs from the failure: [paste logs]. Tell me what is going wrong, which line matters, what is only noise, and where in our code it comes from.',
    },
    {
      title: 'Write the postmortem',
      hint: 'A blameless write-up with actions',
      prompt:
        'We had an incident: [what happened, when, what we did, how it was fixed]. Help me write a blameless postmortem with a timeline, the root cause, and concrete follow-up actions. Ask me for whatever is missing.',
    },
  ],
  icon: `
    <path d="M12 2.5 22 20H2Z" fill="#FECACA" stroke="#991B1B" stroke-width="1" stroke-linejoin="round" />
    <path d="M12 9v5.5" stroke="#B91C1C" stroke-width="2" />
    <circle cx="12" cy="17.2" r="1.1" fill="#B91C1C" />
  `,
  prompt: `INCIDENT MODE
Something is broken for real users. Restore service first, understand it second, prevent it third. Be calm, brief and exact: short turns, the next action first.
- Triage in the first turn: what is broken, who is affected and how badly, since when, and what changed around then (deploy, config, data, traffic, dependency, certificate, quota). Ask only for what you cannot find out yourself.
- Mitigate before diagnosing: if a rollback, feature flag, restart, scale-up or traffic shift would likely stop the harm, propose it now with its risk. A reverted deploy can be investigated at leisure; an outage cannot.
- You work in this workspace, not in production. Give the user exact commands to run against live systems and say what each does. Never run anything destructive or irreversible, and never touch production data, without the user's explicit go-ahead.
- Diagnose from evidence: logs, stack traces, metrics, and the diff between the last good and first bad version (git log, git diff, git bisect). Keep hypotheses with update_plan and mark each confirmed or ruled out, with the evidence. Most incidents are a recent change: check that before anything exotic.
- Keep a timeline as you go: when each thing happened and when each action was taken, with times from the user or the logs. Never invent a timestamp.
- Separate the trigger (what set it off) from the root cause (why that was able to break things) and from what delayed detection or recovery.
- A hotfix is the smallest change that stops the harm, with a test when time allows. Say plainly what is a stopgap and needs proper follow-up.
- Once stable, confirm recovery with evidence, then check for damage left behind: bad data written, jobs that need replaying, users who need telling.
- Blameless throughout: systems and processes fail, people do not.`,
  wrapUpPrompt: `${finalTurn}
Write a blameless postmortem. Reply in this chat; do not write it to a file.
Sections: Summary (what broke, impact, duration) · Timeline · Trigger and root cause · What went well · What made it worse or slower to fix · Fix applied (and what is still a stopgap) · Follow-up actions (each concrete, with a suggested owner role and priority) · Open questions. Mark anything not confirmed by evidence as unconfirmed.`,
});
