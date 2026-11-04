/**
 * MCP tool annotations
 *
 * Every tool exposed over MCP must carry a human-readable `title` and the
 * `readOnlyHint` / `destructiveHint` annotations from the MCP spec. Clients use
 * them to decide which calls need user confirmation, and connector directories
 * (Claude, ChatGPT) reject servers whose tools lack them.
 *
 * Annotations live in this single table rather than on each `server.tool(...)`
 * call so that:
 *  - the full read/write/destructive classification is reviewable in one place
 *  - the tool files (and the in-app agent registry that replays them) stay on
 *    the plain 4-arg `server.tool` API
 *  - `createMcpServer` can fail fast when a new tool is added without an entry
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ToolAnnotations } from '@modelcontextprotocol/sdk/types.js';
import type { ZodRawShape } from 'zod';

/**
 * - `read`: never mutates site data (safe to call without confirmation)
 * - `write`: creates or updates drafts; reversible from the builder
 * - `destructive`: deletes data or pushes drafts live
 */
export type ToolAccessKind = 'read' | 'write' | 'destructive';

export interface ToolMeta {
  title: string;
  kind: ToolAccessKind;
}

const ANNOTATIONS_BY_KIND: Record<ToolAccessKind, ToolAnnotations> = {
  read: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
  write: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
  destructive: { readOnlyHint: false, destructiveHint: true, openWorldHint: false },
};

const read = (title: string): ToolMeta => ({ title, kind: 'read' });
const write = (title: string): ToolMeta => ({ title, kind: 'write' });
const destructive = (title: string): ToolMeta => ({ title, kind: 'destructive' });

/** Title + access classification for every MCP tool, keyed by tool name. */
export const TOOL_META: Record<string, ToolMeta> = {
  // Pages & redirects
  list_pages: read('List pages'),
  get_page: read('Get page'),
  create_page: write('Create page'),
  update_page: write('Update page'),
  update_page_settings: write('Update page settings'),
  duplicate_page: write('Duplicate page'),
  delete_page: destructive('Delete page'),
  list_redirects: read('List redirects'),
  add_redirect: write('Add redirect'),
  update_redirect: write('Update redirect'),
  delete_redirect: destructive('Delete redirect'),

  // Page folders
  list_page_folders: read('List page folders'),
  create_page_folder: write('Create page folder'),
  update_page_folder: write('Update page folder'),
  delete_page_folder: destructive('Delete page folder'),

  // Layers
  get_layers: read('Get page layers'),
  add_layer: write('Add layer'),
  update_layer_design: write('Update layer design'),
  update_rich_text_styles: write('Update rich text element styles'),
  update_layer_text: write('Update layer text'),
  set_rich_text_content: write('Set rich text content'),
  delete_layer: destructive('Delete layer'),
  move_layer: write('Move layer'),
  update_layer_image: write('Update layer image'),
  update_layer_link: write('Update layer link'),
  update_layer_video: write('Update layer video'),
  update_layer_background_image: write('Update layer background image'),
  update_layer_settings: write('Update layer settings'),
  update_form_settings: write('Update form settings'),
  export_layer_html: read('Export layer as HTML'),
  import_html: write('Import HTML as layers'),
  update_layer_iframe: write('Update layer iframe'),
  // Batches may contain delete_layer ops, but every op edits the page *draft* —
  // nothing reaches the live site until `publish` (destructive). Marking the
  // batch destructive would make every multi-edit turn look like a delete and
  // push clients back to one prompt per edit, which is what batching avoids.
  batch_operations: write('Run batch layer operations'),

  // Layouts
  list_layouts: read('List layout templates'),
  add_layout: write('Add layout template'),

  // Collections (CMS)
  list_collections: read('List collections'),
  create_collection: write('Create collection'),
  add_collection_field: write('Add collection field'),
  list_collection_items: read('List collection items'),
  create_collection_item: write('Create collection item'),
  update_collection_item: write('Update collection item'),
  delete_collection_item: destructive('Delete collection item'),
  set_collection_item_order: write('Set collection item order'),
  update_collection: write('Update collection'),
  delete_collection: destructive('Delete collection'),
  update_collection_field: write('Update collection field'),
  delete_collection_field: destructive('Delete collection field'),
  reorder_collection_fields: write('Reorder collection fields'),

  // Collection layers
  bind_collection_layer: write('Bind collection list'),
  set_collection_filters: write('Set collection filters'),
  create_collection_pages: write('Create collection pages'),
  bind_layer_field: write('Bind layer to field'),
  set_dynamic_text: write('Set dynamic text'),
  set_layer_visibility: write('Set layer visibility'),

  // Styles
  list_styles: read('List styles'),
  create_style: write('Create style'),
  apply_style: write('Apply style'),
  set_layer_styles: write('Set layer styles'),
  update_style: write('Update style'),
  delete_style: destructive('Delete style'),

  // Assets
  list_assets: read('List assets'),
  upload_asset: write('Upload asset'),
  get_asset: read('Get asset'),
  update_asset: write('Update asset'),
  delete_asset: destructive('Delete asset'),

  // Asset folders
  list_asset_folders: read('List asset folders'),
  create_asset_folder: write('Create asset folder'),
  update_asset_folder: write('Update asset folder'),
  delete_asset_folder: destructive('Delete asset folder'),

  // Components
  list_components: read('List components'),
  get_component: read('Get component'),
  add_component_instance: write('Add component instance'),
  replace_layer_with_component: write('Replace layer with component'),
  replace_component_instances: destructive('Replace component instances site-wide'),
  set_component_instance: write('Set component instance overrides'),
  detach_component_instance: destructive('Detach component instance'),
  reorder_component_variants: write('Reorder component variants'),
  create_component_from_layer: write('Create component from layer'),
  create_component: write('Create component'),
  update_component: write('Update component'),
  list_component_variants: read('List component variants'),
  create_component_variant: write('Create component variant'),
  update_component_variant: write('Update component variant'),
  delete_component_variant: destructive('Delete component variant'),
  update_component_layers: write('Update component layers'),
  delete_component_variable: destructive('Delete component variable'),
  delete_component: destructive('Delete component'),

  // Color variables
  list_color_variables: read('List color variables'),
  create_color_variable: write('Create color variable'),
  update_color_variable: write('Update color variable'),
  delete_color_variable: destructive('Delete color variable'),
  reorder_color_variables: write('Reorder color variables'),

  // Global variables
  list_global_variables: read('List global variables'),
  create_global_variable: write('Create global variable'),
  update_global_variable: write('Update global variable'),
  delete_global_variable: destructive('Delete global variable'),

  // Fonts
  list_fonts: read('List fonts'),
  search_google_fonts: read('Search Google Fonts'),
  add_font: write('Add font'),
  update_font: write('Update font'),
  delete_font: destructive('Delete font'),

  // Locales & translations
  list_locales: read('List locales'),
  create_locale: write('Create locale'),
  update_locale: write('Update locale'),
  delete_locale: destructive('Delete locale'),
  set_default_locale: write('Set default locale'),
  list_translations: read('List translations'),
  set_translation: write('Set translation'),
  batch_set_translations: write('Set translations in batch'),
  update_translation: write('Update translation'),
  delete_translation: destructive('Delete translation'),
  list_translatable_content: read('List translatable content'),
  set_rich_text_translation: write('Set rich text translation'),

  // Forms
  list_forms: read('List forms'),
  list_form_submissions: read('List form submissions'),
  get_form_submission: read('Get form submission'),
  update_form_submission_status: write('Update form submission status'),
  mark_all_submissions_read: write('Mark all submissions read'),
  delete_form_submission: destructive('Delete form submission'),

  // Settings
  get_settings: read('Get site settings'),
  set_setting: write('Set site setting'),
  set_settings_batch: write('Set site settings in batch'),

  // Publishing
  get_unpublished_changes: read('Get unpublished changes'),
  publish: destructive('Publish site'),

  // Animations
  add_animation: write('Add animation'),
  list_layer_animations: read('List layer animations'),
  remove_layer_animation: destructive('Remove layer animation'),
  clear_layer_animations: destructive('Clear layer animations'),
  set_layer_interactions: write('Set layer interactions'),
};

