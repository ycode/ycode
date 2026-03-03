import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { DesignProperties, Layer } from '@/types';
import { getAllStyles, createStyle } from '@/lib/repositories/layerStyleRepository';
import { getDraftLayers, upsertDraftLayers } from '@/lib/repositories/pageLayersRepository';
import { findLayerById, updateLayerById, designToClassString } from '@/lib/mcp/utils';
import { designSchema } from './shared-schemas';

export function registerStyleTools(server: McpServer) {
  server.tool(
    'list_styles',
    'List all reusable layer styles. Styles define reusable design presets that can be applied to any layer.',
    {},
    async () => {
      const styles = await getAllStyles();
      return { content: [{ type: 'text' as const, text: JSON.stringify(styles, null, 2) }] };
    },
  );

  server.tool(
    'create_style',
    'Create a reusable layer style — like a CSS class. Define the design once, apply it to any number of layers.',
    {
      name: z.string().describe('Style name (e.g. "Card", "Button Primary")'),
      design: designSchema,
    },
    async ({ name, design }) => {
      const classes = designToClassString(design as DesignProperties);
      const style = await createStyle({ name, classes, design: design as DesignProperties });
      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({ message: `Created style "${name}"`, style_id: style.id, classes }, null, 2),
        }],
      };
    },
  );

  server.tool(
    'apply_style',
    'Apply a reusable layer style to a layer.',
    {
      page_id: z.string().describe('The page ID'),
      layer_id: z.string().describe('The layer ID to apply the style to'),
      style_id: z.string().describe('The style ID'),
    },
    async ({ page_id, layer_id, style_id }) => {
      const pageLayers = await getDraftLayers(page_id);
      if (!pageLayers) {
        return { content: [{ type: 'text' as const, text: `Error: Page "${page_id}" has no layers.` }], isError: true };
      }

      const layers = pageLayers.layers as Layer[];
      const layer = findLayerById(layers, layer_id);
      if (!layer) {
        return { content: [{ type: 'text' as const, text: `Error: Layer "${layer_id}" not found.` }], isError: true };
      }

      const updated = updateLayerById(layers, layer_id, (l) => ({ ...l, styleId: style_id }));
      await upsertDraftLayers(page_id, updated);

      return { content: [{ type: 'text' as const, text: `Applied style "${style_id}" to "${layer.customName || layer.name}"` }] };
    },
  );
}
