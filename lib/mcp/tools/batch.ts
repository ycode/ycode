import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { Layer, Breakpoint, UIState, Page } from '@/types';
import {
  findLayerById,
  updateLayerById,
  insertLayer,
  removeLayer,
  moveLayer as moveLayerInTree,
  canHaveChildren,
  createLayerFromTemplate,
  getTiptapTextContent,
  buildTiptapDoc,
  applyDesignToLayer,
  applyImageUpdate,
  describeImageUpdate,
  applyBackgroundImage,
  applyLayerSettings,
  buildLinkSettings,
  defaultDynamicPageItem,
  describeLink,
  resolveLinkAnchor,
} from '@/lib/mcp/utils';
import type { RichTextBlock } from '@/lib/mcp/utils';
import { getCachedLayers, saveCachedLayers } from '@/lib/mcp/page-layers';
import { bindLayerToField } from '@/lib/mcp/field-binding';
import type { FieldCache } from '@/lib/mcp/field-binding';
import { getCollectionById } from '@/lib/repositories/collectionRepository';
import { getPageById } from '@/lib/repositories/pageRepository';
import { canConvertToCollection } from '@/lib/layer-utils';
import { broadcastLayersChanged } from '@/lib/mcp/broadcast';
import { lintDesign } from '@/lib/mcp/design-lint';
import { collectFontFamiliesFromDesign, ensureFontsInstalled, fontWarnings } from '@/lib/mcp/font-install';
import {
  bindingSourceEnum,
  designSchema,
  richTextBlockSchema,
  templateEnum,
  updateBackgroundImageOp,
  updateLinkOp,
  updateSettingsOp,
} from './shared-schemas';

/**
 * Delay between section reveals when streaming a batch onto the canvas. Long
 * enough to read as a deliberate "section appearing" beat (Framer-like), short
 * enough that a full page still assembles in a couple of seconds.
 */
const STEP_REVEAL_DELAY_MS = 400;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const addLayerOp = z.object({
  type: z.literal('add_layer'),
  parent_layer_id: z.string().describe('ID of existing parent, or a ref_id from an earlier operation'),
  position: z.number().optional(),
  template: templateEnum,
  text_content: z.string().optional(),
  rich_content: z.array(richTextBlockSchema).optional().describe('For richText: structured content blocks'),
  custom_name: z.string().optional(),
  ref_id: z.string().optional().describe('A reference ID so later operations can target this layer. Style it with a follow-up update_design op referencing this ref_id.'),
  image_asset_id: z.string().optional().describe('For image layers: asset ID to display'),
  image_alt: z.string().optional().describe('For image layers: alt text for accessibility'),
  design: designSchema.optional().describe('Optional design to apply inline when creating the layer, instead of a follow-up update_design op.'),
});

const updateDesignOp = z.object({
  type: z.literal('update_design'),
  layer_id: z.string().describe('Layer ID or ref_id from a prior add_layer'),
  design: designSchema,
  breakpoint: z.enum(['desktop', 'tablet', 'mobile']).default('desktop').optional(),
  ui_state: z.enum(['neutral', 'hover', 'focus', 'active', 'disabled', 'current']).default('neutral').optional()
    .describe('UI state: "hover" for hover styles, "focus" for focus, "current" for the active/current navigation link, etc.'),
});

const updateTextOp = z.object({
  type: z.literal('update_text'),
  layer_id: z.string().describe('Layer ID or ref_id from a prior add_layer'),
  text: z.string(),
});

const deleteLayerOp = z.object({
  type: z.literal('delete_layer'),
  layer_id: z.string(),
});

const moveLayerOp = z.object({
  type: z.literal('move_layer'),
  layer_id: z.string(),
  new_parent_id: z.string(),
  position: z.number().optional(),
});

const updateImageOp = z.object({
  type: z.literal('update_image'),
  layer_id: z.string().describe('Layer ID or ref_id from a prior add_layer'),
  asset_id: z.string().optional().describe('Asset ID from upload_asset. Omit to keep the current image and only change alt.'),
  alt: z.string().optional().describe('Image alt text for accessibility. Omit to keep the current alt.'),
});

const applyStyleOp = z.object({
  type: z.literal('apply_style'),
  layer_id: z.string(),
  style_id: z.string().describe('Layer style ID to apply'),
});

const setRichTextOp = z.object({
  type: z.literal('set_rich_text'),
  layer_id: z.string().describe('RichText layer ID or ref_id'),
  blocks: z.array(richTextBlockSchema).min(1).describe('Content blocks (paragraph, heading, list, etc.)'),
});

