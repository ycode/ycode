/**
 * Pure CMS field-binding helpers (no database access): the variable payloads a
 * bound layer stores and the per-layer-type binding itself. `field-binding.ts`
 * adds the repository lookups on top; the HTML importer uses these directly.
 */

import { applyBackgroundImageDesign } from '@/lib/mcp/utils';
import type { CollectionField, CollectionFieldType, Layer } from '@/types';

/** Layer types whose text content can be bound to a CMS field. */
export const BINDABLE_TEXT_LAYER_NAMES = new Set(['text', 'heading', 'richText']);

export type BindingSource = 'collection' | 'page' | 'global';
export type BindingTarget = 'auto' | 'src' | 'alt' | 'poster' | 'background';

export interface FieldData {
  field_id: string;
  field_type: CollectionFieldType;
  relationships: string[];
  source: BindingSource;
  collection_layer_id?: string;
  global_id?: string;
  format?: string;
}

/** A field variable's data payload — binds a layer's content to a CMS field or global variable. */
export function buildFieldData(
  field: CollectionField,
  source: BindingSource,
  collectionLayerId: string | undefined,
  format: string | undefined,
): FieldData {
  return {
    field_id: field.id,
    field_type: field.type,
    relationships: [],
    source,
    ...(collectionLayerId ? { collection_layer_id: collectionLayerId } : {}),
    ...(source === 'global' ? { global_id: field.id } : {}),
    ...(format ? { format } : {}),
  };
}

/** Error for a field id that the binding source does not expose. */
export function fieldNotFoundError(fieldId: string, source: BindingSource): string {
  if (source === 'global') return `Global variable "${fieldId}" not found. Call list_global_variables for ids.`;
  return `Field "${fieldId}" not found in the ${source === 'page' ? 'page' : 'list'} collection.`;
}

/** Wrap a field variable in the `<ycode-inline-variable>` tag used in dynamic-text strings. */
export function inlineVariableTag(fieldData: FieldData): string {
  return `<ycode-inline-variable>${JSON.stringify({ type: 'field', data: fieldData })}</ycode-inline-variable>`;
}

/** A single Tiptap inline node representing a bound field. */
export function dynamicVariableNode(fieldData: FieldData, label: string) {
  return { type: 'dynamicVariable', attrs: { variable: { type: 'field', data: fieldData }, label } };
}

/** Wrap inline nodes in a single-paragraph Tiptap doc. */
export function paragraphDoc(content: Record<string, unknown>[]) {
  return { type: 'doc', content: [{ type: 'paragraph', content }] };
}

/** A literal or a CMS field / global variable reference inside dynamic text. */
export type DynamicTextSegment =
  | { type: 'text'; text: string }
  | { type: 'field'; field_id: string; format?: string };

/**
 * Build a single-paragraph Tiptap doc interleaving literal text and bound
 * fields. Errors when a field is missing from `fieldsById` or no segment is a field.
 */
export function buildDynamicTextDoc(
  segments: DynamicTextSegment[],
  fieldsById: Map<string, CollectionField>,
  source: BindingSource,
  collectionLayerId: string | undefined,
): { doc: ReturnType<typeof paragraphDoc>; fieldCount: number } | { error: string } {
  const content: Record<string, unknown>[] = [];
  let fieldCount = 0;
  for (const seg of segments) {
    if (seg.type === 'text') {
      if (seg.text) content.push({ type: 'text', text: seg.text });
      continue;
    }
    const field = fieldsById.get(seg.field_id);
    if (!field) {
      return { error: fieldNotFoundError(seg.field_id, source) };
    }
    content.push(dynamicVariableNode(buildFieldData(field, source, collectionLayerId, seg.format), field.name));
    fieldCount += 1;
  }
  if (fieldCount === 0) {
    return { error: 'Provide at least one "field" segment (use plain static text for non-dynamic content).' };
  }
  return { doc: paragraphDoc(content), fieldCount };
}

