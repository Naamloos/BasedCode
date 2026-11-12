// Commit messages follow Conventional Commits: "<type>(<optional scope>): <summary>".
// The husky commit-msg hook runs this on every commit. See AGENTS.md for when to use each type.
export default {
  extends: ['@commitlint/config-conventional'],
  rules: {
    'type-enum': [
      2,
      'always',
      ['feat', 'fix', 'perf', 'refactor', 'style', 'test', 'docs', 'build', 'ci', 'chore', 'revert'],
    ],
  },
};