/**
 * Resolve the title + annotations for a tool, throwing when it has no entry so
 * a newly added tool cannot ship without a classification.
 */
export function getToolAnnotations(name: string): { title: string; annotations: ToolAnnotations } {
  const meta = TOOL_META[name];
  if (!meta) {
    throw new Error(`MCP tool "${name}" has no entry in lib/mcp/tool-annotations.ts`);
  }
  // The Claude connector directory reads the title from `annotations.title`,
  // while newer clients read the top-level tool `title`, so both are set.
  return {
    title: meta.title,
    annotations: { title: meta.title, ...ANNOTATIONS_BY_KIND[meta.kind] },
  };
}

type RawToolHandler = Parameters<McpServer['registerTool']>[2];

/**
 * Wrap an McpServer so the tool files' plain `server.tool(name, description,
 * schema, handler)` calls are registered with the title and annotations from
 * TOOL_META. Everything else is forwarded to the real server.
 *
 * `sharedParams` are added to every tool's input schema and removed from the
 * arguments before the tool handler runs (handlers may spread their arguments
 * into database updates). The hosting layer reads them from the raw request.
 */
export function withToolAnnotations(server: McpServer, sharedParams: ZodRawShape = {}): McpServer {
  const sharedKeys = Object.keys(sharedParams);

  const annotatedTool = (
    name: string,
    description: string,
    inputSchema: ZodRawShape,
    handler: RawToolHandler,
  ) => {
    const { title, annotations } = getToolAnnotations(name);
    if (sharedKeys.length === 0) {
      return server.registerTool(name, { title, description, inputSchema, annotations }, handler);
    }

    const callHandler = handler as (args: Record<string, unknown>, extra: unknown) => ReturnType<RawToolHandler>;
    const withoutShared = ((args: Record<string, unknown>, extra: unknown) => {
      const rest = { ...args };
      for (const key of sharedKeys) delete rest[key];
      return callHandler(rest, extra);
    }) as RawToolHandler;

    return server.registerTool(
      name,
      { title, description, inputSchema: { ...inputSchema, ...sharedParams }, annotations },
      withoutShared,
    );
  };

  return new Proxy(server, {
    get(target, prop, receiver) {
      if (prop === 'tool') return annotatedTool;
      const value = Reflect.get(target, prop, receiver);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
}
