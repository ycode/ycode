/**
 * Server-only loader for the slug translations used to build localized URLs
 * (hreflang alternates, locale switcher). Kept off the repository so it can use
 * Next.js cache APIs.
 */

import 'server-only';

import { unstable_cache } from 'next/cache';
import { buildAllPagesTag, buildGlobalSettingsTag } from '@/lib/cache-tags';
import { getSlugTranslationsByLocale } from '@/lib/repositories/translationRepository';
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
 * Slug translations for one locale. Published reads are cached until the next
 * publish (every publish purges the global-settings tag), so a multi-locale page
 * render no longer queries every locale. Not cached when SKIP_SETUP is on and no
 * tenantId is given, since the cache key would not identify the site.
 */
export function loadSlugTranslationsByLocale(
  localeId: string,
  isPublished: boolean,
  tenantId?: string,
): Promise<Translation[]> {
  const canCache = isPublished && (Boolean(tenantId) || process.env.SKIP_SETUP !== 'true');
  if (!canCache) {
    return getSlugTranslationsByLocale(localeId, isPublished, tenantId);
  }

  return unstable_cache(
    async () => (await getSlugTranslationsByLocale(localeId, true, tenantId)).map(toSlugRow),
    ['published-slug-translations', tenantId ?? 'default', localeId],
    { tags: [buildAllPagesTag(tenantId), buildGlobalSettingsTag(tenantId)], revalidate: false },
  )();
}
