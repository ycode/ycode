/**
 * CMS Variables Utilities
 *
 * Utilities for parsing and converting CMS variable strings
 * Format: <ycode-inline-variable>{"type":"field","data":{"field_id":"..."}}</ycode-inline-variable>
 */

import type { CollectionField, InlineVariable } from '@/types';
import { isDateFieldType } from '@/lib/collection-field-utils';
import { formatDateInTimezone } from '@/lib/date-format-utils';
import { extractPlainTextFromTiptap } from '@/lib/tiptap-utils';
import { formatDateWithPreset, formatNumberWithPreset } from '@/lib/variable-format-utils';

/**
 * Format a field value for display based on field type
 * - date: formats in user's timezone (with optional format preset)
 * - number: formats with optional number preset
 * - rich_text: extracts plain text from Tiptap JSON
 * Returns the original value for other fields
 * @param format - Optional format preset ID (e.g. 'date-long', 'number-decimal')
 */
export function formatFieldValue(
  value: unknown,
  fieldType: string | null | undefined,
  timezone: string = 'UTC',
  format?: string
): string {
  if (value === null || value === undefined) return '';

  // Handle rich_text fields - extract plain text from Tiptap JSON
  if (fieldType === 'rich_text') {
    if (typeof value === 'object') {
      return extractPlainTextFromTiptap(value);
    }
    if (typeof value === 'string') {
      try {
        const parsed = JSON.parse(value);
        return extractPlainTextFromTiptap(parsed);
      } catch {
        return value;
      }
    }
    return '';
  }

  // Handle date fields with optional format preset
  if (isDateFieldType(fieldType) && typeof value === 'string') {
    if (format) {
      return formatDateWithPreset(value, format, timezone);
    }
    return formatDateInTimezone(value, timezone, 'display');
  }

  // Handle number fields with optional format preset
  if (fieldType === 'number' && format) {
    const numValue = typeof value === 'number' ? value : parseFloat(String(value));
    if (!isNaN(numValue)) {
      return formatNumberWithPreset(numValue, format);
    }
  }

  // For other fields, ensure we return a string
  if (typeof value === 'object') {
    return JSON.stringify(value);
  }

  return String(value);
}

/**
 * Resolve a field value from data sources based on source preference
 * Used for inline variables with page/collection source selection
 *
 * @param fieldId - The field ID (or field path for nested references)
 * @param source - Optional source preference ('page' | 'collection')
 * @param collectionItemData - Merged collection layer data
 * @param pageCollectionItemData - Page collection data for dynamic pages
 * @param collectionLayerId - Optional specific collection layer ID (for layer-specific resolution)
 * @param layerDataMap - Optional map of layer ID → item data (for layer-specific resolution)
 */
export function resolveFieldFromSources(
  fieldId: string,
  source: string | undefined,
  collectionItemData?: Record<string, string>,
  pageCollectionItemData?: Record<string, string> | null,
  collectionLayerId?: string,
  layerDataMap?: Record<string, Record<string, string>>
): string | undefined {
  // Page source - use page data only
  if (source === 'page') {
    return pageCollectionItemData?.[fieldId];
  }

  // Current User source - use simulated or actual user data from map
  if (source === 'current_user') {
    return layerDataMap?.current_user?.[fieldId];
  }

  // If specific layer ID is provided and exists in layerDataMap, use that layer's data
  if (collectionLayerId && layerDataMap?.[collectionLayerId]) {
    return layerDataMap[collectionLayerId][fieldId];
  }

  // Collection source - use merged collection data
  if (source === 'collection') {
    return collectionItemData?.[fieldId];
  }

  // No explicit source - check collection first, then page (backwards compatibility)
  return collectionItemData?.[fieldId] ?? pageCollectionItemData?.[fieldId];
}

/**
 * Gets the display label for a variable based on its type and data
 * - Root fields: just "FieldName"
 * - Nested fields: "SourceName FieldName" (source = immediate parent reference)
 */
