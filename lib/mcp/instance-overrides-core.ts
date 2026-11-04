/**
 * Pure per-instance override values for `set_component_instance` (no database
 * access): static content plus CMS bindings (text with fields, field-bound
 * media and links, links to a CMS item's dynamic page), in the same shapes the
 * builder stores. `instance-overrides.ts` wires the lookups to the repositories.
 */

import type { CollectionField, ComponentVariableValue, FieldVariable, Layer, LinkSettings } from '@/types';
import { buildDynamicTextDoc, buildFieldData, fieldNotFoundError } from '@/lib/mcp/field-binding-core';
import type { BindingSource, DynamicTextSegment } from '@/lib/mcp/field-binding-core';
import {
  buildLinkSettings,
  buildTiptapDoc,
  defaultDynamicPageItem,
  getTiptapTextContent,
  resolveLinkAnchor,
} from '@/lib/mcp/utils';
import type { DynamicPageLinkTarget, LinkInput, RichTextBlock } from '@/lib/mcp/utils';
import { sanitizeHtmlId } from '@/lib/html-utils';
import { findParentCollectionLayer } from '@/lib/layer-utils';
import { createTextComponentVariableValue } from '@/lib/variable-utils';

/** Fields the agent can pass to describe a single instance override. */
export interface OverrideEntryInput {
  text?: string;
  rich_content?: RichTextBlock[];
  segments?: DynamicTextSegment[];
  field_id?: string;
  source?: BindingSource;
  asset_id?: string;
  alt?: string;
  url?: string;
  link_page_id?: string;
  collection_item_id?: string;
  anchor_layer_id?: string;
  target?: LinkSettings['target'];
  variant_id?: string;
  visible?: boolean;
  element_id?: string;
}

/** Fields a CMS binding reads from, plus the Collection List stamped on field variables. */
export type OverrideBinding = { collectionLayerId?: string; fields: CollectionField[] } | { error: string };

/** Where the instance lives and the lookups bindings and links need. */
export interface OverrideContext {
  layers: Layer[];
  pageId: string;
  instanceLayerId: string;
  resolveBinding: (source: BindingSource) => Promise<OverrideBinding>;
  getPage: (pageId: string) => Promise<DynamicPageLinkTarget | null>;
  getPageLayers: (pageId: string) => Promise<Layer[]>;
}

type OverrideResult = { value: ComponentVariableValue } | { error: string };

/** The enclosing Collection List when there is one, otherwise the dynamic page. */
export function defaultOverrideSource(layers: Layer[], instanceLayerId: string): BindingSource {
  return findParentCollectionLayer(layers, instanceLayerId) ? 'collection' : 'page';
}

/** Resolve the binding source and the fields available to the instance. */
async function resolveOverrideBinding(
  entry: OverrideEntryInput,
  ctx: OverrideContext,
): Promise<{ source: BindingSource; collectionLayerId?: string; fields: CollectionField[] } | { error: string }> {
  const source = entry.source ?? defaultOverrideSource(ctx.layers, ctx.instanceLayerId);
  const binding = await ctx.resolveBinding(source);
  if ('error' in binding) return binding;
  return { source, ...binding };
}

async function resolveFieldVariable(
  entry: OverrideEntryInput,
  fieldId: string,
  ctx: OverrideContext,
): Promise<{ variable: FieldVariable } | { error: string }> {
  const binding = await resolveOverrideBinding(entry, ctx);
  if ('error' in binding) return binding;
  const field = binding.fields.find((f) => f.id === fieldId);
  if (!field) {
    return { error: fieldNotFoundError(fieldId, binding.source) };
  }
  return { variable: { type: 'field', data: buildFieldData(field, binding.source, binding.collectionLayerId, undefined) } };
}

async function buildTextOverride(entry: OverrideEntryInput, ctx: OverrideContext): Promise<OverrideResult | null> {
  if (entry.segments && entry.segments.length > 0) {
    const binding = await resolveOverrideBinding(entry, ctx);
    if ('error' in binding) return binding;
    const fieldsById = new Map(binding.fields.map((f) => [f.id, f]));
    const built = buildDynamicTextDoc(entry.segments, fieldsById, binding.source, binding.collectionLayerId);
    if ('error' in built) return built;
    return { value: createTextComponentVariableValue(built.doc) };
  }
  if (entry.rich_content && entry.rich_content.length > 0) {
    return { value: createTextComponentVariableValue(buildTiptapDoc(entry.rich_content)) };
  }
  if (entry.text !== undefined) {
    return { value: createTextComponentVariableValue(getTiptapTextContent(entry.text)) };
  }
  return null;
}