/** Build a Tiptap rich-text doc that renders optional prefix/suffix around a bound field. */
export function buildBoundTextDoc(fieldData: FieldData, label: string, prefix?: string, suffix?: string) {
  const content: Record<string, unknown>[] = [];
  if (prefix) content.push({ type: 'text', text: prefix });
  content.push(dynamicVariableNode(fieldData, label));
  if (suffix) content.push({ type: 'text', text: suffix });
  return paragraphDoc(content);
}

/** Layer types whose href can come from a link / email / phone field. */
const LINKABLE_LAYER_NAMES = new Set(['a', 'button', 'link']);

/**
 * Pure part of the binding: writes the field variable into the layer slot that
 * matches the target (text, image src/alt, video src/poster, audio, background,
 * or the link of a button / anchor). Returns an error when the layer type has
 * no such slot.
 */
export function applyFieldBinding(
  layer: Layer,
  field: CollectionField,
  fieldData: FieldData,
  input: { target: BindingTarget; prefix?: string; suffix?: string },
): { layer: Layer; summary: string; field: CollectionField } | { error: string } {
  const { target, prefix, suffix } = input;
  const isText = BINDABLE_TEXT_LAYER_NAMES.has(layer.name);

  let nextVariables: Layer['variables'];
  let summary: string;

  if (target === 'background') {
    nextVariables = { ...layer.variables, backgroundImage: { src: { type: 'field', data: fieldData } } };
    summary = `background image → "${field.name}"`;
  } else if (isText && (target === 'auto' || target === 'src')) {
    nextVariables = {
      ...layer.variables,
      text: { type: 'dynamic_rich_text', data: { content: buildBoundTextDoc(fieldData, field.name, prefix, suffix) } },
    };
    summary = `text → "${field.name}"`;
  } else if (layer.name === 'image') {
    const existing = layer.variables?.image;
    if (target === 'alt') {
      nextVariables = {
        ...layer.variables,
        image: {
          src: existing?.src ?? { type: 'asset', data: { asset_id: null } },
          alt: { type: 'dynamic_text', data: { content: `${prefix ?? ''}${inlineVariableTag(fieldData)}${suffix ?? ''}` } },
        },
      };
      summary = `image alt → "${field.name}"`;
    } else {
      nextVariables = {
        ...layer.variables,
        image: {
          src: { type: 'field', data: fieldData },
          alt: existing?.alt ?? { type: 'dynamic_text', data: { content: '' } },
        },
      };
      summary = `image src → "${field.name}"`;
    }
  } else if (layer.name === 'video') {
    const existing = layer.variables?.video;
    if (target === 'poster') {
      nextVariables = { ...layer.variables, video: { ...existing, poster: { type: 'field', data: fieldData } } };
      summary = `video poster → "${field.name}"`;
    } else {
      nextVariables = { ...layer.variables, video: { ...existing, src: { type: 'field', data: fieldData } } };
      summary = `video src → "${field.name}"`;
    }
  } else if (layer.name === 'audio') {
    nextVariables = { ...layer.variables, audio: { ...layer.variables?.audio, src: { type: 'field', data: fieldData } } };
    summary = `audio src → "${field.name}"`;
  } else if (target === 'auto' && (LINKABLE_LAYER_NAMES.has(layer.name) || layer.variables?.link)) {
    const existing = layer.variables?.link;
    nextVariables = {
      ...layer.variables,
      link: {
        type: 'field',
        field: { type: 'field', data: fieldData },
        ...(existing?.target ? { target: existing.target } : {}),
        ...(existing?.rel ? { rel: existing.rel } : {}),
      },
    };
    summary = `link → "${field.name}"`;
  } else {
    return {
      error: `Layer "${layer.customName || layer.name}" (${layer.name}) cannot bind a "${target}" field. Use a text, heading, image, video, audio, or linked layer, or target "background".`,
    };
  }

  const next = { ...layer, variables: nextVariables };
  // Background bindings also need the design/classes that render the
  // --bg-img variable, otherwise the bound image never displays.
  return { layer: target === 'background' ? applyBackgroundImageDesign(next) : next, summary, field };
}