export function getVariableLabel(
  variable: InlineVariable,
  fields?: CollectionField[],
  allFields?: Record<string, CollectionField[]>
): string {
  if (variable.type === 'field' && variable.data?.field_id) {
    const rootField = fields?.find(f => f.id === variable.data.field_id);
    const relationships = variable.data.relationships || [];

    if (relationships.length > 0 && allFields) {
      // For nested references, show "SourceName FieldName"
      // where SourceName is the immediate parent reference field
      let sourceName = rootField?.name || '[Deleted]';
      let currentFields = rootField?.reference_collection_id
        ? allFields[rootField.reference_collection_id]
        : [];
      let finalFieldName = '';

      for (let i = 0; i < relationships.length; i++) {
        const relId = relationships[i];
        const relField = currentFields?.find(f => f.id === relId);

        if (i === relationships.length - 1) {
          // Last field in chain - this is the actual field we're selecting
          finalFieldName = relField?.name || '[Deleted]';
        } else {
          // Intermediate reference - update source name
          sourceName = relField?.name || '[Deleted]';
          currentFields = relField?.reference_collection_id
            ? allFields[relField.reference_collection_id]
            : [];
        }
      }

      return `${sourceName} ${finalFieldName}`;
    }

    return rootField?.name || '[Deleted Field]';
  }
  return variable.type;
}

/**
 * Extract a single attribute value from a span attribute string.
 * Supports both " and ' quoted values.
 */
function getAttr(attrs: string, name: string): string | null {
  const m = attrs.match(new RegExp(`${name}=["']([^"']*)["']`));
  return m ? m[1] : null;
}

/** Loose check for a CMS field UUID-like identifier. */
function looksLikeUuid(id: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
}

/**
 * Build the canonical <ycode-inline-variable> tag from a field id and label.
 * Embeds an explicit label so the pill renders even when the field can't be looked up.
 */
function buildCanonicalVariable(fieldId: string, label: string, fieldType: string = 'text'): string {
  const variable = {
    type: 'field',
    data: { field_id: fieldId, field_type: fieldType },
    label,
  };
  return `<ycode-inline-variable>${JSON.stringify(variable)}</ycode-inline-variable>`;
}

/**
 * Replace all matches of `regex` only outside of existing <ycode-inline-variable>...</ycode-inline-variable> tags.
 * This prevents re-wrapping already-normalized content.
 */
function replaceOutsideCanonical(text: string, regex: RegExp, replacer: (match: string, ...groups: string[]) => string): string {
  const canonical = /<ycode-inline-variable[^>]*>[\s\S]*?<\/ycode-inline-variable>/g;
  const segments: { text: string; isCanonical: boolean }[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = canonical.exec(text)) !== null) {
    if (m.index > last) segments.push({ text: text.slice(last, m.index), isCanonical: false });
    segments.push({ text: m[0], isCanonical: true });
    last = canonical.lastIndex;
  }
  if (last < text.length) segments.push({ text: text.slice(last), isCanonical: false });

  return segments
    .map((seg) => (seg.isCanonical ? seg.text : seg.text.replace(regex, replacer as any)))
    .join('');
}

/**
 * Normalize all known legacy inline variable formats to the canonical
 * <ycode-inline-variable>JSON</ycode-inline-variable> format.
 *
 * Handles:
 * - <span y_dynamic_variable="true" y_fieldtype="..." y_fieldname="..." y_name="...">...</span>
 * - <span y_variable="ID" y_name="Label" ...>...</span> (any attr order)
 * - <span y_variable="ID">...</span> (no label)
 * - <span data-variable="JSON">label</span>
 * - Raw JSON variable objects embedded in text: {"type":"field","data":{...}}
 *
 * Important: each pass operates only on text outside existing canonical tags,
 * so already-normalized content is never re-wrapped.
 */
