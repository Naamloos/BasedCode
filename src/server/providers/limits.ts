import { execFile, type ChildProcess, type ChildProcessByStdio } from 'node:child_process';
import type { Readable, Writable } from 'node:stream';
import crossSpawn from 'cross-spawn';
import { createInterface } from 'node:readline';
import { mkdir, readFile } from 'node:fs/promises';
import { promisify } from 'node:util';
import { z } from 'zod';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { query } from '@anthropic-ai/claude-agent-sdk';
import type { LimitWindow, ProviderLimits } from '../../shared/types.js';
import { Store } from '../storage/store.js';
import { Events } from '../storage/events.js';
import { antigravityOptions, cliPath } from './cli.js';

interface CodexWindow {
  usedPercent: number;
  windowDurationMins?: number | null;
  resetsAt?: number | null;
}
interface CodexSnapshot {
  primary?: CodexWindow | null;
  secondary?: CodexWindow | null;
  limitName?: string | null;
  planType?: string | null;
}

const windowLabel = (minutes?: number | null) =>
  !minutes
    ? 'Window'
    : minutes <= 300
      ? `${Math.round(minutes / 60)}-hour`
      : minutes >= 10_000
        ? 'Weekly'
        : `${Math.round(minutes / 1440)}-day`;

const claudeWindowNames: Record<string, string> = {
  five_hour: '5-hour',
  seven_day: 'Weekly',
  seven_day_opus: 'Weekly (Opus)',
  seven_day_sonnet: 'Weekly (Sonnet)',
  overage: 'Extra usage',
};

/**
 * Subscription usage windows for Codex, Claude Code and Antigravity. Codex answers on demand through its
 * app-server. Claude windows come only from the OAuth usage endpoint (or a
 * one-request fallback check), never from runs, whose per-response events are partial and go stale. The latest snapshot per provider is kept in the store.
 */
export class Limits {
  constructor(
    private readonly store: Store,
    private readonly events: Events,
  ) {}

  list(): ProviderLimits[] {
    return this.store.all("limits");
  }

  private save(limits: ProviderLimits): void {
    this.store.put("limits", limits);
    this.events.publish("state");
  }

  /** Reads the CLI's quota report without starting a model turn. */
  async refreshAntigravity(override = ""): Promise<ProviderLimits> {
    const options = antigravityOptions(override);
    const home = join(options.runtimeDir, "home");
    const cwd = join(options.runtimeDir, "workspace");
    await mkdir(home, { recursive: true });
    await mkdir(cwd, { recursive: true });
    const { stdout } = await promisify(execFile)(
      options.agyPath ?? "agy",
      [
        ...(options.agyArgs ?? []),
        "-p",
        "/usage",
        "--output-format",
        "json",
        "--mode",
        "plan",
      ],
      {
        cwd,
        env: { ...process.env, ...options.env, HOME: home, USERPROFILE: home },
        timeout: 20_000,
        maxBuffer: 1_000_000,
        windowsHide: true,
      },
    );
    // This is the CLI's structured slash-command report, not a model's token usage.
    const report = z
      .object({
        status: z.literal("SUCCESS"),
        command: z.object({
          name: z.literal("usage"),
          data: z.object({
            groups: z.array(
              z.object({
                name: z.string(),
                buckets: z.array(
                  z.object({
                    name: z.string().optional(),
                    window: z.string(),
                    remaining_fraction: z.number().min(0).max(1).nullish(),
                    reset_time: z
                      .string()
                      .refine((value) => Number.isFinite(Date.parse(value)))
                      .nullish(),
                    disabled: z.boolean().optional(),
                  }),
                ),
              }),
            ),
          }),
        }),
      })
      .parse(JSON.parse(stdout));
    const windows: LimitWindow[] = report.command.data.groups.flatMap((group) =>
      group.buckets.flatMap((bucket) =>
        bucket.disabled || bucket.remaining_fraction == null
          ? []
          : [
              {
                label: `${group.name} · ${bucket.window === "5h" ? "5-hour" : bucket.window === "weekly" ? "Weekly" : (bucket.name ?? bucket.window)}`,
                usedPercent: Math.round((1 - bucket.remaining_fraction) * 100),
                resetsAt: bucket.reset_time ?? undefined,
              },
            ],
      ),
    );
    if (!windows.length)
      throw new Error("Antigravity did not report any active usage windows.");
    const limits: ProviderLimits = {
      id: "antigravity",
      kind: "antigravity",
      windows,
      updatedAt: new Date().toISOString(),
      source: "Antigravity account",
    };
    this.save(limits);
    return limits;
  }

