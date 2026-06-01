/**
 * Collection Field Utils
 *
 * Centralized utilities for collection field types and operators.
 * Used across CMS components for consistent field type handling.
 */

import type { IconProps } from '@/components/ui/icon';
import type {
  Asset,
  AssetCategory,
  AssetCategoryFilter,
  CollectionField,
  CollectionFieldType,
  CollectionItemWithValues,
  CollectionVariable,
  Layer,
  VisibilityOperator,
} from '@/types';
import { ASSET_CATEGORIES, isAssetOfType } from '@/lib/asset-utils';
import { findAllParentCollectionLayers, getCollectionVariable } from '@/lib/layer-utils';

// =============================================================================
// Field Types Configuration
// =============================================================================

/** Check if a field type stores date/datetime values (date or date_only) */
export function isDateFieldType(type: CollectionFieldType | string | null | undefined): boolean {
  return type === 'date' || type === 'date_only';
}

/** Field type category for grouping in the type selector */
export type FieldTypeCategory = 'basic' | 'contact' | 'asset' | 'relation';

export const FIELD_TYPE_CATEGORIES: { id: FieldTypeCategory; label: string }[] = [
  { id: 'basic', label: 'Basic' },
  { id: 'contact', label: 'Contact' },
  { id: 'asset', label: 'Assets' },
  { id: 'relation', label: 'Relations' },
];

export const FIELD_TYPES = [
  { value: 'text', label: 'Text', icon: 'text', category: 'basic', hasDefault: true },
  { value: 'rich_text', label: 'Rich text', icon: 'rich-text', category: 'basic', hasDefault: true },
  { value: 'number', label: 'Number', icon: 'hash', category: 'basic', hasDefault: true },
  { value: 'boolean', label: 'Boolean', icon: 'check', category: 'basic', hasDefault: true },
  { value: 'date', label: 'Date & Time', icon: 'calendar', category: 'basic', hasDefault: true },
  { value: 'date_only', label: 'Date', icon: 'calendar', category: 'basic', hasDefault: true },
  { value: 'color', label: 'Color', icon: 'droplet', category: 'basic', hasDefault: true },
  { value: 'option', label: 'Option', icon: 'select', category: 'basic', hasDefault: true },
  { value: 'email', label: 'Email', icon: 'email', category: 'contact', hasDefault: true },
  { value: 'phone', label: 'Phone', icon: 'phone', category: 'contact', hasDefault: true },
  { value: 'link', label: 'Link', icon: 'link', category: 'contact', hasDefault: true },
  { value: 'image', label: 'Image', icon: 'image', category: 'asset', hasDefault: true },
  { value: 'audio', label: 'Audio', icon: 'audio', category: 'asset', hasDefault: true },
  { value: 'video', label: 'Video', icon: 'video', category: 'asset', hasDefault: true },
  { value: 'document', label: 'Document', icon: 'file-text', category: 'asset', hasDefault: true },
  { value: 'reference', label: 'Reference', icon: 'database', category: 'relation', hasDefault: false },
  { value: 'multi_reference', label: 'Multi-reference', icon: 'database', category: 'relation', hasDefault: false },
  { value: 'count', label: 'Count', icon: 'hash', category: 'relation', hasDefault: false },
] as const satisfies readonly { value: string; label: string; icon: string; category: FieldTypeCategory; hasDefault: boolean }[];

export type FieldType = (typeof FIELD_TYPES)[number]['value'];

/** Field types grouped by category (preserves order from FIELD_TYPE_CATEGORIES) */
export const FIELD_TYPES_BY_CATEGORY = FIELD_TYPE_CATEGORIES.map(cat => ({
  ...cat,
  types: FIELD_TYPES.filter(t => t.category === cat.id),
}));

/** Valid field type values for API validation (includes system types like 'status') */
export const VALID_FIELD_TYPES: readonly string[] = [...FIELD_TYPES.map((t) => t.value), 'status'];

/** Check if a field type supports setting a default value */
export function supportsDefaultValue(fieldType: CollectionFieldType | undefined): boolean {
  return FIELD_TYPES.some(t => t.value === fieldType && t.hasDefault);
}

/** Field types that can be displayed in variable selectors (excludes multi_reference) */
export const DISPLAYABLE_FIELD_TYPES: CollectionFieldType[] = FIELD_TYPES
  .filter(t => t.value !== 'multi_reference')
  .map(t => t.value) as CollectionFieldType[];

/** Check if a string is a valid field type */
export function isValidFieldType(type: string): type is FieldType {
  return VALID_FIELD_TYPES.includes(type);
}

const FIELD_TYPES_BY_VALUE: Record<FieldType, (typeof FIELD_TYPES)[number]> =
  Object.fromEntries(FIELD_TYPES.map((t) => [t.value, t])) as Record<
    FieldType,
    (typeof FIELD_TYPES)[number]
  >;

