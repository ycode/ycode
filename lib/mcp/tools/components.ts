import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { Breakpoint, ComponentVariable, ComponentVariableValue, ComponentVariant, Layer, UIState } from '@/types';
import {
  getAllComponents,
  getComponentById,
  createComponent,
  updateComponent,
  softDeleteComponent,
} from '@/lib/repositories/componentRepository';
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
  applyLayerSettings,
  buildLinkSettings,
  defaultDynamicPageItem,
  describeLink,
  generateId,
} from '@/lib/mcp/utils';
import type { RichTextBlock } from '@/lib/mcp/utils';
import { buildComponentInstanceLayer, detachSpecificLayerFromComponent } from '@/lib/component-utils';
import {
  cleanLayersForComponentCreation,
  regenerateIdsWithInteractionRemapping,
  replaceLayerWithComponentInstance,
} from '@/lib/layer-utils';
import { sanitizeHtmlId } from '@/lib/html-utils';
import { EMPTY_OVERRIDES, createTextComponentVariableValue } from '@/lib/variable-utils';
import { stringToTiptapContent } from '@/lib/text-format-utils';
import { collectFontFamiliesFromDesign, ensureFontsInstalled, fontWarnings } from '@/lib/mcp/font-install';
import { getCachedLayers as getPageLayers, saveCachedLayers } from '@/lib/mcp/page-layers';
import { getAllPages, getPageById } from '@/lib/repositories/pageRepository';
import { getAllDraftLayers } from '@/lib/repositories/pageLayersRepository';
import { hasLayerQuery, queryLayers } from '@/lib/mcp/layer-query';
import {
  broadcastComponentCreated,
  broadcastComponentUpdated,
  broadcastComponentDeleted,
  broadcastComponentLayersUpdated,
} from '@/lib/mcp/broadcast';
import { buildOverrideValue, createOverrideContext } from '@/lib/mcp/instance-overrides';
import {
  bindingSourceEnum,
  designSchema,
  dynamicTextSegmentSchema,
  richTextBlockSchema,
  templateEnum,
  updateLinkOp,
  updateSettingsOp,
} from './shared-schemas';

const variableTypeEnum = z.enum(['text', 'rich_text', 'image', 'link', 'audio', 'video', 'icon', 'variant', 'visibility', 'id'])
  .describe('Variable type. "variant" lets instances pick which variant of a nested component is rendered. "visibility" is a boolean ({ visible: true|false }) that shows/hides the linked layer per instance. "id" is a string ({ id: "my-element" }) that sets the linked layer\'s HTML id attribute per instance (e.g. per-page tracking ids).');

const variableDefaultValueSchema = z.union([
  z.string(),
  z.number(),
  z.boolean(),
  z.record(z.string(), z.unknown()),
]);

const variableSchema = z.object({
  name: z.string().describe('Display name (e.g. "Button label", "Hero image")'),
  type: variableTypeEnum.default('text'),
  placeholder: z.string().optional()
    .describe('Placeholder text shown in the override input on each instance.'),
  default_value: variableDefaultValueSchema.optional()
    .describe('Default value applied when an instance does not override the variable. Shape matches the variable type (e.g. { type: "dynamic_text", data: { content: "Click me" } } for text).'),
});

const variableUpdateSchema = z.object({
  id: z.string().optional().describe('Existing variable ID to update, or omit to create new'),
  name: z.string().describe('Variable display name'),
  type: variableTypeEnum.default('text'),
  placeholder: z.string().optional(),
  default_value: variableDefaultValueSchema.optional(),
});

/**
 * Coerce a `default_value` into the object shape the renderer expects.
 *
 * `default_value` is intentionally untyped in the tool schema (its shape
 * depends on the variable type), so callers routinely pass a bare string for
 * text variables. Storing that verbatim breaks rendering for every page using
 * the component, so wrap it in the matching variable value here.
 */
function normalizeDefaultValue(value: unknown, type: z.infer<typeof variableTypeEnum>): ComponentVariableValue {
  if (type === 'visibility' && typeof value === 'boolean') {
    return { visible: value };
  }
  if (type === 'id' && typeof value === 'string') {
    return { id: sanitizeHtmlId(value) };
  }
  if (typeof value === 'string') {
    return type === 'rich_text'
      ? createTextComponentVariableValue(stringToTiptapContent(value))
      : { type: 'dynamic_text', data: { content: value } };
  }
  return value as ComponentVariableValue;
}

function normalizeVariables(input: Array<z.infer<typeof variableUpdateSchema>>): ComponentVariable[] {
  return input.map((v) => ({
    id: v.id || generateId(),
    name: v.name,
    type: v.type,
    ...(v.placeholder !== undefined && { placeholder: v.placeholder }),
    ...(v.default_value !== undefined && { default_value: normalizeDefaultValue(v.default_value, v.type) }),
  }));
}

interface InstanceRef {
  page_id: string;
  layer_id: string;
}

/** Every component instance on every draft page, keyed by component id. */
function collectInstancesByComponent(pages: Array<{ page_id: string; layers: Layer[] }>): Map<string, InstanceRef[]> {
  const byComponent = new Map<string, InstanceRef[]>();
  const walk = (layer: Layer, pageId: string) => {
    if (layer.componentId) {
      const list = byComponent.get(layer.componentId) ?? [];
      list.push({ page_id: pageId, layer_id: layer.id });
      byComponent.set(layer.componentId, list);
    }
    for (const child of layer.children ?? []) walk(child, pageId);
  };
  for (const page of pages) {
    for (const layer of page.layers) walk(layer, page.page_id);
  }
  return byComponent;
}

/** Swaps every instance of `fromId` in a tree for `toId`, clearing variant/override state that belongs to the old component. */
function swapComponentInstances(layers: Layer[], fromId: string, toId: string, toName: string): { layers: Layer[]; swapped: string[] } {
  const swapped: string[] = [];
  const walk = (layer: Layer): Layer => {
    const children = layer.children ? layer.children.map(walk) : layer.children;
    if (layer.componentId !== fromId) {
      return children === layer.children ? layer : { ...layer, children };
    }
    swapped.push(layer.id);
    const { componentVariantId: _variant, componentVariantVariableId: _variantVar, componentOverrides: _overrides, ...rest } = layer;
    void _variant; void _variantVar; void _overrides;
    return { ...rest, componentId: toId, customName: toName, children };
  };
  return { layers: layers.map(walk), swapped };
}

