import {
  AGENT_MODELS,
  AGENT_PROVIDERS,
  DEFAULT_AGENT_MODEL,
  agentModelOptions,
  providerOfModelFrom,
  resolveOllamaBaseUrl,
} from '@/lib/agent/models';
import { getSettingsByKeys } from '@/lib/repositories/settingsRepository';

import type { AgentModelOption, AgentProviderId } from '@/lib/agent/models';

/**
 * Resolution of which model/key the in-app agent uses.
 *
 * For self-hosters (BYOK), each provider's API key comes from the settings
 * store or the environment; the model is configurable with a sensible default.
 * Ollama additionally carries a user-set endpoint and its own model id, since
 * both are arbitrary per project. The Ycode Cloud overlay supplies its own
 * hosted resolution.
 */

/** Default model when nothing is configured. Overridable via ANTHROPIC_MODEL or settings. */
export const DEFAULT_ANTHROPIC_MODEL = DEFAULT_AGENT_MODEL;

/**
 * Max tokens per request within a turn. On adaptive-thinking models
 * (Sonnet 5 / Opus 5 / Fable 5, Grok, Gemini) reasoning bills as output and
 * counts against this cap, so 8192 — sized for text + tool calls alone — got
 * whole build turns truncated mid-thought. Every supported model allows at
 * least 64K output, so 16384 is safe across providers.
 */
export const DEFAULT_MAX_TOKENS = 16384;

/** Hard ceiling on tool-calling round trips per user message, to bound runaway loops. */
export const MAX_TOOL_TURNS = 24;

/**
 * Wall-clock budget for one agent run. Vercel's `maxDuration` for the chat
 * route (set in vercel.json, not in the route file) hard-kills the function
 * without streaming anything, leaving the turn silently truncated. The agent
 * loop stops starting new turns once this budget is spent, so long runs end
 * gracefully: page/component snapshots and usage are emitted, and the user
 * gets a resumable "ran out of time" error instead of a silent cut.
 *
 * The default matches vercel.json's 300s (the Vercel hobby-plan ceiling).
 * Deployments that raise maxDuration in their own vercel.json (e.g. Ycode
 * Cloud at 800s) must set AI_CHAT_MAX_DURATION (seconds) to the same value.
 * The 60s buffer below `maxDuration` must cover one full provider turn plus
 * its tool calls and the end-of-run snapshot/CSS work.
 */
const DEFAULT_AI_CHAT_MAX_DURATION_SECONDS = 300;
const RUN_BUFFER_MS = 60_000;
const configuredMaxDurationSeconds = Number(process.env.AI_CHAT_MAX_DURATION);

export const MAX_RUN_MS =
  (Number.isFinite(configuredMaxDurationSeconds) && configuredMaxDurationSeconds > 60
    ? configuredMaxDurationSeconds
    : DEFAULT_AI_CHAT_MAX_DURATION_SECONDS) * 1000 - RUN_BUFFER_MS;

/**
 * Cross-turn conversation history budget, applied before the agent runs so a long
 * chat can't blow past the model's context window (the failure where the agent
 * silently stops editing on big histories). The oldest turns are dropped first.
 * `MAX_HISTORY_CHARS` is a rough proxy for tokens (~chars/4) and leaves headroom
 * for the system prompt, tool schemas, the injected page snapshot, and the
 * in-turn tool-loop growth.
 */
export const MAX_HISTORY_MESSAGES = 24;
export const MAX_HISTORY_CHARS = 160_000;

/** Settings keys holding each provider's API key. */
export const PROVIDER_KEY_SETTINGS: Record<AgentProviderId, string> = {
  anthropic: 'ai_anthropic_api_key',
  openai: 'ai_openai_api_key',
  google: 'ai_google_api_key',
  xai: 'ai_xai_api_key',
  ollama: 'ai_ollama_api_key',
};

export const SETTING_MODEL = 'ai_model';
export const SETTING_ENABLED_MODELS = 'ai_enabled_models';
export const SETTING_AGENT_ENABLED = 'ai_agent_enabled';

/** Ollama endpoint (OpenAI-compatible base URL, e.g. "https://ollama.com/v1"). */
export const SETTING_OLLAMA_BASE_URL = 'ai_ollama_base_url';
/** Model id served by that endpoint ("gpt-oss:120b", "qwen3:8b", ...). */
export const SETTING_OLLAMA_MODEL = 'ai_ollama_model';

/** Env fallbacks for the Ollama endpoint settings. */
const OLLAMA_BASE_URL_ENV_KEYS = ['OLLAMA_BASE_URL'];
const OLLAMA_MODEL_ENV_KEYS = ['OLLAMA_MODEL'];