/** Get icon name for field type. Returns `defaultIcon` for invalid field types. */
export function getFieldIcon(
  fieldType: CollectionFieldType | undefined,
  defaultIcon: IconProps['name'] = 'text'
): IconProps['name'] {
  if (!fieldType) return defaultIcon;
  return FIELD_TYPES_BY_VALUE[fieldType as FieldType]?.icon ?? defaultIcon;
}

/** Get human-readable label for a field type (e.g. 'date_only' → 'Date') */
export function getFieldTypeLabel(fieldType: CollectionFieldType | string): string {
  return FIELD_TYPES_BY_VALUE[fieldType as FieldType]?.label ?? fieldType;
}

// =============================================================================
// Field Operators Configuration
// =============================================================================

export interface OperatorOption {
  value: VisibilityOperator;
  label: string;
}

export const TEXT_OPERATORS: OperatorOption[] = [
  { value: 'is', label: 'is' },
  { value: 'is_not', label: 'is not' },
  { value: 'contains', label: 'contains' },
  { value: 'does_not_contain', label: 'does not contain' },
  { value: 'is_present', label: 'is present' },
  { value: 'is_empty', label: 'is empty' },
];

export const NUMBER_OPERATORS: OperatorOption[] = [
  { value: 'is', label: 'is' },
  { value: 'is_not', label: 'is not' },
  { value: 'lt', label: 'is less than' },
  { value: 'lte', label: 'is less than or equal to' },
  { value: 'gt', label: 'is more than' },
  { value: 'gte', label: 'is more than or equal to' },
];

export const DATE_OPERATORS: OperatorOption[] = [
  { value: 'is', label: 'is' },
  { value: 'is_before', label: 'is before' },
  { value: 'is_after', label: 'is after' },
  { value: 'is_between', label: 'is between' },
  { value: 'is_empty', label: 'is empty' },
  { value: 'is_not_empty', label: 'is not empty' },
];

export const BOOLEAN_OPERATORS: OperatorOption[] = [{ value: 'is', label: 'is' }];

export const REFERENCE_OPERATORS: OperatorOption[] = [
  { value: 'is_one_of', label: 'is one of' },
  { value: 'is_not_one_of', label: 'is not one of' },
  { value: 'exists', label: 'exists' },
  { value: 'does_not_exist', label: 'does not exist' },
];

export const MULTI_REFERENCE_OPERATORS: OperatorOption[] = [
  { value: 'is_one_of', label: 'is one of' },
  { value: 'is_not_one_of', label: 'is not one of' },
  { value: 'contains_all_of', label: 'contains all of' },
  { value: 'contains_exactly', label: 'contains exactly' },
  { value: 'item_count', label: 'item count' },
  { value: 'has_items', label: 'has items' },
  { value: 'has_no_items', label: 'has no items' },
];

export const PAGE_COLLECTION_OPERATORS: OperatorOption[] = [
  { value: 'item_count', label: 'item count' },
  { value: 'has_items', label: 'has items' },
  { value: 'has_no_items', label: 'has no items' },
];

/** Operators available when filtering an item against its own ID (source: 'self'). */
export const SELF_OPERATORS: OperatorOption[] = [
  { value: 'is_one_of', label: 'is one of' },
  { value: 'is_not_one_of', label: 'is not one of' },
];

export const COMPARE_OPERATORS: { value: string; label: string }[] = [
  { value: 'eq', label: 'equals' },
  { value: 'lt', label: 'less than' },
  { value: 'lte', label: 'less than or equal' },
  { value: 'gt', label: 'greater than' },
  { value: 'gte', label: 'greater than or equal' },
];

/** Get operators available for a given field type */
export function getOperatorsForFieldType(
  fieldType: CollectionFieldType | undefined
): OperatorOption[] {
  switch (fieldType) {
    case 'number':
    case 'count':
      return NUMBER_OPERATORS;
    case 'date':
    case 'date_only':
      return DATE_OPERATORS;
    case 'boolean':
      return BOOLEAN_OPERATORS;
    case 'reference':
    case 'image':
    case 'audio':
    case 'video':
    case 'document':
      return REFERENCE_OPERATORS;
    case 'multi_reference':
      return MULTI_REFERENCE_OPERATORS;
    case 'color':
    case 'text':
    case 'rich_text':
    case 'email':
    case 'phone':
    default:
      return TEXT_OPERATORS;
  }
}

/** Check if operator requires a value input */
export function operatorRequiresValue(operator: VisibilityOperator): boolean {
  return ![
    'is_present',
    'is_empty',
    'is_not_empty',
    'has_items',
    'has_no_items',
    'exists',
    'does_not_exist',
  ].includes(operator);
}

/** Check if operator requires collection item selection */
export function operatorRequiresItemSelection(operator: VisibilityOperator): boolean {
  return ['is_one_of', 'is_not_one_of', 'contains_all_of', 'contains_exactly'].includes(
    operator
  );
}