export function registerComponentTools(server: McpServer) {
  server.tool(
    'list_components',
    `List all reusable components with their variables and where they are used.
has_published_version tells whether the component is live; has_unpublished_changes tells whether
publishing would change it (same check as get_unpublished_changes). usage lists the draft pages
(page_id + instance layer_ids) that render the component — use it to find every instance
before editing or swapping a component (see replace_component_instances).`,
    {
      include_usage: z.boolean().optional().default(true)
        .describe('Include per-component usage (pages and instance layer ids). Pass false for a lighter listing.'),
    },
    async ({ include_usage }) => {
      const [components, published, draftPages] = await Promise.all([
        getAllComponents(false),
        getAllComponents(true),
        include_usage ? getAllDraftLayers() : Promise.resolve([]),
      ]);
      const publishedHashById = new Map(published.map((c) => [c.id, c.content_hash]));
      const instances = collectInstancesByComponent(
        draftPages.map((p) => ({ page_id: p.page_id, layers: (p.layers as Layer[]) || [] })),
      );
      const summary = components.map((c) => {
        const refs = instances.get(c.id) ?? [];
        const byPage = new Map<string, string[]>();
        for (const ref of refs) byPage.set(ref.page_id, [...(byPage.get(ref.page_id) ?? []), ref.layer_id]);
        return {
          id: c.id,
          name: c.name,
          variables: c.variables || [],
          layer_count: countLayers(c.layers),
          has_published_version: publishedHashById.has(c.id),
          has_unpublished_changes: !publishedHashById.has(c.id) || publishedHashById.get(c.id) !== c.content_hash,
          ...(include_usage ? {
            instance_count: refs.length,
            usage: [...byPage.entries()].map(([page_id, layer_ids]) => ({ page_id, layer_ids })),
          } : {}),
        };
      });
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(summary) }],
      };
    },
  );

  server.tool(
    'replace_component_instances',
    `Swap EVERY instance of one component for another across all draft pages in one call (e.g.
after rebuilding "Navigation" as "Navigation v2"). Each instance keeps its position; variant
selection and per-instance overrides are reset because they belong to the old component.
Optionally deletes the old component afterwards. Only page instances are swapped — instances
nested inside another component's master must be updated with update_component_layers.
Prefer this over get_layers + replace_layer_with_component page by page.`,
    {
      from_component_id: z.string().describe('Component whose instances should be replaced'),
      to_component_id: z.string().describe('Component to render instead'),
      delete_old: z.boolean().optional().default(false).describe('Delete from_component_id once no page uses it anymore'),
    },
    async ({ from_component_id, to_component_id, delete_old }) => {
      if (from_component_id === to_component_id) {
        return { content: [{ type: 'text' as const, text: 'Error: from_component_id and to_component_id are the same component.' }], isError: true };
      }
      const [from, to] = await Promise.all([getComponentById(from_component_id), getComponentById(to_component_id)]);
      if (!from) return { content: [{ type: 'text' as const, text: `Error: Component "${from_component_id}" not found.` }], isError: true };
      if (!to) return { content: [{ type: 'text' as const, text: `Error: Component "${to_component_id}" not found.` }], isError: true };

      const draftPages = await getAllDraftLayers();
      const updatedPages: Array<{ page_id: string; layer_ids: string[] }> = [];
      for (const page of draftPages) {
        const { layers, swapped } = swapComponentInstances((page.layers as Layer[]) || [], from_component_id, to_component_id, to.name);
        if (swapped.length === 0) continue;
        await saveCachedLayers(page.page_id, layers);
        updatedPages.push({ page_id: page.page_id, layer_ids: swapped });
      }

      let deleted = false;
      if (delete_old) {
        await softDeleteComponent(from_component_id);
        broadcastComponentDeleted(from_component_id).catch(() => {});
        deleted = true;
      }

      const total = updatedPages.reduce((n, p) => n + p.layer_ids.length, 0);
      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({
            message: `Replaced ${total} instance(s) of "${from.name}" with "${to.name}" on ${updatedPages.length} page(s)${deleted ? `; deleted "${from.name}"` : ''}`,
            pages: updatedPages,
            old_component_deleted: deleted,
          }),
        }],
      };
    },
  );

  server.tool(
    'get_component',
    `Get a component by ID: its variables and the layer tree of each variant (variants[0] is the
primary variant; the first variant's tree is what instances render by default).

On large components, read in pieces like get_layers: fields "summary" returns only id, name,
customName, tag, text, link, classes and componentId per layer; depth limits how many levels of
children are included (deeper levels become children_count); variant_id returns one variant.`,
    {
      component_id: z.string().describe('The component ID'),
      variant_id: z.string().optional().describe('Return only this variant\'s layers'),
      depth: z.number().int().min(0).optional().describe('Levels of children to include below each root layer'),
      fields: z.enum(['full', 'summary']).optional().describe('"summary" for a compact view; default "full"'),
    },
    async ({ component_id, variant_id, depth, fields }) => {
      const component = await getComponentById(component_id);
      if (!component) {
        return {
          content: [{ type: 'text' as const, text: `Error: Component "${component_id}" not found.` }],
          isError: true,
        };
      }

      const variants: ComponentVariant[] = (component.variants && component.variants.length > 0)
        ? component.variants
        : [{ id: 'default', name: 'Default', layers: component.layers || [] }];
      const selected = variant_id ? variants.filter((v) => v.id === variant_id) : variants;
      if (selected.length === 0) {
        return { content: [{ type: 'text' as const, text: `Error: Variant "${variant_id}" not found.` }], isError: true };
      }

      const shape = (layers: Layer[]) => {
        const query = { depth, fields };
        if (!hasLayerQuery(query)) return layers;
        const result = queryLayers(layers, query);
        return 'layers' in result ? result.layers : layers;
      };

      // `layers` mirrors variants[0].layers in storage; return the tree once per variant.
      const { layers: _legacyLayers, ...rest } = component;
      void _legacyLayers;
      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({
            ...rest,
            variants: selected.map((v) => ({ ...v, layers: shape(v.layers || []) })),
          }),
        }],
      };
    },
  );

  server.tool(
    'add_component_instance',
    `Reuse a component on a PAGE by inserting a real component instance (a layer that
references the component and shares its structure). Prefer this over rebuilding a
component's markup by hand.

The instance renders the master component's layer tree; its children are read-only
(edit the master component to change the structure). A fresh instance shows the
component's default content — use set_component_instance afterwards to override its
variables (text, image, link, …) or switch its variant.

Use replace_layer_with_component instead when swapping an existing layer for a component.`,
    {
      page_id: z.string().describe('The page ID'),
      parent_layer_id: z.string().describe('ID of the parent layer to insert the instance into'),
      position: z.number().optional().describe('Index within parent children. Omit to append at end.'),
      component_id: z.string().describe('ID of the component to instantiate'),
      variant_id: z.string().optional().describe('Optional variant ID. Omit to use the primary ("Default") variant.'),
      custom_name: z.string().optional().describe('Custom display name for the instance layer. Defaults to the component name.'),
    },
    async ({ page_id, parent_layer_id, position, component_id, variant_id, custom_name }) => {
      const component = await getComponentById(component_id);
      if (!component) {
        return { content: [{ type: 'text' as const, text: `Error: Component "${component_id}" not found.` }], isError: true };
      }

      const layers = await getPageLayers(page_id);
      const parent = findLayerById(layers, parent_layer_id);
      if (!parent) {
        return { content: [{ type: 'text' as const, text: `Error: Parent layer "${parent_layer_id}" not found.` }], isError: true };
      }
      if (!canHaveChildren(parent)) {
        return { content: [{ type: 'text' as const, text: `Error: "${parent.customName || parent.name}" cannot have children.` }], isError: true };
      }

      const instance = buildComponentInstanceLayer(component, { variantId: variant_id, customName: custom_name });
      const updated = insertLayer(layers, parent_layer_id, instance, position);
      await saveCachedLayers(page_id, updated);

      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({
            message: `Added "${component.name}" component instance to page`,
            layer_id: instance.id,
            parent_layer_id,
          }),
        }],
      };
    },
  );

  server.tool(
    'replace_layer_with_component',
    `Swap an existing PAGE layer for a component instance in place (keeps its position).
Use this when the user wants to reuse a component "instead of" an existing layer.

The replaced layer becomes a real component instance rendering the master's layer tree;
its children are read-only (edit the master component to change the structure). It shows the
component's default content — use set_component_instance to override its variables or variant.`,
    {
      page_id: z.string().describe('The page ID'),
      layer_id: z.string().describe('ID of the layer to replace with a component instance'),
      component_id: z.string().describe('ID of the component to instantiate'),
      variant_id: z.string().optional().describe('Optional variant ID. Omit to use the primary ("Default") variant.'),
    },
    async ({ page_id, layer_id, component_id, variant_id }) => {
      const component = await getComponentById(component_id);
      if (!component) {
        return { content: [{ type: 'text' as const, text: `Error: Component "${component_id}" not found.` }], isError: true };
      }

      const layers = await getPageLayers(page_id);
      const target = findLayerById(layers, layer_id);
      if (!target) {
        return { content: [{ type: 'text' as const, text: `Error: Layer "${layer_id}" not found.` }], isError: true };
      }

      const updated = updateLayerById(layers, layer_id, () =>
        buildComponentInstanceLayer(component, { variantId: variant_id, id: layer_id }),
      );
      await saveCachedLayers(page_id, updated);

      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({
            message: `Replaced layer with "${component.name}" component instance`,
            layer_id,
          }),
        }],
      };
    },
  );

  server.tool(
    'set_component_instance',
    `Customize a component INSTANCE on a page: override per-instance content (text, image,
link, icon, media, nested variant) and/or switch which variant the instance renders.

This is how you make several instances of the same component show DIFFERENT content
(e.g. a grid of Feature Cards each with its own title/image). It does NOT edit the master
component — structure stays shared and read-only. Only variables defined on the component
can be overridden; call get_component on the instance's componentId to see the variable ids
and their types. Each override targets one variable by id; the value shape is chosen from the
variable's declared type, so you only pass the relevant field.

CMS BINDINGS (instance inside a Collection List, or on a dynamic CMS page) — bind per instance
instead of in the component defaults, so one component works for any collection:
- text / rich_text: segments interleaving literal text and { type: "field", field_id }.
- image / video / audio / link: field_id binds the variable to a field of that type (link: a
  link, email or phone field).
- link to the item's dynamic page: link_page_id = the dynamic page, collection_item_id
  "current-collection" (default inside a list of that collection), "current-page" (default on
  that dynamic page), "next-item", "previous-item" or an item id.
Fields resolve from source: "collection" (nearest ancestor Collection List, the default when
there is one) or "page" (the dynamic page's item).`,
    {
      page_id: z.string().describe('The page ID the instance lives on'),
      layer_id: z.string().describe('The component-instance layer ID (has componentInstance: true in get_layers)'),
      variant_id: z.string().optional()
        .describe('Switch the instance to this variant of the component. Omit to leave the variant unchanged.'),
      reset_overrides: z.boolean().optional()
        .describe('Clear ALL existing per-instance overrides before applying any new ones (revert to component defaults).'),
      overrides: z.array(z.object({
        variable_id: z.string().describe('Component variable ID to override (from get_component)'),
        clear: z.boolean().optional().describe('Remove this variable\'s override, reverting to the component default'),
        text: z.string().optional().describe('For text/rich_text variables: plain text content'),
        rich_content: z.array(richTextBlockSchema).optional()
          .describe('For text/rich_text variables: structured content blocks (overrides `text`)'),
        segments: z.array(dynamicTextSegmentSchema).optional()
          .describe('For text/rich_text variables: literal text interleaved with CMS field references (overrides `text` and `rich_content`)'),
        field_id: z.string().optional()
          .describe('For image/video/audio/link variables: bind to this CMS field (overrides asset_id / url / link_page_id)'),
        source: bindingSourceEnum.optional()
          .describe('Where segments / field_id resolve from: "collection" (nearest ancestor Collection List), "page" (dynamic page item) or "global" (site-wide global variable, field_id = global ID). Defaults to "collection" inside a Collection List, else "page".'),
        asset_id: z.string().optional().describe('For image/icon/audio/video variables: asset ID to display'),
        alt: z.string().optional().describe('For image variables: alt text'),
        url: z.string().optional().describe('For link variables: external URL'),
        link_page_id: z.string().optional().describe('For link variables: link to this page by ID (alternative to url)'),
        collection_item_id: z.string().optional()
          .describe('For link variables with a dynamic link_page_id: "current-collection", "current-page", "next-item", "previous-item", or an item id. Defaults to "current-collection" inside a list of that collection and "current-page" on its dynamic page.'),
        anchor_layer_id: z.string().optional()
          .describe('For link variables: section to scroll to (layer ID or HTML id). Without url / link_page_id it links within this page.'),
        target: z.enum(['_blank', '_self', '_parent', '_top']).optional().describe('For link variables: link target'),
        variant_id: z.string().optional().describe('For variant variables: the nested component variant ID to render'),
        visible: z.boolean().optional().describe('For visibility variables: whether the linked layer is shown on this instance'),
        element_id: z.string().optional().describe('For id variables: the HTML id attribute the linked layer gets on this instance'),
      })).optional().describe('Per-variable content overrides for this instance'),
    },
    async ({ page_id, layer_id, variant_id, reset_overrides, overrides }) => {
      const layers = await getPageLayers(page_id);
      const target = findLayerById(layers, layer_id);
      if (!target) {
        return { content: [{ type: 'text' as const, text: `Error: Layer "${layer_id}" not found.` }], isError: true };
      }
      if (!target.componentId) {
        return { content: [{ type: 'text' as const, text: `Error: Layer "${layer_id}" is not a component instance.` }], isError: true };
      }

      const component = await getComponentById(target.componentId);
      if (!component) {
        return { content: [{ type: 'text' as const, text: `Error: Component "${target.componentId}" not found.` }], isError: true };
      }

      if (variant_id && !(component.variants ?? []).some((v) => v.id === variant_id)) {
        return { content: [{ type: 'text' as const, text: `Error: Variant "${variant_id}" does not exist on component "${component.name}".` }], isError: true };
      }

      const variablesById = new Map<string, ComponentVariable>(
        (component.variables ?? []).map((v) => [v.id, v]),
      );

      // Start from a canonical, fully-populated overrides object so every bucket
      // exists, then layer existing overrides (unless resetting) on top.
      const base = reset_overrides ? EMPTY_OVERRIDES : (target.componentOverrides ?? EMPTY_OVERRIDES);
      const merged: NonNullable<Layer['componentOverrides']> = {
        text: { ...(base.text ?? {}) },
        rich_text: { ...(base.rich_text ?? {}) },
        image: { ...(base.image ?? {}) },
        link: { ...(base.link ?? {}) },
        audio: { ...(base.audio ?? {}) },
        video: { ...(base.video ?? {}) },
        icon: { ...(base.icon ?? {}) },
        variant: { ...(base.variant ?? {}) },
        visibility: { ...(base.visibility ?? {}) },
        id: { ...(base.id ?? {}) },
        variableLinks: { ...(base.variableLinks ?? {}) },
      };

      const results: Array<{ status: string; detail: string }> = [];
      const overrideContext = createOverrideContext(layers, page_id, layer_id);

      for (const entry of overrides ?? []) {
        const variable = variablesById.get(entry.variable_id);
        if (!variable) {
          results.push({ status: 'error', detail: `Variable "${entry.variable_id}" not found on component "${component.name}"` });
          continue;
        }
        const category = variable.type ?? 'text';
        const bucket = merged[category] as Record<string, ComponentVariableValue> | undefined;
        if (!bucket) {
          results.push({ status: 'error', detail: `Unsupported variable type "${category}" for "${variable.name}"` });
          continue;
        }

        if (entry.clear) {
          delete bucket[entry.variable_id];
          results.push({ status: 'ok', detail: `Cleared override for "${variable.name}"` });
          continue;
        }

        const built = await buildOverrideValue(category, entry, overrideContext);
        if ('error' in built) {
          results.push({ status: 'error', detail: `"${variable.name}": ${built.error}` });
          continue;
        }
        bucket[entry.variable_id] = built.value;
        results.push({ status: 'ok', detail: `Overrode "${variable.name}" (${category})` });
      }

      const errors = results.filter((r) => r.status === 'error');
      if (overrides && overrides.length > 0 && errors.length === overrides.length && variant_id === undefined && !reset_overrides) {
        return {
          content: [{ type: 'text' as const, text: JSON.stringify({ message: 'All overrides failed', results }) }],
          isError: true,
        };
      }

      const updated = updateLayerById(layers, layer_id, (l) => ({
        ...l,
        ...(variant_id !== undefined ? { componentVariantId: variant_id } : {}),
        componentOverrides: merged,
      }));
      await saveCachedLayers(page_id, updated);

      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({
            message: `Updated "${component.name}" instance`,
            layer_id,
            ...(variant_id !== undefined ? { variant_id } : {}),
            ...(reset_overrides ? { reset: true } : {}),
            results,
          }),
        }],
      };
    },
  );

  server.tool(
    'detach_component_instance',
    `Detach a component instance on a PAGE, converting it back into plain, editable layers
(a copy of the component's current structure with fresh IDs). Use when the user wants to
break the link to the master so the layers can be edited freely on this page only.`,
    {
      page_id: z.string().describe('The page ID'),
      layer_id: z.string().describe('The component-instance layer ID to detach'),
    },
    async ({ page_id, layer_id }) => {
      const layers = await getPageLayers(page_id);
      const target = findLayerById(layers, layer_id);
      if (!target) {
        return { content: [{ type: 'text' as const, text: `Error: Layer "${layer_id}" not found.` }], isError: true };
      }
      if (!target.componentId) {
        return { content: [{ type: 'text' as const, text: `Error: Layer "${layer_id}" is not a component instance.` }], isError: true };
      }

      const component = await getComponentById(target.componentId);
      const updated = detachSpecificLayerFromComponent(layers, layer_id, component ?? undefined);
      await saveCachedLayers(page_id, updated);

      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({
            message: `Detached instance of "${component?.name ?? 'component'}" into plain layers`,
            page_id,
          }),
        }],
      };
    },
  );

  server.tool(
    'reorder_component_variants',
    `Reorder a component's variants. The FIRST id in the list becomes the primary ("Default")
variant used by instances that don't pin a specific variant. Every existing variant id must
be included exactly once.`,
    {
      component_id: z.string().describe('The component ID'),
      variant_ids: z.array(z.string()).min(1)
        .describe('All variant IDs in the desired order (index 0 = primary)'),
    },
    async ({ component_id, variant_ids }) => {
      const component = await getComponentById(component_id);
      if (!component) {
        return { content: [{ type: 'text' as const, text: `Error: Component "${component_id}" not found.` }], isError: true };
      }
      const variants = component.variants ?? [];
      if (variants.length === 0) {
        return { content: [{ type: 'text' as const, text: 'Error: Component has no named variants to reorder.' }], isError: true };
      }

      const currentIds = new Set(variants.map((v) => v.id));
      const requestedIds = new Set(variant_ids);
      if (variant_ids.length !== variants.length
        || variant_ids.length !== requestedIds.size
        || ![...currentIds].every((id) => requestedIds.has(id))) {
        return {
          content: [{ type: 'text' as const, text: `Error: variant_ids must list every existing variant exactly once. Current: [${[...currentIds].join(', ')}].` }],
          isError: true,
        };
      }

      const byId = new Map(variants.map((v) => [v.id, v]));
      const reordered = variant_ids.map((id) => byId.get(id)!) as ComponentVariant[];

      await updateComponent(component_id, { variants: reordered });
      broadcastComponentUpdated(component_id, { variants: reordered }).catch(() => {});

      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({
            message: `Reordered variants; primary is now "${reordered[0].name}"`,
            order: reordered.map((v) => ({ id: v.id, name: v.name })),
          }),
        }],
      };
    },
  );

  server.tool(
    'create_component_from_layer',
    `Turn an existing PAGE layer (and its subtree) into a new reusable component, then replace
it in place with an instance of that component. Use when the user wants to "make this a
component" / "componentize this section" so it can be reused elsewhere.

The extracted structure becomes the master component; the original layer becomes an instance
of it (its children become read-only). CMS/page bindings that only make sense in the original
context are stripped. This v1 does not auto-create variables — add them afterwards with
update_component + update_component_layers if the user wants per-instance overrides.`,
    {
      page_id: z.string().describe('The page ID'),
      layer_id: z.string().describe('The layer to convert into a component (its subtree is copied)'),
      name: z.string().describe('Name for the new component'),
    },
    async ({ page_id, layer_id, name }) => {
      if (layer_id === 'body') {
        return { content: [{ type: 'text' as const, text: 'Error: The page body cannot be turned into a component.' }], isError: true };
      }

      const layers = await getPageLayers(page_id);
      const target = findLayerById(layers, layer_id);
      if (!target) {
        return { content: [{ type: 'text' as const, text: `Error: Layer "${layer_id}" not found.` }], isError: true };
      }
      if (target.componentId) {
        return { content: [{ type: 'text' as const, text: `Error: Layer "${layer_id}" is already a component instance.` }], isError: true };
      }

      // Deep-clone the subtree with fresh IDs (remapping interaction references),
      // then strip bindings that don't make sense inside a standalone component.
      const cloned = regenerateIdsWithInteractionRemapping(
        JSON.parse(JSON.stringify(target)) as Layer,
      );
      const cleaned = cleanLayersForComponentCreation([cloned]);

      const component = await createComponent({ name, layers: cleaned });
      broadcastComponentCreated(component).catch(() => {});

      const updated = replaceLayerWithComponentInstance(layers, layer_id, component.id);
      await saveCachedLayers(page_id, updated);

      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({
            message: `Created component "${name}" from layer and replaced it with an instance`,
            component_id: component.id,
            layer_id,
          }),
        }],
      };
    },
  );

  server.tool(
    'create_component',
    `Create a new reusable component. A component is a layer tree with optional variables.

Variables let each instance override specific content (text, images, links). Defining a
variable is only half the job: a variable does NOTHING until it is linked to a layer.
The response returns the variable IDs — then use update_component_layers to build the tree
AND link each variable (pass variable_id on add_layer, or use the link_variable operation).

EXAMPLE: A "Card" component with a title variable:
1. create_component with variables: [{ name: "Card title", type: "text" }]
2. The response includes the variable IDs
3. update_component_layers: add a heading with variable_id set to the title variable's ID
   (or add the heading, then link_variable). Instances can now override the title.`,
    {
      name: z.string().describe('Component name (e.g. "Hero Section", "Feature Card")'),
      variables: z.array(variableSchema).optional()
        .describe('Component variables for content overrides per instance'),
    },
    async ({ name, variables }) => {
      const rootLayer: Layer = {
        id: generateId(),
        name: 'div',
        customName: name,
        classes: '',
        children: [],
      };

      const componentVariables = variables ? normalizeVariables(variables) : undefined;

      const component = await createComponent({
        name,
        layers: [rootLayer],
        variables: componentVariables,
      });

      broadcastComponentCreated(component).catch(() => {});

      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({
            message: `Component "${name}" created`,
            id: component.id,
            root_layer_id: rootLayer.id,
            variables: component.variables || [],
          }),
        }],
      };
    },
  );

  server.tool(
    'update_component',
    'Update a component\'s name and/or variables. Use update_component_layers to modify the layer tree, or the variant tools for variant management.',
    {
      component_id: z.string().describe('The component ID'),
      name: z.string().optional().describe('New component name'),
      variables: z.array(variableUpdateSchema).optional()
        .describe('Full list of variables (replaces existing). Include existing IDs to preserve them; new entries get fresh IDs.'),
    },
    async ({ component_id, name, variables }) => {
      const updates: { name?: string; variables?: ComponentVariable[] } = {};
      if (name !== undefined) updates.name = name;
      if (variables !== undefined) updates.variables = normalizeVariables(variables);

      const component = await updateComponent(component_id, updates);
      broadcastComponentUpdated(component_id, updates).catch(() => {});

      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({
            message: `Component "${component.name}" updated`,
            variables: component.variables || [],
          }),
        }],
      };
    },
  );

  server.tool(
    'list_component_variants',
    'List the named variants of a component. Every component has at least one ("Default"). Variants share the component\'s variables.',
    {
      component_id: z.string().describe('The component ID'),
    },
    async ({ component_id }) => {
      const component = await getComponentById(component_id);
      if (!component) {
        return {
          content: [{ type: 'text' as const, text: `Error: Component "${component_id}" not found.` }],
          isError: true,
        };
      }
      const variants = (component.variants && component.variants.length > 0)
        ? component.variants
        : [{ id: generateId(), name: 'Default', layers: component.layers || [] }];
      const summary = variants.map((v) => ({
        id: v.id,
        name: v.name,
        layer_count: countLayers(v.layers),
        is_primary: v === variants[0],
      }));
      return { content: [{ type: 'text' as const, text: JSON.stringify(summary) }] };
    },
  );

  server.tool(
    'create_component_variant',
    `Add a new named variant to a component. Pass source_variant_id to clone an existing variant
(new layer IDs are generated). Omit it to start from an empty root div.`,
    {
      component_id: z.string().describe('The component ID'),
      name: z.string().describe('Variant name (e.g. "Small", "Dark", "Compact")'),
      source_variant_id: z.string().optional()
        .describe('Variant to clone. Omit for an empty starting tree.'),
    },
    async ({ component_id, name, source_variant_id }) => {
      const component = await getComponentById(component_id);
      if (!component) {
        return {
          content: [{ type: 'text' as const, text: `Error: Component "${component_id}" not found.` }],
          isError: true,
        };
      }
      const existing: ComponentVariant[] = (component.variants && component.variants.length > 0)
        ? component.variants
        : [{ id: generateId(), name: 'Default', layers: component.layers || [] }];

      let layers: Layer[];
      if (source_variant_id) {
        const source = existing.find((v) => v.id === source_variant_id);
        if (!source) {
          return {
            content: [{ type: 'text' as const, text: `Error: Source variant "${source_variant_id}" not found.` }],
            isError: true,
          };
        }
        layers = source.layers.map(cloneLayerWithNewIds);
      } else {
        layers = [{
          id: generateId(),
          name: 'div',
          customName: name,
          classes: '',
          children: [],
        }];
      }

      const newVariant: ComponentVariant = { id: generateId(), name, layers };
      const updatedVariants = [...existing, newVariant];

      await updateComponent(component_id, { variants: updatedVariants });
      broadcastComponentUpdated(component_id, { variants: updatedVariants }).catch(() => {});

      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({
            message: `Variant "${name}" created`,
            id: newVariant.id,
            root_layer_id: layers[0]?.id,
          }),
        }],
      };
    },
  );

  server.tool(
    'update_component_variant',
    'Rename a component variant. Use update_component_layers with variant_id to modify its tree.',
    {
      component_id: z.string().describe('The component ID'),
      variant_id: z.string().describe('The variant ID'),
      name: z.string().describe('New variant name'),
    },
    async ({ component_id, variant_id, name }) => {
      const component = await getComponentById(component_id);
      if (!component) {
        return {
          content: [{ type: 'text' as const, text: `Error: Component "${component_id}" not found.` }],
          isError: true,
        };
      }
      const variants = component.variants || [];
      const idx = variants.findIndex((v) => v.id === variant_id);
      if (idx === -1) {
        return {
          content: [{ type: 'text' as const, text: `Error: Variant "${variant_id}" not found.` }],
          isError: true,
        };
      }
      const updatedVariants = [...variants];
      updatedVariants[idx] = { ...updatedVariants[idx], name };

      await updateComponent(component_id, { variants: updatedVariants });
      broadcastComponentUpdated(component_id, { variants: updatedVariants }).catch(() => {});

      return { content: [{ type: 'text' as const, text: `Variant "${variant_id}" renamed to "${name}"` }] };
    },
  );

  server.tool(
    'delete_component_variant',
    'Delete a named variant. The component must keep at least one variant — the primary cannot be deleted.',
    {
      component_id: z.string().describe('The component ID'),
      variant_id: z.string().describe('The variant ID to delete'),
    },
    async ({ component_id, variant_id }) => {
      const component = await getComponentById(component_id);
      if (!component) {
        return {
          content: [{ type: 'text' as const, text: `Error: Component "${component_id}" not found.` }],
          isError: true,
        };
      }
      const variants = component.variants || [];
      if (variants.length <= 1) {
        return {
          content: [{ type: 'text' as const, text: 'Error: A component must keep at least one variant.' }],
          isError: true,
        };
      }
      if (variants[0]?.id === variant_id) {
        return {
          content: [{ type: 'text' as const, text: 'Error: The primary variant cannot be deleted. Reorder variants or delete a non-primary one.' }],
          isError: true,
        };
      }
      const updatedVariants = variants.filter((v) => v.id !== variant_id);
      if (updatedVariants.length === variants.length) {
        return {
          content: [{ type: 'text' as const, text: `Error: Variant "${variant_id}" not found.` }],
          isError: true,
        };
      }

      await updateComponent(component_id, { variants: updatedVariants });
      broadcastComponentUpdated(component_id, { variants: updatedVariants }).catch(() => {});

      return { content: [{ type: 'text' as const, text: `Variant "${variant_id}" deleted` }] };
    },
  );

  server.tool(
    'update_component_layers',
    `Edit the inside of a component: add, remove, move, restyle, or set content on the
layers within a component's tree (the master definition, not a page instance). This is
the batch_operations equivalent for components — use it to build or change a component's
internal structure. Use ref_id in add_layer to name layers, then reference them in
later operations (e.g. a follow-up update_design op to style a just-added layer).

OPERATIONS: add_layer, update_design, update_text, set_rich_text, update_image (asset and/or
alt), update_link, update_settings (tag, id, name, hidden, attributes, embed code), apply_style,
move_layer, delete_layer, link_variable. Put every change to one component in a single call.

LINKING VARIABLES: A component variable does nothing until it is linked to a layer. Link it
by passing variable_id on the add_layer operation, or with a separate link_variable operation.
The link target and shape are derived automatically from the variable's declared type (you do
NOT need to pass a type, and the layer's slot is created if missing): text/rich_text bind the
text layer, image/icon/video/audio bind that media layer's source, link binds the layer's link,
variant binds a nested component instance's variant. Passing a variable_id that doesn't exist on
the component is an error.

Pass variant_id to target a specific named variant; omit it to update the primary variant
(variants[0]), which is what most components have.`,
    {
      component_id: z.string().describe('The component ID'),
      variant_id: z.string().optional()
        .describe('Variant to modify. Omit to target the primary variant.'),
      operations: z.array(z.discriminatedUnion('type', [
        z.object({
          type: z.literal('add_layer'),
          parent_layer_id: z.string().describe('Parent layer ID or ref_id'),
          position: z.number().optional(),
          template: templateEnum,
          text_content: z.string().optional(),
          rich_content: z.array(richTextBlockSchema).optional()
            .describe('For richText: structured content blocks. Overrides text_content.'),
          custom_name: z.string().optional(),
          ref_id: z.string().optional().describe('Reference ID for later operations. Style it with a follow-up update_design op referencing this ref_id.'),
          image_asset_id: z.string().optional().describe('For image layers: asset ID to display'),
          image_alt: z.string().optional().describe('For image layers: alt text for accessibility'),
          design: designSchema.optional().describe('Optional design to apply inline when creating the layer, instead of a follow-up update_design op.'),
          variable_id: z.string().optional()
            .describe('Component variable ID to link to this layer. The bind target is derived from the variable\'s type (text/rich_text/image/link/icon/audio/video/variant) — do not pass a type. Must be an existing variable on the component.'),
        }),
        z.object({
          type: z.literal('update_design'),
          layer_id: z.string().describe('Layer ID or ref_id'),
          design: designSchema,
          breakpoint: z.enum(['desktop', 'tablet', 'mobile']).default('desktop').optional(),
          ui_state: z.enum(['neutral', 'hover', 'focus', 'active', 'disabled', 'current']).default('neutral').optional()
            .describe('UI state: "hover" for hover styles, "focus" for focus, "current" for the active/current navigation link, etc.'),
        }),
        z.object({
          type: z.literal('update_text'),
          layer_id: z.string().describe('Layer ID or ref_id'),
          text: z.string(),
        }),
        z.object({
          type: z.literal('update_image'),
          layer_id: z.string().describe('Layer ID or ref_id'),
          asset_id: z.string().optional().describe('Asset ID from upload_asset. Omit to keep the current image and only change alt.'),
          alt: z.string().optional().describe('Image alt text for accessibility. Omit to keep the current alt.'),
        }),
        z.object({
          type: z.literal('set_rich_text'),
          layer_id: z.string().describe('RichText layer ID or ref_id'),
          blocks: z.array(richTextBlockSchema).min(1)
            .describe('Content blocks (paragraph, heading, list, etc.)'),
        }),
        z.object({
          type: z.literal('apply_style'),
          layer_id: z.string(),
          style_id: z.string().describe('Layer style ID to apply'),
        }),
        z.object({
          type: z.literal('delete_layer'),
          layer_id: z.string(),
        }),
        z.object({
          type: z.literal('move_layer'),
          layer_id: z.string(),
          new_parent_id: z.string(),
          position: z.number().optional(),
        }),
        z.object({
          type: z.literal('link_variable'),
          layer_id: z.string().describe('Layer ID or ref_id'),
          variable_id: z.string().describe('Component variable ID to link. Must exist on the component.'),
          variable_type: variableTypeEnum.default('text')
            .describe('Optional/legacy — the type is auto-detected from the variable definition. Ignored when the variable exists.'),
        }),
        updateLinkOp,
        updateSettingsOp,
      ])).min(1).max(50),
    },
    async ({ component_id, variant_id, operations }) => {
      const component = await getComponentById(component_id);
      if (!component) {
        return {
          content: [{ type: 'text' as const, text: `Error: Component "${component_id}" not found.` }],
          isError: true,
        };
      }

      const variants: ComponentVariant[] = (component.variants && component.variants.length > 0)
        ? component.variants
        : [{ id: generateId(), name: 'Default', layers: component.layers || [] }];
      const targetIdx = variant_id
        ? variants.findIndex((v) => v.id === variant_id)
        : 0;
      if (targetIdx === -1) {
        return {
          content: [{ type: 'text' as const, text: `Error: Variant "${variant_id}" not found.` }],
          isError: true,
        };
      }

      let layers = variants[targetIdx].layers || [];
      const refMap = new Map<string, string>();
      // Custom fontFamily values these ops apply — missing ones are
      // auto-installed from the Google Fonts catalog after the save.
      const fontFamilies = new Set<string>();
      // Component variables by id, so we can derive the correct link type from
      // the component definition (never from the layer template) and validate
      // that a variable_id actually exists before linking.
      const variablesById = new Map<string, ComponentVariable>(
        (component.variables ?? []).map((v) => [v.id, v]),
      );
      const results: Array<{ op: number; status: string; detail: string }> = [];

      for (let i = 0; i < operations.length; i++) {
        const op = operations[i];
        try {
          switch (op.type) {
            case 'add_layer': {
              const parentId = refMap.get(op.parent_layer_id) || op.parent_layer_id;
              const parent = findLayerById(layers, parentId);
              if (!parent) { results.push({ op: i, status: 'error', detail: `Parent "${op.parent_layer_id}" not found` }); continue; }
              if (!canHaveChildren(parent)) { results.push({ op: i, status: 'error', detail: `"${parent.customName || parent.name}" cannot have children` }); continue; }

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

              let linkDetail = '';
              if (op.variable_id) {
                const variable = variablesById.get(op.variable_id);
                if (!variable) {
                  results.push({ op: i, status: 'error', detail: `Variable "${op.variable_id}" not found on component — layer not added. Create the variable first (create_component/update_component), then link it.` });
                  continue;
                }
                const variableType = variable.type ?? 'text';
                newLayer = linkVariableToLayer(newLayer, op.variable_id, variableType);
                linkDetail = ` linked to variable "${variable.name}" (${variableType})`;
              }

              if (op.ref_id) refMap.set(op.ref_id, newLayer.id);
              layers = insertLayer(layers, parentId, newLayer, op.position);
              results.push({ op: i, status: 'ok', detail: `Added ${op.template} (id: ${newLayer.id})${linkDetail}` });
              break;
            }

            case 'update_design': {
              const layerId = refMap.get(op.layer_id) || op.layer_id;
              const layer = findLayerById(layers, layerId);
              if (!layer) { results.push({ op: i, status: 'error', detail: `Layer "${op.layer_id}" not found` }); continue; }
              const bp = (op.breakpoint ?? 'desktop') as Breakpoint;
              const state = (op.ui_state ?? 'neutral') as UIState;
              layers = updateLayerById(layers, layerId, (l) =>
                applyDesignToLayer(l, op.design as Record<string, Record<string, unknown>>, bp, state),
              );
              collectFontFamiliesFromDesign(op.design as Record<string, unknown>, fontFamilies);
              results.push({ op: i, status: 'ok', detail: `Styled "${layer.customName || layer.name}"` });
              break;
            }

            case 'update_text': {
              const layerId = refMap.get(op.layer_id) || op.layer_id;
              const layer = findLayerById(layers, layerId);
              if (!layer) { results.push({ op: i, status: 'error', detail: `Layer "${op.layer_id}" not found` }); continue; }
              layers = updateLayerById(layers, layerId, (l) => ({
                ...l,
                variables: {
                  ...l.variables,
                  // Preserve any linked component-variable id so setting content
                  // does not accidentally unlink the layer.
                  text: {
                    ...(l.variables?.text?.id ? { id: l.variables.text.id } : {}),
                    type: 'dynamic_rich_text',
                    data: { content: getTiptapTextContent(op.text) },
                  },
                },
              }));
              results.push({ op: i, status: 'ok', detail: `Set text on "${layer.customName || layer.name}"` });
              break;
            }

            case 'update_image': {
              const layerId = refMap.get(op.layer_id) || op.layer_id;
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
              // applyImageUpdate keeps a linked component-variable id on src.
              layers = updateLayerById(layers, layerId, (l) => applyImageUpdate(l, op));
              results.push({ op: i, status: 'ok', detail: `${describeImageUpdate(op)} on "${layer.customName || layer.name}"` });
              break;
            }

            case 'set_rich_text': {
              const layerId = refMap.get(op.layer_id) || op.layer_id;
              const layer = findLayerById(layers, layerId);
              if (!layer) { results.push({ op: i, status: 'error', detail: `Layer "${op.layer_id}" not found` }); continue; }
              const tiptapDoc = buildTiptapDoc(op.blocks as RichTextBlock[]);
              layers = updateLayerById(layers, layerId, (l) => ({
                ...l,
                variables: {
                  ...l.variables,
                  // Preserve any linked component-variable id so setting content
                  // does not accidentally unlink the layer.
                  text: {
                    ...(l.variables?.text?.id ? { id: l.variables.text.id } : {}),
                    type: 'dynamic_rich_text',
                    data: { content: tiptapDoc },
                  },
                },
              }));
              results.push({ op: i, status: 'ok', detail: `Set rich text on "${layer.customName || layer.name}" (${op.blocks.length} blocks)` });
              break;
            }

            case 'apply_style': {
              const layerId = refMap.get(op.layer_id) || op.layer_id;
              const layer = findLayerById(layers, layerId);
              if (!layer) { results.push({ op: i, status: 'error', detail: `Layer "${op.layer_id}" not found` }); continue; }
              layers = updateLayerById(layers, layerId, (l) => ({ ...l, styleId: op.style_id }));
              results.push({ op: i, status: 'ok', detail: `Applied style to "${layer.customName || layer.name}"` });
              break;
            }

            case 'update_link': {
              const layerId = refMap.get(op.layer_id) || op.layer_id;
              const layer = findLayerById(layers, layerId);
              if (!layer) { results.push({ op: i, status: 'error', detail: `Layer "${op.layer_id}" not found` }); continue; }
              let linkInput = op;
              if (op.link_type === 'page' && op.page_id_target && !op.collection_item_id) {
                const targetPage = await getPageById(op.page_id_target).catch(() => null);
                linkInput = defaultDynamicPageItem(op, layers, layerId, targetPage);
              }
              // buildLinkSettings keeps a linked component variable (variable_id) on the link.
              layers = updateLayerById(layers, layerId, (l) => ({
                ...l,
                variables: { ...l.variables, link: buildLinkSettings(linkInput, l.variables?.link) },
              }));
              results.push({ op: i, status: 'ok', detail: `${describeLink(op)} on "${layer.customName || layer.name}"` });
              break;
            }

            case 'update_settings': {
              const layerId = refMap.get(op.layer_id) || op.layer_id;
              const layer = findLayerById(layers, layerId);
              if (!layer) { results.push({ op: i, status: 'error', detail: `Layer "${op.layer_id}" not found` }); continue; }
              layers = updateLayerById(layers, layerId, (l) => applyLayerSettings(l, op));
              results.push({ op: i, status: 'ok', detail: `Updated settings on "${layer.customName || layer.name}"` });
              break;
            }

            case 'delete_layer': {
              const layerId = refMap.get(op.layer_id) || op.layer_id;
              const layer = findLayerById(layers, layerId);
              if (!layer) { results.push({ op: i, status: 'error', detail: `Layer "${op.layer_id}" not found` }); continue; }
              layers = removeLayer(layers, layerId);
              results.push({ op: i, status: 'ok', detail: `Deleted "${layer.customName || layer.name}"` });
              break;
            }

            case 'move_layer': {
              const layerId = refMap.get(op.layer_id) || op.layer_id;
              const newParentId = refMap.get(op.new_parent_id) || op.new_parent_id;
              const layer = findLayerById(layers, layerId);
              if (!layer) { results.push({ op: i, status: 'error', detail: `Layer "${op.layer_id}" not found` }); continue; }
              layers = moveLayerInTree(layers, layerId, newParentId, op.position);
              results.push({ op: i, status: 'ok', detail: `Moved "${layer.customName || layer.name}"` });
              break;
            }

            case 'link_variable': {
              const layerId = refMap.get(op.layer_id) || op.layer_id;
              const layer = findLayerById(layers, layerId);
              if (!layer) { results.push({ op: i, status: 'error', detail: `Layer "${op.layer_id}" not found` }); continue; }
              const variable = variablesById.get(op.variable_id);
              if (!variable) {
                results.push({ op: i, status: 'error', detail: `Variable "${op.variable_id}" not found on component. Create the variable first (create_component/update_component), then link it.` });
                continue;
              }
              // The variable's declared type is authoritative; op.variable_type is
              // only a legacy fallback for callers that omit a real variable.
              const variableType = variable.type ?? op.variable_type;
              layers = updateLayerById(layers, layerId, (l) =>
                linkVariableToLayer(l, op.variable_id, variableType),
              );
              results.push({ op: i, status: 'ok', detail: `Linked variable "${variable.name}" (${variableType}) to "${layer.customName || layer.name}"` });
              break;
            }
          }
        } catch (err) {
          results.push({ op: i, status: 'error', detail: err instanceof Error ? err.message : 'Unknown error' });
        }
      }

      const errors = results.filter((r) => r.status === 'error');
      if (errors.length === operations.length) {
        return {
          content: [{ type: 'text' as const, text: JSON.stringify({ message: 'All operations failed', results }) }],
          isError: true,
        };
      }

      const updatedVariants = variants.map((v, i) => (i === targetIdx ? { ...v, layers } : v));
      await updateComponent(component_id, { variants: updatedVariants });
      broadcastComponentLayersUpdated(component_id, updatedVariants[0].layers).catch(() => {});

      // Auto-install any Google Font these ops referenced but never added.
      const fonts = await ensureFontsInstalled(fontFamilies);
      const warnings = fontWarnings(fonts);

      const refEntries = Object.fromEntries(refMap);
      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({
            message: `Executed ${results.filter((r) => r.status === 'ok').length}/${operations.length} operations`,
            ref_ids: Object.keys(refEntries).length > 0 ? refEntries : undefined,
            results,
            fonts_auto_installed: fonts.installed.length > 0 ? fonts.installed : undefined,
            design_warnings: warnings.length > 0 ? warnings : undefined,
          }),
        }],
      };
    },
  );

  server.tool(
    'delete_component_variable',
    `Delete a variable from a component and clean up every reference: unlink it from all of the
component's variant layers, and remove any per-instance overrides that referenced it across
pages. Use this instead of update_component's variables list when removing a variable, so no
dangling links or orphaned overrides are left behind.`,
    {
      component_id: z.string().describe('The component ID'),
      variable_id: z.string().describe('The variable ID to delete'),
    },
    async ({ component_id, variable_id }) => {
      const component = await getComponentById(component_id);
      if (!component) {
        return { content: [{ type: 'text' as const, text: `Error: Component "${component_id}" not found.` }], isError: true };
      }
      const variable = (component.variables ?? []).find((v) => v.id === variable_id);
      if (!variable) {
        return { content: [{ type: 'text' as const, text: `Error: Variable "${variable_id}" not found on component "${component.name}".` }], isError: true };
      }
      const category = variable.type ?? 'text';

      const updatedVariables = (component.variables ?? []).filter((v) => v.id !== variable_id);
      const variants: ComponentVariant[] = (component.variants && component.variants.length > 0)
        ? component.variants
        : [{ id: generateId(), name: 'Default', layers: component.layers ?? [] }];
      const updatedVariants = variants.map((v) => ({
        ...v,
        layers: unlinkVariableFromLayers(v.layers ?? [], variable_id),
      }));

      await updateComponent(component_id, { variables: updatedVariables, variants: updatedVariants });
      broadcastComponentUpdated(component_id, { variables: updatedVariables, variants: updatedVariants }).catch(() => {});

      // Sweep pages so instances of this component don't keep overrides that
      // point at the now-deleted variable. Best-effort: never fail the delete
      // because a page couldn't be cleaned.
      let cleanedPages = 0;
      try {
        const pages = await getAllPages({ is_published: false });
        for (const page of pages) {
          const before = await getPageLayers(page.id);
          const after = cleanInstanceOverridesInLayers(before, component_id, variable_id, category);
          if (JSON.stringify(after) !== JSON.stringify(before)) {
            await saveCachedLayers(page.id, after);
            cleanedPages += 1;
          }
        }
      } catch (error) {
        console.error('[delete_component_variable] page override cleanup failed:', error);
      }

      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({
            message: `Deleted variable "${variable.name}" from "${component.name}"`,
            unlinked_from_variants: updatedVariants.length,
            pages_cleaned: cleanedPages,
          }),
        }],
      };
    },
  );

  server.tool(
    'delete_component',
    'Delete a component. This detaches it from all pages and components that use it.',
    { component_id: z.string().describe('The component ID to delete') },
    async ({ component_id }) => {
      const result = await softDeleteComponent(component_id);
      broadcastComponentDeleted(component_id).catch(() => {});

      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({
            message: `Component "${result.component.name}" deleted`,
            affected_entities: result.affectedEntities.map((e) => ({
              type: e.type,
              name: e.name,
            })),
          }),
        }],
      };
    },
  );
}

