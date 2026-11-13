import { NextRequest, NextResponse } from 'next/server';
import { isAgentSecretSettingKey } from '@/lib/agent/config';
import { setSettings } from '@/lib/repositories/settingsRepository';
import { clearAllCache, getAllPublishedRoutes, warmRoutes } from '@/lib/services/cacheService';

/**
 * Setting keys that don't affect public-page rendering. Mirrors the list in
 * /ycode/api/settings/[key]/route.ts — keep them in sync. Agent secrets
 * (shared and per-user) are covered by isAgentSecretSettingKey.
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

/**
 * PUT /ycode/api/settings/batch
 *
 * Update multiple settings at once.
 * Invalidates the public page cache so ISR pages pick up the new values.
 * Request body: { settings: { key1: value1, key2: value2, ... } }
 */
export async function PUT(request: NextRequest) {
  try {
    const body = await request.json();
    const { settings } = body;

    if (!settings || typeof settings !== 'object') {
      return NextResponse.json(
        { error: 'Missing or invalid settings object in request body' },
        { status: 400 }
      );
    }

    const count = await setSettings(settings);

    // Only invalidate caches if any of the updated keys actually affect
    // public page rendering. Skips builder-only autosaves.
    const touchesPublicKeys = Object.keys(settings).some(
      (key) => !DRAFT_ONLY_SETTING_KEYS.has(key) && !isAgentSecretSettingKey(key)
    );
    if (touchesPublicKeys) {
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
            `[Cache] settings batch: warming ${warmResult.warmed}${warmResult.total > warmResult.warmed ? ` of ${warmResult.total}` : ''} route(s) in background`,
          );
        }
      } catch {
        // Non-fatal: warming is an optimization
      }
    }

    return NextResponse.json({
      data: { count },
      message: `Updated ${count} setting(s) successfully`,
    });
  } catch (error) {
    console.error('[API] Error updating settings:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to update settings' },
      { status: 500 }
    );
  }
}
