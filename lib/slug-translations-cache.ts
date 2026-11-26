/**
 * Server-only loader for the slug translations used to build localized URLs
 * (hreflang alternates, locale switcher). Kept off the repository so it can use
 * Next.js cache APIs.
 */

import 'server-only';

import { unstable_cache } from 'next/cache';
import { buildAllPagesTag, buildGlobalSettingsTag } from '@/lib/cache-tags';
import { groupTranslationsByLocale } from '@/lib/locale-runtime';
import { getSlugTranslationsForLocales } from '@/lib/repositories/translationRepository';
import type { Translation } from '@/types';

/**
 * Keep only the fields URL builders read. Full rows of a site with thousands of
 * CMS items exceed the 2 MB data-cache entry limit and would never be cached.
 */
function toSlugRow(translation: Translation): Translation {
  return {
    locale_id: translation.locale_id,
    source_type: translation.source_type,
    source_id: translation.source_id,
    content_key: translation.content_key,
    content_type: translation.content_type,
    content_value: translation.content_value,
    is_completed: translation.is_completed,
  } as Translation;
}

/**
 * Slug translations for several locales, keyed by locale id. Published reads
 * are cached per locale until the next publish (every publish purges the
 * global-settings tag). Locales missing from the cache are loaded together in
 * one query, so a cold render of a 17-locale site makes one query, not 17.
 * Not cached when SKIP_SETUP is on and no tenantId is given, since the cache
 * key would not identify the site.
 */
export async function loadSlugTranslationsForLocales(
  localeIds: string[],
  isPublished: boolean,
  tenantId?: string,
): Promise<Record<string, Translation[]>> {
  const ids = [...new Set(localeIds)];
  if (ids.length === 0) return {};

  let batch: Promise<Record<string, Translation[]>> | null = null;
  const loadBatch = () => {
    batch ??= getSlugTranslationsForLocales(ids, isPublished, tenantId)
      .then((rows) => groupTranslationsByLocale(rows, ids));
    return batch;
  };

  const canCache = isPublished && (Boolean(tenantId) || process.env.SKIP_SETUP !== 'true');
  if (!canCache) return loadBatch();

  const entries = await Promise.all(ids.map(async (localeId) => {
    const rows = await unstable_cache(
      async () => (await loadBatch())[localeId].map(toSlugRow),
      ['published-slug-translations', tenantId ?? 'default', localeId],
      { tags: [buildAllPagesTag(tenantId), buildGlobalSettingsTag(tenantId)], revalidate: false },
    )();
    return [localeId, rows] as const;
  }));

  return Object.fromEntries(entries);
}
