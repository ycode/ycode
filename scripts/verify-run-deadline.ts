/* eslint-disable @typescript-eslint/no-require-imports */
/**
 * Proves the run deadline actually tears down a HUNG provider request.
 *
 * Regression this guards: MAX_RUN_MS is only checked BETWEEN turns, so a
 * provider request that accepts the connection and then stalls forever (no
 * bytes, no error, no close) used to block the agent loop indefinitely while
 * the browser held its SSE connection open — the panel spins and Ollama shows
 * no usage. The runtime now arms an AbortController for MAX_RUN_MS and aborts
 * the in-flight fetch.
 *
 * Method: a real HTTP server on 127.0.0.1 that accepts
 * /v1/chat/completions and never writes anything, wired to the real Ollama
 * provider, with the budget set to its minimum (61s -> MAX_RUN_MS = 1s).
 * Pass = run ends with the resumable time-limit error in ~1s, not never.
 */
import Module from 'module';
import http from 'http';

const origLoad = (Module as any)._load;
(Module as any)._load = function (request: string, parent: unknown, isMain: boolean) {
  if (request === 'server-only') return {};
  return origLoad.call(this, request, parent, isMain);
};

// Must be set BEFORE config.ts is first required — it reads env at module load.
// 61 is the smallest accepted value (>60), giving MAX_RUN_MS = 61s - 60s = 1s.
process.env.AI_CHAT_MAX_DURATION = '61';

const { runAgent } = require('@/lib/agent/runtime');
const { MAX_RUN_MS } = require('@/lib/agent/config');
const { createOllamaProvider } = require('@/lib/agent/providers/ollama');

let requestsSeen = 0;

// A server that accepts the request and then says nothing, ever. This is the
// exact failure shape: connection open, no bytes, no error.
const server = http.createServer((req: http.IncomingMessage, res: http.ServerResponse) => {
  requestsSeen += 1;
  res.writeHead(200, { 'Content-Type': 'text/event-stream' });
  res.write(': connected\n\n'); // headers + a comment, then silence forever
  // deliberately never res.end() and never send a data frame
});

server.listen(0, '127.0.0.1', async () => {
  const addr = server.address() as { port: number };
  const baseUrl = `http://127.0.0.1:${addr.port}/v1`;
  console.log('=== run-deadline regression check ===');
  console.log(`stalling endpoint : ${baseUrl}`);
  console.log(`MAX_RUN_MS        : ${MAX_RUN_MS}ms (AI_CHAT_MAX_DURATION=61)\n`);

  const provider = createOllamaProvider('test-key', baseUrl);
  const t0 = Date.now();
  let errorMessage: string | null = null;
  let sawUsage = false;

  const hardStop = setTimeout(() => {
    console.log('✗ FAIL — still running after 25s: the deadline did not tear down the hung request');
    process.exit(1);
  }, 25_000);

  try {
    for await (const event of runAgent({
      provider,
      model: 'stall-test',
      messages: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }],
      context: { pageId: null },
    })) {
      const ms = Date.now() - t0;
      if (event.type === 'error') {
        errorMessage = event.message;
        console.log(`  [${ms}ms] error: ${String(event.message).slice(0, 90)}`);
      } else if (event.type === 'usage') {
        sawUsage = true;
        console.log(`  [${ms}ms] usage event emitted (run stayed resumable)`);
      } else {
        console.log(`  [${ms}ms] ${event.type}`);
      }
    }
  } catch (e) {
    console.log(`  threw: ${e instanceof Error ? e.message : String(e)}`);
  }

  clearTimeout(hardStop);
  const elapsed = Date.now() - t0;
  const budgetish = MAX_RUN_MS + 6000; // allow a few seconds of slack

  console.log('\n=== RESULT ===');
  console.log(`elapsed            : ${elapsed}ms`);
  console.log(`requests received  : ${requestsSeen}`);
  console.log(`error message      : ${errorMessage ?? '(none)'}`);
  console.log(`usage emitted      : ${sawUsage}`);

  const isTimeLimit = !!errorMessage && errorMessage.includes('ran out of time');
  const pass = isTimeLimit && elapsed <= budgetish;
  console.log(`\n${pass
    ? `✓ PASS — hung request aborted at the deadline (${elapsed}ms), resumable error surfaced`
    : '✗ FAIL — expected the resumable time-limit error within the budget'}`);
  server.close();
  process.exit(pass ? 0 : 1);
});
