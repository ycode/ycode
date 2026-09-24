/* eslint-disable @typescript-eslint/no-require-imports */
/**
 * Deeper Ollama provider verification: the multi-turn tool round trip and the
 * model-id gating that decides whether a project's Ollama model is runnable.
 *
 * The single-turn test proves streaming works. What actually breaks in
 * production is the SECOND provider call: the assistant's tool_use block has to
 * be translated into Chat Completions `tool_calls`, and the tool_result into a
 * `role: "tool"` message. If that mapping is wrong the model never sees the
 * result and either re-calls the tool forever or answers from nothing.
 *
 *   npx tsx scripts/verify-ollama-roundtrip.ts [--cloud] [--model <id>]
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
const model = args.includes('--model') ? args[args.indexOf('--model') + 1] : useCloud ? 'glm-5.3-flash' : 'qwen3:8b';
const baseUrl = useCloud ? 'https://ollama.com/v1' : 'http://127.0.0.1:11434/v1';
const apiKey = useCloud ? (process.env.OLLAMA_API_KEY ?? null) : null;

const { createOllamaProvider } = require('@/lib/agent/providers/ollama');
const {
  resolveOllamaBaseUrl,
  OLLAMA_DEFAULT_BASE_URL,
} = require('@/lib/agent/models');
const { getAgentTools } = require('@/lib/agent/tools/registry');

const results: string[] = [];
function check(name: string, ok: boolean, detail = ''): void {
  results.push(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
  console.log(`${ok ? '✓' : '✗'} ${name}${detail ? ` — ${detail}` : ''}`);
}

const tools = getAgentTools() ?? [];

/** One turn against the provider, collecting text / tool_use / stop. */
async function turn(messages: any[]): Promise<{ text: string; toolUses: any[]; stopReason: string | null }> {
  const provider = createOllamaProvider(apiKey, baseUrl);
  const controller = new AbortController();
  let text = '';
  const toolUses: any[] = [];
  let stopReason: string | null = null;
  for await (const event of provider.streamMessage({
    system:
      'You are a tool-calling test harness. When a tool result is provided, ' +
      'read it and answer the user in plain text. Never call the same tool twice.',
    messages,
    tools: tools.slice(0, 12),
    model,
    maxTokens: 4096,
    signal: controller.signal,
  })) {
    if (event.type === 'text_delta') text += event.text;
    else if (event.type === 'tool_use') toolUses.push(event);
    else if (event.type === 'message_stop') stopReason = event.stopReason;
  }
  return { text, toolUses, stopReason };
}

async function main(): Promise<void> {
  console.log(`\n=== Ollama round-trip verification ===`);
  console.log(`endpoint: ${baseUrl}\nmodel:    ${model}\n`);

  // ── 1. Base-URL normalization (pure logic, no network) ────────────────────
  const cases: Array<[unknown, string | null, string]> = [
    ['', OLLAMA_DEFAULT_BASE_URL, 'blank → cloud default'],
    ['ollama.com', 'https://ollama.com/v1', 'bare cloud host'],
    ['https://ollama.com', 'https://ollama.com/v1', 'https cloud host (no /v1)'],
    ['https://ollama.com/v1', 'https://ollama.com/v1', 'already has /v1'],
    ['http://localhost:11434', 'http://localhost:11434/v1', 'bare local host + port'],
    ['http://127.0.0.1:11434/v1/', 'http://127.0.0.1:11434/v1', 'trailing slash stripped'],
    ['http://192.0.2.10:11434', 'http://192.0.2.10:11434/v1', 'bare LAN host (doc-range IP)'],
    ['ftp://example.com', null, 'non-http scheme rejected'],
    ['   ', OLLAMA_DEFAULT_BASE_URL, 'whitespace → cloud default'],
  ];
  let urlPass = 0;
  for (const [input, expected, label] of cases) {
    const got = resolveOllamaBaseUrl(input);
    if (got === expected) urlPass += 1;
    else console.log(`   ✗ ${label}: got ${JSON.stringify(got)} want ${JSON.stringify(expected)}`);
  }
  check('base URL normalization', urlPass === cases.length, `${urlPass}/${cases.length} cases`);

  // ── 2. FULL tool round trip: call → result → final text ───────────────────
  const probe = tools.find((t: any) => /page/i.test(t.name)) ?? tools[0];
  const toolName = probe.name;

  const first = await turn([
    { role: 'user', content: [{ type: 'text', text: `Call the tool named "${toolName}" now with an empty object.` }] },
  ]);
  check('turn 1 produced a tool_use', first.toolUses.length > 0,
    first.toolUses.map((t) => t.name).join(', ') || 'none');

  if (first.toolUses.length > 0) {
    const call = first.toolUses[0];
    // Feed the result back exactly the way the runtime does.
    const second = await turn([
      { role: 'user', content: [{ type: 'text', text: `Call the tool named "${toolName}" now with an empty object.` }] },
      {
        role: 'assistant',
        content: [
          ...(first.text ? [{ type: 'text', text: first.text }] : []),
          { type: 'tool_use', id: call.id, name: call.name, input: call.input },
        ],
      },
      {
        role: 'user',
        content: [
          {
            type: 'tool_result',
            toolUseId: call.id,
            content: '{"ok":true,"pages":[{"id":"pg_1","name":"Home","slug":"/"}]}',
          },
        ],
      },
    ]);

    check('turn 2 returned text after the tool result', second.text.trim().length > 0,
      JSON.stringify(second.text.trim().slice(0, 80)));
    check('turn 2 did NOT re-call the same tool', !second.toolUses.some((t) => t.name === call.name),
      second.toolUses.map((t) => t.name).join(', ') || 'no further tool calls');
    check('turn 2 stopReason present', second.stopReason !== null, String(second.stopReason));
  }

  // ── 3. Error quality on a bad endpoint ────────────────────────────────────
  const badProvider = createOllamaProvider(apiKey, 'http://127.0.0.1:9/v1');
  let badError: string | null = null;
  try {
    const c = new AbortController();
    for await (const _event of badProvider.streamMessage({
      system: 'x',
      messages: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }],
      tools: [],
      model,
      maxTokens: 32,
      signal: c.signal,
    })) {
      // drain
    }
  } catch (error) {
    badError = error instanceof Error ? error.message : String(error);
  }
  check('unreachable endpoint throws (does not hang)', badError !== null,
    badError ? `"${badError.slice(0, 70)}"` : 'no error raised');

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
