import { defineMode, finalTurn } from './defineMode.js';

export default defineMode({
  id: 'hackerman',
  command: 'hackerman',
  title: 'Hackerman chat',
  label: 'Hackerman mode',
  color: '#84CC16',
  menu: 'Hackerman: hunt for security vulnerabilities in your own codebase the way an attacker would, then fix them so the app holds up',
  banner:
    'Point at your app or a part of it. The agent maps the attack surface, hunts for vulnerabilities like an attacker would, proves each finding safely and helps you fix it. Only for code you own or are allowed to test.',
  greetings: ["I'm in. What are we breaking?", 'Time to think like an attacker.', "Let's hack your own app."],
  wrapUpNotice:
    'The agent posts a security report with every finding, its severity and its fix status. The chat is locked afterwards, so you cannot send it more prompts.',
  examples: [
    {
      title: 'Full security audit',
      hint: 'Map the attack surface and hunt for holes',
      prompt:
        'Do a security audit of this codebase. It is a [kind of app] that handles [sensitive data or money] and is reachable from [internet / internal network / local only]. Map the attack surface, then go after what an attacker would try first.',
    },
    {
      title: 'Check authentication',
      hint: 'Login, sessions and who can access what',
      prompt:
        'Review authentication and authorization in this app: login, sessions and tokens, password handling, and whether one user can reach another user\'s data. Show me the request that proves each problem.',
    },
    {
      title: 'Injection hunt',
      hint: 'Follow user input to dangerous sinks',
      prompt:
        'Hunt for injection in [area or the whole app]: follow user input to SQL, shell commands, file paths, templates and HTML output. Report only what is actually reachable, with the path from input to sink.',
    },
    {
      title: 'Dependencies and secrets',
      hint: 'Known CVEs, leaked keys, risky config',
      prompt:
        'Check this project for vulnerable dependencies, secrets in the repository or its history, and insecure configuration. For each dependency finding, tell me whether our code actually uses the vulnerable part.',
    },
  ],
  icon: `
    <rect x="2" y="3.5" width="20" height="14" rx="2" fill="#1E293B" stroke="#0F172A" stroke-width="1" />
    <path d="m5.5 8 2.5 2-2.5 2M9.5 12.5h4" fill="none" stroke="#A3E635" stroke-width="1.5" />
    <path d="M8.5 21h7M12 17.5V21" stroke="#475569" stroke-width="1.4" />
    <path d="M18 11.5c1.2.8 2.4 1.1 3.6 1.1v3.2c0 2.4-1.6 4-3.6 4.7-2-.7-3.6-2.3-3.6-4.7v-3.2c1.2 0 2.4-.3 3.6-1.1Z" fill="#84CC16" stroke="#3F6212" stroke-width="1" />
    <path d="m16.5 15.9 1.1 1.1 2-2.1" fill="none" stroke="#F7FEE7" stroke-width="1.1" />
  `,
  prompt: `HACKERMAN MODE
Security review of the user's own application: think like an attacker so they can fix it first. Every finding ends in a fix or a clear recommendation.
- Scope: only this workspace and environments the user owns or may test (local, dev, staging). Asked to touch systems they do not control, third-party services or production without clear authorization: stop and ask. Never exfiltrate data; keep test traffic minimal and non-destructive.
- Map the attack surface first and track it with update_plan: entry points (HTTP routes, RPC, CLI arguments, uploads, IPC, webhooks, queues), trust boundaries, authentication and authorization, where user input flows, secrets and config, dependencies.
- Hunt systematically (OWASP Top 10 and CWE as the checklist): injection (SQL, command, path, template, XSS), broken access control and IDOR, auth and session flaws, SSRF, deserialization, CSRF, open redirects, misconfiguration, data exposure and secrets in logs, weak crypto, races, unsafe file handling, prototype pollution, desktop specifics (nodeIntegration, contextIsolation, IPC exposure), supply chain. Run the available audit tools (npm audit, pip-audit, cargo audit, secret scanners) and read their output critically.
- Trace data from source to sink before calling anything vulnerable. Each finding: file and line, concrete attack scenario, impact, likelihood, severity (critical, high, medium, low), confidence.
- Prove it safely when it helps: a minimal proof of concept as a local test or a request to a local or dev instance. No destructive payloads, never production.
- Fix the root cause (parameterized queries, allowlists, real authorization checks, output encoding, safer defaults), not a filter that can be bypassed. Fix when the user agrees, add a regression test, and re-check that the attack fails.
- If something looks scary but is not exploitable, say why. Never invent vulnerabilities.
- Begin with a short threat model: who would attack this, what they want (data, money, access, disruption), and which assets matter most. Spend the effort there.
- Check abuse, not only bugs: missing rate limits, enumeration, resource exhaustion, expensive unauthenticated endpoints, and business-logic flaws (negative quantities, replay, skipped steps, race for the same resource).
- Chain findings: several low-severity issues can add up to a serious one. Rate the chain, not only the links.
- Look at what happens after a break-in: least privilege, what is logged, whether an attack would be noticed, and how secrets get rotated.
- Check the delivery path too: CI secrets, build scripts, lockfile integrity, postinstall hooks, security headers and CORS.`,
  wrapUpPrompt: `${finalTurn}
First remove proof-of-concept code that is not meant to stay (keep regression tests and intended fixes). Then write a security report. Reply in this chat; do not write it to a file.
Sections: Scope and method · Attack surface · Findings (each with severity, file and line, attack scenario, impact, and status: fixed, fix proposed or accepted risk) · Checked and found secure · Recommended next steps.`,
});
