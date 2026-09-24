/* eslint-disable @typescript-eslint/no-require-imports */
/**
 * Negative control for the run deadline: a HEALTHY stream must not be killed.
 *
 * Guards the failure mode the deadline could introduce — if it were armed too
 * eagerly or the abort leaked into the normal path, ordinary streaming
 * responses would be cut off at MAX_RUN_MS for no reason.
 *
 * A real SSE endpoint streams a few frames and closes normally. With the
 * budget set to its minimum (61s -> MAX_RUN_MS = 1s), a correct implementation
 * completes the stream and reports `done`, NOT the time-limit error.
 */
import Module from 'module';
import http from 'http';

const origLoad = (Module as any)._load;
(Module as any)._load = function (request: string, parent: unknown, isMain: boolean) {
  if (request === 'server-only') return {};
  return origLoad.call(this, request, parent, isMain);
};

// Smallest accepted value (>60), so MAX_RUN_MS = 1s — aggressively tight on
// purpose, to catch a deadline that fires too eagerly.
process.env.AI_CHAT_MAX_DURATION = '61';

const { runAgent } = require('@/lib/agent/runtime');
const { MAX_RUN_MS } = require('@/lib/agent/config');
const { createOllamaProvider } = require('@/lib/agent/providers/ollama');

const server = http.createServer((req: http.IncomingMessage, res: http.ServerResponse) => {
  res.writeHead(200, { 'Content-Type': 'text/event-stream' });
  const frame = (delta: string) =>
    `data: ${JSON.stringify({
      id: 'chatcmpl-healthy',
      object: 'chat.completion.chunk',
      choices: [{ index: 0, delta: { content: delta }, finish_reason: null }],
    })}\n\n`;

  res.write(frame('OK'));
  res.write(frame('.'));
  res.write(
    `data: ${JSON.stringify({
      id: 'chatcmpl-healthy',
      object: 'chat.completion.chunk',
      choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
      usage: { prompt_tokens: 5, completion_tokens: 2, total_tokens: 7 },
    })}\n\n`,
  );
  res.write('data: [DONE]\n\n');
  res.end();
});

server.listen(0, '127.0.0.1', async () => {
  const addr = server.address() as { port: number };
  const baseUrl = `http://127.0.0.1:${addr.port}/v1`;
  console.log('=== healthy-stream control (deadline must NOT fire) ===');
  console.log(`endpoint   : ${baseUrl}`);
  console.log(`MAX_RUN_MS : ${MAX_RUN_MS}ms\n`);

  const provider = createOllamaProvider('test-key', baseUrl);
  const t0 = Date.now();
  let text = '';
  let errorMessage: string | null = null;
  let done = false;

  for await (const event of runAgent({
    provider,
    model: 'healthy-test',
    messages: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }],
    context: { pageId: null },
  })) {
    if (event.type === 'text') text += event.text;
    else if (event.type === 'error') errorMessage = String(event.message);
    else if (event.type === 'done') done = true;
  }

  const elapsed = Date.now() - t0;
  console.log('=== RESULT ===');
  console.log(`elapsed : ${elapsed}ms`);
  console.log(`text    : ${JSON.stringify(text)}`);
  console.log(`done    : ${done}`);
  console.log(`error   : ${errorMessage ?? '(none)'}`);

  const pass = done && !errorMessage && text === 'OK.';
  console.log(`\n${pass
    ? '✓ PASS — healthy stream completed normally; the deadline did not interfere'
    : '✗ FAIL — the deadline interfered with a normal stream'}`);
  server.close();
  process.exit(pass ? 0 : 1);
});