/** Media variable slots whose linked variable id lives on `.src.id`. */
const MEDIA_LINK_SLOTS = ['image', 'audio', 'video', 'icon'] as const;

/**
 * Recursively strip every link to `variableId` from a component's layer tree:
 * text/media/link variable slots plus the top-level variant-variable link. Used
 * when deleting a variable so no layer keeps a dangling reference.
 */
function unlinkVariableFromLayers(layers: Layer[], variableId: string): Layer[] {
  return layers.map((layer) => {
    let next: Layer = layer;

    if (layer.variables) {
      const vars = { ...layer.variables } as Record<string, unknown>;
      let changed = false;

      const textVar = vars.text as { id?: string } | undefined;
      if (textVar?.id === variableId) {
        const { id: _omitTextId, ...rest } = textVar;
        vars.text = rest;
        changed = true;
      }

      for (const slot of MEDIA_LINK_SLOTS) {
        const mediaVar = vars[slot] as { src?: { id?: string } } | undefined;
        if (mediaVar?.src?.id === variableId) {
          const { id: _omitSrcId, ...restSrc } = mediaVar.src;
          vars[slot] = { ...mediaVar, src: restSrc };
          changed = true;
        }
      }

      const linkVar = vars.link as { variable_id?: string } | undefined;
      if (linkVar?.variable_id === variableId) {
        const { variable_id: _omitLinkVar, ...restLink } = linkVar;
        vars.link = restLink;
        changed = true;
      }

      if (changed) next = { ...next, variables: vars as Layer['variables'] };
    }

    if (next.componentVariantVariableId === variableId) {
      const { componentVariantVariableId: _omitVariant, ...rest } = next;
      next = rest as Layer;
    }

    if (next.settings?.visibilityVariableId === variableId) {
      const { visibilityVariableId: _omitVisibility, ...restSettings } = next.settings;
      next = { ...next, settings: restSettings };
    }

    if (next.settings?.idVariableId === variableId) {
      const { idVariableId: _omitId, ...restSettings } = next.settings;
      next = { ...next, settings: restSettings };
    }

    if (next.children && next.children.length > 0) {
      next = { ...next, children: unlinkVariableFromLayers(next.children, variableId) };
    }

    return next;
  });
}