/**
 * Parse a JSON-stringified array of item IDs (used by reference / self conditions).
 * Returns an empty array for unset, malformed, or non-array values so callers
 * can always `for…of` the result without extra guards.
 */
export function parseItemIdList(value: string | undefined | null): string[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === 'string') : [];
  } catch {
    return [];
  }
}

/** Check if operator requires a second value (for date ranges) */
export function operatorRequiresSecondValue(operator: VisibilityOperator): boolean {
  return operator === 'is_between';
}

// =============================================================================
// Date Filter Presets
// =============================================================================

export interface DatePresetOption {
  value: string;
  label: string;
}

export const DATE_PRESET_OPTIONS: DatePresetOption[] = [
  { value: '$today', label: 'Today' },
  { value: '$this_week', label: 'This week' },
  { value: '$this_month', label: 'This month' },
  { value: '$this_year', label: 'This year' },
  { value: '$past_week', label: 'In the past week' },
  { value: '$past_month', label: 'In the past month' },
  { value: '$past_year', label: 'In the past year' },
];

export function isDatePreset(value: string | undefined): boolean {
  return !!value && value.startsWith('$');
}

/**
 * Resolve a date preset string to a concrete YYYY-MM-DD date (or date pair for
 * range presets). Returns `null` for non-preset values.
 */
export function resolveDatePreset(preset: string): { start: string; end: string } | null {
  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = now.getMonth();
  const dd = now.getDate();

  const fmt = (d: Date) => d.toISOString().slice(0, 10);

  switch (preset) {
    case '$today':
      return { start: fmt(new Date(yyyy, mm, dd)), end: fmt(new Date(yyyy, mm, dd)) };
    case '$this_week': {
      const day = now.getDay();
      const monday = new Date(yyyy, mm, dd - ((day + 6) % 7));
      const sunday = new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + 6);
      return { start: fmt(monday), end: fmt(sunday) };
    }
    case '$this_month':
      return { start: fmt(new Date(yyyy, mm, 1)), end: fmt(new Date(yyyy, mm + 1, 0)) };
    case '$this_year':
      return { start: fmt(new Date(yyyy, 0, 1)), end: fmt(new Date(yyyy, 11, 31)) };
    case '$past_week':
      return { start: fmt(new Date(yyyy, mm, dd - 7)), end: fmt(new Date(yyyy, mm, dd)) };
    case '$past_month':
      return { start: fmt(new Date(yyyy, mm - 1, dd)), end: fmt(new Date(yyyy, mm, dd)) };
    case '$past_year':
      return { start: fmt(new Date(yyyy - 1, mm, dd)), end: fmt(new Date(yyyy, mm, dd)) };
    default:
      return null;
  }
}

/**
 * Resolve a filter value that may be a date preset into operator + concrete
 * value(s) suitable for the filter API. Presets always widen to `is_between`
 * so the full day(s) are captured; plain values are returned as-is.
 */
export function resolveDateFilterValue(
  operator: string,
  value: string | undefined,
  value2: string | undefined,
): { operator: string; value: string; value2?: string } | null {
  if (!value) return null;
  if (!isDatePreset(value)) return { operator, value, value2 };
  const range = resolveDatePreset(value);
  if (!range) return { operator, value, value2 };

  switch (operator) {
    case 'is':
    case 'is_between':
      return { operator: 'is_between', value: range.start, value2: range.end };
    case 'is_before':
      return { operator: 'is_before', value: range.start };
    case 'is_after':
      return { operator: 'is_after', value: range.end };
    default:
      return { operator: 'is_between', value: range.start, value2: range.end };
  }
}

/**
 * True if a single condition compares a date field against a date preset
 * (e.g. `$today`). Such conditions resolve relative to the current date, so
 * the static export re-evaluates them client-side instead of baking the result.
 */
export function isDynamicDateCondition(
  condition: { source?: string; fieldType?: string; value?: string },
): boolean {
  if (condition.source !== 'collection_field') return false;
  if (!condition.fieldType || !isDateFieldType(condition.fieldType as CollectionFieldType)) return false;
  return isDatePreset(condition.value);
}

/**
 * True if a ConditionalVisibility expression contains any date-preset condition.
 * Used by the static export to detect rules that need client-side re-evaluation.
 */
export function hasDynamicDateRule(
  visibility:
    | { groups?: Array<{ conditions?: Array<{ source?: string; fieldType?: string; value?: string }> }> }
    | undefined
    | null,
): boolean {
  if (!visibility?.groups) return false;
  for (const group of visibility.groups) {
    if (!group.conditions) continue;
    for (const condition of group.conditions) {
      if (isDynamicDateCondition(condition)) return true;
    }
  }
  return false;
}

/** Match `YYYY-MM-DD` (the format emitted by `<input type="date">` and date presets). */
const DATE_ONLY_REGEX = /^\d{4}-\d{2}-\d{2}$/;

