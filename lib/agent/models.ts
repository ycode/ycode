/**
 * Models and providers the in-app AI builder can use.
 *
 * This module has no server-only imports so it can be shared between the client
 * (model picker UI) and the server (request validation). The actual default is
 * still resolved server-side from settings/env in `lib/agent/config.ts`.
 */

export type AgentProviderId = 'anthropic' | 'openai' | 'google' | 'xai' | 'ollama';

/**
 * Default Ollama endpoint. Ollama Cloud speaks the OpenAI Chat Completions API
 * at `/v1`, so the base URL stored here always includes the version prefix.
 */
export const OLLAMA_DEFAULT_BASE_URL = 'https://ollama.com/v1';

/** Placeholder shown when no base URL is stored yet. */
export const OLLAMA_DEFAULT_BASE_URL_LABEL = 'https://ollama.com';

/**
 * Normalize a user-entered Ollama endpoint into an OpenAI-compatible base URL.
 *
 * Users type what they know — "ollama.com", "http://localhost:11434", or a full
 * "/v1" URL — so accept all of them and append `/v1` when it's missing (Ollama's
 * OpenAI-compatible routes live under it). A blank value falls back to Ollama
 * Cloud. Anything that isn't http(s) is rejected so a typo can't turn into a
 * relative fetch that silently resolves against the Ycode origin.
 */