  /** Reads Codex's `account/rateLimits/read` over a short-lived `codex app-server`. Uses no model quota. */
  async refreshCodex(codexPath: string): Promise<ProviderLimits> {
    const executable = cliPath("codex", codexPath);
    if (!executable) throw new Error("Codex CLI was not found on PATH.");
    // cross-spawn also runs npm's codex.cmd shim, which plain spawn refuses on Windows.
    const child = crossSpawn(
      /\.[cm]?js$/i.test(executable) ? "node" : executable,
      [...(/\.[cm]?js$/i.test(executable) ? [executable] : []), "app-server"],
      { stdio: ["pipe", "pipe", "ignore"], windowsHide: true },
    ) as ChildProcessByStdio<Writable, Readable, null>;
    const pending = new Map<
      number,
      { resolve: (value: unknown) => void; reject: (error: Error) => void }
    >();
    let nextId = 1;
    createInterface({ input: child.stdout }).on("line", (line) => {
      let message: {
        id?: number;
        result?: unknown;
        error?: { message?: string };
      };
      try {
        message = JSON.parse(line);
      } catch {
        return;
      }
      if (message.id === undefined || !pending.has(message.id)) return;
      const waiter = pending.get(message.id)!;
      pending.delete(message.id);
      if (message.error)
        waiter.reject(
          new Error(message.error.message ?? "Codex app-server error."),
        );
      else waiter.resolve(message.result);
    });
    const request = (method: string, params: unknown) =>
      new Promise<unknown>((resolve, reject) => {
        const id = nextId++;
        pending.set(id, { resolve, reject });
        child.stdin.write(JSON.stringify({ id, method, params }) + "\n");
      });
    const exited = new Promise<never>((_, reject) => {
      child.once("error", reject);
      child.once("exit", (code) =>
        reject(new Error(`Codex app-server exited (${code}).`)),
      );
    });
    const timeout = new Promise<never>((_, reject) =>
      setTimeout(
        () => reject(new Error("Codex did not report usage within 20 s.")),
        20_000,
      ),
    );
    try {
      const result = await Promise.race([
        (async () => {
          await request("initialize", {
            clientInfo: {
              name: "basedcode",
              title: "BasedCode",
              version: "0.1.0",
            },
          });
          child.stdin.write(JSON.stringify({ method: "initialized" }) + "\n");
          return (await request("account/rateLimits/read", null)) as {
            rateLimits?: CodexSnapshot;
            rateLimitsByLimitId?: Record<string, CodexSnapshot> | null;
          };
        })(),
        exited,
        timeout,
      ]);
      const snapshot = result.rateLimitsByLimitId?.codex ?? result.rateLimits;
      const windows: LimitWindow[] = [
        snapshot?.primary,
        snapshot?.secondary,
      ].flatMap((window) =>
        window
          ? [
              {
                label: windowLabel(window.windowDurationMins),
                usedPercent: window.usedPercent,
                resetsAt: window.resetsAt
                  ? new Date(window.resetsAt * 1000).toISOString()
                  : undefined,
              },
            ]
          : [],
      );
      const limits: ProviderLimits = {
        id: "codex",
        kind: "codex",
        windows,
        plan: snapshot?.planType ?? undefined,
        updatedAt: new Date().toISOString(),
        source: "Codex account",
      };
      this.save(limits);
      return limits;
    } finally {
      stop(child);
    }
  }