export function isDateOnlyString(value: string | undefined | null): boolean {
  return !!value && DATE_ONLY_REGEX.test(value);
}

/**
 * Convert a filter date string to start/end-of-day UTC timestamps.
 * For `YYYY-MM-DD` inputs the range spans the entire UTC day so that filters
 * match datetime values (which are stored as full ISO strings) regardless of
 * the time component. For other inputs, both bounds equal the parsed
 * timestamp. Returns `null` if the input cannot be parsed.
 */
export function dateStringToDayBounds(
  value: string | undefined | null,
): { start: number; end: number } | null {
  if (!value) return null;
  if (isDateOnlyString(value)) {
    const start = Date.parse(`${value}T00:00:00.000Z`);
    const end = Date.parse(`${value}T23:59:59.999Z`);
    if (isNaN(start) || isNaN(end)) return null;
    return { start, end };
  }
  const ts = Date.parse(value);
  return isNaN(ts) ? null : { start: ts, end: ts };
}

/**
 * Compare a stored date/datetime value against a filter value using day-aware
 * semantics (so `is today` matches any timestamp on today's date).
 * Returns `false` if either value cannot be parsed.
 */
export function compareDateFilter(
  storedValue: string,
  operator: 'is' | 'is_before' | 'is_after' | 'is_between',
  filterValue: string,
  filterValue2?: string,
): boolean {
  const valueTs = Date.parse(storedValue);
  if (isNaN(valueTs)) return false;
  const bounds = dateStringToDayBounds(filterValue);
  if (!bounds) return false;

  switch (operator) {
    case 'is':
      return valueTs >= bounds.start && valueTs <= bounds.end;
    case 'is_before':
      return valueTs < bounds.start;
    case 'is_after':
      return valueTs > bounds.end;
    case 'is_between': {
      const bounds2 = dateStringToDayBounds(filterValue2);
      if (!bounds2) return false;
      return valueTs >= bounds.start && valueTs <= bounds2.end;
    }
  }
}

// =============================================================================
// Field Lookup Utilities
// =============================================================================

/** Find a field by ID from an array of fields */
export function findFieldById(
  fields: CollectionField[],
  fieldId: string
): CollectionField | undefined {
  return fields.find((f) => f.id === fieldId);
}

/** Get field name by ID. Returns 'Unknown field' if not found. */
export function getFieldName(fields: CollectionField[], fieldId: string): string {
  return findFieldById(fields, fieldId)?.name ?? 'Unknown field';
}

/** Find the computed status field ID for a collection's fields */
export function findStatusFieldId(fields: CollectionField[]): string | null {
  return fields.find(f => f.type === 'status' && f.is_computed)?.id ?? null;
}

/** Action types for changing an item's publish status */
export type StatusAction = 'draft' | 'stage' | 'publish';

/** Serialize a status value object to JSON for storage in item values */
export function buildStatusValue(isPublishable: boolean, isPublished: boolean, isModified = false): string {
  return JSON.stringify({ is_publishable: isPublishable, is_published: isPublished, is_modified: isModified });
}

/** Derive optimistic is_publishable/is_published flags from a status action */
export function getStatusFlagsFromAction(action: StatusAction): { isPublishable: boolean; isPublished: boolean } {
  return {
    isPublishable: action !== 'draft',
    isPublished: action === 'publish',
  };
}

/** Get field type by ID. Returns undefined if not found. */
export function getFieldType(
  fields: CollectionField[],
  fieldId: string
): CollectionFieldType | undefined {
  return findFieldById(fields, fieldId)?.type;
}

/** Check if field type is a reference type */
export function isReferenceType(fieldType: CollectionFieldType | undefined): boolean {
  return fieldType === 'reference' || fieldType === 'multi_reference';
}

/** Validate field value. Returns null if valid, error message if invalid. Only email and phone have validation. */
export function validateFieldValue(
  fieldType: CollectionFieldType,
  value: string
): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;

  switch (fieldType) {
    case 'email': {
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      return emailRegex.test(trimmed) ? null : 'Invalid email format';
    }
    case 'phone': {
      const phoneRegex = /^[\d\s-()+.']*$/;
      const digitCount = (trimmed.match(/\d/g) || []).length;
      if (!phoneRegex.test(trimmed) || digitCount < 7) {
        return 'Phone must contain at least 7 digits';
      }
      return null;
    }
    default:
      return null;
  }
}

// =============================================================================
// Display Field Utilities
// =============================================================================

/**
 * Find the best display field for a collection.
 * Priority: 'title' key → 'name' key → first fillable text field → first field
 */
export function findDisplayField(
  fields: CollectionField[]
): CollectionField | null {
  const titleField = fields.find((f) => f.key === 'title');
  if (titleField) return titleField;

  const nameField = fields.find((f) => f.key === 'name');
  if (nameField) return nameField;

  const textField = fields.find(
    (f) => (f.type === 'text' || f.type === 'email' || f.type === 'phone') && f.fillable
  );
  if (textField) return textField;

  return fields[0] ?? null;
}

