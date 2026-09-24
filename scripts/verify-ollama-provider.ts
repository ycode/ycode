/* eslint-disable @typescript-eslint/no-require-imports */
/**
 * Verify the Ollama provider against a REAL endpoint using Ycode's own code.
 *
 *   npx tsx scripts/verify-ollama-provider.ts                  # local 127.0.0.1:11434
 *   npx tsx scripts/verify-ollama-provider.ts --cloud          # https://ollama.com/v1
 *   npx tsx scripts/verify-ollama-provider.ts --model qwen3:8b
 *
 * Exercises the actual `createOllamaProvider` + shared `createChatCompletionsProvider`
 * loop + the real tool registry (so a green run means the live builder panel will
 * stream and call tools on this endpoint). `server-only` is neutralized the same
 * way scripts/smoke-agent.ts does it.
 */
import fs from 'fs';
import Module from 'module';
import path from 'path';

const origLoad = (Module as any)._load;
(Module as any)._load = function (request: string, parent: unknown, isMain: boolean) {
  if (request === 'server-only') return {};
  return origLoad.call(this, request, parent, isMain);
};

function loadEnv(): void {
  for (const file of ['.env.local', '.env']) {
    const full = path.resolve(process.cwd(), file);
    if (!fs.existsSync(full)) continue;
    for (const rawLine of fs.readFileSync(full, 'utf8').split('\n')) {
      const line = rawLine.trim();
      if (!line || line.startsWith('#')) continue;
      const eq = line.indexOf('=');
      if (eq === -1) continue;
      const key = line.slice(0, eq).trim();
      let value = line.slice(eq + 1).trim();
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }
      if (key && process.env[key] === undefined) process.env[key] = value;
    }
  }
}
loadEnv();

const args = process.argv.slice(2);
const useCloud = args.includes('--cloud');
const modelArg = args[args.indexOf('--model') + 1];
const model = args.includes('--model') ? modelArg : useCloud ? 'glm-5.3-flash' : 'qwen3:8b';
const baseUrl = useCloud ? 'https://ollama.com/v1' : 'http://127.0.0.1:11434/v1';
const apiKey = useCloud ? (process.env.OLLAMA_API_KEY ?? null) : null;

const { createOllamaProvider } = require('@/lib/agent/providers/ollama');
const { getAgentTools } = require('@/lib/agent/tools/registry');

const results: string[] = [];
function check(name: string, ok: boolean, detail = ''): void {
  results.push(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
  console.log(`${ok ? '✓' : '✗'} ${name}${detail ? ` — ${detail}` : ''}`);
}

async function main(): Promise<void> {
  console.log(`\n=== Ollama provider verification ===`);
  console.log(`endpoint: ${baseUrl}`);
  console.log(`model:    ${model}`);
  console.log(`api key:  ${apiKey ? `present (len ${apiKey.length})` : 'none (keyless/self-hosted)'}\n`);

  const provider = createOllamaProvider(apiKey, baseUrl);
  check('provider factory returns id "ollama-byok"', provider.id === 'ollama-byok', provider.id);
  check('provider exposes streamMessage', typeof provider.streamMessage === 'function');

  // ── 1. Text streaming, no tools ────────────────────────────────────────────
  let text = '';
  let stopReason: string | null = null;
  let usage: any = null;
  const controller = new AbortController();
  for await (const event of provider.streamMessage({
    system: 'You are a test harness. Follow instructions exactly.',
    messages: [{ role: 'user', content: [{ type: 'text', text: 'Reply with exactly the word PONG and nothing else.' }] }],
    tools: [],
    model,
    maxTokens: 2048,
    signal: controller.signal,
  })) {
    if (event.type === 'text_delta') text += event.text;
    else if (event.type === 'message_stop') {
      stopReason = event.stopReason;
      usage = event.usage;
    }
  }
  check('streamed text (no tools)', /PONG/i.test(text), `got ${JSON.stringify(text.slice(0, 60))}`);
  check('message_stop stopReason present', stopReason !== null, String(stopReason));
  check('usage reported', !!usage && typeof usage.inputTokens === 'number',
    usage ? `in=${usage.inputTokens} out=${usage.outputTokens} cacheRead=${usage.cacheReadInputTokens}` : 'none');

  // ── 2. Real tool registry → tool_use event ─────────────────────────────────
  const tools: any[] = getAgentTools() ?? [];
  check('tool registry exposes tools', tools.length > 0, `${tools.length} tools`);

  const probe = tools.find((t) => /page/i.test(t.name)) ?? tools[0];
  const toolName = probe?.name;
  let toolUse: any = null;
  let text2 = '';
  const controller2 = new AbortController();
  for await (const event of provider.streamMessage({
    system: `You can call tools. The available tool named "${toolName}" exists. Call it if asked.`,
    messages: [{ role: 'user', content: [{ type: 'text', text: `Call the tool named "${toolName}" now. Pass an empty object as input.` }] }],
    tools: tools.slice(0, 12),
    model,
    maxTokens: 4096,
    signal: controller2.signal,
  })) {
    if (event.type === 'text_delta') text2 += event.text;
    else if (event.type === 'tool_use') toolUse = event;
  }
  check('emitted a tool_use event', toolUse !== null,
    toolUse ? `name=${toolUse.name} input=${JSON.stringify(toolUse.input).slice(0, 80)}` : 'model produced no tool call');
  if (toolUse) {
    check('tool_use input is an object', typeof toolUse.input === 'object' && toolUse.input !== null);
    check('tool_use references a real registered tool', tools.some((t) => t.name === toolUse.name), toolUse.name);
  }

  // ── 3. Summary ────────────────────────────────────────────────────────────
  const failures = results.filter((r) => r.startsWith('FAIL'));
  console.log(`\n=== ${results.length - failures.length}/${results.length} checks passed ===`);
  if (failures.length) {
    console.log(failures.join('\n'));
    process.exitCode = 1;
  }
}

main().catch((error: unknown) => {
  console.error('\nVERIFICATION THREW:', error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
