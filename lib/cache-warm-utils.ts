/**
 * Order routes so the most visited URLs are warmed first: the homepage, then
 * shallow paths, then deeper ones. The warm chain stops at
 * CACHE_WARM_MAX_TOTAL, so whatever comes first is what gets warmed.
 *
 * The sort is stable, so callers can put default-locale pages before locale
 * variants and static pages before CMS items within the same depth.
 */
export function orderRoutesForWarming(routes: string[]): string[] {
  return routes
    .map((route, index) => ({ route, index, depth: route === '' ? 0 : route.split('/').length }))
    .sort((a, b) => a.depth - b.depth || a.index - b.index)
    .map(({ route }) => route);
}

/**
 * Whether a warm chain hop still belongs to the newest run for its site.
 * Fails open: a hop without a run id (signed before this check existed) or a
 * site with no stored run keeps warming.
 */
export function isCurrentWarmRun(runId: string | null | undefined, storedRunId: unknown): boolean {
  if (!runId) return true;
  if (typeof storedRunId !== 'string' || storedRunId === '') return true;
  return runId === storedRunId;
}
