/**
 * Cache tags shared between the code that populates ISR / data-cache entries
 * (page routes) and the code that purges them (publish). Kept dependency-free
 * so page bundles don't pull in the cache service.
 */

/** Site-wide global settings entry (self-hosted / single tenant). */
export const GLOBAL_SETTINGS_TAG = 'global-settings';

/** Sweep-all tag for every page's data-cache entry (self-hosted / single tenant). */
export const ALL_PAGES_TAG = 'all-pages';

/**
 * Tag for the per-site global settings data-cache entry (published_at, custom
 * code, favicon…). Tenant-scoped when a tenantId is given, deployment-wide
 * otherwise. Lets a selective publish refresh it without purging every page.
 */
export function buildGlobalSettingsTag(tenantId?: string | null): string {
  return tenantId ? `t-${tenantId}-global-settings` : GLOBAL_SETTINGS_TAG;
}

/**
 * Tag for the cached redirects list. Tenant-scoped when a tenantId is given.
 * Lets a redirects change refresh it without purging every page.
 */
export function buildRedirectsTag(tenantId?: string | null): string {
  return tenantId ? `t-${tenantId}-redirects` : 'redirects';
}

/**
 * Tag that sweeps every page's data-cache entry. Tenant-scoped when a tenantId
 * is given so a tenant's publish never invalidates another tenant's cache.
 */
export function buildAllPagesTag(tenantId?: string | null): string {
  return tenantId ? `tenant-${tenantId}` : ALL_PAGES_TAG;
}

/**
 * Per-route data-cache tag, purged by a selective publish of that URL.
 * `slugPath` has no leading slash; the homepage is the empty string.
 * Tenant-scoped when a tenantId is given.
 */
export function buildRouteTag(tenantId: string | null | undefined, slugPath: string): string {
  const suffix = slugPath ? `/${slugPath}` : '/';
  return tenantId ? `t-${tenantId}-route-${suffix}` : `route-${suffix}`;
}
