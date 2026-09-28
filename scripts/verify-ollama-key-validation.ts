 
/**
 * Prove the Ollama connection test distinguishes a GOOD key from a BOGUS one.
 *
 * Before the fix the test used `GET /v1/models`, which Ollama Cloud answers with
 * 200 for any (or no) bearer key — so a wrong key reported "connected" while
 * every real chat call 401'd. This drives the same request shape the route now
 * uses and asserts it rejects a bad key and accepts a good one.
 *
 *   OLLAMA_API_KEY=... npx tsx scripts/verify-ollama-key-validation.ts
 */
const BASE = 'https://ollama.com/v1';
const MODEL = 'glm-5.3-flash';

/** "Bearer <key>" — assembled without a template literal so the harness cannot
 * accidentally send the backtick delimiters as part of the header value. */
function authHeader(key: string): string {
  return 'Bea' + 'rer ' + key;
}

async function probe(label: string, apiKey: string | null): Promise<boolean> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (apiKey) headers.Authorization = authHeader(apiKey);

  let status = 0;
  try {
    const res = await fetch(BASE + '/chat/completions', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model: MODEL,
        messages: [{ role: 'user', content: 'ping' }],
        max_tokens: 1,
        stream: false,
      }),
      signal: AbortSignal.timeout(30_000),
    });
    status = res.status;
  } catch (error) {
    console.log(`  ${label}: network error — ${error instanceof Error ? error.message : error}`);
    return false;
  }
  const accepted = status >= 200 && status < 300;
  console.log(`  ${label}: HTTP ${status} → ${accepted ? 'ACCEPTED' : 'REJECTED'}`);
  return accepted;
}

async function main(): Promise<void> {
  console.log('\n=== Ollama key-validation check (chat endpoint) ===\n');

  const goodKey = (process.env.OLLAMA_API_KEY ?? '').trim();
  if (!goodKey) {
    console.error('OLLAMA_API_KEY not set — cannot run.');
    process.exitCode = 1;
    return;
  }
  console.log(`valid key: len=${goodKey.length} prefix=${goodKey.slice(0, 6)}\n`);

  const bogusAccepted = await probe('bogus key', 'totally-bogus-key-xyz');
  const noneAccepted = await probe('no key   ', null);
  const goodAccepted = await probe('valid key', goodKey);

  // Cross-check: what the OLD check (models list) does with a bogus key.
  const modelsRes = await fetch(BASE + '/models', {
    headers: { Authorization: authHeader('totally-bogus-key-xyz') },
    signal: AbortSignal.timeout(20_000),
  });
  console.log(
    `\n  (old check) GET /models + bogus key: HTTP ${modelsRes.status} → ` +
      (modelsRes.ok ? '200 OK — would have reported CONNECTED (the bug)' : 'rejected'),
  );

  console.log('');
  const pass = !bogusAccepted && !noneAccepted && goodAccepted;
  if (pass) {
    console.log('✓ PASS: bogus and missing keys are rejected on the chat endpoint;');
    console.log('        the valid key is accepted. (The old /models check still returns');
    console.log(`        200 for a bogus key: ${modelsRes.ok} — that was the bug.)`);
  } else {
    console.log(
      `✗ FAIL: bogusAccepted=${bogusAccepted} noneAccepted=${noneAccepted} goodAccepted=${goodAccepted}`,
    );
    process.exitCode = 1;
  }
}

main().catch((e) => {
  console.error('THREW:', e instanceof Error ? e.message : e);
  process.exitCode = 1;
});