function normalizeInlineVariableFormats(text: string): string {
  // 0. Convert self-closing <ycode-inline-variable .../> to open/close form
  text = text.replace(
    /<ycode-inline-variable\b([^>]*?)\/>/g,
    '<ycode-inline-variable$1></ycode-inline-variable>'
  );

  // 1. <span ...y_dynamic_variable="true" ...>...</span>
  text = replaceOutsideCanonical(
    text,
    /<span\b([^>]*\by_dynamic_variable=["']true["'][^>]*)>([\s\S]*?)<\/span>/g,
    (_full: string, attrs: string) => {
      const fieldId = getAttr(attrs, 'y_fieldname') || getAttr(attrs, 'y_variable') || '';
      const fieldType = getAttr(attrs, 'y_fieldtype') || 'text';
      const label = getAttr(attrs, 'y_name') || fieldId || 'variable';
      return buildCanonicalVariable(fieldId, label, fieldType);
    }
  );

  // 2. <span ...y_variable="ID" ...>...</span> (and any reordered attrs with y_name)
  text = replaceOutsideCanonical(
    text,
    /<span\b([^>]*\by_variable=["']([^"']+)["'][^>]*)>([\s\S]*?)<\/span>/g,
    (_full: string, attrs: string, fieldId: string) => {
      const explicitLabel = getAttr(attrs, 'y_name') || getAttr(attrs, 'y_fieldname');
      // y_variable is a layer-local short ID (not a CMS field UUID). When no explicit
      // label is available, fall back to a generic name rather than the cryptic id.
      const label = explicitLabel || (looksLikeUuid(fieldId) ? fieldId : 'Variable');
      const fieldType = getAttr(attrs, 'y_fieldtype') || 'text';
      return buildCanonicalVariable(fieldId, label, fieldType);
    }
  );

  // 3. <span data-variable="JSON">label</span> (TipTap HTML serialization)
  text = replaceOutsideCanonical(
    text,
    /<span\b[^>]*\bdata-variable=["']([^"']*)["'][^>]*>([\s\S]*?)<\/span>/g,
    (full: string, encoded: string, label: string) => {
      const decoded = encoded.replace(/&quot;/g, '"').replace(/&amp;/g, '&');
      try {
        const parsed = JSON.parse(decoded);
        if (parsed?.type && parsed?.data) {
          if (!parsed.label && label) parsed.label = label.trim();
          return `<ycode-inline-variable>${JSON.stringify(parsed)}</ycode-inline-variable>`;
        }
      } catch { /* not valid JSON */ }
      return full;
    }
  );

  // 4. Raw JSON variable objects embedded in text (only outside canonical tags)
  text = transformOutsideCanonical(text, transformRawJsonVariables);

  return text;
}

/**
 * Walk the text and convert any embedded `{"type":"...","data":{"field_id":"..."},...}`
 * JSON object into the canonical <ycode-inline-variable> form, leaving other text intact.
 */
function transformRawJsonVariables(segment: string): string {
  if (!segment.includes('{"type":"')) return segment;
  let result = '';
  let i = 0;
  while (i < segment.length) {
    if (segment[i] === '{' && segment.startsWith('{"type":"', i)) {
      let depth = 0;
      let consumed = false;
      for (let j = i; j < segment.length; j++) {
        if (segment[j] === '{') depth++;
        else if (segment[j] === '}') {
          depth--;
          if (depth === 0) {
            const jsonStr = segment.slice(i, j + 1);
            try {
              const parsed = JSON.parse(jsonStr);
              if (parsed?.type && parsed?.data && (parsed.data.field_id || parsed.data.fieldId)) {
                const fieldId = parsed.data.field_id || parsed.data.fieldId;
                const fieldType = parsed.data.field_type || parsed.data.fieldType || 'text';
                const label = parsed.label || fieldId || 'variable';
                result += buildCanonicalVariable(fieldId, label, fieldType);
                i = j + 1;
                consumed = true;
              }
            } catch { /* not valid JSON */ }
            break;
          }
        }
      }
      if (!consumed) {
        result += segment[i];
        i++;
      }
    } else {
      result += segment[i];
      i++;
    }
  }
  return result;
}

/**
 * Apply a transform function to each text segment outside of canonical tags.
 */
function transformOutsideCanonical(text: string, transform: (segment: string) => string): string {
  const canonical = /<ycode-inline-variable[^>]*>[\s\S]*?<\/ycode-inline-variable>/g;
  const parts: string[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = canonical.exec(text)) !== null) {
    if (m.index > last) parts.push(transform(text.slice(last, m.index)));
    parts.push(m[0]);
    last = canonical.lastIndex;
  }
  if (last < text.length) parts.push(transform(text.slice(last)));
  return parts.join('');
}

/**
 * Converts string with variables to Tiptap JSON content
 * Supports both ID-based format and legacy embedded JSON format
 * ID-based: <ycode-inline-variable id="uuid"></ycode-inline-variable>
 * Legacy: <ycode-inline-variable>JSON</ycode-inline-variable>
 */
export function parseValueToContent(
  text: string,
  fields?: CollectionField[],
  variables?: Record<string, InlineVariable>,
  allFields?: Record<string, CollectionField[]>
): {
  type: 'doc';
  content: Array<{
    type: 'paragraph';
    content?: any[];
  }>;
} {
  // Normalize all known variable formats before parsing
  text = normalizeInlineVariableFormats(text);

  const content: any[] = [];
  const regex = /<ycode-inline-variable(?:\s+id="([^"]+)")?>([\s\S]*?)<\/ycode-inline-variable>/g;
  let lastIndex = 0;
  let match;

  while ((match = regex.exec(text)) !== null) {
    // Add text before the match
    if (match.index > lastIndex) {
      const textContent = text.slice(lastIndex, match.index);
      if (textContent) {
        content.push({
          type: 'text',
          text: textContent,
        });
      }
    }

    const variableId = match[1]; // ID from id="..." attribute
    const variableContent = match[2].trim(); // Content inside tag
    let variable: InlineVariable | null = null;
    let label: string = 'variable';

    // Priority 1: Look up by ID if provided and variables map exists
    if (variableId && variables && variables[variableId]) {
      variable = variables[variableId];
      label = getVariableLabel(variable, fields, allFields);
    }
    // Priority 2: Parse embedded JSON (legacy format)
    else if (variableContent) {
      try {
        const parsed = JSON.parse(variableContent);
        if (parsed.type && parsed.data) {
          variable = parsed;
          const resolvedLabel = getVariableLabel(parsed, fields, allFields);
          // Prefer an explicit embedded label when field lookup couldn't resolve a real name
          // (returns 'field' for unknown types or '[Deleted Field]' when field id missing)
          if (parsed.label && (resolvedLabel === 'field' || resolvedLabel === '[Deleted Field]')) {
            label = parsed.label;
          } else {
            label = resolvedLabel;
          }
        }
      } catch {
        // Invalid JSON, skip this variable
      }
    }

    if (variable) {
      content.push({
        type: 'dynamicVariable',
        attrs: {
          variable,
          label,
        },
      });
    }

    lastIndex = regex.lastIndex;
  }

  // Add remaining text
  if (lastIndex < text.length) {
    const textContent = text.slice(lastIndex);
    if (textContent) {
      content.push({
        type: 'text',
        text: textContent,
      });
    }
  }

  return {
    type: 'doc',
    content: [
      {
        type: 'paragraph',
        content: content.length > 0 ? content : undefined,
      },
    ],
  };
}

/**
 * Converts Tiptap JSON content back to string
 * Outputs format: <ycode-inline-variable>{"type":"field","data":{"field_id":"..."}}</ycode-inline-variable>
 */
export function convertContentToValue(content: any): string {
  let result = '';

  if (content?.content) {
    for (const block of content.content) {
      if (block.content) {
        for (const node of block.content) {
          if (node.type === 'text') {
            result += node.text;
          } else if (node.type === 'dynamicVariable') {
            if (node.attrs.variable) {
              result += `<ycode-inline-variable>${JSON.stringify(node.attrs.variable)}</ycode-inline-variable>`;
            }
          }
        }
      }
    }
  }

  return result;
}
