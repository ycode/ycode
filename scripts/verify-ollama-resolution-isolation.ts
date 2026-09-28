/* eslint-disable @typescript-eslint/no-require-imports */
/**
 * Independent concurrency check for the Ollama provider-resolution path.
 *
 * The earlier scripts tested a module-global that no longer exists. This checks
 * the CURRENT contract instead: resolution carries the project's model options
 * explicitly, so two interleaved "requests" for different projects must each
 * resolve their own Ollama model — and neither may see the other's.
 *
 *   npx tsx scripts/verify-ollama-resolution-isolation.ts
 */
import Module from 'module';

const origLoad = (Module as any)._load;
(Module as any)._load = function (request: string, parent: unknown, isMain: boolean) {
  if (request === 'server-only') return {};
  return origLoad.call(this, request, parent, isMain);
};

// Two tenants, each with its own Ollama model, resolved through the same shared
// settings reader (keyed off a request-scoped marker, as a real request would).
let currentTenant: string | null = null;

const stubLoad = (Module as any)._load;
(Module as any)._load = function (request: string, parent: unknown, isMain: boolean) {
  if (request === 'server-only') return {};
  if (parent && request.endsWith('repositories/settingsRepository')) {
    return {
      getSettingsByKeys: async () => ({
        ai_ollama_base_url: 'http://127.0.0.1:11434',
        ai_ollama_model: currentTenant === 'A' ? 'project-a:7b' : 'project-b:70b',
      }),
      setSettings: async () => undefined,
    };
  }
  return stubLoad.call(this, request, parent, isMain);
};

const { resolveAgentConfig } = require('@/lib/agent/config');
const { providerOfModelFrom, isAllowedModelFrom } = require('@/lib/agent/models');

let failures = 0;
const log: string[] = [];

async function requestResolve(tenant: string, expectedModel: string, delayMs: number): Promise<void> {
  currentTenant = tenant;
  const config = await resolveAgentConfig(null);
  const ownModel: string = config.ollamaModel;
  const options = config.modelOptions;

  // Control yields between resolve and use — the interleaving window that broke
  // the module-global design.
  await new Promise((r) => setTimeout(r, delayMs));

  const provider = providerOfModelFrom(options, ownModel);
  const allowed = isAllowedModelFrom(options, ownModel);
  const providerNames = options.map((o: { provider: string }) => o.provider);
  const ok = provider === 'ollama' && allowed && ownModel === expectedModel;
  if (!ok) failures += 1;
  log.push(
    `  ${ok ? '✓' : '✗'} tenant ${tenant}: model=${ownModel} providerOfModelFrom=${JSON.stringify(provider)} allowed=${allowed}`,
  );
}

async function main(): Promise<void> {
  console.log('\n=== Ollama resolution isolation (current contract) ===\n');

  console.log('concurrent (real server shape, control yield between resolve and use):');
  await Promise.all([
    requestResolve('A', 'project-a:7b', 40),
    requestResolve('B', 'project-b:70b', 5),
  ]);
  for (const line of log) console.log(line);

  // The shipped allowlist must still resolve normally — the refactor must not
  // have broken provider lookup for the four hosted vendors.
  const { AGENT_MODELS } = require('@/lib/agent/models');
  const hostedChecks = AGENT_MODELS.map(
    (m: { id: string; provider: string }) =>
      providerOfModelFrom(AGENT_MODELS, m.id) === m.provider,
  );
  const hostedOk = hostedChecks.every(Boolean);
  console.log(`\n  ${hostedOk ? '✓' : '✗'} all ${AGENT_MODELS.length} shipped models still resolve to their own provider`);

  // An unknown model (no Ollama configured for this options list) must NOT be
  // silently accepted as Ollama — that is how a stray model id would bypass the
  // allowlist.
  const foreign = providerOfModelFrom(AGENT_MODELS, 'some-other-project:70b');
  const foreignOk = foreign === null;
  console.log(`  ${foreignOk ? '✓' : '✗'} unknown model id resolves to null, not a default provider (got ${JSON.stringify(foreign)})`);

  console.log('');
  if (failures > 0 || !hostedOk || !foreignOk) {
    console.log('⚠️  FAILED — resolution is not isolated or the allowlist regressed.');
    process.exitCode = 1;
  } else {
    console.log('✅ Resolution isolated per request; allowlist intact.');
  }
}

main().catch((error: unknown) => {
  console.error('THREW:', error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
