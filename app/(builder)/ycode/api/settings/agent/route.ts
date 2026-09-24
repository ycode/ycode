import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import {
  personalKeySetting,
  PROVIDER_KEY_SETTINGS,
  resolveAgentConfig,
  sanitizeEnabledModels,
  SETTING_AGENT_ENABLED,
  SETTING_ENABLED_MODELS,
  SETTING_MODEL,
  SETTING_OLLAMA_BASE_URL,
  SETTING_OLLAMA_MODEL,
} from '@/lib/agent/config';
import { AGENT_PROVIDERS, resolveOllamaBaseUrl } from '@/lib/agent/models';
import { getAuthUser } from '@/lib/supabase-auth';
import { getSettingsByKeys, setSettings } from '@/lib/repositories/settingsRepository';

import type { ResolvedAgentConfig } from '@/lib/agent/config';
import type { AgentProviderId } from '@/lib/agent/models';

/**
 * GET /ycode/api/settings/agent
 *
 * Agent (AI builder) configuration status for the current user. API keys are
 * never returned in full — only a masked hint per provider — so they can't
 * leak into client state.
 */
export async function GET() {
  try {
    const auth = await getAuthUser();
    const config = await resolveAgentConfig(auth?.user.id);
    return NextResponse.json({ data: toStatusPayload(config) });
  } catch (error) {
    console.error('[API] Error fetching agent settings:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to fetch agent settings' },
      { status: 500 }
    );
  }
}

const providerIds = ['anthropic', 'openai', 'google', 'xai', 'ollama'] as const;

const scopeSchema = z.enum(['all', 'personal']);

const putSchema = z.object({
  // Per-provider keys: undefined = keep current; null / "" = remove stored key.
  keys: z
    .object({
      anthropic: z.string().nullish(),
      openai: z.string().nullish(),
      google: z.string().nullish(),
      xai: z.string().nullish(),
      ollama: z.string().nullish(),
    })
    .partial()
    .optional(),
  // Per-provider availability. With a new key: where to store it. Without a
  // key: moves the currently stored key to the given scope.
  keyScopes: z
    .object({
      anthropic: scopeSchema.optional(),
      openai: scopeSchema.optional(),
      google: scopeSchema.optional(),
      xai: scopeSchema.optional(),
      ollama: scopeSchema.optional(),
    })
    .partial()
    .optional(),
  model: z.string().optional(),
  enabledModels: z.array(z.string()).optional(),
  agentEnabled: z.boolean().optional(),
  // Ollama endpoint + model id. An empty string clears the stored value.
  ollamaBaseUrl: z.string().optional(),
  ollamaModel: z.string().optional(),
});

/**
 * PUT /ycode/api/settings/agent
 *
 * Save agent configuration. Only provided fields are updated. These are
 * builder-only settings, so no public-page cache invalidation is needed.
 *
 * Keys can be scoped per provider: "all" stores them in the shared project
 * setting; "personal" stores them under the current user's id so only they
 * can use that key (their personal key shadows the shared one).
 */
