import OpenAI from 'openai';

import { OLLAMA_DEFAULT_BASE_URL } from '@/lib/agent/models';

import { createChatCompletionsProvider } from './openai';

import type { AgentProvider } from './types';

/**
 * BYOK Ollama provider (Ollama Cloud or a self-hosted server).
 *
 * Ollama exposes OpenAI-compatible Chat Completions routes under `/v1`, so this
 * reuses the shared Chat Completions provider. Two things differ from the other
 * OpenAI-compatible vendors:
 *
 *  - The endpoint is user-set (`ai_ollama_base_url`) instead of a fixed vendor
 *    host, and a LAN server usually has no TLS or auth — hence an optional key.
 *  - The model id is whatever the endpoint serves ("gpt-oss:120b", "qwen3:8b"),
 *    so no reasoning-effort policy is imposed; models that take `think` carry
 *    their own default.
 *
 * Ollama reports unknown model ids as a 404, which the runtime surfaces to the
 * user as-is — good enough, since the model is typed by hand in settings.
 */
export function createOllamaProvider(apiKey: string | null, baseURL?: string): AgentProvider {
  const client = new OpenAI({
    // A self-hosted server ignores the key, but the SDK rejects an empty one.
    apiKey: apiKey ?? 'ollama',
    baseURL: baseURL || OLLAMA_DEFAULT_BASE_URL,
    maxRetries: 2,
  });
  return createChatCompletionsProvider('ollama-byok', client);
}