export function resolveOllamaBaseUrl(value: unknown): string | null {
  const raw = typeof value === 'string' ? value.trim() : '';
  if (!raw) return OLLAMA_DEFAULT_BASE_URL;

  // Bare hosts ("ollama.com", "localhost:11434") get an https:// prefix; plain
  // http:// is still honored for a LAN box that has no TLS.
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`;

  let parsed: URL;
  try {
    parsed = new URL(withScheme);
  } catch {
    return null;
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;

  const path = parsed.pathname.replace(/\/+$/, '');
  parsed.pathname = path.endsWith('/v1') ? path : `${path}/v1`;
  parsed.search = '';
  parsed.hash = '';
  return parsed.toString().replace(/\/$/, '');
}

export interface AgentProviderOption {
  id: AgentProviderId;
  label: string;
  /** Env var that supplies the key when no setting is stored. */
  envVar: string;
  /** Input placeholder hint for the key field. */
  keyPlaceholder: string;
  /** Where the user creates an API key. */
  consoleUrl: string;
  consoleLabel: string;
  /** True when the provider works without an API key (self-hosted Ollama has
   * no auth), so the connect form must not require one. */
  keyOptional?: boolean;
  /** Provider serves models from a user-set endpoint rather than a fixed
   * vendor host, so the settings UI must collect a base URL. */
  usesBaseUrl?: boolean;
  /** Endpoint used when the user hasn't stored one. */
  defaultBaseUrl?: string;
}

export const AGENT_PROVIDERS: AgentProviderOption[] = [
  {
    id: 'anthropic',
    label: 'Anthropic (Claude)',
    envVar: 'ANTHROPIC_API_KEY',
    keyPlaceholder: 'sk-ant-...',
    consoleUrl: 'https://console.anthropic.com/settings/keys',
    consoleLabel: 'Anthropic Console',
  },
  {
    id: 'openai',
    label: 'OpenAI (ChatGPT)',
    envVar: 'OPENAI_API_KEY',
    keyPlaceholder: 'sk-...',
    consoleUrl: 'https://platform.openai.com/api-keys',
    consoleLabel: 'OpenAI Platform',
  },
  {
    id: 'google',
    label: 'Google Gemini',
    envVar: 'GEMINI_API_KEY',
    keyPlaceholder: 'AIza...',
    consoleUrl: 'https://aistudio.google.com/apikey',
    consoleLabel: 'Google AI Studio',
  },
  {
    id: 'xai',
    label: 'xAI (Grok)',
    envVar: 'XAI_API_KEY',
    keyPlaceholder: 'xai-...',
    consoleUrl: 'https://console.x.ai',
    consoleLabel: 'xAI Console',
  },
  {
    id: 'ollama',
    label: 'Ollama',
    envVar: 'OLLAMA_API_KEY',
    keyPlaceholder: 'Key (Ollama Cloud only)',
    consoleUrl: 'https://ollama.com/settings/keys',
    consoleLabel: 'Ollama account',
    keyOptional: true,
    usesBaseUrl: true,
    defaultBaseUrl: OLLAMA_DEFAULT_BASE_URL,
  },
];

export interface AgentModelOption {
  id: string;
  label: string;
  provider: AgentProviderId;
  /** Superseded model kept for projects that already have it enabled. Legacy
   * models are excluded from the default enabled set and hidden in settings
   * unless present in the stored allowlist, so no new project can adopt them. */
  legacy?: boolean;
}

export const AGENT_MODELS: AgentModelOption[] = [
  { id: 'claude-opus-5', label: 'Opus 5', provider: 'anthropic' },
  { id: 'claude-fable-5', label: 'Fable 5', provider: 'anthropic' },
  { id: 'claude-sonnet-5', label: 'Sonnet 5', provider: 'anthropic' },
  { id: 'claude-opus-4-8', label: 'Opus 4.8', provider: 'anthropic', legacy: true },
  { id: 'gpt-5.5', label: 'GPT-5.5', provider: 'openai' },
  { id: 'gpt-5-mini', label: 'GPT-5 Mini', provider: 'openai' },
  { id: 'gemini-3.1-pro-preview', label: 'Gemini 3.1 Pro', provider: 'google' },
  { id: 'gemini-3.5-flash', label: 'Gemini 3.5 Flash', provider: 'google' },
  { id: 'grok-4.5', label: 'Grok 4.5', provider: 'xai' },
  { id: 'grok-4.3', label: 'Grok 4.3', provider: 'xai' },
];

/**
 * Model selected by default in the picker. Opus 5 is Anthropic's recommended
 * production tier and prices the same as the Opus 4.8 it replaces; users who
 * want a cheaper (Sonnet 5) or stronger (Fable 5) model — or a different
 * provider — can switch from the dropdown.
 */
export const DEFAULT_AGENT_MODEL = 'claude-opus-5';

/**
 * Model id configured for the project's endpoint, or null.
 *
 * Ollama serves arbitrary model tags ("gpt-oss:120b", "llama3.2:3b"), so unlike
 * the other providers there is no shipped model list to pick from: each project
 * stores one model id and the agent runs that.
 *
 * This is deliberately NOT module state. An earlier design kept the id in a
 * module-level variable written by `resolveAgentConfig` and read later by
 * `providerOfModel`; on a shared server two concurrent requests from different
 * projects interleave between that write and read, so the in-flight request
 * resolved its own model id against a neighbour's — `providerOfModel` returned
 * null and the request fell through to "no API key configured" or silently
 * swapped to the default model. Resolution is now explicit: callers pass the
 * project's model options (from `ResolvedAgentConfig.modelOptions`) into
 * `providerOfModelFrom` / `isAllowedModelFrom`.
 */

/** Model option for a project-configured Ollama model id. */
export function ollamaModelOption(id: string): AgentModelOption {
  return { id, label: id, provider: 'ollama' };
}

/**
 * Model options a project can run: the shipped allowlist plus the project's
 * configured Ollama model, when it has one. Settings pages and the model picker
 * render from this so a configured Ollama model is selectable like any other.
 */
export function agentModelOptions(ollamaModelId?: string | null): AgentModelOption[] {
  return ollamaModelId ? [...AGENT_MODELS, ollamaModelOption(ollamaModelId)] : AGENT_MODELS;
}

/**
 * Models the removed automatic self-review pass ran on, per provider. Kept so
 * providerOfModel still resolves these ids — they appear on assistant turns in
 * older persisted chats (and in stored usage records).
 */
const LEGACY_REVIEW_MODEL_BY_PROVIDER: Record<AgentProviderId, string> = {
  anthropic: 'claude-haiku-4-5',
  openai: 'gpt-5-mini',
  google: 'gemini-3.5-flash',
  xai: 'grok-4.3',
  // The agent's internal review pass never ran on a hosted Ollama model.
  ollama: '',
};

/** Which provider serves a model id, or null for unknown/custom models.
 * Resolves picker models (AGENT_MODELS) and the legacy review-only ids found in
 * older chats. A project's own Ollama model is NOT resolvable here — it is
 * project-specific, so pass the project's `modelOptions` to
 * `providerOfModelFrom` instead. */
export function providerOfModel(id: string): AgentProviderId | null {
  const pickerProvider = AGENT_MODELS.find((model) => model.id === id)?.provider;
  if (pickerProvider) return pickerProvider;
  const reviewEntry = (Object.entries(LEGACY_REVIEW_MODEL_BY_PROVIDER) as Array<[AgentProviderId, string]>)
    .find(([, modelId]) => modelId !== '' && modelId === id);
  return reviewEntry ? reviewEntry[0] : null;
}

/**
 * Which provider serves a model id, resolved against the caller's own model
 * options first.
 *
 * Every caller that holds a `ResolvedAgentConfig` (the chat route, the settings
 * route) must use this: the project's Ollama model id only exists in
 * `modelOptions`, and resolving it from shared state instead is what made two
 * concurrent requests clobber each other. Client components use this too, with
 * the options they received in the settings status.
 */
export function providerOfModelFrom(
  options: readonly AgentModelOption[],
  id: string,
): AgentProviderId | null {
  return options.find((option) => option.id === id)?.provider ?? providerOfModel(id);
}

/**
 * Whether a requested model id is one this project is allowed to use.
 *
 * `options` is the project's own option list (`ResolvedAgentConfig.modelOptions`)
 * so a configured Ollama model is allowed for the project that configured it and
 * for no one else. Omitting it falls back to the shipped allowlist only.
 */
export function isAllowedModelFrom(
  options: readonly AgentModelOption[],
  id: string,
): boolean {
  return options.some((option) => option.id === id) || providerOfModel(id) !== null;
}

/** USD per million tokens, split by how Anthropic bills each token class. */
interface ModelPricing {
  input: number;
  output: number;
  /** Ephemeral (5-minute) cache writes are billed at 1.25x input. */
  cacheWrite: number;
  /** Cache reads are billed at 0.1x input. */
  cacheRead: number;
}

/**
 * Provider list prices (USD / MTok), used for the approximate session cost in
 * the usage badge. Estimates only — not billing data.
 *
 * claude-sonnet-5 uses the introductory rate in effect through Aug 31, 2026
 * ($2/$10); it moves to $3/$15 on Sep 1, 2026.
 *
 * OpenAI and Google cache automatically and don't bill cache writes, so their
 * cacheWrite matches the plain input rate (a cache-writing input token costs
 * the same as an uncached one).
 */
const MODEL_PRICING: Record<string, ModelPricing> = {
  'claude-opus-5': { input: 5, output: 25, cacheWrite: 6.25, cacheRead: 0.5 },
  'claude-fable-5': { input: 10, output: 50, cacheWrite: 12.5, cacheRead: 1 },
  'claude-sonnet-5': { input: 2, output: 10, cacheWrite: 2.5, cacheRead: 0.2 },
  'claude-opus-4-8': { input: 5, output: 25, cacheWrite: 6.25, cacheRead: 0.5 },
  // Review-only fast tier (not in the picker). Estimate for the cost badge.
  'claude-haiku-4-5': { input: 1, output: 5, cacheWrite: 1.25, cacheRead: 0.1 },
  'gpt-5.5': { input: 5, output: 30, cacheWrite: 5, cacheRead: 0.5 },
  'gpt-5-mini': { input: 0.25, output: 2, cacheWrite: 0.25, cacheRead: 0.025 },
  'gemini-3.1-pro-preview': { input: 2, output: 12, cacheWrite: 2, cacheRead: 0.2 },
  'gemini-3.5-flash': { input: 1.5, output: 9, cacheWrite: 1.5, cacheRead: 0.15 },
  // xAI standard-context rates (< 200k prompt tokens); like OpenAI, xAI caches
  // automatically and doesn't bill cache writes separately.
  'grok-4.5': { input: 2, output: 6, cacheWrite: 2, cacheRead: 0.3 },
  'grok-4.3': { input: 1.25, output: 2.5, cacheWrite: 1.25, cacheRead: 0.2 },
};

export interface TokenUsageBreakdown {
  inputTokens: number;
  outputTokens: number;
  cacheWriteTokens: number;
  cacheReadTokens: number;
}

/**
 * Approximate USD cost of a usage report for a given model, or null when the
 * model isn't in the pricing table (e.g. a custom ANTHROPIC_MODEL override) —
 * callers should hide the estimate rather than show a wrong number.
 */
export function estimateCostUsd(model: string, usage: TokenUsageBreakdown): number | null {
  const pricing = MODEL_PRICING[model];
  if (!pricing) return null;

  return (
    (usage.inputTokens * pricing.input +
      usage.outputTokens * pricing.output +
      usage.cacheWriteTokens * pricing.cacheWrite +
      usage.cacheReadTokens * pricing.cacheRead) / 1_000_000
  );
}
