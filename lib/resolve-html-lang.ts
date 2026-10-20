/**
 * Server-only lookup of `<html lang>` from published/draft locales.
 * Kept off the pure helper so unit tests don't load Next.js cache APIs.
 */

import 'server-only';

import { unstable_cache } from '@/coursey/cache';
import { buildAllPagesTag, buildGlobalSettingsTag } from '@/lib/cache-tags';
import { htmlLangFromLocales } from '@/lib/html-lang';
import { getAllLocales } from '@/lib/repositories/localeRepository';

const FALLBACK_LANG = 'en';

/**
 * Published locales for the lang lookup, cached until publish. Keyed and tagged
 * per tenant so cloud ISR never serves one tenant's locales to another. Also
 * tagged with the global-settings tag, which every publish purges — so a locale
 * add/rename that doesn't trigger a full invalidation still refreshes the lang.
 */
function getCachedPublishedLocales(tenantId?: string) {
  return unstable_cache(
    async () => getAllLocales(true, tenantId),
    ['published-html-lang-locales', tenantId ?? 'default'],
    { tags: [buildAllPagesTag(tenantId), buildGlobalSettingsTag(tenantId)], revalidate: false },
  )();
}

/**
 * Resolve `<html lang>` for a public pathname (no leading slash).
 * Falls back to `en` when locales cannot be loaded.
 */
export async function resolveHtmlLang(
  slugPath: string,
  isPublished = true,
  tenantId?: string,
): Promise<string> {
  try {
    const locales = isPublished
      ? await getCachedPublishedLocales(tenantId)
      : await getAllLocales(false, tenantId);

    return htmlLangFromLocales(slugPath, locales);
  } catch {
    return FALLBACK_LANG;
  }
}
