/* eslint-disable @typescript-eslint/no-require-imports */
/**
 * End-to-end check of the exact path the builder uses to run a message:
 *
 *   resolveAgentConfig() → getAgentProvider(model) → streamMessage()
 *
 * This is the integration the unit-style scripts don't cover: it proves a
 * project configured with ONLY Ollama (no vendor keys anywhere) is actually
 * reachable through `getAgentProvider`, that the endpoint is threaded into the
 * provider the route receives, and that a real completion streams back.
 *
 *   npx tsx scripts/verify-ollama-end-to-end.ts [--cloud] [--model <id>]
 */
import Module from 'module';

const origLoad = (Module as any)._load;
(Module as any)._load = function (request: string, parent: unknown, isMain: boolean) {
  if (request === 'server-only') return {};
  return origLoad.call(this, request, parent, isMain);
};

const args = process.argv.slice(2);
const useCloud = args.includes('--cloud');
const model = args.includes('--model')
  ? args[args.indexOf('--model') + 1]
  : useCloud
    ? 'glm-5.3-flash'
    : 'qwen3:8b';
const baseUrlSetting = useCloud ? 'https://ollama.com' : 'http://localhost:11434';
const apiKey = useCloud ? (process.env.OLLAMA_API_KEY ?? null) : null;

// A project configured with Ollama ONLY — no vendor keys at all. This is the
// scenario that must work for Serge: "I'd like to add Ollama so I can use
// other models", with nothing else connected.
const SETTINGS: Record<string, unknown> = {
  ai_ollama_base_url: baseUrlSetting,
  ai_ollama_model: model,
  ...(apiKey ? { ai_ollama_api_key: apiKey } : {}),
};

const stubLoad = (Module as any)._load;
(Module as any)._load = function (request: string, parent: unknown, isMain: boolean) {
  if (request === 'server-only') return {};
  if (parent && request.endsWith('repositories/settingsRepository')) {
    return {
      getSettingsByKeys: async (keys: string[]) => {
        const out: Record<string, unknown> = {};
        for (const k of keys) if (k in SETTINGS) out[k] = SETTINGS[k];
        return out;
      },
      setSettings: async () => undefined,
    };
  }
  return stubLoad.call(this, request, parent, isMain);
};

const results: string[] = [];
function check(name: string, ok: boolean, detail = ''): void {
  results.push(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
  console.log(`${ok ? '✓' : '✗'} ${name}${detail ? ` — ${detail}` : ''}`);
}

async function main(): Promise<void> {
  console.log('\n=== Ollama end-to-end (getAgentProvider) ===');
  console.log(`settings: base_url=${baseUrlSetting}  model=${model}  key=${apiKey ? 'set' : 'none'}\n`);

  const { getAgentProvider, AgentConfigurationError } = require('@/lib/agent/providers');
  const { getAgentTools } = require('@/lib/agent/tools/registry');
  const { resolveAgentConfig } = require('@/lib/agent/config');

  // ── 1. Ollama alone must count as a configured project ────────────────────
  const config = await resolveAgentConfig(null);
  check("ollama-only project is 'configured' (no vendor key needed)", config.configured === true,
    `configured=${config.configured} ollamaBaseUrl=${config.ollamaBaseUrl} ollamaModel=${config.ollamaModel}`);
  check('endpoint resolved to an OpenAI-compatible /v1 base URL',
    typeof config.ollamaBaseUrl === 'string' && config.ollamaBaseUrl.endsWith('/v1'),
    String(config.ollamaBaseUrl));
  check("configured model appears in the project's model options",
    config.modelOptions.some((o: any) => o.id === model), `${config.modelOptions.length} options`);

  // ── 2. getAgentProvider must hand back a working provider ─────────────────
  let provider: any = null;
  let resolvedModel = '';
  try {
    ({ provider, model: resolvedModel } = await getAgentProvider(model));
    check('getAgentProvider() succeeded with no vendor keys', provider !== null,
      `provider.id=${provider?.id} model=${resolvedModel}`);
  } catch (error) {
    check('getAgentProvider() succeeded with no vendor keys', false,
      error instanceof Error ? error.message : String(error));
    return finish();
  }

  check('provider is the Ollama backend', provider.id === 'ollama-byok', String(provider.id));
  check('resolved model matches the configured Ollama model', resolvedModel === model, resolvedModel);

  // ── 3. The default model must fall back to Ollama, not Anthropic ──────────
  const defaultProvider = await getAgentProvider(null);
  check('default model resolves to Ollama (not an unconfigured vendor)',
    defaultProvider.provider.id === 'ollama-byok',
    `${defaultProvider.provider.id} / ${defaultProvider.model}`);

  // ── 4. Stream a real completion through the provider the route gets ───────
  const tools = (getAgentTools() ?? []).slice(0, 8);
  const controller = new AbortController();
  let text = '';
  let stop: string | null = null;
  for await (const event of provider.streamMessage({
    system: 'You are a test harness. Reply with exactly one word.',
    messages: [{ role: 'user', content: [{ type: 'text', text: 'Reply with exactly the word PONG.' }] }],
    tools,
    model: resolvedModel,
    maxTokens: 2048,
    signal: controller.signal,
  })) {
    if (event.type === 'text_delta') text += event.text;
    else if (event.type === 'message_stop') stop = event.stopReason;
  }
  check("streamed a real completion through getAgentProvider's provider",
    /PONG/i.test(text), JSON.stringify(text.trim().slice(0, 40)));
  check('stream terminated cleanly', stop !== null, String(stop));

  finish();
}

function finish(): void {
  const failures = results.filter((r) => r.startsWith('FAIL'));
  console.log(`\n=== ${results.length - failures.length}/${results.length} checks passed ===`);
  if (failures.length) process.exitCode = 1;
}

main().catch((e) => {
  console.error('THREW:', e instanceof Error ? e.message : e);
  process.exitCode = 1;
});
