import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type {
  Layer,
  CollectionVariable,
  CollectionField,
} from '@/types';
import { getCollectionById } from '@/lib/repositories/collectionRepository';
import { getFieldsByCollectionId } from '@/lib/repositories/collectionFieldRepository';
import { getCachedDraft, saveCachedLayers } from '@/lib/mcp/page-layers';
import { findLayerById, updateLayerById } from '@/lib/mcp/utils';
import { getPageById } from '@/lib/repositories/pageRepository';
import { canConvertToCollection, findParentCollectionLayer } from '@/lib/layer-utils';
import {
  BINDABLE_TEXT_LAYER_NAMES,
  bindLayerToField,
  buildDynamicTextDoc,
  getFieldsCached,
  resolveBindingContext,
} from '@/lib/mcp/field-binding';
import { bindingSourceEnum, dynamicTextSegmentSchema } from './shared-schemas';
import {
  fieldConditionSchema,
  itemIdConditionSchema,
  pageCollectionConditionSchema,
  buildConditionGroups,
} from './visibility-conditions';

/**
 * Find a collection-list layer (a layer carrying a `collection` variable). Such
 * layers render as `div` but repeat their children for each item in the bound
 * collection — they're created via add_layer template "collection".
 */
function findCollectionLayer(layers: Layer[], layerId: string, convert = false):
  | { layer: Layer; collection: CollectionVariable }
  | { error: string } {
  const layer = findLayerById(layers, layerId);
  if (!layer) return { error: `Layer "${layerId}" not found.` };
  const collection = layer.variables?.collection;
  if (collection) return { layer, collection };
  if (convert) {
    if (!canConvertToCollection(layer)) {
      return { error: `Layer "${layerId}" (${layer.name}) cannot become a Collection List — use a plain container div.` };
    }
    return { layer, collection: { id: '' } };
  }
  return { error: `Layer "${layerId}" is not a Collection List. Add one with add_layer template "collection", or pass convert: true to turn this container into one in place.` };
}

