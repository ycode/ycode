/**
 * Variable Format Utilities
 *
 * Format presets and formatting functions for date and number inline variables.
 * Uses Intl.DateTimeFormat and Intl.NumberFormat for locale-aware formatting.
 */

import type { CollectionFieldType } from '@/types';
import { isDateFieldType, isDateOnlyString } from '@/lib/collection-field-utils';

// ─── Date Format Presets ────────────────────────────────────────────

export interface DateFormatPreset {
  id: string;
  label: string;
  options: Intl.DateTimeFormatOptions;
  locale?: string;
  /** Helper text shown next to the preview (e.g. "Hour (12h)") */
  detail?: string;
  /** Strip leading zero from the formatted output (for Intl quirks like 24h numeric hours) */
  stripLeadingZero?: boolean;
  /** Extract a single part from formatToParts instead of using the full formatted string */
  extractPart?: Intl.DateTimeFormatPartTypes;
}

export interface FormatPresetSection<T> {
  title: string;
  presets: T[];
}

export const DATE_FORMAT_SECTIONS: FormatPresetSection<DateFormatPreset>[] = [
  {
    title: 'Date and time',
    presets: [
      {
        id: 'datetime-long',
        label: 'March 26, 2026, 9:38 AM',
        options: { month: 'long', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true },
      },
      {
        id: 'datetime-short',
        label: 'Mar 26, 2026, 9:38 AM',
        options: { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true },
      },
      {
        id: 'datetime-24h',
        label: 'Mar 26, 2026, 09:38',
        options: { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false },
      },
    ],
  },
  {
    title: 'Date',
    presets: [
      {
        id: 'date-long',
        label: 'March 26, 2026',
        options: { month: 'long', day: 'numeric', year: 'numeric' },
      },
      {
        id: 'date-short',
        label: 'Mar 26, 2026',
        options: { month: 'short', day: 'numeric', year: 'numeric' },
      },
      {
        id: 'date-full',
        label: 'Thursday, March 26, 2026',
        options: { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' },
      },
      {
        id: 'date-short-weekday',
        label: 'Thu, Mar 26, 2026',
        options: { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' },
      },
      {
        id: 'date-us',
        label: '3/26/2026',
        options: { month: 'numeric', day: 'numeric', year: 'numeric' },
        locale: 'en-US',
      },
      {
        id: 'date-eu',
        label: '26/03/2026',
        options: { day: '2-digit', month: '2-digit', year: 'numeric' },
        locale: 'en-GB',
      },
      {
        id: 'date-eu-dot',
        label: '26.03.2026',
        options: { day: '2-digit', month: '2-digit', year: 'numeric' },
        locale: 'de-DE',
      },
      {
        id: 'date-iso',
        label: '2026-03-26',
        options: { year: 'numeric', month: '2-digit', day: '2-digit' },
        locale: 'sv-SE',
      },
      {
        id: 'date-month-year',
        label: 'March 2026',
        options: { month: 'long', year: 'numeric' },
      },
      {
        id: 'date-short-month-year',
        label: 'Mar 2026',
        options: { month: 'short', year: 'numeric' },
      },
      {
        id: 'date-day-month',
        label: '26 Mar',
        options: { day: 'numeric', month: 'short' },
      },
    ],
  },
  {
    title: 'Date parts',
    presets: [
      {
        id: 'part-weekday-long',
        label: 'Tuesday',
        detail: 'Day name',
        options: { weekday: 'long' },
      },
      {
        id: 'part-weekday-short',
        label: 'Tue',
        detail: 'Day name (short)',
        options: { weekday: 'short' },
      },
      {
        id: 'part-month-long',
        label: 'April',
        detail: 'Month name',
        options: { month: 'long' },
      },
      {
        id: 'part-month-short',
        label: 'Apr',
        detail: 'Month name (short)',
        options: { month: 'short' },
      },
      {
        id: 'part-day',
        label: '7',
        detail: 'Day',
        options: { day: 'numeric' },
      },
      {
        id: 'part-day-padded',
        label: '07',
        detail: 'Day (zero-padded)',
        options: { day: '2-digit' },
      },
      {
        id: 'part-year',
        label: '2026',
        detail: 'Year',
        options: { year: 'numeric' },
      },
      {
        id: 'part-year-short',
        label: '26',
        detail: 'Year (short)',
        options: { year: '2-digit' },
      },
    ],
  },
  {
    title: 'Time',
    presets: [
      {
        id: 'time-12h',
        label: '9:38 AM',
        options: { hour: 'numeric', minute: '2-digit', hour12: true },
      },
      {
        id: 'time-24h',
        label: '09:38',
        options: { hour: '2-digit', minute: '2-digit', hour12: false },
      },
    ],
  },
  {
    title: 'Time parts',
    presets: [
      {
        id: 'part-hour-12',
        label: '9',
        detail: 'Hour (12h)',
        options: { hour: 'numeric', hour12: true },
        extractPart: 'hour',
      },
      {
        id: 'part-hour-12-padded',
        label: '09',
        detail: 'Hour (12h, zero-padded)',
        options: { hour: '2-digit', hour12: true },
        extractPart: 'hour',
      },
      {
        id: 'part-hour-24-short',
        label: '9',
        detail: 'Hour (24h)',
        options: { hour: 'numeric', hour12: false },
        extractPart: 'hour',
        stripLeadingZero: true,
      },
      {
        id: 'part-hour-24',
        label: '09',
        detail: 'Hour (24h, zero-padded)',
        options: { hour: '2-digit', hour12: false },
        extractPart: 'hour',
      },
      {
        id: 'part-ampm',
        label: 'AM',
        detail: 'AM / PM',
        options: { hour: 'numeric', hour12: true },
        extractPart: 'dayPeriod',
      },
      {
        id: 'part-minute',
        label: '8',
        detail: 'Minute',
        options: { hour: 'numeric', minute: 'numeric', hour12: false },
        extractPart: 'minute',
        stripLeadingZero: true,
      },
      {
        id: 'part-minute-padded',
        label: '08',
        detail: 'Minute (zero-padded)',
        options: { hour: 'numeric', minute: '2-digit', hour12: false },
        extractPart: 'minute',
      },
    ],
  },
];

/** Sections for date_only fields (excludes datetime, time, and time parts) */
export const DATE_ONLY_FORMAT_SECTIONS: FormatPresetSection<DateFormatPreset>[] =
  DATE_FORMAT_SECTIONS.filter(s => s.title === 'Date' || s.title === 'Date parts');

/** Flat list of all date presets (used for lookup by ID) */
export const DATE_FORMAT_PRESETS: DateFormatPreset[] =
  DATE_FORMAT_SECTIONS.flatMap(s => s.presets);

// ─── Number Format Presets ──────────────────────────────────────────

export interface NumberFormatPreset {
  id: string;
  label: string;
  options: Intl.NumberFormatOptions;
  locale?: string;
  sample: number;
}

export interface NumberFormatSection {
  title: string;
  presets: NumberFormatPreset[];
}

export const NUMBER_FORMAT_SECTIONS: NumberFormatSection[] = [
  {
    title: 'Standard',
    presets: [
      {
        id: 'number-integer',
        label: '12,345',
        options: { maximumFractionDigits: 0, useGrouping: true },
        sample: 12345,
      },
      {
        id: 'number-decimal',
        label: '12,345.00',
        options: { minimumFractionDigits: 2, maximumFractionDigits: 2, useGrouping: true },
        sample: 12345,
      },
      {
        id: 'number-single-decimal',
        label: '12,345.0',
        options: { minimumFractionDigits: 1, maximumFractionDigits: 1, useGrouping: true },
        sample: 12345,
      },
      {
        id: 'number-plain',
        label: '12345',
        options: { maximumFractionDigits: 0, useGrouping: false },
        sample: 12345,
      },
      {
        id: 'number-plain-decimal',
        label: '12345.00',
        options: { minimumFractionDigits: 2, maximumFractionDigits: 2, useGrouping: false },
        sample: 12345,
      },
      {
        id: 'number-compact',
        label: '12K',
        options: { notation: 'compact', maximumFractionDigits: 1 },
        sample: 12345,
      },
    ],
  },
  {
    title: 'Percent',
    presets: [
      {
        id: 'number-percent',
        label: '12%',
        options: { style: 'percent', maximumFractionDigits: 0 },
        sample: 0.12,
      },
      {
        id: 'number-percent-decimal',
        label: '12.35%',
        options: { style: 'percent', minimumFractionDigits: 2, maximumFractionDigits: 2 },
        sample: 0.1235,
      },
    ],
  },
];

/** Flat list of all number presets (used for lookup by ID) */
export const NUMBER_FORMAT_PRESETS: NumberFormatPreset[] =
  NUMBER_FORMAT_SECTIONS.flatMap(s => s.presets);

// ─── Helpers ────────────────────────────────────────────────────────

const datePresetMap = new Map(DATE_FORMAT_PRESETS.map(p => [p.id, p]));
const numberPresetMap = new Map(NUMBER_FORMAT_PRESETS.map(p => [p.id, p]));

/** Check whether a field type supports format selection */
export function isFormattableFieldType(fieldType: string | null | undefined): boolean {
  return isDateFieldType(fieldType) || fieldType === 'number';
}

/**
 * Whether a stored format preset id is valid for the given field type. Used to
 * detect a stale format left behind when a field/global changes type (e.g. a
 * number preset on a field that's now a date), so callers can reset it.
 */
export function isFormatValidForFieldType(
  format: string | null | undefined,
  fieldType: string | null | undefined
): boolean {
  if (!format) return true;
  if (isDateFieldType(fieldType)) return datePresetMap.has(format);
  if (fieldType === 'number') return numberPresetMap.has(format);
  return false;
}

/** Get format preset sections for a field type (grouped with titles) */
export function getFormatSectionsForFieldType(
  fieldType: string | null | undefined
): FormatPresetSection<DateFormatPreset | NumberFormatPreset>[] {
  if (fieldType === 'date') return DATE_FORMAT_SECTIONS;
  if (fieldType === 'date_only') return DATE_ONLY_FORMAT_SECTIONS;
  if (fieldType === 'number') return NUMBER_FORMAT_SECTIONS;
  return [];
}

/** Get the default format ID for a field type */
export function getDefaultFormatId(fieldType: string | null | undefined): string | undefined {
  if (isDateFieldType(fieldType)) return 'date-long';
  if (fieldType === 'number') return 'number-integer';
  return undefined;
}

/** Build a field variable data object with the appropriate default format preset */
export function buildFieldVariableData(
  fieldId: string,
  relationshipPath: string[],
  fieldType: CollectionFieldType | null,
  source?: string,
  layerId?: string,
) {
  const defaultFormat = getDefaultFormatId(fieldType);
  return {
    type: 'field' as const,
    data: {
      field_id: fieldId,
      field_type: fieldType,
      relationships: relationshipPath,
      ...(defaultFormat && { format: defaultFormat }),
      ...(source && { source: source as 'page' | 'collection' | 'global' }),
      ...(layerId && { collection_layer_id: layerId }),
      // For global bindings, mirror the id so resolution can key on it even if
      // field_id is later remapped (e.g. component instance id transforms).
      ...(source === 'global' && { global_id: fieldId }),
    },
  };
}

type FieldVariable = ReturnType<typeof buildFieldVariableData>;

interface FieldVariableIdentity {
  field_id?: string;
  source?: string;
  relationships?: string[];
  collection_layer_id?: string;
  format?: string;
}

/** Identity of a bound field, ignoring its display format. */
function getFieldVariableKey(data: FieldVariableIdentity): string {
  return [
    data.source ?? '',
    data.field_id ?? '',
    (data.relationships ?? []).join('.'),
    data.collection_layer_id ?? '',
  ].join('|');
}

/**
 * Map each field variable in a Tiptap doc to its display format (first occurrence wins).
 * A missing format is kept as `undefined` so it can be reproduced as-is.
 */
export function collectFieldVariableFormats(doc: unknown): Map<string, string | undefined> {
  const formats = new Map<string, string | undefined>();

  const walk = (node: unknown) => {
    if (!node || typeof node !== 'object') return;
    const { type, attrs, content } = node as {
      type?: string;
      attrs?: { variable?: { type?: string; data?: FieldVariableIdentity } };
      content?: unknown[];
    };
    const variable = attrs?.variable;
    if (type === 'dynamicVariable' && variable?.type === 'field' && variable.data) {
      const key = getFieldVariableKey(variable.data);
      if (!formats.has(key)) formats.set(key, variable.data.format);
    }
    if (Array.isArray(content)) content.forEach(walk);
  };

  walk(doc);
  return formats;
}

/** Give a new field variable the format the same field uses in `formats`, if it appears there. */
export function withMatchingVariableFormat(
  variable: FieldVariable,
  formats?: Map<string, string | undefined>
): FieldVariable {
  const key = getFieldVariableKey(variable.data);
  if (!formats?.has(key)) return variable;

  const data = { ...variable.data };
  const format = formats.get(key);
  if (format) {
    data.format = format;
  } else {
    delete data.format;
  }
  return { ...variable, data };
}

/**
 * Format a date value using a preset ID
 * Falls back to the default display format if preset is not found
 */
export function formatDateWithPreset(
  value: string | Date,
  presetId: string | undefined,
  timezone: string = 'UTC'
): string {
  const dateObj = typeof value === 'string' ? new Date(value) : value;
  if (isNaN(dateObj.getTime())) return '';

  // date_only values are timezone-neutral calendar dates (`YYYY-MM-DD` parses as
  // UTC midnight). Formatting them in the project timezone would shift the day, so
  // pin the display timezone to UTC to preserve the stored calendar date.
  const effectiveTimezone = typeof value === 'string' && isDateOnlyString(value) ? 'UTC' : timezone;

  const preset = presetId ? datePresetMap.get(presetId) : datePresetMap.get('date-long');
  if (!preset) {
    return new Intl.DateTimeFormat('en-US', {
      timeZone: effectiveTimezone,
      month: 'long',
      day: 'numeric',
      year: 'numeric',
    }).format(dateObj);
  }

  try {
    const formatter = new Intl.DateTimeFormat(preset.locale || 'en-US', {
      timeZone: effectiveTimezone,
      ...preset.options,
    });
    const result = preset.extractPart
      ? (formatter.formatToParts(dateObj).find(p => p.type === preset.extractPart)?.value ?? '')
      : formatter.format(dateObj);
    return preset.stripLeadingZero ? result.replace(/^0/, '') : result;
  } catch {
    return '';
  }
}

/**
 * Format a number value using a preset ID
 * Falls back to plain string conversion if preset is not found
 */
export function formatNumberWithPreset(
  value: number,
  presetId: string | undefined
): string {
  const preset = presetId ? numberPresetMap.get(presetId) : undefined;
  if (!preset) return String(value);

  try {
    return new Intl.NumberFormat(preset.locale || 'en-US', preset.options).format(value);
  } catch {
    return String(value);
  }
}

// Fixed sample date for all format previews so the dropdown is consistent
// Tue Apr 7 2026 09:08 — uses single-digit components to show zero-padding differences
const PREVIEW_DATE = new Date(2026, 3, 7, 9, 8);

/** Generate a preview label for a date format preset */
export function getDateFormatPreview(preset: DateFormatPreset): string {
  try {
    const formatter = new Intl.DateTimeFormat(preset.locale || 'en-US', {
      ...preset.options,
    });
    const result = preset.extractPart
      ? (formatter.formatToParts(PREVIEW_DATE).find(p => p.type === preset.extractPart)?.value ?? '')
      : formatter.format(PREVIEW_DATE);
    return preset.stripLeadingZero ? result.replace(/^0/, '') : result;
  } catch {
    return preset.label;
  }
}

/**
 * Generate a live preview label for a number format preset
 */
export function getNumberFormatPreview(preset: NumberFormatPreset): string {
  try {
    return new Intl.NumberFormat(preset.locale || 'en-US', preset.options).format(preset.sample);
  } catch {
    return preset.label;
  }
}
