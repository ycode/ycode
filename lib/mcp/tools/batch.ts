import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { Layer } from '@/types';
import { getDraftLayers, upsertDraftLayers } from '@/lib/repositories/pageLayersRepository';
import {
  findLayerById,
  updateLayerById,
  insertLayer,
  removeLayer,
  moveLayer as moveLayerInTree,
  canHaveChildren,
  createLayerFromTemplate,
  getTiptapTextContent,
  applyDesignToLayer,
  ELEMENT_TEMPLATES,
} from '@/lib/mcp/utils';
import { broadcastLayersChanged } from '@/lib/mcp/broadcast';
import { designSchema } from './shared-schemas';

const templateEnum = z.enum(
  Object.keys(ELEMENT_TEMPLATES) as [string, ...string[]],
);

const addLayerOp = z.object({
  type: z.literal('add_layer'),
  parent_layer_id: z.string().describe('ID of existing parent, or a ref_id from an earlier operation'),
  position: z.number().optional(),
  template: templateEnum,
  text_content: z.string().optional(),
  custom_name: z.string().optional(),
  ref_id: z.string().optional().describe('A reference ID so later operations can target this layer'),
  design: designSchema.optional().describe('Design properties to apply immediately on creation'),
  image_asset_id: z.string().optional().describe('For image layers: asset ID to display'),
});

const updateDesignOp = z.object({
  type: z.literal('update_design'),
  layer_id: z.string().describe('Layer ID or ref_id from a prior add_layer'),
  design: designSchema,
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
  asset_id: z.string().describe('Asset ID from upload_asset'),
});

const applyStyleOp = z.object({
  type: z.literal('apply_style'),
  layer_id: z.string(),
  style_id: z.string().describe('Layer style ID to apply'),
});

const operationSchema = z.discriminatedUnion('type', [
  addLayerOp, updateDesignOp, updateTextOp, updateImageOp, deleteLayerOp, moveLayerOp, applyStyleOp,
]);

function resolveId(id: string, refMap: Map<string, string>): string {
  return refMap.get(id) || id;
}

export function registerBatchTools(server: McpServer) {
  server.tool(
    'batch_operations',
    `Execute multiple layer operations in a single call. Fetches the layer tree
once, applies all operations in order, then saves once. MUCH faster than individual tools.

Use ref_id in add_layer to name layers, then reference them in later operations.

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
      operations: z.array(operationSchema).min(1).max(50).describe('Array of operations to execute in order'),
    },
    async ({ page_id, operations }) => {
      const pageLayers = await getDraftLayers(page_id);
      let layers = (pageLayers?.layers as Layer[]) || [];

      const refMap = new Map<string, string>();
      const results: Array<{ op: number; status: string; detail: string }> = [];

      for (let i = 0; i < operations.length; i++) {
        const op = operations[i];
        try {
          switch (op.type) {
            case 'add_layer': {
              const parentId = resolveId(op.parent_layer_id, refMap);
              const parent = findLayerById(layers, parentId);
              if (!parent) { results.push({ op: i, status: 'error', detail: `Parent "${op.parent_layer_id}" not found` }); continue; }
              if (!canHaveChildren(parent)) { results.push({ op: i, status: 'error', detail: `"${parent.customName || parent.name}" cannot have children` }); continue; }

              let newLayer = createLayerFromTemplate(op.template, { customName: op.custom_name, textContent: op.text_content });
              if (!newLayer) { results.push({ op: i, status: 'error', detail: `Unknown template "${op.template}"` }); continue; }

              if (op.design) {
                newLayer = applyDesignToLayer(newLayer, op.design as Record<string, Record<string, unknown>>);
              }

              if (op.image_asset_id && newLayer.variables?.image) {
                newLayer.variables = {
                  ...newLayer.variables,
                  image: { ...newLayer.variables.image, src: { type: 'asset', data: { asset_id: op.image_asset_id } } },
                };
              }

              if (op.ref_id) refMap.set(op.ref_id, newLayer.id);
              layers = insertLayer(layers, parentId, newLayer, op.position);
              results.push({ op: i, status: 'ok', detail: `Added ${op.template} (id: ${newLayer.id})` });
              break;
            }

            case 'update_design': {
              const layerId = resolveId(op.layer_id, refMap);
              const layer = findLayerById(layers, layerId);
              if (!layer) { results.push({ op: i, status: 'error', detail: `Layer "${op.layer_id}" not found` }); continue; }
              layers = updateLayerById(layers, layerId, (l) =>
                applyDesignToLayer(l, op.design as Record<string, Record<string, unknown>>),
              );
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
              layers = updateLayerById(layers, layerId, (l) => {
                const existing = (l.variables?.image || {}) as Record<string, unknown>;
                return {
                  ...l,
                  variables: {
                    ...l.variables,
                    image: {
                      ...existing,
                      src: { type: 'asset' as const, data: { asset_id: op.asset_id } },
                      alt: (existing.alt || { type: 'dynamic_text' as const, data: { content: '' } }) as { type: 'dynamic_text'; data: { content: string } },
                    },
                  },
                };
              });
              results.push({ op: i, status: 'ok', detail: `Set image on "${layer.customName || layer.name}"` });
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
          }
        } catch (err) {
          results.push({ op: i, status: 'error', detail: err instanceof Error ? err.message : 'Unknown error' });
        }
      }

      const errors = results.filter((r) => r.status === 'error');
      if (errors.length === operations.length) {
        return { content: [{ type: 'text' as const, text: JSON.stringify({ message: 'All operations failed', results }, null, 2) }], isError: true };
      }

      await upsertDraftLayers(page_id, layers);
      broadcastLayersChanged(page_id, layers).catch(() => {});

      const refEntries = Object.fromEntries(refMap);
      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({
            message: `Executed ${results.filter((r) => r.status === 'ok').length}/${operations.length} operations`,
            ref_ids: Object.keys(refEntries).length > 0 ? refEntries : undefined,
            results,
          }, null, 2),
        }],
      };
    },
  );
}