const bindFieldOp = z.object({
  type: z.literal('bind_field'),
  layer_id: z.string().describe('Layer ID or ref_id whose content to bind to a CMS field'),
  field_id: z.string().describe('Collection field ID (global variable ID when source is "global")'),
  source: bindingSourceEnum.default('collection').optional()
    .describe('"collection" = nearest ancestor Collection List (default); "page" = the dynamic page\'s item; "global" = a site-wide global variable (any layer)'),
  target: z.enum(['auto', 'src', 'alt', 'poster', 'background']).default('auto').optional()
    .describe('"auto" picks by layer type (text→text, image/video/audio→src); "alt", "poster" or "background" for those targets'),
  format: z.string().optional().describe('Optional value format (e.g. a date format)'),
  prefix: z.string().optional().describe('Text layers: literal text before the value'),
  suffix: z.string().optional().describe('Text layers: literal text after the value'),
});

const bindCollectionOp = z.object({
  type: z.literal('bind_collection'),
  layer_id: z.string().describe('Collection List layer ID or ref_id (a plain container is converted in place)'),
  collection_id: z.string().describe('The CMS collection to repeat'),
  sort_by: z.string().optional().describe('"manual", "random", "none", or a field ID'),
  sort_order: z.enum(['asc', 'desc']).optional(),
  limit: z.number().int().positive().optional(),
});

const operationSchema = z.discriminatedUnion('type', [
  addLayerOp, updateDesignOp, updateTextOp, updateImageOp, deleteLayerOp, moveLayerOp, applyStyleOp, setRichTextOp,
  updateLinkOp, updateSettingsOp, updateBackgroundImageOp, bindCollectionOp, bindFieldOp,
]);

function resolveId(id: string, refMap: Map<string, string>): string {
  return refMap.get(id) || id;
}

