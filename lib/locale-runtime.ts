/**
 * Locale Runtime Helpers
 *
 * Pure runtime helpers for resolving translations on the rendered page.
 * Lives in its own module (with zero deps on `lib/templates/*` or
 * `lib/layer-display-utils`) so the public renderer can pull them in
 * without dragging the builder-only translatable-item extractors and the
 * template tree behind them into the public bundle.
 */

import type { Page, Translation } from '@/types';

/**
 * Build a stable storage key for any translation row.
 * Format: `{source_type}:{source_id}:{content_key}`
 * Pure helper — used by both runtime resolution (locale-aware page URLs)
 * and the builder-side extractors.
 */
export function getTranslatableKey(
  translation: Translation | { source_type: string; source_id: string; content_key: string }
): string {
  return `${translation.source_type}:${translation.source_id}:${translation.content_key}`;
}

/**
 * Build a translation key for a layer
 * @param pageId - Page ID
 * @param contentKey - Content key (e.g. `layer:layer-id:text`)
 * @param masterComponentId - Optional component ID — when set, the translation
 *   is namespaced under `component:{id}` instead of `page:{id}` so component
 *   instances share translations across pages.
 */
export function buildLayerTranslationKey(
  pageId: string,
  contentKey: string,
  masterComponentId?: string | undefined
): string {
  const sourcePrefix = masterComponentId
    ? `component:${masterComponentId}`
    : `page:${pageId}`;
  return `${sourcePrefix}:${contentKey}`;
}

/** Get translation from translations map by key */
export function getTranslationByKey(
  translations: Record<string, Translation> | null | undefined,
  translationKey: string
): Translation | undefined {
  if (!translations) return undefined;
  return translations[translationKey];
}

/**
 * Check if a translation has a valid non-empty text value.
 * Only returns true if translation is completed and has non-empty content.
 */
export function hasValidTranslationValue(translation: Translation | undefined): boolean {
  if (!translation || !translation.is_completed) {
    return false;
  }
  return !!(translation.content_value && translation.content_value.trim() !== '');
}

/**
 * Get the translation value if valid, otherwise undefined.
 * Pass `{ includeIncomplete: true }` to skip the `is_completed` gate (used by
 * the builder canvas to surface in-progress translations to the editor).
 */
export function getTranslationValue(
  translation: Translation | undefined,
  options?: { includeIncomplete?: boolean }
): string | undefined {
  if (!translation) return undefined;
  if (options?.includeIncomplete) {
    const value = translation.content_value;
    return value && value.trim() !== '' ? value : undefined;
  }
  if (hasValidTranslationValue(translation)) {
    return translation.content_value;
  }
  return undefined;
}

/**
 * Get translated asset ID if a translation exists.
 * Falls back to `originalAssetId` when no completed translation is found.
 */
export function getTranslatedAssetId(
  originalAssetId: string | undefined,
  contentKey: string,
  translations: Record<string, Translation> | null | undefined,
  pageId: string | undefined,
  masterComponentId?: string | undefined
): string | undefined {
  if (!originalAssetId || !translations || !pageId) return originalAssetId;

  const translationKey = buildLayerTranslationKey(pageId, contentKey, masterComponentId);
  const translation = getTranslationByKey(translations, translationKey);

  const translatedValue = getTranslationValue(translation);
  if (translatedValue) {
    return translatedValue;
  }

  return originalAssetId;
}

/**
 * Slim a per-locale translation catalog down to only the rows still needed
 * after server-side injection. Text/media translations are already baked into
 * the layer tree (via `injectTranslatedText`), so we drop them and keep:
 *   - slug rows — localized link/URL building across every page (client + server)
 *   - seo rows for `seoForPageId` — metadata is only ever generated for the
 *     page being rendered, so other pages' rows are dead weight
 * Dropping the rest keeps the full ~MB catalog out of `PageData` and the
 * serialized RSC/hydration payload on every localized page.
 */
export function slimTranslations(
  translations: Record<string, Translation> | null | undefined,
  options?: { seoForPageId?: string }
): Record<string, Translation> | undefined {
  if (!translations) return undefined;

  const seoForPageId = options?.seoForPageId;
  const slim: Record<string, Translation> = {};
  for (const key in translations) {
    const { content_key: contentKey, source_id: sourceId } = translations[key];
    const isSlug = contentKey === 'slug' || contentKey.endsWith(':slug');
    const isSeo = contentKey.startsWith('seo:');
    if (isSlug || (isSeo && sourceId === seoForPageId)) {
      slim[key] = translations[key];
    }
  }
  return slim;
}

/**
 * Return `page` with its custom head/body code swapped for the active locale's
 * translations. Applied once when the page is fetched so every consumer (page
 * renderer, document <head>, static export) reads already-localized code.
 * Returns the original object when nothing is translated.
 */
export function translatePageCustomCode(
  page: Page,
  translations: Record<string, Translation> | null | undefined
): Page {
  const customCode = page.settings?.custom_code;
  if (!customCode || !translations) return page;

  const head = getTranslatedText(customCode.head, 'custom_code:head', translations, page.id) || '';
  const body = getTranslatedText(customCode.body, 'custom_code:body', translations, page.id) || '';
  if (head === customCode.head && body === customCode.body) return page;

  return {
    ...page,
    settings: { ...page.settings, custom_code: { head, body } },
  };
}

/** Get translated text if a translation exists, otherwise return the original. */
export function getTranslatedText(
  originalText: string | undefined,
  contentKey: string,
  translations: Record<string, Translation> | null | undefined,
  pageId: string | undefined,
  masterComponentId?: string | undefined
): string | undefined {
  if (!originalText || !translations || !pageId) return originalText;

  const translationKey = buildLayerTranslationKey(pageId, contentKey, masterComponentId);
  const translation = getTranslationByKey(translations, translationKey);

  const translatedValue = getTranslationValue(translation);
  if (translatedValue) {
    return translatedValue;
  }

  return originalText;
}