  /** Records one Claude `rate_limit_event`; each event describes one window, so windows accumulate per type. */
  recordClaude(
    info: {
      status?: string;
      rateLimitType?: string;
      utilization?: number;
      resetsAt?: number;
    },
    source: string,
  ): void {
    if (!info.rateLimitType) return;
    const previous = this.list().find((item) => item.id === "claude");
    const label = claudeWindowNames[info.rateLimitType] ?? info.rateLimitType;
    // Utilization arrives as a fraction; tolerate a percentage too.
    const usedPercent =
      info.utilization === undefined
        ? undefined
        : info.utilization <= 1
          ? Math.round(info.utilization * 100)
          : Math.round(info.utilization);
    const window: LimitWindow = {
      label,
      usedPercent,
      status: info.status as LimitWindow["status"],
      resetsAt: info.resetsAt
        ? new Date(info.resetsAt * 1000).toISOString()
        : undefined,
    };
    const windows = [
      ...(previous?.windows ?? []).filter((item) => item.label !== label),
      window,
    ].sort(
      (a, b) =>
        Object.values(claudeWindowNames).indexOf(a.label) -
        Object.values(claudeWindowNames).indexOf(b.label),
    );
    this.save({
      id: "claude",
      kind: "claude",
      windows,
      updatedAt: new Date().toISOString(),
      source,
    });
  }

  /**
   * Refreshes Claude windows. Tries the OAuth usage endpoint Claude Code's `/usage` reads first, which costs no quota;
   * falls back to one minimal Haiku request when that is unavailable (API-key login, expired token, endpoint changed).
   */
  async refreshClaude(claudePath: string): Promise<ProviderLimits | undefined> {
    try {
      const limits = await this.fetchClaudeUsage();
      if (limits) return limits;
    } catch {
      /* Fall back to a usage check request. */
    }
    return this.probeClaude(claudePath);
  }

  /**
   * Reads `GET /api/oauth/usage` with Claude Code's stored OAuth token. The endpoint is undocumented and may change.
   * The token is read from disk per call, sent only to api.anthropic.com and never stored or logged.
   */
  private async fetchClaudeUsage(): Promise<ProviderLimits | undefined> {
    const configDir =
      process.env.CLAUDE_CONFIG_DIR || join(homedir(), ".claude");
    let credentials: {
      claudeAiOauth?: {
        accessToken?: string;
        expiresAt?: number;
        subscriptionType?: string;
      };
    };
    try {
      credentials = JSON.parse(
        await readFile(join(configDir, ".credentials.json"), "utf8"),
      );
    } catch {
      return undefined;
    }
    const oauth = credentials.claudeAiOauth;
    if (
      !oauth?.accessToken ||
      (oauth.expiresAt && oauth.expiresAt < Date.now())
    )
      return undefined;

    const response = await fetch("https://api.anthropic.com/api/oauth/usage", {
      headers: {
        Authorization: `Bearer ${oauth.accessToken}`,
        "anthropic-beta": "oauth-2025-04-20",
      },
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) return undefined;
    const body = (await response.json()) as Record<
      string,
      { utilization?: number | null; resets_at?: string | null } | null
    >;

    // Utilization is already a percentage here, unlike the fraction in `rate_limit_event`.
    const windows: LimitWindow[] = Object.entries(claudeWindowNames).flatMap(
      ([key, label]) => {
        const window = body[key];
        if (!window || typeof window.utilization !== "number") return [];
        return [
          {
            label,
            usedPercent: Math.round(window.utilization),
            resetsAt: window.resets_at ?? undefined,
          },
        ];
      },
    );
    if (!windows.length) return undefined;
    const limits: ProviderLimits = {
      id: "claude",
      kind: "claude",
      windows,
      plan: oauth.subscriptionType,
      updatedAt: new Date().toISOString(),
      source: "Claude account",
    };
    this.save(limits);
    return limits;
  }

  /** Sends one minimal Haiku request so Claude Code reports current windows. Uses a very small amount of quota. */
  private async probeClaude(
    claudePath: string,
  ): Promise<ProviderLimits | undefined> {
    const session = query({
      prompt: "Reply with the single word OK.",
      options: {
        model: "haiku",
        tools: [],
        settingSources: [],
        plugins: [],
        persistSession: false,
        maxTurns: 1,
        pathToClaudeCodeExecutable: cliPath("claude", claudePath),
      },
    });
    const timer = setTimeout(() => session.close(), 45_000);
    try {
      for await (const message of session) {
        if (message.type === "rate_limit_event")
          this.recordClaude(message.rate_limit_info, "Usage check");
        if (message.type === "result") break;
      }
    } finally {
      clearTimeout(timer);
      session.close();
    }
    return this.list().find((item) => item.id === "claude");
  }
}

function stop(child: ChildProcess): void {
  if (child.exitCode !== null) return;
  child.stdin?.end();
  child.kill();
}
