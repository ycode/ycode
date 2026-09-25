import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import {
  getAllLocales,
  createLocale,
  updateLocale,
  deleteLocale,
  setDefaultLocale,
} from '@/lib/repositories/localeRepository';
import {
  getTranslationsByLocale,
  getTranslationsBySource,
  getCmsTranslationsForItems,
  createTranslation,
  updateTranslation,
  deleteTranslation,
  upsertTranslations,
} from '@/lib/repositories/translationRepository';
import { getPageById } from '@/lib/repositories/pageRepository';
import { getAllComponents, getComponentById } from '@/lib/repositories/componentRepository';
import { getFieldsByCollectionId } from '@/lib/repositories/collectionFieldRepository';
import { getItemsWithValues } from '@/lib/repositories/collectionItemRepository';
import { getCachedLayers } from '@/lib/mcp/page-layers';
import {
  extractPageTranslatableItems,
  extractComponentTranslatableItems,
  extractCmsTranslatableItems,
} from '@/lib/localisation-utils';
import type { TranslatableItem } from '@/lib/localisation-utils';
import { getTranslatableKey } from '@/lib/locale-runtime';
import { buildTiptapDoc, validateTranslationContent } from '@/lib/mcp/utils';
import type { RichTextBlock } from '@/lib/mcp/utils';
import type { ComponentVariant, Layer, TranslationContentType } from '@/types';

const richTextBlockSchema = z.object({
  type: z.enum(['paragraph', 'heading', 'blockquote', 'bulletList', 'orderedList', 'codeBlock', 'horizontalRule']),
  text: z.string().optional().describe('Text content. Supports **bold**, *italic*, [link](url).'),
  level: z.number().optional().describe('Heading level 1-6 (for heading type)'),
  items: z.array(z.string()).optional().describe('List items (for bulletList/orderedList)'),
});

