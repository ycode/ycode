import { NextRequest } from 'next/server';
import { noCache } from '@/lib/api-response';
import { warmRouteChain, verifyWarmChainSignature } from '@/lib/services/cacheService';

/**
 * Self-chaining cache-warming endpoint.
 *
 * Warms one batch of routes in a fresh function invocation, then triggers the
 * next link in the chain until the route list is drained (or the overall cap
 * is reached). Decoupling each batch into its own invocation lets us warm an
 * arbitrarily long route list without blowing any single function's lifetime.
 *
 * Internal-only: requests are authenticated by an HMAC signature derived from
 * the Supabase service-role key (see cacheService). No user-configured secret
 * is required, so self-hosters get full warming out of the box.
 */

// 50 parallel fetches with a 15s per-URL timeout comfortably fit a 60s budget.
export const maxDuration = 60;

export async function POST(request: NextRequest) {
  // Read the raw body so the HMAC is verified against the exact bytes signed.
  const raw = await request.text();
  const signature = request.headers.get('x-warm-signature');

  if (!(await verifyWarmChainSignature(raw, signature))) {
    return noCache({ error: 'Invalid signature' }, 401);
  }

  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return noCache({ error: 'Invalid JSON' }, 400);
  }

  const { routes, warmed, runId } = (body ?? {}) as {
    routes?: unknown;
    warmed?: unknown;
    runId?: unknown;
  };

  if (!Array.isArray(routes)) {
    return noCache({ error: 'routes must be an array' }, 400);
  }

  const alreadyWarmed = typeof warmed === 'number' && warmed >= 0 ? warmed : 0;
  const result = await warmRouteChain(
    routes as string[],
    alreadyWarmed,
    request,
    typeof runId === 'string' ? runId : null,
  );

  return noCache({ success: true, ...result });
}