export function registerCollectionLayerTools(server: McpServer) {
  server.tool(
    'bind_collection_layer',
    `Bind a Collection List element (add_layer template "collection") to a CMS collection so it
is repeated once per item. Also sets sorting, an optional item limit, and pagination.

THE COLLECTION LAYER IS THE REPEATED ITEM, NOT THE LIST CONTAINER: the layer itself (with its
classes) is cloned per item along with its children. Keep the list layout (display grid,
gridTemplateColumns, gap, dividers) on its PARENT div and only card styling (padding,
background, border, radius) on the collection layer — a grid on the collection layer renders
one grid per item. Pass convert: true to turn an existing plain div (e.g. an imported card)
into the Collection List in place; move the other static copies out or delete them.

Changing the bound collection clears any existing filters on the layer, since they reference the
previous collection's fields. After binding, use set_collection_filters to filter the items.

NESTED COLLECTIONS: To source a list from a reference field of a parent item instead of a whole
collection, pass source_field_id + source_field_type:
- "reference" / "multi_reference": collection_id must be the field's target collection; set
  source_field_source "collection" (field on the ancestor list's item) or "page" (field on the
  dynamic page's item).
- "inverse_reference": collection_id is the child collection, source_field_id is the child field
  that points back to the parent.

SORT INPUTS: link sort_by_input_layer_id / sort_order_input_layer_id to filter input layers so
visitors control sorting at runtime.`,
    {
      page_id: z.string().describe('The page ID'),
      layer_id: z.string().describe('The Collection List layer ID'),
      collection_id: z.string().describe('The CMS collection to display (for nested reference/multi_reference, the field\'s target collection).'),
      sort_by: z.string().optional()
        .describe('"manual" (collection order), "random", "none", or a field ID to sort by. Omit to leave unchanged.'),
      sort_order: z.enum(['asc', 'desc']).optional().describe('Sort direction when sort_by is a field ID.'),
      limit: z.number().int().positive().optional().describe('Maximum number of items to show (ignored when pagination is enabled).'),
      pagination: z.object({
        enabled: z.boolean().describe('Turn pagination on or off.'),
        mode: z.enum(['pages', 'load_more']).optional().describe('"pages" for numbered pages, "load_more" for a load-more button. Defaults to "pages".'),
        items_per_page: z.number().int().positive().optional().describe('Items per page. Defaults to 10.'),
      }).optional().describe('Pagination settings.'),
      source_field_id: z.string().nullable().optional()
        .describe('Nested collections: the reference field to source items from. Pass null to clear nesting (revert to a direct collection).'),
      source_field_type: z.enum(['reference', 'multi_reference', 'multi_asset', 'inverse_reference']).optional()
        .describe('Type of the source field. Required when source_field_id is set.'),
      source_field_source: z.enum(['page', 'collection']).nullable().optional()
        .describe('Where the source field lives: "collection" (ancestor list item) or "page" (dynamic page item). Omit for inverse_reference.'),
      sort_by_input_layer_id: z.string().nullable().optional().describe('Link sort_by to a filter input layer (null clears).'),
      sort_order_input_layer_id: z.string().nullable().optional().describe('Link sort_order to a filter input layer (null clears).'),
      convert: z.boolean().optional()
        .describe('When layer_id is a plain container (e.g. one imported card), convert it into the Collection List in place instead of failing.'),
    },
    async ({ page_id, layer_id, collection_id, sort_by, sort_order, limit, pagination, source_field_id, source_field_type, source_field_source, sort_by_input_layer_id, sort_order_input_layer_id, convert }) => {
      const pageLayers = await getCachedDraft(page_id);
      if (!pageLayers) {
        return { content: [{ type: 'text' as const, text: `Error: Page "${page_id}" has no layers.` }], isError: true };
      }

      const layers = pageLayers.layers as Layer[];
      const found = findCollectionLayer(layers, layer_id, convert);
      if ('error' in found) {
        return { content: [{ type: 'text' as const, text: `Error: ${found.error}` }], isError: true };
      }

      const collection = await getCollectionById(collection_id);
      if (!collection) {
        return { content: [{ type: 'text' as const, text: `Error: Collection "${collection_id}" not found.` }], isError: true };
      }

      if (source_field_id && !source_field_type) {
        return { content: [{ type: 'text' as const, text: 'Error: source_field_type is required when source_field_id is set.' }], isError: true };
      }

      const existing = found.collection;
      const collectionChanged = !!existing.id && existing.id !== collection_id;

      const nextVariable: CollectionVariable = {
        ...existing,
        id: collection_id,
        ...(sort_by !== undefined ? { sort_by } : {}),
        ...(sort_order !== undefined ? { sort_order } : {}),
        ...(limit !== undefined ? { limit } : {}),
        ...(pagination !== undefined ? {
          pagination: {
            enabled: pagination.enabled,
            mode: pagination.mode ?? 'pages',
            items_per_page: pagination.items_per_page ?? 10,
          },
        } : {}),
      };

      // Nested-collection sourcing. null clears nesting; a field id sets it.
      if (source_field_id === null) {
        delete nextVariable.source_field_id;
        delete nextVariable.source_field_type;
        delete nextVariable.source_field_source;
      } else if (source_field_id !== undefined) {
        nextVariable.source_field_id = source_field_id;
        nextVariable.source_field_type = source_field_type;
        nextVariable.source_field_source = source_field_source ?? undefined;
      }

      // Sort input linking. null clears the link.
      if (sort_by_input_layer_id === null) delete nextVariable.sort_by_inputLayerId;
      else if (sort_by_input_layer_id !== undefined) nextVariable.sort_by_inputLayerId = sort_by_input_layer_id;
      if (sort_order_input_layer_id === null) delete nextVariable.sort_order_inputLayerId;
      else if (sort_order_input_layer_id !== undefined) nextVariable.sort_order_inputLayerId = sort_order_input_layer_id;

      // Filters reference the previous collection's fields — drop them when the
      // bound collection changes so we never persist conditions that can't resolve.
      if (collectionChanged) {
        delete nextVariable.filters;
      }

      const updated = updateLayerById(layers, layer_id, (l) => ({
        ...l,
        variables: { ...l.variables, collection: nextVariable },
      }));
      await saveCachedLayers(page_id, updated);

      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({
            message: `Bound layer to collection "${collection.name}"`,
            layer_id,
            collection_id,
            filters_cleared: collectionChanged || undefined,
          }),
        }],
      };
    },
  );

  server.tool(
    'set_collection_filters',
    `Set the filters on a Collection List element so it only renders matching items (filtering at the
data level, before render). REPLACES all existing filters. Pass an empty groups array to clear them.

STRUCTURE: groups are joined by AND; conditions within a group are joined by OR.

CONDITION SOURCES:
- "field": filter by a collection field value. Provide field_id and operator. Operators depend on
  the field type (e.g. text: is/is_not/contains; number: is/lt/gt; reference: is_one_of; multi_reference:
  contains_all_of/has_items; boolean: is with value "true"/"false"; date: is/is_before/is_after/is_between).
  - For reference / multi_reference operators, pass item_ids (collection item IDs).
  - For a two-bound date operator (is_between), pass value and value2.
- "item_id": filter by the item's own identity (like reference semantics). operator is_one_of / is_not_one_of
  with item_ids and/or includes_current_page_item.

CURRENT PAGE (dynamic pages only) — the "Current Category/Tag" pattern:
- Set value_mode "current_page" on a "field" condition to bind the compare value to the current dynamic
  page item. For a reference / multi_reference field, it compares against the page item's ID (no value needed).
  For a scalar field, also pass current_page_field_id (a field on the page's collection whose value is compared).
- Or use an "item_id" condition with includes_current_page_item: true to show only the current page's item.

FILTER INPUTS (visitor-facing filtering): set input_layer_id on a "field" condition to bind its value to a
filter input layer (an input/select/etc. inside a Filter element). The visitor's input then drives the filter
at runtime instead of a static value (use input_layer_id2 for the second bound of is_between).`,
    {
      page_id: z.string().describe('The page ID'),
      layer_id: z.string().describe('The Collection List layer ID'),
      groups: z.array(z.object({
        conditions: z.array(z.discriminatedUnion('source', [
          fieldConditionSchema,
          itemIdConditionSchema,
        ])).min(1).describe('Conditions joined by OR.'),
      })).describe('Filter groups joined by AND. Empty array clears all filters.'),
    },
    async ({ page_id, layer_id, groups }) => {
      const pageLayers = await getCachedDraft(page_id);
      if (!pageLayers) {
        return { content: [{ type: 'text' as const, text: `Error: Page "${page_id}" has no layers.` }], isError: true };
      }

      const layers = pageLayers.layers as Layer[];
      const found = findCollectionLayer(layers, layer_id);
      if ('error' in found) {
        return { content: [{ type: 'text' as const, text: `Error: ${found.error}` }], isError: true };
      }

      const collectionId = found.collection.id;
      if (!collectionId) {
        return { content: [{ type: 'text' as const, text: 'Error: Layer is not bound to a collection. Call bind_collection_layer first.' }], isError: true };
      }

      const fields = await getFieldsByCollectionId(collectionId);
      const fieldsById = new Map<string, CollectionField>(fields.map((f) => [f.id, f]));

      const result = buildConditionGroups(groups, { fieldsById, layers });
      if ('error' in result) {
        return { content: [{ type: 'text' as const, text: `Error: ${result.error}` }], isError: true };
      }
      const builtGroups = result.groups;

      const nextVariable: CollectionVariable = { ...found.collection };
      if (builtGroups.length > 0) {
        nextVariable.filters = { groups: builtGroups };
      } else {
        delete nextVariable.filters;
      }

      const updated = updateLayerById(layers, layer_id, (l) => ({
        ...l,
        variables: { ...l.variables, collection: nextVariable },
      }));
      await saveCachedLayers(page_id, updated);

      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({
            message: builtGroups.length > 0
              ? `Set ${builtGroups.length} filter group(s) on the collection layer`
              : 'Cleared all filters on the collection layer',
            layer_id,
            groups: builtGroups.length,
          }),
        }],
      };
    },
  );

  server.tool(
    'bind_layer_field',
    `Bind a layer's content to a CMS collection field so it shows live data per item. Use this on
elements INSIDE a Collection List (source "collection") or anywhere on a dynamic CMS page
(source "page") to wire up titles, images, prices, etc. Source "global" binds ANY layer on any
page to a site-wide global variable (field_id = global variable ID from list_global_variables).

WHAT GETS BOUND (by layer type):
- text / heading / richText → the text content (optionally wrapped with prefix/suffix, e.g. "By " + Author)
- image → the image src (or target "alt" for alt text)
- video / audio → the media src (video also supports target "poster")
- button / a / any linked layer → the link href, from a link, email or phone field
- any layer with target "background" → the background image

The field must exist in the relevant collection: for source "collection" that's the collection bound to
the nearest ancestor Collection List; for source "page" it's the dynamic page's collection.

TIP: To link a card to the item's own dynamic page, use update_layer_link with link_type "page",
page_id_target = the dynamic page, and collection_item_id "current-collection" (the default when
the layer is inside a list of that collection).

Binding many layers (a whole card, several lists)? Use the bind_field / bind_collection ops in
one batch_operations call instead of one call per field.`,
    {
      page_id: z.string().describe('The page ID'),
      layer_id: z.string().describe('The layer whose content to bind'),
      field_id: z.string().describe('The collection field ID to bind to (global variable ID when source is "global")'),
      source: bindingSourceEnum.default('collection')
        .describe('"collection" = nearest ancestor Collection List (default). "page" = the dynamic page\'s collection item. "global" = a site-wide global variable.'),
      target: z.enum(['auto', 'src', 'alt', 'poster', 'background']).default('auto')
        .describe('What to bind. "auto" picks by layer type (text→text, image/video/audio→src). Use "alt", "poster", or "background" for those specific targets.'),
      format: z.string().optional().describe('Optional value format (e.g. a date format) applied when rendering the field.'),
      prefix: z.string().optional().describe('Text layers only: literal text rendered before the field value.'),
      suffix: z.string().optional().describe('Text layers only: literal text rendered after the field value.'),
    },
    async ({ page_id, layer_id, field_id, source, target, format, prefix, suffix }) => {
      const pageLayers = await getCachedDraft(page_id);
      if (!pageLayers) {
        return { content: [{ type: 'text' as const, text: `Error: Page "${page_id}" has no layers.` }], isError: true };
      }

      const layers = pageLayers.layers as Layer[];
      const layer = findLayerById(layers, layer_id);
      if (!layer) {
        return { content: [{ type: 'text' as const, text: `Error: Layer "${layer_id}" not found.` }], isError: true };
      }

      const bound = await bindLayerToField(layers, layer, page_id, { field_id, source, target, format, prefix, suffix });
      if ('error' in bound) {
        return { content: [{ type: 'text' as const, text: `Error: ${bound.error}` }], isError: true };
      }
      const { summary } = bound;

      const updated = updateLayerById(layers, layer_id, () => bound.layer);
      await saveCachedLayers(page_id, updated);

      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({ message: `Bound ${summary}`, layer_id, field_id, source }),
        }],
      };
    },
  );

  server.tool(
    'set_dynamic_text',
    `Set a text layer's content to a mix of literal text and one or more CMS fields in a single text node
(e.g. "{first_name} {last_name}" or "$" + price + " / mo"). Use this when one field (bind_layer_field)
isn't enough.

Provide ordered segments: { type: "text", text } literals interleaved with { type: "field", field_id }
references. Works on text / heading / richText layers, inside a Collection List (source "collection")
or on a dynamic CMS page (source "page").

GLOBAL VARIABLES (source "global", any page): field_id is a global variable ID, e.g. "Only " +
price_per_photo + " per photo". Changing the global's value then updates every layer using it.
Keep the same global in each locale's translation of the layer (see the localization guide).`,
    {
      page_id: z.string().describe('The page ID'),
      layer_id: z.string().describe('The text / heading / richText layer'),
      source: bindingSourceEnum.default('collection')
        .describe('"collection" = nearest ancestor Collection List (default). "page" = the dynamic page\'s collection item. "global" = site-wide global variables.'),
      segments: z.array(dynamicTextSegmentSchema).min(1)
        .describe('Ordered segments interleaving literal text and field references.'),
    },
    async ({ page_id, layer_id, source, segments }) => {
      const pageLayers = await getCachedDraft(page_id);
      if (!pageLayers) {
        return { content: [{ type: 'text' as const, text: `Error: Page "${page_id}" has no layers.` }], isError: true };
      }
      const layers = pageLayers.layers as Layer[];
      const layer = findLayerById(layers, layer_id);
      if (!layer) {
        return { content: [{ type: 'text' as const, text: `Error: Layer "${layer_id}" not found.` }], isError: true };
      }
      if (!BINDABLE_TEXT_LAYER_NAMES.has(layer.name)) {
        return { content: [{ type: 'text' as const, text: `Error: Layer "${layer.customName || layer.name}" (${layer.name}) is not a text layer.` }], isError: true };
      }

      const ctx = await resolveBindingContext(layers, layer_id, page_id, source);
      if ('error' in ctx) {
        return { content: [{ type: 'text' as const, text: `Error: ${ctx.error}` }], isError: true };
      }
      const { collectionId, collectionLayerId } = ctx;

      const fields = await getFieldsCached(collectionId);
      const fieldsById = new Map<string, CollectionField>(fields.map((f) => [f.id, f]));

      const built = buildDynamicTextDoc(segments, fieldsById, source, collectionLayerId);
      if ('error' in built) {
        return { content: [{ type: 'text' as const, text: `Error: ${built.error}` }], isError: true };
      }
      const { fieldCount } = built;

      const nextVariables: Layer['variables'] = {
        ...layer.variables,
        text: { type: 'dynamic_rich_text', data: { content: built.doc } },
      };
      const updated = updateLayerById(layers, layer_id, (l) => ({ ...l, variables: nextVariables }));
      await saveCachedLayers(page_id, updated);

      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({ message: `Set dynamic text with ${fieldCount} field(s)`, layer_id, source }),
        }],
      };
    },
  );

  server.tool(
    'set_layer_visibility',
    `Set conditional visibility on ANY layer: it only renders when the conditions match. REPLACES all
existing visibility conditions; pass an empty groups array to clear them (always visible).

STRUCTURE: groups are joined by AND; conditions within a group are joined by OR.

CONDITION SOURCES:
- "field": test a collection field value. Fields resolve from the nearest ancestor Collection List
  and/or, on a dynamic CMS page, the page's collection. Operators depend on the field type (same as
  set_collection_filters). For reference/multi_reference operators pass item_ids; for is_between pass
  value + value2. value_mode "current_page" binds the compare value to the current dynamic page item.
- "item_id": test the enclosing item's own identity (is_one_of / is_not_one_of, with item_ids and/or
  includes_current_page_item).
- "page_collection": test how many items another Collection List on the page has — has_items /
  has_no_items, or item_count with compare_operator + compare_value. Pass that list's collection_layer_id.`,
    {
      page_id: z.string().describe('The page ID'),
      layer_id: z.string().describe('The layer to show/hide conditionally'),
      groups: z.array(z.object({
        conditions: z.array(z.discriminatedUnion('source', [
          fieldConditionSchema,
          itemIdConditionSchema,
          pageCollectionConditionSchema,
        ])).min(1).describe('Conditions joined by OR.'),
      })).describe('Condition groups joined by AND. Empty array clears all conditions (always visible).'),
    },
    async ({ page_id, layer_id, groups }) => {
      const pageLayers = await getCachedDraft(page_id);
      if (!pageLayers) {
        return { content: [{ type: 'text' as const, text: `Error: Page "${page_id}" has no layers.` }], isError: true };
      }
      const layers = pageLayers.layers as Layer[];
      const layer = findLayerById(layers, layer_id);
      if (!layer) {
        return { content: [{ type: 'text' as const, text: `Error: Layer "${layer_id}" not found.` }], isError: true };
      }

      // Gather candidate fields from every collection context the layer can see:
      // the nearest ancestor Collection List, the layer's own collection (if any),
      // and the dynamic page's collection. collection_field conditions resolve by
      // field id at render time, so a merged lookup is sufficient for validation.
      const collectionIds = new Set<string>();
      const ancestor = findParentCollectionLayer(layers, layer_id);
      if (ancestor?.variables?.collection?.id) collectionIds.add(ancestor.variables.collection.id);
      if (layer.variables?.collection?.id) collectionIds.add(layer.variables.collection.id);
      const page = await getPageById(page_id);
      if (page?.settings?.cms?.collection_id) collectionIds.add(page.settings.cms.collection_id);

      const fieldArrays = await Promise.all([...collectionIds].map((cid) => getFieldsByCollectionId(cid)));
      const fieldsById = new Map<string, CollectionField>();
      for (const fields of fieldArrays) {
        for (const f of fields) fieldsById.set(f.id, f);
      }

      const result = buildConditionGroups(groups, { fieldsById, layers });
      if ('error' in result) {
        return { content: [{ type: 'text' as const, text: `Error: ${result.error}` }], isError: true };
      }
      const builtGroups = result.groups;

      const updated = updateLayerById(layers, layer_id, (l) => ({
        ...l,
        variables: {
          ...l.variables,
          conditionalVisibility: builtGroups.length > 0 ? { groups: builtGroups } : undefined,
        },
      }));
      await saveCachedLayers(page_id, updated);

      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({
            message: builtGroups.length > 0
              ? `Set ${builtGroups.length} visibility condition group(s)`
              : 'Cleared conditional visibility (always visible)',
            layer_id,
            groups: builtGroups.length,
          }),
        }],
      };
    },
  );
}
