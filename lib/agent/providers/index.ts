import { resolveAgentConfig } from '@/lib/agent/config';
import { isAllowedModelFrom, providerOfModelFrom } from '@/lib/agent/models';

import { createAnthropicProvider } from './anthropic';
import { createGoogleProvider } from './google';
import { createOllamaProvider } from './ollama';
import { createOpenAiProvider } from './openai';
import { createXaiProvider } from './xai';

import type { AgentProviderId } from '@/lib/agent/models';
import type { AgentProvider } from './types';

/**
 * Provider selection.
 *
 * The open-source build ships BYOK providers for Anthropic, OpenAI, Google
 * Gemini, xAI Grok, and Ollama (Cloud or self-hosted), picked by the model the
 * request runs on. The Ycode Cloud overlay calls `registerHostedProvider` at
 * startup to take over for hosted tenants — so the hosted implementation lives
 * entirely in the overlay and is simply absent from self-host builds.
 */

export class AgentConfigurationError extends Error {}

type HostedProviderFactory = () => Promise<AgentProvider | null>;

let hostedProviderFactory: HostedProviderFactory | null = null;

/** Called by the Cloud overlay to provide a hosted (managed-key) backend. */
export function registerHostedProvider(factory: HostedProviderFactory): void {
  hostedProviderFactory = factory;
}

/**
 * Per-provider backend settings. Only providers whose endpoint isn't fixed at
 * the vendor carry one: Ollama's base URL is user-set (Cloud or a LAN server),
 * the rest hardcode theirs inside their factory.
 */
interface ProviderBackendOptions {
  /** Ollama: resolved OpenAI-compatible base URL. */
  baseUrl?: string | null;
}

const PROVIDER_FACTORIES: Record<
  AgentProviderId,
  (apiKey: string | null, options: ProviderBackendOptions) => AgentProvider
> = {
  anthropic: (apiKey) => createAnthropicProvider(requireApiKey(apiKey, 'anthropic')),
  openai: (apiKey) => createOpenAiProvider(requireApiKey(apiKey, 'openai')),
  google: (apiKey) => createGoogleProvider(requireApiKey(apiKey, 'google')),
  xai: (apiKey) => createXaiProvider(requireApiKey(apiKey, 'xai')),
  // An optional key on purpose: a self-hosted Ollama server doesn't
  // authenticate, and only Ollama Cloud issues keys.
  ollama: (apiKey, options) => createOllamaProvider(apiKey, options.baseUrl ?? undefined),
};

const PROVIDER_LABELS: Record<AgentProviderId, string> = {
  anthropic: 'Anthropic',
  openai: 'OpenAI',
  google: 'Google Gemini',
  xai: 'xAI',
  ollama: 'Ollama',
};

/**
 * Resolve the active provider for the current request.
 *
 * Prefers a registered hosted provider (Cloud); otherwise picks the BYOK
 * backend that serves the resolved model. A client-requested model is honored
 * only when it's in the allowlist, enabled in the agent settings, AND its
 * provider is usable; otherwise the server-resolved default applies. Throws
 * AgentConfigurationError when no usable backend is configured, so the API
 * route can surface a clear message.
 *
 * `userId` scopes key resolution to the requesting user, so personal
 * (only-me) provider keys are honored alongside shared project keys.
 */
export async function getAgentProvider(
  requestedModel?: string | null,
  userId?: string | null,
): Promise<{
  provider: AgentProvider;
  model: string;
  enabledModels: string[];
}> {
  const config = await resolveAgentConfig(userId);

  if (!config.agentEnabled) {
    throw new AgentConfigurationError(
      'The AI agent is turned off for this project. Enable it in Settings → Agent to use the AI builder.',
    );
  }

  let model = config.model;
  if (
    requestedModel &&
    isAllowedModelFrom(config.modelOptions, requestedModel) &&
    config.enabledModels.includes(requestedModel) &&
    isModelUsable(config, requestedModel)
  ) {
    model = requestedModel;
  }

  if (hostedProviderFactory) {
    const hosted = await hostedProviderFactory();
    if (hosted) return { provider: hosted, model, enabledModels: config.enabledModels };
  }

  if (!config.configured) {
    throw new AgentConfigurationError(
      'No AI agent connected. Add an Anthropic, OpenAI, Google Gemini, xAI, or Ollama connection in Settings → Agent to use the AI builder.',
    );
  }

  // Custom model ids outside the allowlist (self-hoster env override) run on
  // Anthropic, matching the ANTHROPIC_MODEL escape hatch they're set through.
  const providerId = providerOfModelFrom(config.modelOptions, model) ?? 'anthropic';
  if (!isModelUsable(config, model)) {
    throw new AgentConfigurationError(unusableModelMessage(providerId));
  }

  return {
    provider: PROVIDER_FACTORIES[providerId](config.providers[providerId].apiKey, {
      baseUrl: config.ollamaBaseUrl,
    }),
    model,
    enabledModels: config.enabledModels,
  };
}

/**
 * Whether a model's provider can actually serve a request. Ollama needs a
 * resolved endpoint and model id rather than a key (its key is optional), every
 * other provider needs its key.
 */
function isModelUsable(config: Awaited<ReturnType<typeof resolveAgentConfig>>, model: string): boolean {
  const providerId = providerOfModelFrom(config.modelOptions, model);
  if (providerId === null) return false;
  if (providerId === 'ollama') {
    return config.ollamaBaseUrl !== null && config.ollamaModel !== null;
  }
  return config.providers[providerId].apiKey !== null;
}

/** How to fix an unusable provider, worded per provider. */
export function unusableModelMessage(providerId: AgentProviderId): string {
  if (providerId === 'ollama') {
    return 'Ollama isn\'t set up yet. Add the endpoint URL and a model name in Settings → Agent.';
  }
  return `No API key configured for ${PROVIDER_LABELS[providerId]}. Add one in Settings → Agent or pick a model from a connected provider.`;
}

/** BYOK providers other than Ollama always require a key to be constructed. */
function requireApiKey(apiKey: string | null, providerId: AgentProviderId): string {
  if (!apiKey) throw new AgentConfigurationError(unusableModelMessage(providerId));
  return apiKey;
}