/**
 * Recursively remove per-instance overrides that reference a deleted variable
 * from instances of `componentId` on a page tree. Clears the value from the
 * variable's type bucket, drops matching variableLinks, and strips a dangling
 * variant-variable link.
 */
function cleanInstanceOverridesInLayers(
  layers: Layer[],
  componentId: string,
  variableId: string,
  category: string,
): Layer[] {
  return layers.map((layer) => {
    let next: Layer = layer;

    if (layer.componentId === componentId && layer.componentOverrides) {
      const overrides = { ...layer.componentOverrides } as Record<string, unknown>;

      if (category !== 'variableLinks') {
        const bucket = overrides[category] as Record<string, unknown> | undefined;
        if (bucket && bucket[variableId] !== undefined) {
          const { [variableId]: _omitOverride, ...remaining } = bucket;
          overrides[category] = Object.keys(remaining).length > 0 ? remaining : undefined;
        }
      }

      const links = overrides.variableLinks as Record<string, string> | undefined;
      if (links?.[variableId]) {
        const { [variableId]: _omitLink, ...remainingLinks } = links;
        overrides.variableLinks = Object.keys(remainingLinks).length > 0 ? remainingLinks : undefined;
      }

      next = { ...layer, componentOverrides: overrides as Layer['componentOverrides'] };
    }

    if (next.componentVariantVariableId === variableId) {
      const { componentVariantVariableId: _omitVariant, ...rest } = next;
      next = rest as Layer;
    }

    if (next.children && next.children.length > 0) {
      next = {
        ...next,
        children: cleanInstanceOverridesInLayers(next.children, componentId, variableId, category),
      };
    }

    return next;
  });
}

