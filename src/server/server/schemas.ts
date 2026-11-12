import { guidedModeIds } from '../../shared/chatModes.js';
import { z } from 'zod';
import { themeTokenNames } from '../../shared/types.js';

export const id = z.uuid();
export const workspaceInput = z.object({ workspaceId: id });
export const serverConfig = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  transport: z.enum(['stdio', 'http', 'sse']),
  url: z.string().optional(),
  command: z.string().optional(),
  args: z.array(z.string()).optional(),
  enabled: z.boolean().optional(),
  description: z.string().max(2000).optional(),
  env: z.record(z.string().max(200), z.string().max(4000)).optional(),
  headers: z.record(z.string().max(200), z.string().max(4000)).optional(),
  secretEnv: z.array(z.string().max(200)).max(50).optional(),
  secretHeaders: z.array(z.string().max(200)).max(50).optional(),
  auth: z.enum(['none', 'oauth']).optional(),
  oauth: z
    .object({ clientId: z.string().max(500).optional(), scopes: z.string().max(2000).optional() })
    .optional(),
  registry: z
    .object({ registryId: z.string().max(100), name: z.string().max(300), version: z.string().max(100) })
    .optional(),
});
export const mcpRegistry = z.object({
  id: z.string().min(1).max(100),
  name: z.string().min(1).max(100),
  url: z
    .string()
    .url()
    .max(500)
    .refine((value) => value.startsWith('https://') || /^http:\/\/(127\.0\.0\.1|localhost)[:/]/.test(value), 'Registry URLs must use HTTPS.'),
  enabled: z.boolean(),
  format: z.enum(['official', 'mcpcentral', 'truespar']).optional(),
});
const approvalMode = z.enum(['always', 'per-tool', 'no-commands', 'allow-all']);
const providerSchema = z.object({
  id: z.string().min(1),
  kind: z.enum(['codex', 'claude', 'antigravity', 'ollama', 'lmstudio', 'openai']),
  model: z.string(),
  endpoint: z.string(),
  enabled: z.boolean(),
  requireConsent: z.boolean(),
  name: z.string().max(60).optional(),
  effort: z.string().max(20).optional(),
});
const budgetSchema = z.object({
  maxToolCalls: z.number().int().min(1).max(100_000).optional(),
  maxTokens: z.number().int().min(1_000).optional(),
  maxCostUsd: z.number().min(0.01).max(10_000).optional(),
});
const commandRulesSchema = z.object({
  allow: z.array(z.string().max(2000)).max(200),
  deny: z.array(z.string().max(2000)).max(200),
});
export const settingsSchema = z.object({
  fallback: z
    .array(z.object({ providerId: z.string().min(1), enabled: z.boolean() }))
    .max(30)
    .optional(),
  approvalMode: approvalMode.optional(),
  mcpServers: z.array(serverConfig).max(30).optional(),
  budget: budgetSchema.optional(),
  fixFailedChecks: z.boolean().optional(),
  instructions: z.string().max(20_000).optional(),
  defaultMode: z.enum(['default', ...guidedModeIds]).optional(),
  commandRules: commandRulesSchema.optional(),
  checks: z.array(z.object({ name: z.string(), command: z.string() })).max(30),
  editor: z.object({ command: z.string().min(1), args: z.array(z.string()) }),
});
export const globalSchema = z.object({
  welcomeDismissed: z.boolean().default(false),
  providers: z.array(providerSchema).max(30),
  approvalMode,
  language: z.enum(['en', 'nl', 'based']).default('based'),
  disabledTools: z.array(z.string().min(1).max(100)).default([]),
  mcpServers: z.array(serverConfig).max(100),
  mcpRegistries: z.array(mcpRegistry).max(20).optional(),
  knownMcpRegistries: z.array(z.string().max(100)).max(50).optional(),
  languageServers: z
    .array(
      z.object({
        id: z.string().min(1),
        name: z.string(),
        languages: z.array(z.string()),
        command: z.string().min(1),
        args: z.array(z.string()),
      }),
    )
    .max(30),
  compaction: z.object({
    enabled: z.boolean(),
    thresholdTokens: z.number().int().min(4_000).max(2_000_000),
  }),
  appearance: z.object({
    theme: z.string().max(40),
    lightTheme: z.string().max(40).default('normie'),
    customThemes: z.array(z.object({
      id: z.string().regex(/^custom-[a-z0-9-]+$/).max(40),
      name: z.string().trim().min(1).max(60),
      scheme: z.enum(['dark', 'light']),
      tokens: z.record(z.enum(themeTokenNames), z.string().regex(/^#[0-9a-fA-F]{6}([0-9a-fA-F]{2})?$/)),
    })).max(100).refine((items) => new Set(items.map((item) => item.id)).size === items.length).optional(),
    mode: z.enum(['dark', 'light', 'system']).default('dark'),
    flame: z.string().max(40),
  }),
  keybindings: z.record(z.string().max(60), z.string().max(60)).default({}),
  codexPath: z.string().max(1000),
  claudePath: z.string().max(1000),
  antigravityPath: z.string().max(1000).optional(),
  cloudflaredPath: z.string().max(1000).optional(),
  newWorkspace: settingsSchema.optional(),
  commandRules: commandRulesSchema.optional(),
  budget: budgetSchema.optional(),
  fixFailedChecks: z.boolean().optional(),
  secretGuard: z.boolean().optional(),
  deferTools: z.boolean().optional(),
  profile: z
    .object({
      name: z.string().max(100).optional(),
      occupation: z.string().max(200).optional(),
      experience: z.enum(['', 'beginner', 'intermediate', 'expert']).optional(),
      voice: z.enum(['based', 'plain']).optional(),
      about: z.string().max(4000).optional(),
      avatar: z
        .string()
        .max(500_000)
        .regex(/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/)
        .optional(),
    })
    .optional(),
  notifications: z
    .object({
      enabled: z.boolean(),
      url: z.union([z.literal(''), z.string().url().max(500).refine((value) => /^https?:/.test(value))]),
      format: z.enum(['ntfy', 'json', 'discord', 'slack', 'telegram', 'gotify']),
      approvals: z.boolean(),
      finished: z.boolean(),
    })
    .optional(),
});
