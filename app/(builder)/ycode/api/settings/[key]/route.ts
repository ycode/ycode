import { NextRequest, NextResponse } from 'next/server';
import { isAgentSecretSettingKey } from '@/lib/agent/config';
import { getSettingByKey, setSetting } from '@/lib/repositories/settingsRepository';
import { clearAllCache, getAllPublishedRoutes, warmRoutes } from '@/lib/services/cacheService';

/**
 * Setting keys that don't affect public-page rendering and therefore should
 * NOT trigger a cache nuke when updated.
 *
 * - `draft_css`: builder-only preview CSS. Public pages serve `published_css`.
 *   Saved on every edit, so invalidating here would purge every page on every
 *   keystroke and undo selective invalidation entirely.
 * - `email`: SMTP credentials for form submission backend. Not consumed by
 *   public page renders.
 * - `ai_*`: AI builder configuration (API key, model choices). Builder-only.
 * - `form_spam_protection`: enforced by the submission endpoint. The honeypot
 *   field is rendered unconditionally, so published HTML never varies with it.
 * - `component_folder_order`: order of component folders in the builder.
 *
 * All other keys (redirects, favicon_url, ga_measurement_id, published_css,
 * color variables, etc.) are read by public pages and DO require invalidation.
 */
const DRAFT_ONLY_SETTING_KEYS = new Set([
  'draft_css',
  'email',
  'ai_model',
  'ai_enabled_models',
  'ai_agent_enabled',
  'form_spam_protection',
  'component_folder_order',
]);

/** Builder-only keys that must not purge the public cache. Agent secrets
 * (shared and per-user) are covered by isAgentSecretSettingKey. */
function isDraftOnlySettingKey(key: string): boolean {
  return DRAFT_ONLY_SETTING_KEYS.has(key) || isAgentSecretSettingKey(key);
}

/**
 * GET /ycode/api/settings/[key]
 *
 * Get a setting value by key
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ key: string }> }
) {
  try {
    const { key } = await params;

    if (isAgentSecretSettingKey(key)) {
      return NextResponse.json(
        { error: 'This setting cannot be read directly' },
        { status: 403 }
      );
    }

    const value = await getSettingByKey(key);

    if (value === null) {
      return NextResponse.json(
        { error: 'Setting not found' },
        { status: 404 }
      );
    }

    return NextResponse.json({ data: value });
  } catch (error) {
    console.error('[API] Error fetching setting:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to fetch setting' },
      { status: 500 }
    );
  }
}

/**
 * PUT /ycode/api/settings/[key]
 *
 * Update a setting value
 */
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ key: string }> }
) {
  try {
    const { key } = await params;
    const body = await request.json();
    const { value } = body;

    if (value === undefined) {
      return NextResponse.json(
        { error: 'Missing value in request body' },
        { status: 400 }
      );
    }

    await setSetting(key, value);

    // Skip cache invalidation for draft/internal settings so builder
    // autosaves don't purge the public CDN cache on every edit.
    if (!isDraftOnlySettingKey(key)) {
      await clearAllCache();

      // Prime the cache so the first visit to any public page after this
      // settings change doesn't pay the cold-cache cost. warmRoutes batches
      // and self-chains through every route up to the overall cap; anything
      // beyond that self-warms on first real visit.
      try {
        const routes = await getAllPublishedRoutes();
        const warmResult = await warmRoutes(routes, request);
        if (warmResult) {
          console.log(
            `[Cache] settings (${key}): warming ${warmResult.warmed}${warmResult.total > warmResult.warmed ? ` of ${warmResult.total}` : ''} route(s) in background`,
          );
        }
      } catch {
        // Non-fatal: warming is an optimization
      }
    }

    return NextResponse.json({
      data: { key, value },
      message: 'Setting updated successfully',
    });
  } catch (error) {
    console.error('[API] Error updating setting:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to update setting' },
      { status: 500 }
    );
  }
}