/** Get display name for a collection item using the display field */
export function getItemDisplayName(
  item: CollectionItemWithValues,
  displayField: CollectionField | null
): string {
  if (!displayField) return 'Untitled';
  return item.values[displayField.id] || 'Untitled';
}

// =============================================================================
// Field Groups Utilities
// =============================================================================

/** Source of field data: 'page' for dynamic page data, 'collection' for collection layer data */
export type FieldSourceType = 'page' | 'collection';

/** A group of fields with a source, label, optional detail (e.g. collection name), and optional layer ID */
export interface FieldGroup {
  fields: CollectionField[];
  label?: string;
  /** Optional right-aligned detail (e.g. collection name) shown as shortcut style */
  detail?: string;
  source?: FieldSourceType;
  /** ID of the collection layer these fields belong to */
  layerId?: string;
}

/** Parent collection layer info for field groups */
export interface ParentCollectionLayer {
  layerId: string;
  collectionId: string;
}

/** Configuration for building field groups */
export interface BuildFieldGroupsConfig {
  /** Parent collection layers ordered by closest first (immediate parent → ancestors) */
  parentCollectionLayers: ParentCollectionLayer[];
  /** Current page (for dynamic page collection) */
  page?: { is_dynamic?: boolean; settings?: { cms?: { collection_id?: string } } } | null;
  /** All collection fields keyed by collection ID */
  fieldsByCollectionId: Record<string, CollectionField[]>;
  /** All collections for looking up names */
  collections: { id: string; name: string }[];
  /** Multi-asset collection context (when inside a multi-asset nested collection) */
  multiAssetContext?: { sourceFieldId: string; source: FieldSourceType } | null;
}

/**
 * Build field groups for multi-source field selection.
 * Returns groups for collection layer fields and/or page collection fields.
 */
export function buildFieldGroups(config: BuildFieldGroupsConfig): FieldGroup[] | undefined {
  const { parentCollectionLayers, page, fieldsByCollectionId, collections, multiAssetContext } = config;
  const groups: FieldGroup[] = [];
  const addedCollectionIds = new Set<string>();

  // Add multi-asset virtual fields if inside a multi-asset collection context.
  // Virtual asset field values live in the per-iteration item data only
  // (never in pageCollectionItemData), so always use 'collection' source —
  // even when the parent multi-image field itself is page-bound.
  if (multiAssetContext) {
    groups.push({
      fields: buildMultiAssetVirtualFields(),
      label: 'File fields',
      source: 'collection',
    });
  }

  // Add collection fields in order (closest first)
  for (let i = 0; i < parentCollectionLayers.length; i++) {
    const { layerId, collectionId } = parentCollectionLayers[i];
    // Skip multi-asset virtual collection and duplicates
    if (collectionId === MULTI_ASSET_COLLECTION_ID || addedCollectionIds.has(collectionId)) {
      continue;
    }

    const collectionFields = fieldsByCollectionId[collectionId] || [];
    const collection = collections.find(c => c.id === collectionId);
    if (collectionFields.length > 0) {
      const isClosest = i === 0;
      groups.push({
        fields: collectionFields,
        label: collection?.name ?? 'Collection',
        detail: isClosest ? 'Collection fields' : 'Parent fields',
        source: 'collection',
        layerId,
      });
      addedCollectionIds.add(collectionId);
    }
  }

  // Add page collection fields if on a dynamic page
  // Always add even if same collection as layer - page data differs from collection layer data
  if (page?.is_dynamic && page?.settings?.cms?.collection_id) {
    const pageCollectionId = page.settings.cms.collection_id;
    const pageCollectionFields = fieldsByCollectionId[pageCollectionId] || [];
    const pageCollection = collections.find(c => c.id === pageCollectionId);
    if (pageCollectionFields.length > 0) {
      groups.push({
        fields: pageCollectionFields,
        label: pageCollection?.name ?? 'Collection',
        detail: 'Page fields',
        source: 'page',
      });
    }
  }

  return groups.length > 0 ? groups : undefined;
}

/** Field types that can be used as link targets */
export const LINK_FIELD_TYPES: CollectionFieldType[] = ['link', 'email', 'phone', 'image', 'audio', 'video', 'document'];

/** Field types that store media assets (image, audio, video) */
export const MEDIA_FIELD_TYPES: CollectionFieldType[] = ['image', 'audio', 'video'];

/** Field types that store asset IDs (media + documents) */
export const ASSET_FIELD_TYPES: CollectionFieldType[] = ['image', 'audio', 'video', 'document'];

/** Field types that can be bound to color design properties */
export const COLOR_FIELD_TYPES: CollectionFieldType[] = ['color'];

