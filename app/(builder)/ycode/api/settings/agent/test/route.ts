import Anthropic from '@anthropic-ai/sdk';
import { GoogleGenAI } from '@google/genai';
import { NextRequest, NextResponse } from 'next/server';
import OpenAI from 'openai';
import { z } from 'zod';

import { resolveAgentConfig } from '@/lib/agent/config';
import { resolveOllamaBaseUrl } from '@/lib/agent/models';
import { getAuthUser } from '@/lib/supabase-auth';

import type { AgentProviderId } from '@/lib/agent/models';

const bodySchema = z.object({
  provider: z.enum(['anthropic', 'openai', 'google', 'xai', 'ollama']).default('anthropic'),
  // Key to test; falls back to the provider's currently configured key when
  // omitted so the user can verify an already-saved configuration. Ollama keys
  // are optional (a self-hosted server doesn't authenticate).
  apiKey: z.string().nullish(),
  // Ollama only: endpoint/model being tested, so an unsaved form can be
  // verified before it's written to settings.
  ollamaBaseUrl: z.string().nullish(),
  ollamaModel: z.string().nullish(),
});

/**
 * POST /ycode/api/settings/agent/test
 *
 * Verify a provider configuration by making a cheap authenticated request
 * (models list — no tokens billed). Ollama is verified against its own endpoint,
 * with or without a key, and reports which models that endpoint actually serves.
 */
export async function POST(request: NextRequest) {
  let provider: AgentProviderId = 'anthropic';
  try {
    const body = bodySchema.parse(await request.json().catch(() => ({})));
    provider = body.provider;

    // Ollama always needs the resolved config (for the endpoint/model fallback),
    // as does any provider whose key wasn't passed inline.
    const needsConfig = provider === 'ollama' || !body.apiKey?.trim();
    const auth = needsConfig ? await getAuthUser() : null;
    const config = needsConfig ? await resolveAgentConfig(auth?.user.id) : null;

    const apiKey = body.apiKey?.trim() || config?.providers[provider].apiKey || null;

    if (provider === 'ollama') {
      const baseUrl = resolveOllamaBaseUrl(body.ollamaBaseUrl?.trim() || config?.ollamaBaseUrl);
      if (!baseUrl) {
        return NextResponse.json(
          { error: 'Add an endpoint URL to test the connection' },
          { status: 400 },
        );
      }
      const model = body.ollamaModel?.trim() || config?.ollamaModel || null;
      await testOllama(baseUrl, apiKey, model);
      return NextResponse.json({
        data: { success: true },
        message: model
          ? `Connected to ${baseUrl} — "${model}" is available`
          : `Connected to ${baseUrl}`,
      });
    }

    if (!apiKey) {
      return NextResponse.json({ error: 'No API key to test' }, { status: 400 });
    }

    await testKey(provider, apiKey);

    return NextResponse.json({
      data: { success: true },
      message: 'API key is valid',
    });
  } catch (error) {
    const friendly = toFriendlyError(provider, error);
    if (friendly) {
      return NextResponse.json({ error: friendly }, { status: 400 });
    }
    console.error('[API] Error testing agent API key:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to test API key' },
      { status: 500 }
    );
  }
}

async function testKey(provider: AgentProviderId, apiKey: string): Promise<void> {
  if (provider === 'anthropic') {
    const client = new Anthropic({ apiKey, maxRetries: 0 });
    await client.models.list({ limit: 1 });
    return;
  }
  if (provider === 'openai') {
    const client = new OpenAI({ apiKey, maxRetries: 0 });
    await client.models.list();
    return;
  }
  if (provider === 'xai') {
    await testXaiKey(apiKey);
    return;
  }
  const client = new GoogleGenAI({ apiKey });
  await client.models.list({ config: { pageSize: 1 } });
}

/** A problem to report to the user as-is (bad key, unreachable endpoint). */
class ProviderKeyError extends Error {}

/**
 * Verify an Ollama endpoint.
 *
 * Listing models is NOT a key check: Ollama Cloud answers `GET /v1/models` with
 * 200 and the full public catalog even for an absent or bogus bearer key, so a
 * models-list check reports "connected" for a key that every real chat call
 * rejects with 401. When a key is supplied it is therefore validated against
 * `POST /v1/chat/completions` — the exact endpoint the agent uses — and the
 * models list is only consulted for a keyless self-hosted server, where a
 * reachable endpoint is the whole check.
 */