export function registerBatchTools(server: McpServer) {
  server.tool(
    'batch_operations',
    `Execute multiple layer operations in a single call. Fetches the layer tree
once, applies all operations in order, then saves once. MUCH faster than individual tools,
and one call means one permission prompt in the user's AI client instead of one per edit.

OPERATIONS: add_layer, update_design, update_text, set_rich_text, update_image, update_link,
update_settings (tag, id, name, hidden, attributes, embed code), update_background_image,
apply_style, move_layer, delete_layer, bind_collection (bind a Collection List — or convert a
container into one — to a CMS collection), bind_field (bind text / heading / image / video /
background to a collection field; same options as bind_layer_field). Use this whenever a turn
touches two or more layers — including wiring up a whole CMS card in one call — the
single-purpose tools are for one-off edits or element-specific settings (slider, lightbox, map,
options source, filters, pagination).

LIMIT: max 50 operations per call — split larger builds into several calls.

Use ref_id in add_layer to name layers, then reference them in later operations (including
update_link anchor_layer_id; give the target an HTML id with update_settings first).

EXAMPLE:
{
  "page_id": "...",
  "operations": [
    { "type": "add_layer", "parent_layer_id": "body_id", "template": "section", "ref_id": "hero" },
    { "type": "add_layer", "parent_layer_id": "hero", "template": "heading", "text_content": "Welcome", "ref_id": "title" },
    { "type": "update_design", "layer_id": "title", "design": { "typography": { "isActive": true, "fontSize": "56px" } } }
  ]
}`,
    {
      page_id: z.string().describe('The page ID'),
      operations: z.array(operationSchema).min(1).max(50).describe('Array of operations to execute in order (max 50)'),
    },
    async ({ page_id, operations }) => {
      let layers = await getCachedLayers(page_id);
      const pageCache = new Map<string, Promise<Page | null>>();
      const getCachedPage = (id: string) => {
        if (!pageCache.has(id)) pageCache.set(id, getPageById(id).catch(() => null));
        return pageCache.get(id)!;
      };

      // Reveal the page section-by-section as it's built. Each time the agent
      // starts a new top-level section, we broadcast the current tree (a live
      // realtime push, NOT a DB write) so the previously finished section streams
      // onto the canvas on its own — like Framer — instead of the whole page
      // popping in at once when the batch's single save runs at the end.
      const rootLayer = layers.find((l) => l.id === 'body' || l.name === 'body');
      const rootParentId = rootLayer?.id;
      let hasUnflushedStructuralChange = false;

      const refMap = new Map<string, string>();
      const results: Array<{ op: number; status: string; detail: string }> = [];
      // Layers this batch created or restyled — the design linter scopes its
      // per-layer checks to these so pre-existing issues don't repeat forever.
      const touchedIds = new Set<string>();
      // Custom fontFamily values this batch applies — missing ones are
      // auto-installed from the Google Fonts catalog after the save.
      const fontFamilies = new Set<string>();
      // Collection fields fetched once per collection for bind_field ops.
      const fieldCache: FieldCache = new Map();

      for (let i = 0; i < operations.length; i++) {
        const op = operations[i];
        try {
          switch (op.type) {
            case 'add_layer': {
              const parentId = resolveId(op.parent_layer_id, refMap);
              const parent = findLayerById(layers, parentId);
              if (!parent) { results.push({ op: i, status: 'error', detail: `Parent "${op.parent_layer_id}" not found` }); continue; }
              if (!canHaveChildren(parent)) { results.push({ op: i, status: 'error', detail: `"${parent.customName || parent.name}" cannot have children` }); continue; }

              // A new top-level section is beginning: flush the section(s) built
              // so far to the canvas, then pace briefly before assembling this one.
              if (rootParentId && parentId === rootParentId && hasUnflushedStructuralChange) {
                await broadcastLayersChanged(page_id, layers).catch(() => {});
                await sleep(STEP_REVEAL_DELAY_MS);
                hasUnflushedStructuralChange = false;
              }

              let newLayer = createLayerFromTemplate(op.template, {
                customName: op.custom_name,
                textContent: op.text_content,
                richContent: op.rich_content as RichTextBlock[] | undefined,
              });
              if (!newLayer) { results.push({ op: i, status: 'error', detail: `Unknown template "${op.template}"` }); continue; }

              if (op.design) {
                newLayer = applyDesignToLayer(newLayer, op.design as Record<string, Record<string, unknown>>);
                collectFontFamiliesFromDesign(op.design as Record<string, unknown>, fontFamilies);
              }

              if ((op.image_asset_id || op.image_alt !== undefined) && newLayer.variables?.image) {
                newLayer = applyImageUpdate(newLayer, { asset_id: op.image_asset_id, alt: op.image_alt });
              }

              if (op.ref_id) refMap.set(op.ref_id, newLayer.id);
              layers = insertLayer(layers, parentId, newLayer, op.position);
              touchedIds.add(newLayer.id);
              hasUnflushedStructuralChange = true;
              results.push({ op: i, status: 'ok', detail: `Added ${op.template} (id: ${newLayer.id})` });
              break;
            }

            case 'update_design': {
              const layerId = resolveId(op.layer_id, refMap);
              const layer = findLayerById(layers, layerId);
              if (!layer) { results.push({ op: i, status: 'error', detail: `Layer "${op.layer_id}" not found` }); continue; }
              const bp = (op as { breakpoint?: string }).breakpoint || 'desktop';
              const state = (op as { ui_state?: string }).ui_state || 'neutral';
              layers = updateLayerById(layers, layerId, (l) =>
                applyDesignToLayer(l, op.design as Record<string, Record<string, unknown>>, bp as Breakpoint, state as UIState),
              );
              collectFontFamiliesFromDesign(op.design as Record<string, unknown>, fontFamilies);
              touchedIds.add(layerId);
              results.push({ op: i, status: 'ok', detail: `Styled "${layer.customName || layer.name}"` });
              break;
            }

            case 'update_text': {
              const layerId = resolveId(op.layer_id, refMap);
              const layer = findLayerById(layers, layerId);
              if (!layer) { results.push({ op: i, status: 'error', detail: `Layer "${op.layer_id}" not found` }); continue; }
              layers = updateLayerById(layers, layerId, (l) => ({
                ...l,
                variables: { ...l.variables, text: { type: 'dynamic_rich_text', data: { content: getTiptapTextContent(op.text) } } },
              }));
              results.push({ op: i, status: 'ok', detail: `Set text on "${layer.customName || layer.name}"` });
              break;
            }

            case 'update_image': {
              const layerId = resolveId(op.layer_id, refMap);
              const layer = findLayerById(layers, layerId);
              if (!layer) { results.push({ op: i, status: 'error', detail: `Layer "${op.layer_id}" not found` }); continue; }
              if (op.asset_id === undefined && op.alt === undefined) {
                results.push({ op: i, status: 'error', detail: 'update_image needs asset_id and/or alt' });
                continue;
              }
              if (op.asset_id === undefined && !layer.variables?.image?.src) {
                results.push({ op: i, status: 'error', detail: `"${layer.customName || layer.name}" has no image yet — pass asset_id to set one before alt` });
                continue;
              }
              layers = updateLayerById(layers, layerId, (l) => applyImageUpdate(l, op));
              results.push({ op: i, status: 'ok', detail: `${describeImageUpdate(op)} on "${layer.customName || layer.name}"` });
              break;
            }

            case 'update_link': {
              const layerId = resolveId(op.layer_id, refMap);
              const layer = findLayerById(layers, layerId);
              if (!layer) { results.push({ op: i, status: 'error', detail: `Layer "${op.layer_id}" not found` }); continue; }
              const linksElsewhere = op.link_type === 'page' && op.page_id_target && op.page_id_target !== page_id;
              const anchorInput = op.anchor_layer_id && !linksElsewhere
                ? { ...op, anchor_layer_id: resolveId(op.anchor_layer_id, refMap) }
                : op;
              const resolvedLink = resolveLinkAnchor(
                anchorInput,
                linksElsewhere && op.anchor_layer_id ? await getCachedLayers(op.page_id_target!) : layers,
              );
              if ('error' in resolvedLink) { results.push({ op: i, status: 'error', detail: resolvedLink.error }); continue; }
              let linkInput = resolvedLink.input;
              if (linkInput.link_type === 'page' && linkInput.page_id_target && !linkInput.collection_item_id) {
                const [targetPage, currentPage] = await Promise.all([getCachedPage(linkInput.page_id_target), getCachedPage(page_id)]);
                linkInput = defaultDynamicPageItem(linkInput, layers, layerId, targetPage, currentPage);
              }
              layers = updateLayerById(layers, layerId, (l) => ({
                ...l,
                variables: { ...l.variables, link: buildLinkSettings(linkInput, l.variables?.link) },
              }));
              results.push({ op: i, status: 'ok', detail: `${describeLink(op)} on "${layer.customName || layer.name}"` });
              break;
            }

            case 'update_settings': {
              const layerId = resolveId(op.layer_id, refMap);
              const layer = findLayerById(layers, layerId);
              if (!layer) { results.push({ op: i, status: 'error', detail: `Layer "${op.layer_id}" not found` }); continue; }
              layers = updateLayerById(layers, layerId, (l) => applyLayerSettings(l, op));
              results.push({ op: i, status: 'ok', detail: `Updated settings on "${layer.customName || layer.name}"` });
              break;
            }

            case 'update_background_image': {
              const layerId = resolveId(op.layer_id, refMap);
              const layer = findLayerById(layers, layerId);
              if (!layer) { results.push({ op: i, status: 'error', detail: `Layer "${op.layer_id}" not found` }); continue; }
              if (!op.asset_id && !op.url) { results.push({ op: i, status: 'error', detail: 'update_background_image needs asset_id or url' }); continue; }
              layers = updateLayerById(layers, layerId, (l) => applyBackgroundImage(l, op));
              results.push({ op: i, status: 'ok', detail: `Set background image on "${layer.customName || layer.name}"` });
              break;
            }

            case 'delete_layer': {
              const layerId = resolveId(op.layer_id, refMap);
              const layer = findLayerById(layers, layerId);
              if (!layer) { results.push({ op: i, status: 'error', detail: `Layer "${op.layer_id}" not found` }); continue; }
              layers = removeLayer(layers, layerId);
              results.push({ op: i, status: 'ok', detail: `Deleted "${layer.customName || layer.name}"` });
              break;
            }

            case 'move_layer': {
              const layerId = resolveId(op.layer_id, refMap);
              const newParentId = resolveId(op.new_parent_id, refMap);
              const layer = findLayerById(layers, layerId);
              if (!layer) { results.push({ op: i, status: 'error', detail: `Layer "${op.layer_id}" not found` }); continue; }
              layers = moveLayerInTree(layers, layerId, newParentId, op.position);
              results.push({ op: i, status: 'ok', detail: `Moved "${layer.customName || layer.name}"` });
              break;
            }

            case 'apply_style': {
              const layerId = resolveId(op.layer_id, refMap);
              const layer = findLayerById(layers, layerId);
              if (!layer) { results.push({ op: i, status: 'error', detail: `Layer "${op.layer_id}" not found` }); continue; }
              layers = updateLayerById(layers, layerId, (l) => ({ ...l, styleId: op.style_id }));
              results.push({ op: i, status: 'ok', detail: `Applied style to "${layer.customName || layer.name}"` });
              break;
            }

            case 'bind_collection': {
              const layerId = resolveId(op.layer_id, refMap);
              const layer = findLayerById(layers, layerId);
              if (!layer) { results.push({ op: i, status: 'error', detail: `Layer "${op.layer_id}" not found` }); continue; }
              const existing = layer.variables?.collection;
              if (!existing && !canConvertToCollection(layer)) {
                results.push({ op: i, status: 'error', detail: `"${layer.customName || layer.name}" cannot become a Collection List — use a plain container div` });
                continue;
              }
              const collection = await getCollectionById(op.collection_id);
              if (!collection) { results.push({ op: i, status: 'error', detail: `Collection "${op.collection_id}" not found` }); continue; }
              const collectionChanged = !!existing?.id && existing.id !== op.collection_id;
              layers = updateLayerById(layers, layerId, (l) => {
                const next = {
                  ...l.variables?.collection,
                  id: op.collection_id,
                  ...(op.sort_by !== undefined ? { sort_by: op.sort_by } : {}),
                  ...(op.sort_order !== undefined ? { sort_order: op.sort_order } : {}),
                  ...(op.limit !== undefined ? { limit: op.limit } : {}),
                };
                // Filters reference the previous collection's fields — drop them on a switch.
                if (collectionChanged) delete next.filters;
                return { ...l, variables: { ...l.variables, collection: next } };
              });
              touchedIds.add(layerId);
              results.push({ op: i, status: 'ok', detail: `${existing ? 'Bound' : 'Converted and bound'} "${layer.customName || layer.name}" to collection "${collection.name}"` });
              break;
            }

            case 'bind_field': {
              const layerId = resolveId(op.layer_id, refMap);
              const layer = findLayerById(layers, layerId);
              if (!layer) { results.push({ op: i, status: 'error', detail: `Layer "${op.layer_id}" not found` }); continue; }
              const bound = await bindLayerToField(layers, layer, page_id, {
                field_id: op.field_id,
                source: op.source ?? 'collection',
                target: op.target ?? 'auto',
                format: op.format,
                prefix: op.prefix,
                suffix: op.suffix,
              }, fieldCache);
              if ('error' in bound) { results.push({ op: i, status: 'error', detail: bound.error }); continue; }
              layers = updateLayerById(layers, layerId, () => bound.layer);
              results.push({ op: i, status: 'ok', detail: `Bound ${bound.summary} on "${layer.customName || layer.name}"` });
              break;
            }

            case 'set_rich_text': {
              const layerId = resolveId(op.layer_id, refMap);
              const layer = findLayerById(layers, layerId);
              if (!layer) { results.push({ op: i, status: 'error', detail: `Layer "${op.layer_id}" not found` }); continue; }
              const tiptapDoc = buildTiptapDoc(op.blocks as RichTextBlock[]);
              layers = updateLayerById(layers, layerId, (l) => ({
                ...l,
                variables: { ...l.variables, text: { type: 'dynamic_rich_text', data: { content: tiptapDoc } } },
              }));
              results.push({ op: i, status: 'ok', detail: `Set rich text on "${layer.customName || layer.name}" (${op.blocks.length} blocks)` });
              break;
            }
          }
        } catch (err) {
          results.push({ op: i, status: 'error', detail: err instanceof Error ? err.message : 'Unknown error' });
        }
      }

      const errors = results.filter((r) => r.status === 'error');
      if (errors.length === operations.length) {
        return { content: [{ type: 'text' as const, text: JSON.stringify({ message: 'All operations failed', results }) }], isError: true };
      }

      await saveCachedLayers(page_id, layers);

      // Auto-install any Google Font the batch referenced but never added —
      // otherwise the family silently renders as a browser fallback.
      const fonts = await ensureFontsInstalled(fontFamilies);

      // Instant design feedback on what this batch built (Framer-style linter):
      // deterministic checks the model can act on in its next operation,
      // instead of shipping structural/contrast mistakes it cannot see.
      const designWarnings = [...fontWarnings(fonts), ...lintDesign(layers, touchedIds)];

      const refEntries = Object.fromEntries(refMap);
      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({
            message: `Executed ${results.filter((r) => r.status === 'ok').length}/${operations.length} operations`,
            ref_ids: Object.keys(refEntries).length > 0 ? refEntries : undefined,
            results,
            fonts_auto_installed: fonts.installed.length > 0 ? fonts.installed : undefined,
            design_warnings: designWarnings.length > 0 ? designWarnings : undefined,
          }),
        }],
      };
    },
  );
}