export function registerLocaleTools(server: McpServer) {
  server.tool(
    'list_locales',
    'List all locales (languages) configured for the site. The default locale is the primary language.',
    {},
    async () => {
      const locales = await getAllLocales(false);
      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify(locales.map((l) => ({
            id: l.id,
            code: l.code,
            label: l.label,
            is_default: l.is_default,
          })), null, 2),
        }],
      };
    },
  );

  server.tool(
    'create_locale',
    'Add a new locale (language) to the site. Use ISO 639-1 codes (e.g. "en", "fr", "de", "es", "ja").',
    {
      code: z.string().describe('ISO 639-1 language code (e.g. "fr", "de", "ja")'),
      label: z.string().describe('Human-readable label (e.g. "French", "German", "Japanese")'),
      is_default: z.boolean().optional().describe('Set as the default locale. Only one locale can be default.'),
    },
    async ({ code, label, is_default }) => {
      const { locale } = await createLocale({ code, label, is_default });
      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({ message: `Created locale "${label}" (${code})`, locale }, null, 2),
        }],
      };
    },
  );

  server.tool(
    'update_locale',
    'Update a locale label or set it as default.',
    {
      locale_id: z.string().describe('The locale ID'),
      label: z.string().optional().describe('New label'),
      is_default: z.boolean().optional().describe('Set as default locale'),
    },
    async ({ locale_id, label, is_default }) => {
      const updates: Record<string, unknown> = {};
      if (label !== undefined) updates.label = label;
      if (is_default !== undefined) updates.is_default = is_default;

      const { locale } = await updateLocale(locale_id, updates);
      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({ message: `Updated locale "${locale.label}"`, locale }, null, 2),
        }],
      };
    },
  );

  server.tool(
    'delete_locale',
    'Delete a locale. Cannot delete the default locale — set another locale as default first.',
    {
      locale_id: z.string().describe('The locale ID to delete'),
    },
    async ({ locale_id }) => {
      await deleteLocale(locale_id);
      return {
        content: [{ type: 'text' as const, text: `Locale ${locale_id} deleted successfully.` }],
      };
    },
  );

  server.tool(
    'set_default_locale',
    'Set a locale as the default (primary) language for the site.',
    {
      locale_id: z.string().describe('The locale ID to set as default'),
    },
    async ({ locale_id }) => {
      const locale = await setDefaultLocale(locale_id);
      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({ message: `Set "${locale.label}" as default locale`, locale }, null, 2),
        }],
      };
    },
  );

  server.tool(
    'list_translations',
    'List existing translations for a specific locale. Optionally filter by source type or completion status to keep the response small.',
    {
      locale_id: z.string().describe('The locale ID to get translations for'),
      source_type: z.enum(['page', 'folder', 'component', 'cms']).optional().describe('Only return translations for this source type'),
      completed: z.boolean().optional().describe('Filter by completion status (true = completed only, false = drafts only)'),
    },
    async ({ locale_id, source_type, completed }) => {
      const translations = await getTranslationsByLocale(locale_id);
      const filtered = translations.filter((t) =>
        (source_type === undefined || t.source_type === source_type) &&
        (completed === undefined || t.is_completed === completed),
      );
      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({
            count: filtered.length,
            translations: filtered.map((t) => ({
              id: t.id,
              source_type: t.source_type,
              source_id: t.source_id,
              content_key: t.content_key,
              content_type: t.content_type,
              content_value: t.content_value,
              is_completed: t.is_completed,
            })),
          }),
        }],
      };
    },
  );

  server.tool(
    'set_translation',
    'Create or update a translation for a specific content key in a locale.',
    {
      locale_id: z.string().describe('The locale ID'),
      source_type: z.enum(['page', 'folder', 'component', 'cms']).describe('Type of source being translated'),
      source_id: z.string().describe('ID of the source (page ID, component ID, etc.)'),
      content_key: z.string().describe('Content key identifying what is being translated (e.g. layer ID or field name)'),
      content_type: z.enum(['text', 'richtext', 'asset_id', 'code']).optional().describe('Type of content. Defaults to "text".'),
      content_value: z.string().describe('The translated content'),
      is_completed: z.boolean().optional().describe('Mark translation as complete. Defaults to true. Incomplete translations are saved as drafts but never shown on the live site.'),
    },
    async ({ locale_id, source_type, source_id, content_key, content_type, content_value, is_completed }) => {
      const resolvedType = content_type || 'text';
      const validation = validateTranslationContent(resolvedType, content_value);
      if (!validation.valid) {
        return { content: [{ type: 'text' as const, text: `Error: ${validation.error}` }], isError: true };
      }
      const translation = await createTranslation({
        locale_id,
        source_type,
        source_id,
        content_key,
        content_type: resolvedType,
        content_value,
        is_completed: is_completed ?? true,
      });
      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({ message: 'Translation saved', translation }, null, 2),
        }],
      };
    },
  );

  server.tool(
    'batch_set_translations',
    `Create or update up to 1000 translations in one call — the most efficient way to translate a lot of content. Set the top-level locale_id once and omit it from each item (only override it per item when writing multiple locales at once). Rich text: pass content_type "richtext" with content_value as a JSON-stringified Tiptap doc (or use set_rich_text_translation for a single block-based field).`,
    {
      locale_id: z.string().optional().describe('Default locale ID applied to every item that omits its own locale_id. Set this once instead of repeating it on each item.'),
      translations: z.array(z.object({
        locale_id: z.string().optional().describe('Overrides the top-level locale_id for this item'),
        source_type: z.enum(['page', 'folder', 'component', 'cms']),
        source_id: z.string(),
        content_key: z.string(),
        content_type: z.enum(['text', 'richtext', 'asset_id', 'code']).optional(),
        content_value: z.string(),
        is_completed: z.boolean().optional(),
      })).min(1).max(1000).describe('Array of translations to upsert (max 1000)'),
    },
    async ({ locale_id, translations }) => {
      // Each item's locale_id falls back to the shared top-level one. Report any
      // item missing both so the whole batch is rejected before writing.
      const missingLocale = translations
        .map((t, i) => ({ i, key: t.content_key, hasLocale: !!(t.locale_id || locale_id) }))
        .filter((e) => !e.hasLocale)
        .map((e) => `[${e.i}] "${e.key}"`);
      if (missingLocale.length > 0) {
        return {
          content: [{
            type: 'text' as const,
            text: `Error: ${missingLocale.length} item(s) have no locale_id (and no top-level locale_id was provided): ${missingLocale.join(', ')}`,
          }],
          isError: true,
        };
      }

      const data = translations.map((t) => ({
        locale_id: (t.locale_id || locale_id) as string,
        source_type: t.source_type as 'page' | 'folder' | 'component' | 'cms',
        source_id: t.source_id,
        content_key: t.content_key,
        content_type: (t.content_type || 'text') as TranslationContentType,
        content_value: t.content_value,
        is_completed: t.is_completed ?? true,
      }));

      // Validate every entry up front so a malformed item doesn't partially
      // apply the batch — report each failure with its index and key.
      const errors = data
        .map((t, i) => ({ i, key: t.content_key, result: validateTranslationContent(t.content_type, t.content_value) }))
        .filter((e) => !e.result.valid)
        .map((e) => `[${e.i}] "${e.key}": ${(e.result as { error: string }).error}`);
      if (errors.length > 0) {
        return {
          content: [{
            type: 'text' as const,
            text: `Error: ${errors.length} translation(s) have an invalid format and none were saved. Fix and retry:\n${errors.join('\n')}`,
          }],
          isError: true,
        };
      }

      const result = await upsertTranslations(data);
      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({ message: `Saved ${result.length} translations`, count: result.length }),
        }],
      };
    },
  );

  server.tool(
    'update_translation',
    'Update an existing translation value or completion status.',
    {
      translation_id: z.string().describe('The translation ID'),
      content_value: z.string().optional().describe('New translated content'),
      is_completed: z.boolean().optional().describe('Mark as complete or incomplete'),
    },
    async ({ translation_id, content_value, is_completed }) => {
      const updates: Record<string, unknown> = {};
      if (content_value !== undefined) updates.content_value = content_value;
      if (is_completed !== undefined) updates.is_completed = is_completed;

      const translation = await updateTranslation(translation_id, updates);
      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({ message: 'Translation updated', translation }, null, 2),
        }],
      };
    },
  );

  server.tool(
    'delete_translation',
    'Delete a translation.',
    {
      translation_id: z.string().describe('The translation ID to delete'),
    },
    async ({ translation_id }) => {
      await deleteTranslation(translation_id);
      return {
        content: [{ type: 'text' as const, text: `Translation ${translation_id} deleted successfully.` }],
      };
    },
  );

  server.tool(
    'list_translatable_content',
    `Discover exactly what can be translated for a page, component, or CMS collection — and the precise source_type/source_id/content_key/content_type to use with set_translation. Use this BEFORE translating so you never have to guess keys. Pass locale_id to annotate each item with its existing translation, and untranslated_only to return only the items still needing a translation (skips already-done work — the cheapest way to resume or translate a new locale).`,
    {
      source_type: z.enum(['page', 'component', 'cms']).describe('What to inspect: a page, a component, or a CMS collection'),
      source_id: z.string().describe('Page ID, component ID, or collection ID (for cms)'),
      locale_id: z.string().optional().describe('Optional locale ID to annotate each item with its existing translation status/value'),
      untranslated_only: z.boolean().optional().describe('Requires locale_id. Only return items with no completed translation yet. Use this to avoid re-sending content that is already translated.'),
      search: z.string().optional().describe('CMS only: filter collection items by search term'),
      limit: z.number().optional().describe('CMS only: max collection items to scan (default 25)'),
      offset: z.number().optional().describe('CMS only: skip this many collection items — paginate large collections with limit + offset'),
    },
    async ({ source_type, source_id, locale_id, untranslated_only, search, limit, offset }) => {
      if (untranslated_only && !locale_id) {
        return { content: [{ type: 'text' as const, text: 'Error: untranslated_only requires locale_id.' }], isError: true };
      }

      let items: TranslatableItem[] = [];
      let total: number | undefined;
      // Existing translations for the requested locale, scoped to just this
      // source (page/component/scanned CMS items) — avoids loading the entire
      // locale catalogue on every discovery call.
      let existingByKey: Map<string, { value: string; is_completed: boolean }> | null = null;

      const buildExistingMap = (translations: { content_value: string; is_completed: boolean; source_type: string; source_id: string; content_key: string }[]) =>
        new Map(translations.map((t) => [
          getTranslatableKey(t),
          { value: t.content_value, is_completed: t.is_completed },
        ]));

      if (source_type === 'page') {
        const page = await getPageById(source_id);
        if (!page) {
          return { content: [{ type: 'text' as const, text: `Error: Page "${source_id}" not found.` }], isError: true };
        }
        const layers = await getCachedLayers(source_id);
        // Pass components so per-instance override rows get rich
        // "Component › Variable" labels instead of falling back to layer names.
        const components = await getAllComponents(false).catch(() => []);
        items = extractPageTranslatableItems(page, layers, undefined, components);
        if (locale_id) {
          existingByKey = buildExistingMap(await getTranslationsBySource('page', source_id, false, locale_id));
        }
      } else if (source_type === 'component') {
        const component = await getComponentById(source_id);
        if (!component) {
          return { content: [{ type: 'text' as const, text: `Error: Component "${source_id}" not found.` }], isError: true };
        }
        const variants = component.variants as ComponentVariant[] | undefined;
        const layers = (variants?.[0]?.layers || (component.layers as Layer[]) || []);
        items = extractComponentTranslatableItems({ id: component.id, name: component.name }, layers);
        if (locale_id) {
          existingByKey = buildExistingMap(await getTranslationsBySource('component', source_id, false, locale_id));
        }
      } else {
        const fields = await getFieldsByCollectionId(source_id);
        // Push pagination into the query instead of fetching the whole
        // collection and slicing — critical for large CMS catalogues.
        const { items: collectionItems, total: itemTotal } = await getItemsWithValues(
          source_id,
          false,
          { ...(search ? { search } : {}), limit: limit ?? 25, offset: offset ?? 0 },
        );
        total = itemTotal;
        for (const item of collectionItems) {
          items.push(...extractCmsTranslatableItems(
            { id: item.id, collection_id: source_id, values: item.values },
            fields,
          ));
        }
        if (locale_id) {
          existingByKey = buildExistingMap(
            await getCmsTranslationsForItems(locale_id, false, collectionItems.map((i) => i.id)),
          );
        }
      }

      let result = items.map((item) => {
        const existing = existingByKey?.get(item.key);
        return {
          source_type: item.source_type,
          source_id: item.source_id,
          content_key: item.content_key,
          content_type: item.content_type,
          label: item.info?.label,
          source_value: item.content_value,
          ...(locale_id
            ? { has_translation: !!existing, is_completed: existing?.is_completed ?? false, translated_value: existing?.value }
            : {}),
        };
      });

      if (untranslated_only) {
        result = result.filter((item) => !item.has_translation || !item.is_completed);
      }

      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({
            count: result.length,
            ...(total !== undefined ? { collection_items_total: total, scanned_items: Math.min(total, (offset ?? 0) + (limit ?? 25)) - (offset ?? 0) } : {}),
            items: result,
          }),
        }],
      };
    },
  );

  server.tool(
    'set_rich_text_translation',
    `Translate a rich-text content key by passing structured blocks. The blocks are converted
to the Tiptap JSON shape that Ycode expects for richtext translations and stored as
content_value. Equivalent to calling set_translation with content_type "richtext" but the
agent doesn't have to assemble the JSON by hand.

Block types match add_layer's rich_content: paragraph, heading, blockquote, bulletList,
orderedList, codeBlock, horizontalRule. Text supports **bold**, *italic*, [link](url).`,
    {
      locale_id: z.string().describe('The locale ID'),
      source_type: z.enum(['page', 'folder', 'component', 'cms']).describe('Type of source being translated'),
      source_id: z.string().describe('ID of the source (page ID, component ID, etc.)'),
      content_key: z.string().describe('Content key identifying the rich-text field (e.g. layer ID or "richtext:<field id>")'),
      blocks: z.array(richTextBlockSchema).min(1).describe('Rich-text blocks describing the translated content'),
      is_completed: z.boolean().optional().describe('Mark translation as complete. Defaults to true. Incomplete translations are saved as drafts but never shown on the live site.'),
    },
    async ({ locale_id, source_type, source_id, content_key, blocks, is_completed }) => {
      const doc = buildTiptapDoc(blocks as RichTextBlock[]);
      const translation = await createTranslation({
        locale_id,
        source_type,
        source_id,
        content_key,
        content_type: 'richtext',
        content_value: JSON.stringify(doc),
        is_completed: is_completed ?? true,
      });
      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({ message: 'Rich-text translation saved', translation }, null, 2),
        }],
      };
    },
  );
}