async function testOllama(baseUrl: string, apiKey: string | null, model: string | null): Promise<void> {
  const root = baseUrl.replace(/\/+$/, '');

  if (apiKey) {
    let chatResponse: Response;
    try {
      chatResponse = await fetch(`${root}/chat/completions`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        // A 1-token completion; falls back to a known public model when no model
        // is configured yet, so the key can still be validated.
        body: JSON.stringify({
          model: model ?? 'gpt-oss:20b',
          messages: [{ role: 'user', content: 'ping' }],
          max_tokens: 1,
          stream: false,
        }),
        signal: AbortSignal.timeout(20_000),
      });
    } catch {
      throw new ProviderKeyError(
        `Could not reach Ollama at ${baseUrl}. Check the endpoint URL and that the server is running.`,
      );
    }

    if (chatResponse.status === 401 || chatResponse.status === 403) {
      throw new ProviderKeyError(
        'Invalid API key. Ollama Cloud requires a key from your Ollama account; a self-hosted server usually needs none.',
      );
    }
    // Ollama reports an unknown model id as 404 — a model problem, not a key one.
    if (chatResponse.status === 404 && model) {
      throw new ProviderKeyError(`Ollama has no model named "${model}" on ${baseUrl}.`);
    }
    if (!chatResponse.ok) {
      const detail = await readOllamaError(chatResponse);
      throw new ProviderKeyError(
        `Ollama API error: ${chatResponse.status} ${chatResponse.statusText}${detail ? ` — ${detail}` : ''}`,
      );
    }
    return;
  }

  // Keyless (self-hosted): the models list is the only check available, plus
  // whether the configured model id is one the endpoint actually serves.
  let response: Response;
  try {
    response = await fetch(`${root}/models`, { signal: AbortSignal.timeout(15_000) });
  } catch {
    throw new ProviderKeyError(
      `Could not reach Ollama at ${baseUrl}. Check the endpoint URL and that the server is running.`,
    );
  }

  if (!response.ok) {
    throw new ProviderKeyError(`Ollama API error: ${response.status} ${response.statusText}`);
  }

  if (!model) return;

  const payload = (await response.json().catch(() => null)) as
    | { data?: Array<{ id?: string }> }
    | null;
  const ids = (payload?.data ?? [])
    .map((entry) => entry.id)
    .filter((id): id is string => typeof id === 'string' && id.length > 0);
  // An endpoint that reports no models (a fresh local install) proves nothing
  // about the model id, so don't fail on it.
  if (ids.length === 0 || ids.includes(model)) return;

  const shown = ids.slice(0, 5).join(', ');
  throw new ProviderKeyError(
    `Connected to ${baseUrl}, but it has no model named "${model}". Available: ${shown}${ids.length > 5 ? ', …' : ''}`,
  );
}

/** Best-effort read of Ollama's `{"error":{"message":...}}` body. */
async function readOllamaError(response: Response): Promise<string | null> {
  try {
    const payload = (await response.json()) as { error?: { message?: unknown } | string };
    if (typeof payload.error === 'string') return payload.error;
    const message = payload.error?.message;
    return typeof message === 'string' ? message : null;
  } catch {
    return null;
  }
}

/** A key problem xAI reported that should surface to the user as-is. */
class XaiKeyError extends Error {}

/**
 * xAI API keys carry per-endpoint ACLs, so listing models (how the other
 * providers are tested) 403s for keys that were never granted that endpoint —
 * even when the key is fine for chat. GET /v1/api-key validates any key
 * without requiring ACLs and reports its status and permissions.
 */
async function testXaiKey(apiKey: string): Promise<void> {
  const response = await fetch('https://api.x.ai/v1/api-key', {
    headers: { Authorization: `Bearer ${apiKey}` },
  });

  if (response.status === 401 || response.status === 403) {
    throw new XaiKeyError('Invalid API key');
  }
  if (!response.ok) {
    throw new XaiKeyError(`xAI API error: ${response.status} ${response.statusText}`);
  }

  const info = (await response.json()) as {
    api_key_blocked?: boolean;
    api_key_disabled?: boolean;
    team_blocked?: boolean;
    acls?: string[];
  };

  if (info.api_key_disabled || info.api_key_blocked) {
    throw new XaiKeyError('API key is valid but disabled or blocked — re-enable it in the xAI Console');
  }
  // xAI blocks the whole team until it has credits, so this is usually a
  // billing problem rather than a key problem.
  if (info.team_blocked) {
    throw new XaiKeyError('API key is valid but your xAI team is blocked — this usually means it has no credits yet. Add credits in the xAI Console.');
  }

  // The agent talks to the chat endpoint, so a key without that ACL will fail
  // at build time even though it authenticates fine.
  const acls = info.acls ?? [];
  const hasChatAccess = acls.some(
    (acl) => acl === 'api-key:endpoint:*' || acl === 'api-key:endpoint:chat',
  );
  if (!hasChatAccess) {
    throw new XaiKeyError(
      'API key is valid but has no chat endpoint permission — edit the key in the xAI Console and grant it the "chat" endpoint (or all endpoints)',
    );
  }
}

/** Map SDK auth/permission errors to a user-facing message, or null for
 * unexpected failures (which surface as a 500). */
function toFriendlyError(provider: AgentProviderId, error: unknown): string | null {
  if (error instanceof ProviderKeyError || error instanceof XaiKeyError) {
    return error.message;
  }
  if (error instanceof Anthropic.AuthenticationError || error instanceof OpenAI.AuthenticationError) {
    return 'Invalid API key';
  }
  if (error instanceof Anthropic.PermissionDeniedError || error instanceof OpenAI.PermissionDeniedError) {
    return 'API key is valid but has no access to this API';
  }
  if (error instanceof Anthropic.APIError) {
    return `Anthropic API error: ${error.message}`;
  }
  if (error instanceof OpenAI.APIError) {
    return `OpenAI API error: ${error.message}`;
  }
  // The Google SDK throws plain errors; auth failures carry a 400 with
  // "API key not valid" or a 403.
  if (provider === 'google' && error instanceof Error) {
    const message = error.message.toLowerCase();
    if (message.includes('api key not valid') || message.includes('api_key_invalid') || message.includes('permission')) {
      return 'Invalid API key';
    }
    return `Google API error: ${error.message}`;
  }
  return null;
}