export async function PUT(request: NextRequest) {
  try {
    const body = putSchema.parse(await request.json());
    const auth = await getAuthUser();
    const userId = auth?.user.id ?? null;

    if (!userId && hasPersonalIntent(body)) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    }

    const updates: Record<string, unknown> = {};
    // Default-model change staged for validation against the config this request
    // will produce (see the post-Ollama resolve below).
    let pendingModel: string | null = null;

    // Current stored rows (shared + this user's personal) so key writes,
    // deletes, and scope moves can target the right row.
    const stored = await getSettingsByKeys([
      ...providerIds.map((id) => PROVIDER_KEY_SETTINGS[id]),
      ...(userId ? providerIds.map((id) => personalKeySetting(id, userId)) : []),
    ]);

    for (const providerId of providerIds) {
      const sharedSettingKey = PROVIDER_KEY_SETTINGS[providerId];
      const personalSettingKey = userId ? personalKeySetting(providerId, userId) : null;
      const hasPersonal = personalSettingKey !== null && isNonEmpty(stored[personalSettingKey]);
      const hasShared = isNonEmpty(stored[sharedSettingKey]);

      const key = body.keys?.[providerId];
      const requestedScope = body.keyScopes?.[providerId];

      if (key !== undefined) {
        const trimmed = key?.trim() ?? '';

        if (trimmed.length === 0) {
          // Disconnect: remove the row the current user's resolution points to.
          if (hasPersonal && personalSettingKey) {
            updates[personalSettingKey] = null;
          } else {
            updates[sharedSettingKey] = null;
          }
          continue;
        }

        // New key: store at the requested scope, defaulting to the scope of
        // the key it replaces (so "Replace key" keeps the availability).
        const scope = requestedScope ?? (hasPersonal ? 'personal' : 'all');
        if (scope === 'personal' && personalSettingKey) {
          updates[personalSettingKey] = trimmed;
        } else {
          updates[sharedSettingKey] = trimmed;
          // A leftover personal key would shadow the just-saved shared key
          // for this user — saving "for all users" replaces it.
          if (hasPersonal && personalSettingKey) {
            updates[personalSettingKey] = null;
          }
        }
        continue;
      }

      // Scope change without a new key: move the stored key between rows.
      if (requestedScope !== undefined && personalSettingKey) {
        if (requestedScope === 'personal' && !hasPersonal && hasShared) {
          updates[personalSettingKey] = stored[sharedSettingKey];
          updates[sharedSettingKey] = null;
        } else if (requestedScope === 'all' && hasPersonal) {
          updates[sharedSettingKey] = stored[personalSettingKey];
          updates[personalSettingKey] = null;
        }
      }
    }

    if (body.model !== undefined) {
      // The allowlist is the project's own model options, so a configured
      // Ollama model id is selectable as the default like any vendor model.
      // Validated below, once, against the config this request will produce.
      pendingModel = body.model;
    }

    // Ollama endpoint + model id. Both are stored raw (the endpoint normalized
    // to an OpenAI-compatible base URL) and read back through resolveAgentConfig.
    if (body.ollamaBaseUrl !== undefined) {
      const raw = body.ollamaBaseUrl.trim();
      if (raw.length === 0) {
        updates[SETTING_OLLAMA_BASE_URL] = null;
      } else {
        const normalized = resolveOllamaBaseUrl(raw);
        if (!normalized) {
          return NextResponse.json(
            { error: 'Enter a valid http(s) endpoint, e.g. http://localhost:11434' },
            { status: 400 },
          );
        }
        updates[SETTING_OLLAMA_BASE_URL] = normalized;
      }
    }

    if (body.ollamaModel !== undefined) {
      const trimmed = body.ollamaModel.trim();
      if (trimmed.length > 0 && !/^[A-Za-z0-9._\-/:]+$/.test(trimmed)) {
        return NextResponse.json(
          { error: 'Enter a valid Ollama model name, e.g. gpt-oss:120b' },
          { status: 400 },
        );
      }
      updates[SETTING_OLLAMA_MODEL] = trimmed.length > 0 ? trimmed : null;
    }

    // Enablement is validated after the Ollama settings are applied below, so a
    // model list that only references a model being configured in the same
    // request is accepted.
    let enablement: string[] | null = null;
    if (body.enabledModels !== undefined) {
      enablement = body.enabledModels;
    }

    if (body.agentEnabled !== undefined) {
      // Store only the opt-out; `null` deletes the row so "on" stays the default.
      updates[SETTING_AGENT_ENABLED] = body.agentEnabled ? null : false;
    }

    // Enablement and the default model are validated together, after the Ollama
    // settings above are accounted for, so a request that configures an Ollama
    // model AND enables/selects it in the same call is accepted. One resolve
    // covers both — the previous two-call version re-read the stored settings
    // and never saw the values this request is writing.
    const nextConfig = await resolveAgentConfig(userId, {
      [SETTING_OLLAMA_BASE_URL]: updates[SETTING_OLLAMA_BASE_URL],
      [SETTING_OLLAMA_MODEL]: updates[SETTING_OLLAMA_MODEL],
    });
    const known = nextConfig.modelOptions.map((option) => option.id);

    if (pendingModel !== null) {
      if (!known.includes(pendingModel)) {
        return NextResponse.json({ error: 'Unknown model' }, { status: 400 });
      }
      updates[SETTING_MODEL] = pendingModel;
    }

    if (enablement !== null) {
      const enabled = sanitizeEnabledModels(
        enablement.filter((id) => known.includes(id)),
        nextConfig.ollamaModel,
      );
      if (enabled.length !== enablement.length) {
        return NextResponse.json(
          { error: 'At least one valid model must be enabled' },
          { status: 400 }
        );
      }
      updates[SETTING_ENABLED_MODELS] = enabled;
    }

    if (Object.keys(updates).length > 0) {
      await setSettings(updates);
    }

    const config = await resolveAgentConfig(userId);

    return NextResponse.json({
      data: toStatusPayload(config),
      message: 'Agent settings updated successfully',
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
    }
    console.error('[API] Error updating agent settings:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to update agent settings' },
      { status: 500 }
    );
  }
}

/** True when the request wants a personal key but we couldn't resolve the user. */
function hasPersonalIntent(body: z.infer<typeof putSchema>): boolean {
  return Object.values(body.keyScopes ?? {}).some((scope) => scope === 'personal');
}

function isNonEmpty(value: unknown): boolean {
  return typeof value === 'string' && value.trim().length > 0;
}

function toStatusPayload(config: ResolvedAgentConfig) {
  const providers = {} as Record<AgentProviderId, {
    configured: boolean;
    source: 'setting' | 'env' | null;
    scope: 'all' | 'personal' | null;
    maskedKey: string | null;
    baseUrl?: string | null;
    model?: string | null;
  }>;
  for (const provider of AGENT_PROVIDERS) {
    const resolved = config.providers[provider.id];
    // A self-hosted endpoint with no key is still a working connection, so
    // Ollama reports "configured" off its endpoint + model instead.
    const configured = provider.id === 'ollama'
      ? config.ollamaBaseUrl !== null && config.ollamaModel !== null
      : resolved.apiKey !== null;
    providers[provider.id] = {
      configured,
      source: resolved.source,
      scope: resolved.scope,
      maskedKey: resolved.apiKey ? maskKey(resolved.apiKey) : null,
      ...(provider.id === 'ollama'
        ? { baseUrl: config.ollamaBaseUrl, model: config.ollamaModel }
        : {}),
    };
  }
  return {
    configured: config.configured,
    agentEnabled: config.agentEnabled,
    providers,
    model: config.model,
    enabledModels: config.enabledModels,
    modelOptions: config.modelOptions,
    ollamaBaseUrl: config.ollamaBaseUrl,
    ollamaModel: config.ollamaModel,
  };
}

/** "sk-ant-...wxyz" — enough to recognize the key without exposing it. */
function maskKey(key: string): string {
  if (key.length <= 8) return '••••';
  return `${key.slice(0, 7)}...${key.slice(-4)}`;
}