/** Field types that can be bound to image layers (image fields) */
export const IMAGE_FIELD_TYPES: CollectionFieldType[] = ['image'];

/** Field types that can be bound to audio layers (audio fields) */
export const AUDIO_FIELD_TYPES: CollectionFieldType[] = ['audio'];

/** Field types that can be bound to video layers (video) */
export const VIDEO_FIELD_TYPES: CollectionFieldType[] = ['video'];

/** Field types that contain plain text values (for YouTube video IDs, etc.) */
export const VIDEO_ID_FIELD_TYPES: CollectionFieldType[] = ['text'];

/** Field types that can be bound to simple text content (excludes rich_text and media/asset types) */
export const SIMPLE_TEXT_FIELD_TYPES: CollectionFieldType[] = ['text', 'number', 'date', 'date_only', 'email', 'phone', 'option', 'count'];

/** Field types that can be bound to rich text content (excludes media/asset types) */
export const RICH_TEXT_FIELD_TYPES: CollectionFieldType[] = [...SIMPLE_TEXT_FIELD_TYPES, 'rich_text'];

/** Field types for richText layer CMS bindings (only rich_text) */
export const RICH_TEXT_ONLY_FIELD_TYPES: CollectionFieldType[] = ['rich_text'];

/** Field types that can be bound to link layers for downloads (document fields) */
export const DOCUMENT_FIELD_TYPES: CollectionFieldType[] = ['document'];

/** Check if a field type uses asset selector (image, audio, video, document) */
export function isAssetFieldType(fieldType: CollectionFieldType | undefined | null): boolean {
  return fieldType != null && ASSET_FIELD_TYPES.includes(fieldType);
}

/** Check if a field type is a media type (image, audio, video) */
export function isMediaFieldType(fieldType: CollectionFieldType | undefined | null): boolean {
  return fieldType != null && MEDIA_FIELD_TYPES.includes(fieldType);
}

/** Check if a field allows multiple assets */
export function isMultipleAssetField(field: CollectionField): boolean {
  return isAssetFieldType(field.type) && field.data?.multiple === true;
}

// -- Asset field category / label / validation helpers --

/** Map an asset field type to a single ASSET_CATEGORIES value */
export function getAssetCategoryForField(fieldType: CollectionFieldType): AssetCategory {
  switch (fieldType) {
    case 'image': return ASSET_CATEGORIES.IMAGES;
    case 'audio': return ASSET_CATEGORIES.AUDIO;
    case 'video': return ASSET_CATEGORIES.VIDEOS;
    default: return ASSET_CATEGORIES.DOCUMENTS;
  }
}

/** Get file-manager category filter (images include icons) */
export function getFileManagerCategory(fieldType: CollectionFieldType): AssetCategoryFilter {
  if (fieldType === 'image') return [ASSET_CATEGORIES.IMAGES, ASSET_CATEGORIES.ICONS];
  return getAssetCategoryForField(fieldType);
}

/** Validate that an asset matches the expected field type */
export function isValidAssetForField(asset: Asset, fieldType: CollectionFieldType): boolean {
  if (fieldType === 'image') {
    return !!(asset.mime_type && (isAssetOfType(asset.mime_type, ASSET_CATEGORIES.IMAGES) || isAssetOfType(asset.mime_type, ASSET_CATEGORIES.ICONS)));
  }
  const category = getAssetCategoryForField(fieldType);
  return !!(asset.mime_type && isAssetOfType(asset.mime_type, category));
}

/** Get human-readable label for asset field add buttons (e.g. "an image") */
export function getAssetFieldLabel(fieldType: CollectionFieldType): string {
  switch (fieldType) {
    case 'image': return 'an image';
    case 'audio': return 'an audio';
    case 'video': return 'a video';
    case 'document': return 'a document';
    default: return 'a file';
  }
}

/** Get short label for asset field types (e.g. "image") */
export function getAssetFieldTypeLabel(fieldType: CollectionFieldType): string {
  switch (fieldType) {
    case 'image': return 'image';
    case 'audio': return 'audio';
    case 'video': return 'video';
    case 'document': return 'document';
    default: return 'file';
  }
}

// =============================================================================
// Multi-Asset Virtual Fields
// =============================================================================

/** Virtual collection ID marker for multi-asset collections */
export const MULTI_ASSET_COLLECTION_ID = '__multi_asset__';

/**
 * Whether a collection binding points to a real, selected source.
 * Field-sourced bindings (reference/multi-asset/inverse) require a `source_field_id`,
 * so an unbound multi-asset placeholder (virtual `id`, no field chosen yet) is not
 * considered selected. Direct collections just require a non-empty `id`.
 */
export function hasBoundCollectionSource(collectionVariable?: CollectionVariable | null): boolean {
  if (!collectionVariable) return false;
  if (collectionVariable.source_field_type) return !!collectionVariable.source_field_id;
  return !!collectionVariable.id;
}