/** All settings keys that store a provider secret. */
export const AI_SECRET_SETTING_KEYS: string[] = Object.values(PROVIDER_KEY_SETTINGS);

/**
 * Settings key holding a user's personal (only-me) key for a provider.
 * Shared project keys live at the plain PROVIDER_KEY_SETTINGS key; personal
 * keys are suffixed with the owner's user id and shadow the shared key for
 * that user only.
 */
export function personalKeySetting(provider: AgentProviderId, userId: string): string {
  return `${PROVIDER_KEY_SETTINGS[provider]}:${userId}`;
}

/**
 * True for any settings key holding a provider secret — shared
 * ("ai_anthropic_api_key") or per-user ("ai_anthropic_api_key:<userId>").
 * Use this instead of exact-match checks wherever secrets must be filtered.
 */
export function isAgentSecretSettingKey(key: string): boolean {
  return AI_SECRET_SETTING_KEYS.some(
    (secret) => key === secret || key.startsWith(`${secret}:`),
  );
}

export type KeySource = 'setting' | 'env';

/** Who a configured key is available to. */
export type AgentKeyScope = 'all' | 'personal';

export interface ResolvedProviderKey {
  apiKey: string | null;
  /** Where the active key comes from, for the settings UI status display. */
  source: KeySource | null;
  /** Availability of the active key: 'personal' = only the current user,
   * 'all' = everyone on the project (stored shared key or env var). */
  scope: AgentKeyScope | null;
}

export interface ResolvedAgentConfig {
  /** Per-provider key resolution. */
  providers: Record<AgentProviderId, ResolvedProviderKey>;
  /** True when at least one provider has a usable key. */
  configured: boolean;
  /** Whether the agent is enabled at all. Defaults to true; when false the
   * builder hides the Agent tab and the chat API refuses to run. */
  agentEnabled: boolean;
  /** Default model: always allowed, enabled, and served by a configured provider
   * — unless it's a custom env override outside the allowlist. */
  model: string;
  /** Model ids the builder may use. Always a non-empty subset of the project's
   * model options (the shipped allowlist plus its Ollama model). */
  enabledModels: string[];
  /** Resolved Ollama endpoint (OpenAI-compatible base URL). */
  ollamaBaseUrl: string | null;
  /** Model id served by that endpoint, when one is configured. */
  ollamaModel: string | null;
  /** Model options this project can run: the shipped allowlist plus the
   * configured Ollama model. */
  modelOptions: AgentModelOption[];
}

/** Env var(s) each provider's key can come from. */
const PROVIDER_ENV_KEYS: Record<AgentProviderId, string[]> = {
  anthropic: ['ANTHROPIC_API_KEY'],
  openai: ['OPENAI_API_KEY'],
  // GOOGLE_API_KEY is the older alias the Google SDK also honors.
  google: ['GEMINI_API_KEY', 'GOOGLE_API_KEY'],
  xai: ['XAI_API_KEY'],
  ollama: ['OLLAMA_API_KEY'],
};

/** First non-empty env value among `names`. */
function firstEnv(names: string[]): string | null {
  return names.map((name) => asNonEmptyString(process.env[name])).find((value) => value !== null) ?? null;
}

/**
 * Resolve the BYOK configuration for all providers.
 *
 * Key precedence per provider: the user's personal key (when `userId` is
 * given), then the shared settings key, then the env var. Ollama may have no
 * key at all (a self-hosted server doesn't authenticate) and is resolvable on
 * its endpoint + model alone.
 * Model precedence: settings override, then ANTHROPIC_MODEL env var, then the
 * first enabled model of a configured provider.
 * Enabled models come from settings; an empty/invalid value means "all models",
 * and a configured Ollama model is always part of the allowlist.
 */