async function buildMediaOverride(
  category: 'image' | 'audio' | 'video',
  entry: OverrideEntryInput,
  ctx: OverrideContext,
): Promise<OverrideResult | null> {
  const alt = category === 'image' && entry.alt !== undefined
    ? { alt: { type: 'dynamic_text' as const, data: { content: entry.alt } } }
    : {};

  if (entry.field_id) {
    const resolved = await resolveFieldVariable(entry, entry.field_id, ctx);
    if ('error' in resolved) return resolved;
    return { value: { src: resolved.variable, ...alt } };
  }
  if (!entry.asset_id) return null;
  return { value: { src: { type: 'asset', data: { asset_id: entry.asset_id } }, ...alt } };
}

/** Map the agent's link fields to a LinkInput, or null when none were given. */
function toLinkInput(entry: OverrideEntryInput): LinkInput | null {
  const shared = {
    ...(entry.anchor_layer_id ? { anchor_layer_id: entry.anchor_layer_id } : {}),
    ...(entry.target ? { target: entry.target } : {}),
  };
  if (entry.url !== undefined) {
    return { link_type: 'url', url: entry.url, ...shared };
  }
  if (entry.link_page_id) {
    return {
      link_type: 'page',
      page_id_target: entry.link_page_id,
      ...(entry.collection_item_id ? { collection_item_id: entry.collection_item_id } : {}),
      ...shared,
    };
  }
  if (entry.anchor_layer_id) {
    return { link_type: 'url', ...shared };
  }
  return null;
}

async function buildLinkOverride(entry: OverrideEntryInput, ctx: OverrideContext): Promise<OverrideResult | null> {
  if (entry.field_id) {
    const resolved = await resolveFieldVariable(entry, entry.field_id, ctx);
    if ('error' in resolved) return resolved;
    return { value: { type: 'field', field: resolved.variable, ...(entry.target ? { target: entry.target } : {}) } };
  }

  let input = toLinkInput(entry);
  if (!input) return null;

  if (input.anchor_layer_id) {
    const linksElsewhere = input.link_type === 'page' && input.page_id_target !== ctx.pageId;
    const anchorLayers = linksElsewhere ? await ctx.getPageLayers(input.page_id_target!) : ctx.layers;
    const anchored = resolveLinkAnchor(input, anchorLayers);
    if ('error' in anchored) return anchored;
    input = anchored.input;
  }

  if (input.link_type === 'page' && input.page_id_target && !input.collection_item_id) {
    const [targetPage, currentPage] = await Promise.all([ctx.getPage(input.page_id_target), ctx.getPage(ctx.pageId)]);
    input = defaultDynamicPageItem(input, ctx.layers, ctx.instanceLayerId, targetPage, currentPage);
  }

  return { value: buildLinkSettings(input) };
}

/**
 * Build the override value for one variable, choosing the shape from the
 * variable's declared type. Errors when the entry has no usable value for that
 * type or a CMS binding cannot resolve from the instance's position.
 */
export async function buildOverrideValue(
  category: string,
  entry: OverrideEntryInput,
  ctx: OverrideContext,
): Promise<OverrideResult> {
  let result: OverrideResult | null = null;

  switch (category) {
    case 'text':
    case 'rich_text':
      result = await buildTextOverride(entry, ctx);
      break;

    case 'image':
    case 'audio':
    case 'video':
      result = await buildMediaOverride(category, entry, ctx);
      break;

    case 'icon':
      if (entry.field_id) return { error: 'Icon variables cannot be bound to a CMS field.' };
      if (entry.asset_id) result = { value: { src: { type: 'asset', data: { asset_id: entry.asset_id } } } };
      break;

    case 'link':
      result = await buildLinkOverride(entry, ctx);
      break;

    case 'variant':
      if (entry.variant_id) result = { value: { variant_id: entry.variant_id } };
      break;

    case 'visibility':
      if (entry.visible !== undefined) result = { value: { visible: entry.visible } };
      break;

    case 'id':
      if (entry.element_id !== undefined) result = { value: { id: sanitizeHtmlId(entry.element_id) } };
      break;
  }

  return result ?? { error: `No usable value provided (${category})` };
}