/** Virtual field IDs for multi-asset collections (prefixed to avoid collision) */
export const MULTI_ASSET_VIRTUAL_FIELDS = {
  FILENAME: '__asset_filename',
  URL: '__asset_url',
  FILE_SIZE: '__asset_file_size',
  MIME_TYPE: '__asset_mime_type',
  WIDTH: '__asset_width',
  HEIGHT: '__asset_height',
} as const;

/** Build virtual CollectionField[] for multi-asset context */
export function buildMultiAssetVirtualFields(): CollectionField[] {
  const baseField = {
    collection_id: '__virtual__',
    order: 0,
    hidden: false,
    is_computed: false,
    is_published: true,
    created_at: '',
    updated_at: '',
    deleted_at: null,
  };

  return [
    { ...baseField, id: MULTI_ASSET_VIRTUAL_FIELDS.URL, name: 'File URL', type: 'image' as CollectionFieldType, key: null, default: null, reference_collection_id: null, data: {}, fillable: false },
    { ...baseField, id: MULTI_ASSET_VIRTUAL_FIELDS.FILENAME, name: 'File name', type: 'text' as CollectionFieldType, key: null, default: null, reference_collection_id: null, data: {}, fillable: false },
    { ...baseField, id: MULTI_ASSET_VIRTUAL_FIELDS.FILE_SIZE, name: 'File size', type: 'text' as CollectionFieldType, key: null, default: null, reference_collection_id: null, data: {}, fillable: false },
    { ...baseField, id: MULTI_ASSET_VIRTUAL_FIELDS.MIME_TYPE, name: 'MIME type', type: 'text' as CollectionFieldType, key: null, default: null, reference_collection_id: null, data: {}, fillable: false },
    { ...baseField, id: MULTI_ASSET_VIRTUAL_FIELDS.WIDTH, name: 'Width', type: 'text' as CollectionFieldType, key: null, default: null, reference_collection_id: null, data: {}, fillable: false },
    { ...baseField, id: MULTI_ASSET_VIRTUAL_FIELDS.HEIGHT, name: 'Height', type: 'text' as CollectionFieldType, key: null, default: null, reference_collection_id: null, data: {}, fillable: false },
  ];
}

/** Check if a field ID is a virtual asset field */
export function isVirtualAssetField(fieldId: string): boolean {
  return fieldId.startsWith('__asset_');
}

/**
 * Checks recursively whether a reference field has at least one sub-field
 * matching the allowed types (directly or via nested references).
 */
function referenceHasMatchingSubFields(
  field: CollectionField,
  allowedTypes: CollectionFieldType[],
  allFields: Record<string, CollectionField[]>,
  visited: Set<string> = new Set(),
): boolean {
  if (!field.reference_collection_id) return false;
  if (visited.has(field.reference_collection_id)) return false;
  visited.add(field.reference_collection_id);

  const subFields = allFields[field.reference_collection_id] || [];
  return subFields.some(f => {
    if (f.type === 'multi_reference') return false;
    if (allowedTypes.includes(f.type as CollectionFieldType)) return true;
    if (f.type === 'reference') return referenceHasMatchingSubFields(f, allowedTypes, allFields, visited);
    return false;
  });
}

/**
 * Filter field groups to only include fields of specified types.
 * Returns empty array if no matching fields exist.
 * - When options.excludeMultipleAsset is true, also excludes fields with multiple assets.
 * - When options.allFields is provided, reference fields are only kept if their referenced
 *   collection contains at least one field matching the allowed types (checked recursively).
 */
export function filterFieldGroupsByType(
  fieldGroups: FieldGroup[] | undefined,
  allowedTypes: CollectionFieldType[],
  options?: { excludeMultipleAsset?: boolean; allFields?: Record<string, CollectionField[]> }
): FieldGroup[] {
  if (!fieldGroups || fieldGroups.length === 0) return [];

  return fieldGroups
    .map(group => {
      const fields = group.fields.filter(field => {
        if (field.type === 'reference' && field.reference_collection_id) {
          if (options?.allFields) {
            return referenceHasMatchingSubFields(field, allowedTypes, options.allFields);
          }
          return true;
        }
        if (!allowedTypes.includes(field.type)) return false;
        if (options?.excludeMultipleAsset && isMultipleAssetField(field)) return false;
        return true;
      });
      // References always appear after regular fields
      fields.sort((a, b) => {
        const aIsRef = a.type === 'reference' ? 1 : 0;
        const bIsRef = b.type === 'reference' ? 1 : 0;
        return aIsRef - bIsRef;
      });
      return { ...group, fields };
    })
    .filter(group => group.fields.length > 0);
}

/**
 * Flatten field groups into a single array of fields.
 */
export function flattenFieldGroups(fieldGroups: FieldGroup[] | undefined): CollectionField[] {
  return fieldGroups?.flatMap(g => g.fields) || [];
}