export async function resolveAgentConfig(
  userId?: string | null,
  /**
   * Settings staged by the caller but not yet written. The settings route
   * validates a request against the configuration that request WILL produce, so
   * it must see the Ollama endpoint/model it is about to store — reading back
   * the persisted rows would validate against the previous state and reject a
   * first-time "set endpoint + model + enable it" save. `undefined` leaves the
   * stored value alone; `null` means the caller is clearing it.
   */
  overrides?: Partial<Record<string, unknown>>,
): Promise<ResolvedAgentConfig> {
  const personalKeys = userId
    ? AGENT_PROVIDERS.map((provider) => personalKeySetting(provider.id, userId))
    : [];
  const stored = await getSettingsByKeys([
    ...AI_SECRET_SETTING_KEYS,
    ...personalKeys,
    SETTING_MODEL,
    SETTING_ENABLED_MODELS,
    SETTING_AGENT_ENABLED,
    SETTING_OLLAMA_BASE_URL,
    SETTING_OLLAMA_MODEL,
  ]).catch(() => ({} as Record<string, unknown>));

  const settings = overrides
    ? { ...stored, ...Object.fromEntries(Object.entries(overrides).filter(([, v]) => v !== undefined)) }
    : stored;

  const providers = {} as Record<AgentProviderId, ResolvedProviderKey>;
  for (const provider of AGENT_PROVIDERS) {
    const personalKey = userId
      ? asNonEmptyString(settings[personalKeySetting(provider.id, userId)])
      : null;
    const sharedKey = asNonEmptyString(settings[PROVIDER_KEY_SETTINGS[provider.id]]);
    const envKey = firstEnv(PROVIDER_ENV_KEYS[provider.id]);
    providers[provider.id] = {
      apiKey: personalKey ?? sharedKey ?? envKey,
      source: personalKey || sharedKey ? 'setting' : envKey ? 'env' : null,
      scope: personalKey ? 'personal' : sharedKey || envKey ? 'all' : null,
    };
  }

  // Ollama is endpoint-based: an endpoint plus a model id is a usable
  // configuration even with no key, since a self-hosted server doesn't
  // authenticate. Resolved here so the endpoint feeds both the chat request and
  // the connection test.
  const ollamaBaseUrl = resolveOllamaBaseUrl(
    asNonEmptyString(settings[SETTING_OLLAMA_BASE_URL]) ?? firstEnv(OLLAMA_BASE_URL_ENV_KEYS),
  );
  const ollamaModel =
    asNonEmptyString(settings[SETTING_OLLAMA_MODEL]) ?? firstEnv(OLLAMA_MODEL_ENV_KEYS);

  const ollamaUsable = ollamaBaseUrl !== null && ollamaModel !== null;
  const configured =
    ollamaUsable || AGENT_PROVIDERS.some((provider) => providers[provider.id].apiKey !== null);
  // Opt-out flag: only an explicit `false` disables the agent, so existing
  // projects (no row stored) keep the agent on.
  const agentEnabled = settings[SETTING_AGENT_ENABLED] !== false;
  const enabledModels = sanitizeEnabledModels(settings[SETTING_ENABLED_MODELS], ollamaModel);
  // The project's own option list, carried through the resolution instead of
  // parked in module state: the Ollama model id belongs to ONE project, so it
  // must not be visible to a concurrent request from another.
  const modelOptions = agentModelOptions(ollamaModel);

  let model = asNonEmptyString(settings[SETTING_MODEL])
    ?? asNonEmptyString(process.env.ANTHROPIC_MODEL)
    ?? DEFAULT_AGENT_MODEL;

  // Keep the default usable: it must be enabled AND its provider must have a
  // key (for Ollama: a configured endpoint + model). Custom env overrides
  // (models outside the allowlist) are left alone — that's a self-hoster power
  // feature that bypasses the picker entirely.
  const isKnownModel = modelOptions.some((option) => option.id === model);
  if (isKnownModel) {
    const usable = (id: string) => {
      if (!enabledModels.includes(id)) return false;
      const provider = providerOfModelFrom(modelOptions, id);
      if (provider === null) return false;
      return provider === 'ollama' ? ollamaUsable : providers[provider].apiKey !== null;
    };
    if (!usable(model)) {
      model = enabledModels.find(usable) ?? enabledModels[0];
    }
  }

  return {
    providers,
    configured,
    agentEnabled,
    model,
    enabledModels,
    ollamaBaseUrl,
    ollamaModel,
    modelOptions,
  };
}

/**
 * Coerce a stored enabled-models value into a valid non-empty allowlist subset.
 * Legacy models stay valid when a stored list already includes them, but the
 * default (nothing stored / nothing valid) excludes them so no new project
 * picks up a superseded model. `ollamaModel` extends the allowlist with the
 * project's own Ollama model id.
 */
export function sanitizeEnabledModels(value: unknown, ollamaModel?: string | null): string[] {
  const options = agentModelOptions(ollamaModel ?? null);
  const allIds = options.map((option) => option.id);
  const defaultIds = options
    .filter((option) => !option.legacy)
    .map((option) => option.id);
  if (!Array.isArray(value)) return defaultIds;
  const valid = allIds.filter((id) => value.includes(id));
  return valid.length > 0 ? valid : defaultIds;
}

function asNonEmptyString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}
