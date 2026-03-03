import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { DesignProperties, Layer } from '@/types';
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

async function getPageLayers(pageId: string): Promise<Layer[]> {
  const pageLayers = await getDraftLayers(pageId);
  return (pageLayers?.layers as Layer[]) || [];
}

async function savePageLayers(pageId: string, layers: Layer[]): Promise<void> {
  await upsertDraftLayers(pageId, layers);
  broadcastLayersChanged(pageId, layers).catch(() => {});
}

export function registerLayerTools(server: McpServer) {
  server.tool(
    'get_layers',
    `Get the full layer tree for a page. Returns all layers with their design properties,
text content, children, and settings. Use this to understand the current page structure
before making changes.`,
    { page_id: z.string().describe('The page ID') },
    async ({ page_id }) => {
      const layers = await getPageLayers(page_id);
      return { content: [{ type: 'text' as const, text: JSON.stringify(layers, null, 2) }] };
    },
  );

  server.tool(
    'add_layer',
    `Add a new element to a page.

ELEMENT TYPES:
- Structure: div, section, container, hr
- Content: heading (h1), text (paragraph)
- Media: image, video, audio, icon, iframe
- Actions: button
- Forms: form, input, textarea
- Utilities: htmlEmbed

NESTING RULES:
- Leaf elements (image, text, input, video, icon, etc.) CANNOT have children
- Sections cannot contain other sections`,
    {
      page_id: z.string().describe('The page ID'),
      parent_layer_id: z.string().describe('ID of the parent layer to insert into'),
      position: z.number().optional().describe('Index within parent children. Omit to append at end.'),
      template: templateEnum.describe('Element template to create'),
      text_content: z.string().optional().describe('For text/heading/button: the display text'),
      custom_name: z.string().optional().describe('Custom display name for the layer'),
    },
    async ({ page_id, parent_layer_id, position, template, text_content, custom_name }) => {
      const layers = await getPageLayers(page_id);

      const parent = findLayerById(layers, parent_layer_id);
      if (!parent) {
        return { content: [{ type: 'text' as const, text: `Error: Parent layer "${parent_layer_id}" not found.` }], isError: true };
      }
      if (!canHaveChildren(parent)) {
        return { content: [{ type: 'text' as const, text: `Error: "${parent.customName || parent.name}" cannot have children.` }], isError: true };
      }
      if (parent.name === 'section' && template === 'section') {
        return { content: [{ type: 'text' as const, text: 'Error: Sections cannot contain other sections.' }], isError: true };
      }

      const newLayer = createLayerFromTemplate(template, { customName: custom_name, textContent: text_content });
      if (!newLayer) {
        return { content: [{ type: 'text' as const, text: `Error: Unknown template "${template}".` }], isError: true };
      }

      const updated = insertLayer(layers, parent_layer_id, newLayer, position);
      await savePageLayers(page_id, updated);

      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({
            message: `Added ${template} "${custom_name || newLayer.customName || template}" to page`,
            layer_id: newLayer.id,
            parent_layer_id,
          }, null, 2),
        }],
      };
    },
  );

  server.tool(
    'update_layer_design',
    `Update the visual design of a layer. Merges design properties into existing design
and regenerates Tailwind CSS classes.

IMPORTANT: Set isActive: true on any design category you want to apply.`,
    {
      page_id: z.string().describe('The page ID'),
      layer_id: z.string().describe('The layer ID to update'),
      breakpoint: z.enum(['desktop', 'tablet', 'mobile']).default('desktop')
        .describe('Responsive breakpoint. Desktop is default.'),
      design: designSchema,
    },
    async ({ page_id, layer_id, design }) => {
      const layers = await getPageLayers(page_id);

      const layer = findLayerById(layers, layer_id);
      if (!layer) {
        return { content: [{ type: 'text' as const, text: `Error: Layer "${layer_id}" not found.` }], isError: true };
      }

      const updated = updateLayerById(layers, layer_id, (l) =>
        applyDesignToLayer(l, design as Record<string, Record<string, unknown>>),
      );

      await savePageLayers(page_id, updated);

      const updatedLayer = findLayerById(updated, layer_id);
      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({
            message: `Updated design for "${updatedLayer?.customName || updatedLayer?.name}"`,
            layer_id,
            classes: updatedLayer?.classes,
            design: updatedLayer?.design,
          }, null, 2),
        }],
      };
    },
  );

  server.tool(
    'update_layer_text',
    'Update the text content of a text, heading, or button layer.',
    {
      page_id: z.string().describe('The page ID'),
      layer_id: z.string().describe('The layer ID to update'),
      text: z.string().describe('New text content'),
    },
    async ({ page_id, layer_id, text }) => {
      const layers = await getPageLayers(page_id);

      const layer = findLayerById(layers, layer_id);
      if (!layer) {
        return { content: [{ type: 'text' as const, text: `Error: Layer "${layer_id}" not found.` }], isError: true };
      }

      const updated = updateLayerById(layers, layer_id, (l) => ({
        ...l,
        variables: {
          ...l.variables,
          text: { type: 'dynamic_rich_text', data: { content: getTiptapTextContent(text) } },
        },
      }));

      await savePageLayers(page_id, updated);
      return { content: [{ type: 'text' as const, text: `Updated text for "${layer.customName || layer.name}" to "${text}"` }] };
    },
  );

  server.tool(
    'delete_layer',
    'Remove a layer and all its children from a page',
    {
      page_id: z.string().describe('The page ID'),
      layer_id: z.string().describe('The layer ID to delete'),
    },
    async ({ page_id, layer_id }) => {
      const layers = await getPageLayers(page_id);

      const layer = findLayerById(layers, layer_id);
      if (!layer) {
        return { content: [{ type: 'text' as const, text: `Error: Layer "${layer_id}" not found.` }], isError: true };
      }
      if (layer.restrictions?.delete === false) {
        return { content: [{ type: 'text' as const, text: `Error: Layer "${layer.customName || layer.name}" cannot be deleted.` }], isError: true };
      }

      const updated = removeLayer(layers, layer_id);
      await savePageLayers(page_id, updated);
      return { content: [{ type: 'text' as const, text: `Deleted layer "${layer.customName || layer.name}" (${layer_id})` }] };
    },
  );

  server.tool(
    'move_layer',
    'Move a layer to a different parent or position within the page tree',
    {
      page_id: z.string().describe('The page ID'),
      layer_id: z.string().describe('The layer ID to move'),
      new_parent_id: z.string().describe('The new parent layer ID'),
      position: z.number().optional().describe('Position within new parent. Omit to append at end.'),
    },
    async ({ page_id, layer_id, new_parent_id, position }) => {
      const layers = await getPageLayers(page_id);

      const layer = findLayerById(layers, layer_id);
      if (!layer) {
        return { content: [{ type: 'text' as const, text: `Error: Layer "${layer_id}" not found.` }], isError: true };
      }
      const newParent = findLayerById(layers, new_parent_id);
      if (!newParent) {
        return { content: [{ type: 'text' as const, text: `Error: New parent "${new_parent_id}" not found.` }], isError: true };
      }
      if (!canHaveChildren(newParent)) {
        return { content: [{ type: 'text' as const, text: `Error: "${newParent.customName || newParent.name}" cannot have children.` }], isError: true };
      }

      const updated = moveLayerInTree(layers, layer_id, new_parent_id, position);
      await savePageLayers(page_id, updated);
      return { content: [{ type: 'text' as const, text: `Moved "${layer.customName || layer.name}" into "${newParent.customName || newParent.name}"` }] };
    },
  );
}
