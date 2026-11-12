import { defineMode, finalTurn } from './defineMode.js';

export default defineMode({
  id: 'migration',
  command: 'migrate',
  title: 'Migration chat',
  label: 'Migration planner mode',
  color: '#14B8A6',
  menu: 'Migration planner: plan and carry out an upgrade of packages or frameworks to new versions, step by step with checks in between',
  banner: 'Say what you want to upgrade and to which version. The agent inventories usages, reads the breaking changes, plans small verifiable steps and guides the migration.',
  greetings: ['What are we upgrading today?', 'Which version jump are we surviving?', "Major version bump? Let's plan it."],
  wrapUpNotice: 'The agent posts a migration report: what was upgraded, what changed, and what is left. The chat is locked afterwards, so you cannot send it more prompts.',
  examples: [
    {
      title: 'Upgrade a package',
      hint: 'Breaking changes handled step by step',
      prompt:
        'I want to upgrade [package] from [current version] to [target version]. Read the changelog between them, list the breaking changes that touch our code, and plan the upgrade in steps we can verify.',
    },
    {
      title: 'Upgrade a framework',
      hint: 'A major version, safely',
      prompt:
        'Help me migrate this project from [framework and current version] to [target version]. Record a passing baseline first, then plan it through intermediate versions if that is safer.',
    },
    {
      title: 'Update outdated dependencies',
      hint: 'What is behind, and in which order',
      prompt:
        'List the outdated dependencies in this project. Group them by risk (patch, minor, major, security fixes first) and plan the order to update them in, with a check after each group.',
    },
    {
      title: 'Switch to another library',
      hint: 'Replace one dependency with another',
      prompt:
        'I want to replace [current library] with [new library] because [reason]. Find every place we use the old one, map each use to the new API, flag what has no equivalent, and plan the switch.',
    },
  ],
  icon: `
    <rect x="10.9" y="3" width="2.2" height="18.5" rx=".6" fill="#A16207" stroke="#713F12" stroke-width=".8" />
    <path d="M4 4.3h12.6l3.2 2.9-3.2 2.9H4a1 1 0 0 1-1-1V5.3a1 1 0 0 1 1-1Z" fill="#2DD4BF" stroke="#0F766E" stroke-width="1" />
    <path d="M20 11.6H7.4l-3.2 2.9 3.2 2.9H20a1 1 0 0 0 1-1v-3.8a1 1 0 0 0-1-1Z" fill="#14B8A6" stroke="#0F766E" stroke-width="1" />
    <path d="M8 21.5h8" stroke="#713F12" stroke-width="1.2" />
  `,
  prompt: `MIGRATION PLANNER MODE
Plan an upgrade of packages or frameworks and carry it through safely, in small verified steps.
- Establish the current state: versions in use (manifests and lockfiles), target versions, and why they are upgrading.
- Research the path from official changelogs, release notes and migration guides between current and target. List breaking changes, deprecations and new peer or runtime requirements, and name your sources. Do not rely on memory for version details.
- Inventory the impact: search for every usage each breaking change touches, including config, build tooling, types and tests.
- Plan with update_plan: small steps (intermediate versions, codemods, one subsystem at a time), each with its check (typecheck, tests, build, running the app) and its rollback.
- Execute a step, run its check, fix what broke, then move on. Never stack a second step on a failing one. Ask before large or risky changes.
- Start from a clean, passing baseline on its own branch and record the checks' results first; a failure that predates the upgrade is not yours to chase mid-migration.
- Check what else pins the version: transitive and peer dependencies, the lockfile, runtime versions in CI, Dockerfiles, engines fields and deployment config.
- Treat new deprecation warnings as the to-do list for the next upgrade and report them.
- Commit, or have the user commit, after each green step, so a rollback is one step and not the whole migration.
- Tests can pass on behavior that changed silently (defaults, error types, ordering, timing): read the changelog for those, then look at the affected features in the running app.`,
  wrapUpPrompt: `${finalTurn}
Write a migration report. Reply in this chat; do not write it to a file.
Sections: Upgrades (from and to versions) · Breaking changes handled · Code changed (with file links) · Verification results · Remaining steps and risks.`,
});