/** Prefix for reference-field-based collection item resolution (page source) */
export const REF_PAGE_PREFIX = 'ref-page:';
/** Prefix for reference-field-based collection item resolution (collection source) */
export const REF_COLLECTION_PREFIX = 'ref-collection:';

/** A resolved option for a reference field pointing to a specific CMS page collection. */
export interface ReferenceItemOption {
  value: string;
  label: string;
}

/**
 * Build select options for reference fields that point to a given target collection.
 * Used in link settings dropdowns to offer "Category - Reference field" style options.
 */
export function buildReferenceItemOptions(
  isDynamicPage: boolean,
  targetPageCollectionId: string | null,
  fieldGroups: FieldGroup[] | undefined
): ReferenceItemOption[] {
  if (!isDynamicPage || !targetPageCollectionId || !fieldGroups) return [];
  const options: ReferenceItemOption[] = [];
  for (const group of fieldGroups) {
    const prefix = group.source === 'page' ? REF_PAGE_PREFIX : REF_COLLECTION_PREFIX;
    for (const field of group.fields) {
      if (field.type === 'reference' && field.reference_collection_id === targetPageCollectionId) {
        options.push({
          value: `${prefix}${field.id}`,
          label: `${field.name} - Reference field`,
        });
      }
    }
  }
  return options;
}

/**
 * Check if any fields match a predicate across all groups.
 */
export function hasFieldsMatching(
  fieldGroups: FieldGroup[] | undefined,
  predicate: (field: CollectionField) => boolean
): boolean {
  return fieldGroups?.some(g => g.fields.some(predicate)) ?? false;
}

// =============================================================================
// Field Selection Value Encoding/Parsing (for Select components with layerId)
// =============================================================================

/** Encoded field selection info */
export interface FieldSelectionInfo {
  fieldId: string;
  source?: FieldSourceType;
  layerId?: string;
}

/**
 * Encode field selection info into a single string value for Select components.
 * Format: "source:layerId:fieldId" for collection sources, "page::fieldId" for page sources
 */
export function encodeFieldSelection(fieldId: string, source?: FieldSourceType, layerId?: string): string {
  if (source === 'page') {
    return `page::${fieldId}`;
  }
  if (source === 'collection' && layerId) {
    return `collection:${layerId}:${fieldId}`;
  }
  // Legacy format: just field ID (for backwards compatibility)
  return fieldId;
}

/**
 * Parse encoded field selection value back into its components.
 */
export function parseFieldSelection(value: string): FieldSelectionInfo {
  const parts = value.split(':');
  if (parts.length >= 3 && (parts[0] === 'page' || parts[0] === 'collection')) {
    return {
      source: parts[0] as FieldSourceType,
      layerId: parts[1] || undefined,
      fieldId: parts.slice(2).join(':'), // Handle field IDs with colons
    };
  }
  // Legacy format: just field ID
  return { fieldId: value };
}

/**
 * Get current field selection value from field groups by field ID.
 * Returns the encoded value if the field is found in the groups.
 */
export function getEncodedFieldValue(fieldId: string | null | undefined, fieldGroups: FieldGroup[] | undefined): string {
  if (!fieldId || !fieldGroups) return '';
  for (const group of fieldGroups) {
    const field = group.fields.find(f => f.id === fieldId);
    if (field) {
      return encodeFieldSelection(fieldId, group.source, group.layerId);
    }
  }
  return fieldId; // Fallback to just field ID
}

/**
 * Build field groups for a specific layer by resolving its parent collection context.
 * Encapsulates the repeated pattern of finding parent collections, extracting
 * multi-asset context, and calling buildFieldGroups.
 */
export function buildFieldGroupsForLayer(
  layerId: string,
  layers: Layer[],
  page: BuildFieldGroupsConfig['page'],
  fieldsByCollectionId: Record<string, CollectionField[]>,
  collections: { id: string; name: string }[],
): FieldGroup[] | undefined {
  const parents = findAllParentCollectionLayers(layers, layerId);
  const parentCollection = parents[0] || null;
  const collectionVariable = parentCollection ? getCollectionVariable(parentCollection) : null;
  const isMultiAssetParent = collectionVariable?.source_field_type === 'multi_asset';
  const multiAssetContext = isMultiAssetParent && collectionVariable.source_field_id
    ? {
      sourceFieldId: collectionVariable.source_field_id,
      source: (collectionVariable.source_field_source || 'collection') as FieldSourceType,
    }
    : null;
  const parentCollectionLayers = parents
    .map(layer => ({ layerId: layer.id, collectionId: getCollectionVariable(layer)?.id }))
    .filter((item): item is ParentCollectionLayer => !!item.collectionId);

  return buildFieldGroups({
    parentCollectionLayers,
    page,
    fieldsByCollectionId,
    collections,
    multiAssetContext,
  });
}