function countLayers(layers: Layer[]): number {
  let count = 0;
  for (const layer of layers) {
    count += 1;
    if (layer.children) count += countLayers(layer.children);
  }
  return count;
}

/**
 * Deep-clone a layer, regenerating IDs for the whole subtree.
 * Used when cloning a variant so the new variant has fresh layer IDs.
 */
function cloneLayerWithNewIds(layer: Layer): Layer {
  return {
    ...layer,
    id: generateId('lyr'),
    ...(layer.children && Array.isArray(layer.children) && {
      children: layer.children.map(cloneLayerWithNewIds),
    }),
  };
}

/**
 * Link a component variable to a layer's content slot, creating the slot when it
 * does not exist yet. Mirrors the editor UI handlers (ImageSettings,
 * LinkSettings, etc.) so agent-built components behave like hand-built ones.
 * The linked id lives at a per-type location the runtime resolves:
 *   text/rich_text -> variables.text.id
 *   image/audio/video/icon -> variables.<type>.src.id
 *   link -> variables.link.variable_id (note: variable_id, not id)
 *   variant -> layer.componentVariantVariableId
 *   visibility -> layer.settings.visibilityVariableId
 *   id -> layer.settings.idVariableId
 */
function linkVariableToLayer(layer: Layer, variableId: string, variableType: string): Layer {
  const vars = { ...layer.variables };
  const assetSrc = { type: 'asset' as const, id: variableId, data: { asset_id: null } };

  switch (variableType) {
    case 'text':
    case 'rich_text':
      vars.text = vars.text
        ? { ...vars.text, id: variableId }
        : { type: 'dynamic_text' as const, id: variableId, data: { content: '' } };
      break;

    case 'image':
      vars.image = vars.image
        ? { ...vars.image, src: { ...vars.image.src, id: variableId } }
        : { src: assetSrc, alt: { type: 'dynamic_text' as const, data: { content: '' } } };
      break;

    case 'link':
      // variable_id is a runtime extension on LinkSettings for component linking.
      // 'none' is the sentinel link type used until a real one is chosen.
      vars.link = (vars.link
        ? { ...vars.link, variable_id: variableId }
        : { type: 'none', variable_id: variableId }) as unknown as typeof vars.link;
      break;

    case 'audio':
      vars.audio = vars.audio
        ? { ...vars.audio, src: { ...vars.audio.src, id: variableId } }
        : { src: assetSrc };
      break;

    case 'video':
      vars.video = vars.video
        ? { ...vars.video, src: { ...(vars.video.src ?? assetSrc), id: variableId } }
        : { src: assetSrc };
      break;

    case 'icon':
      vars.icon = vars.icon
        ? { ...vars.icon, src: { ...(vars.icon.src ?? assetSrc), id: variableId } }
        : { src: assetSrc };
      break;

    case 'variant':
      // Variant variables target the layer's nested-component variant override
      // via a top-level layer field (not inside variables).
      return { ...layer, componentVariantVariableId: variableId, variables: vars };

    case 'visibility':
      // Visibility drives `settings.hidden`, so the link lives in settings.
      return { ...layer, settings: { ...layer.settings, visibilityVariableId: variableId }, variables: vars };

    case 'id':
      // The id variable drives `settings.id`, so the link lives in settings.
      return { ...layer, settings: { ...layer.settings, idVariableId: variableId }, variables: vars };
  }

  return { ...layer, variables: vars };
}
