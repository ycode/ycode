import { CssVariableValidationError } from '@/lib/css-variable-schemas';
import type { ColorVariable, CssVariablesGraph, CssVariableType } from '@/types';

export const CSS_VARIABLE_REFERENCE = /^var\(--([a-zA-Z0-9-]+)\)$/;

/** Values are embedded in a style element; reject declaration/HTML delimiters. */
export function isValidCssVariableValue(type: CssVariableType, value: string): boolean {
  if (value === '' || CSS_VARIABLE_REFERENCE.test(value)) return true;
  if (value.length > 1000 || /[;{}<>\\\n\r]/.test(value)) return false;
  switch (type) {
    case 'size': return /^-?(?:\d+\.?\d*|\.\d+)(px|rem|em|vh|vw|svh|svw|dvh|dvw|vmin|vmax|ch|ex|cm|mm|in|pt|pc)$/.test(value) || value === '0';
    case 'number': return /^-?(?:\d+\.?\d*|\.\d+)$/.test(value);
    case 'percentage': return /^-?(?:\d+\.?\d*|\.\d+)%$/.test(value);
    case 'color': return /^(#[\da-f]{3,8}(?:\/(?:100|\d{1,2})(?:\.\d+)?)?|[a-z]+|(?:rgba?|hsla?|oklch|oklab|color)\([\da-z.,% /+-]+\))$/i.test(value);
    case 'font_family': return /^[\w\s,'".-]+$/.test(value);
  }
}

/** Validate relationships and aliases across every mode, including batch edits. */
export function validateCssVariableValues(graph: CssVariablesGraph): void {
  const variables = new Map(graph.variables.map(v => [v.id, v]));
  const modes = new Map(graph.modes.map(m => [m.id, m]));
  const edges = new Map<string, Set<string>>();
  for (const row of graph.values) {
    const variable = variables.get(row.css_variable_id);
    const mode = modes.get(row.mode_id);
    if (!variable || !mode || variable.set_id !== mode.set_id) {
      throw new CssVariableValidationError('A value must belong to a variable and mode in the same collection');
    }
    if (!isValidCssVariableValue(variable.type, row.value)) {
      throw new CssVariableValidationError(`Invalid ${variable.type} value for ${variable.name}`);
    }
    const reference = CSS_VARIABLE_REFERENCE.exec(row.value)?.[1];
    if (!reference) continue;
    const target = variables.get(reference);
    if (!target || target.type !== variable.type) throw new CssVariableValidationError('Aliases must reference an existing variable of the same type');
    const targets = edges.get(variable.id) ?? new Set<string>();
    targets.add(reference);
    edges.set(variable.id, targets);
  }
  const visited = new Set<string>();
  const active = new Set<string>();
  const visit = (id: string): void => {
    if (active.has(id)) throw new CssVariableValidationError('Variable aliases cannot form a cycle');
    if (visited.has(id)) return;
    active.add(id);
    for (const target of edges.get(id) ?? []) visit(target);
    active.delete(id);
    visited.add(id);
  };
  for (const id of variables.keys()) visit(id);
}

/** Flat compatibility view for existing color pickers and animation resolvers. */
export function getDefaultColorVariables(graph: CssVariablesGraph): ColorVariable[] {
  const resolve = (id: string, seen = new Set<string>()): string => {
    if (seen.has(id)) return '';
    seen.add(id);
    const variable = graph.variables.find(v => v.id === id);
    if (!variable) return '';
    const modes = graph.modes.filter(m => m.set_id === variable.set_id).sort((a, b) => a.sort_order - b.sort_order);
    const mode = modes.find(m => m.is_default) ?? modes[0];
    const value = graph.values.find(v => v.css_variable_id === id && v.mode_id === mode?.id)?.value ?? '';
    const target = CSS_VARIABLE_REFERENCE.exec(value)?.[1];
    return target ? resolve(target, seen) : value;
  };
  return graph.variables.filter(v => v.type === 'color').sort((a, b) => a.sort_order - b.sort_order).map(v => ({
    id: v.id, name: v.name, value: resolve(v.id), sort_order: v.sort_order, created_at: v.created_at, updated_at: v.updated_at,
  }));
}

/** Read-only graph for rendering a deployment before its first migration runs. */
export function legacyColorsToGraph(colors: ColorVariable[]): CssVariablesGraph {
  const setId = '00000000-0000-4000-8000-000000000001';
  const modeId = '00000000-0000-4000-8000-000000000002';
  const groupId = '00000000-0000-4000-8000-000000000003';
  const meta = { sort_order: 0, created_at: '', updated_at: '' };
  return {
    sets: [{ ...meta, id: setId, name: 'Colors', activation_kind: 'default' }],
    modes: [{ ...meta, id: modeId, set_id: setId, name: 'Default', is_default: true, data_theme: null, min_width: null }],
    groups: [{ ...meta, id: groupId, set_id: setId, name: 'Default group' }],
    variables: colors.map(color => ({ ...color, set_id: setId, group_id: groupId, type: 'color' })),
    values: colors.map(color => ({ css_variable_id: color.id, mode_id: modeId, value: color.value, created_at: color.created_at, updated_at: color.updated_at })),
  };
}
