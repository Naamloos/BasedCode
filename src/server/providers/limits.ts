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
import { randomUUID } from 'node:crypto';
import type { LimitReset, LimitWindow, ProviderLimits } from '../../shared/types.js';
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
    const result = (await codexAppServer(codexPath, (request) =>
      request("account/rateLimits/read", null),
    )) as {
      rateLimits?: CodexSnapshot;
      rateLimitsByLimitId?: Record<string, CodexSnapshot> | null;
      rateLimitResetCredits?: unknown;
    };
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
    const resets = codexResets(result.rateLimitResetCredits);
    const limits: ProviderLimits = {
      id: "codex",
      kind: "codex",
      windows,
      ...(resets.length ? { resets } : {}),
      plan: snapshot?.planType ?? undefined,
      updatedAt: new Date().toISOString(),
      source: "Codex account",
    };
    this.save(limits);
    return limits;
  }

  /**
   * Spends one usage reset. Only called after the user confirms in the UI; the idempotency/request id makes a
   * retried call spend at most one reset. Refreshes the windows afterwards so the UI shows the result.
   */
  async useReset(
    kind: "codex" | "claude",
    resetId: string,
    paths: { codexPath: string; claudePath: string },
  ): Promise<{ ok: boolean; message: string }> {
    const outcome =
      kind === "codex"
        ? await this.useCodexReset(paths.codexPath, resetId)
        : await this.useClaudeReset(resetId);
    await (kind === "codex"
      ? this.refreshCodex(paths.codexPath)
      : this.refreshClaude(paths.claudePath)
    ).catch(() => undefined);
    return outcome;
  }

  private async useCodexReset(
    codexPath: string,
    creditId: string,
  ): Promise<{ ok: boolean; message: string }> {
    const result = (await codexAppServer(codexPath, (request) =>
      request("account/rateLimitResetCredit/consume", {
        idempotencyKey: randomUUID(),
        creditId: creditId || null,
      }),
    )) as { outcome?: string };
    return codexResetOutcome(result.outcome);
  }

  /** Claims a Claude limit-reset grant the way Claude Code's `/limit-reset` does. The endpoint is undocumented. */
  private async useClaudeReset(
    grantId: string,
  ): Promise<{ ok: boolean; message: string }> {
    const oauth = await claudeOAuth();
    if (!oauth)
      return {
        ok: false,
        message:
          "Claude login not found or expired. Run Claude Code once to refresh it, then try again.",
      };
    const organization = await claudeOrganization();
    if (!organization)
      return {
        ok: false,
        message: "Claude Code did not record an organization for this login.",
      };
    const body =
      grantId === claudeWeeklyReset
        ? { program: "juniper_tide" }
        : {
            program: "cedar_ember",
            grant_id: grantId,
            request_id: randomUUID(),
          };
    if ("grant_id" in body && !/^[a-z0-9_-]{1,40}$/.test(grantId))
      return { ok: false, message: "That reset is no longer available." };
    const response = await fetch(
      `https://api.anthropic.com/api/organizations/${encodeURIComponent(organization)}/reset_rate_limits`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${oauth.accessToken}`,
          "anthropic-beta": "oauth-2025-04-20",
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(25_000),
      },
    );
    if (response.status === 401 || response.status === 403)
      return {
        ok: false,
        message: "Claude refused the reset for this login. Run /login in Claude Code, then try again.",
      };
    if (!response.ok)
      return { ok: false, message: "Couldn't reach Claude. Nothing was used; try again in a moment." };
    const result = (await response.json().catch(() => ({}))) as { result?: string };
    return claudeResetOutcome(result.result);
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
      // Run events carry no reset info, so keep what the last account read found.
      ...(previous?.resets ? { resets: previous.resets } : {}),
      ...(previous?.resetsHidden ? { resetsHidden: true } : {}),
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
    const oauth = await claudeOAuth();
    if (!oauth) return undefined;
    const get = (query: string) =>
      fetch(`https://api.anthropic.com/api/oauth/usage${query}`, {
        headers: {
          Authorization: `Bearer ${oauth.accessToken}`,
          "anthropic-beta": "oauth-2025-04-20",
        },
        signal: AbortSignal.timeout(10_000),
      });
    // One request: the reset flags return the usage windows too, and a second call per refresh got rate limited (429).
    const response = await get("?cedar_ember=1&skip_spend=1");
    if (!response.ok) {
      console.error(`Claude usage read failed: HTTP ${response.status}`);
      return undefined;
    }
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
    const resets = claudeResets(body);
    const limits: ProviderLimits = {
      id: "claude",
      kind: "claude",
      windows,
      ...(resets.length ? { resets } : {}),
      ...(!resets.length && claudeResetsHidden(body) ? { resetsHidden: true } : {}),
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

/** Reset id for Claude's once-a-week 5-hour reset, which has no grant id of its own. */
export const claudeWeeklyReset = "weekly-5-hour";

type ResetOutcome = { ok: boolean; message: string };

/** Turns Codex's `rateLimitResetCredits` summary into resets. Codex may report only a count, then picks the credit itself. */
export function codexResets(summary: unknown): LimitReset[] {
  const parsed = z
    .object({
      availableCount: z.number().int().min(0),
      credits: z
        .array(
          z.object({
            id: z.string(),
            title: z.string().nullish(),
            expiresAt: z.number().nullish(),
            status: z.string().optional(),
          }),
        )
        .nullish(),
    })
    .safeParse(summary);
  if (!parsed.success || parsed.data.availableCount === 0) return [];
  const available = (parsed.data.credits ?? []).filter(
    (credit) => credit.status === undefined || credit.status === "available",
  );
  if (!available.length)
    return [{ id: "", label: "Codex reset", left: parsed.data.availableCount }];
  return available.map((credit) => ({
    id: credit.id,
    label: credit.title || "Codex reset",
    left: 1,
    expiresAt: credit.expiresAt
      ? new Date(credit.expiresAt * 1000).toISOString()
      : undefined,
  }));
}

export function codexResetOutcome(outcome?: string): ResetOutcome {
  switch (outcome) {
    case "reset":
      return { ok: true, message: "Codex limits reset." };
    case "alreadyRedeemed":
      return { ok: true, message: "That reset was already used; your limits were reset." };
    case "nothingToReset":
      return { ok: false, message: "No Codex limit needs a reset right now. Nothing was used." };
    case "noCredit":
      return { ok: false, message: "This Codex account has no resets left." };
    default:
      return { ok: false, message: "Codex did not confirm the reset. Check your limits in a moment." };
  }
}

const claudeGrant = z.object({
  id: z.string().regex(/^[a-z0-9_-]{1,40}$/),
  label: z.string().nullish().catch(null),
  resets_left: z.number().int().min(0),
  ends_at: z.string().nullish().catch(null),
  paused: z.boolean().catch(false),
  usable_now: z.boolean().catch(false),
  use_requires_limit: z.boolean().catch(true),
  unavailable_reason: z.string().nullish().catch(null),
});

/** Reads the reset grants (`cedar_ember`) and the weekly 5-hour reset (`juniper_tide`) from Claude's usage response. */
export function claudeResets(body: unknown): LimitReset[] {
  const parsed = z
    .object({
      cedar_ember: z
        .object({
          eligible: z.boolean().catch(false),
          ineligible_reason: z.string().nullish().catch(null),
          // Only its presence matters; the type isn't known, so any non-empty value counts.
          next_grant_id: z.unknown().optional(),
          // Parsed one by one so a single odd grant does not hide the others.
          grants: z.array(z.unknown()).catch([]),
        })
        .nullish()
        .catch(null),
      juniper_tide: z
        .object({ available: z.boolean().catch(false) })
        .nullish()
        .catch(null),
    })
    .safeParse(body);
  if (!parsed.success) return [];
  const { cedar_ember: grants, juniper_tide: weekly } = parsed.data;
  // An ineligible account still lists its grants (for example when the server rejects this client's version),
  // so they are shown with the reason rather than dropped; "no_grant" really means there is nothing to show.
  const blocked = grants && !grants.eligible ? (grants.ineligible_reason ?? "unknown") : undefined;
  const resets: LimitReset[] = (blocked === "no_grant" ? [] : (grants?.grants ?? []))
    .flatMap((raw) => {
      const grant = claudeGrant.safeParse(raw);
      return grant.success ? [grant.data] : [];
    })
    .filter((grant) => grant.resets_left > 0)
    .map((grant) => {
      const reason = blocked ?? grant.unavailable_reason ?? (grant.paused ? "paused" : undefined);
      return {
        id: grant.id,
        label: grant.label || "Claude limit reset",
        left: grant.resets_left,
        expiresAt: grant.ends_at ?? undefined,
        usableNow: grant.usable_now || !grant.use_requires_limit,
        ...(reason ? { unavailableReason: reason } : {}),
      };
    });
  // For clients it doesn't serve ("surface"), the server sends no grant list but still names the next grant,
  // so the user at least learns a reset exists and can use it in Claude Code.
  const nextGrant = grants?.next_grant_id;
  if (blocked && blocked !== "no_grant" && !resets.length && nextGrant != null && nextGrant !== "")
    resets.push({ id: "", label: "Claude limit reset", unavailableReason: blocked });
  if (weekly?.available)
    resets.push({ id: claudeWeeklyReset, label: "Weekly 5-hour reset", left: 1, usableNow: true });
  return resets;
}

/** True when Claude withholds reset details from this client ("surface"): a reset may exist but cannot be seen here. */
export function claudeResetsHidden(body: unknown): boolean {
  if (!body || typeof body !== "object") return false;
  const { cedar_ember: grants, juniper_tide: weekly } = body as Record<string, unknown>;
  const reason = (block: unknown) =>
    block && typeof block === "object"
      ? (block as { ineligible_reason?: unknown }).ineligible_reason
      : undefined;
  return reason(grants) === "surface" || reason(weekly) === "surface";
}

export function claudeResetOutcome(result?: string): ResetOutcome {
  switch (result) {
    case "reset":
      return { ok: true, message: "Claude limits reset." };
    case "already_used":
      return { ok: false, message: "That reset was already used." };
    case "not_limited":
      return { ok: false, message: "You haven't reached a Claude limit yet. Nothing was used." };
    case "cooldown":
      return { ok: false, message: "This reset is cooling down. Try again later." };
    case "ineligible":
      return { ok: false, message: "This Claude account can't use that reset." };
    default:
      return { ok: false, message: "Couldn't reset your Claude limits. Nothing was used; try again in a moment." };
  }
}

const claudeConfigDir = () =>
  process.env.CLAUDE_CONFIG_DIR || join(homedir(), ".claude");

/** Claude Code's stored OAuth login, or undefined when absent or expired. Read per call, never cached. */
async function claudeOAuth(): Promise<
  { accessToken: string; subscriptionType?: string } | undefined
> {
  try {
    const credentials = JSON.parse(
      await readFile(join(claudeConfigDir(), ".credentials.json"), "utf8"),
    ) as {
      claudeAiOauth?: { accessToken?: string; expiresAt?: number; subscriptionType?: string };
    };
    const oauth = credentials.claudeAiOauth;
    if (!oauth?.accessToken || (oauth.expiresAt && oauth.expiresAt < Date.now()))
      return undefined;
    return { accessToken: oauth.accessToken, subscriptionType: oauth.subscriptionType };
  } catch {
    return undefined;
  }
}

/** The organization Claude Code logged in to, from `.claude.json` (inside CLAUDE_CONFIG_DIR, else the home folder). */
async function claudeOrganization(): Promise<string | undefined> {
  const file = process.env.CLAUDE_CONFIG_DIR
    ? join(process.env.CLAUDE_CONFIG_DIR, ".claude.json")
    : join(homedir(), ".claude.json");
  try {
    const config = JSON.parse(await readFile(file, "utf8")) as {
      oauthAccount?: { organizationUuid?: string };
    };
    return config.oauthAccount?.organizationUuid || undefined;
  } catch {
    return undefined;
  }
}

/** Runs JSON-RPC requests against a short-lived `codex app-server`, then stops it. */
async function codexAppServer(
  codexPath: string,
  run: (request: (method: string, params: unknown) => Promise<unknown>) => Promise<unknown>,
): Promise<unknown> {
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
    let message: { id?: number; result?: unknown; error?: { message?: string } };
    try {
      message = JSON.parse(line);
    } catch {
      return;
    }
    if (message.id === undefined || !pending.has(message.id)) return;
    const waiter = pending.get(message.id)!;
    pending.delete(message.id);
    if (message.error)
      waiter.reject(new Error(message.error.message ?? "Codex app-server error."));
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
    child.once("exit", (code) => reject(new Error(`Codex app-server exited (${code}).`)));
  });
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error("Codex did not answer within 20 s.")), 20_000);
  });
  try {
    return await Promise.race([
      (async () => {
        await request("initialize", {
          clientInfo: { name: "basedcode", title: "BasedCode", version: "0.1.0" },
        });
        child.stdin.write(JSON.stringify({ method: "initialized" }) + "\n");
        return run(request);
      })(),
      exited,
      timeout,
    ]);
  } finally {
    clearTimeout(timer);
    stop(child);
  }
}

function stop(child: ChildProcess): void {
  if (child.exitCode !== null) return;
  child.stdin?.end();
  child.kill();
}
