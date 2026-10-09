/**
 * CSS Variable Repository
 *
 * Data access layer for the typed CSS variables system (sets, modes, groups,
 * variables, values). Each entity is exposed via small CRUD + reorder helpers.
 *
 * The graph is shipped to the client and SSR via {@link getCssVariablesGraph}.
 */

import { validateCssVariableValues, CSS_VARIABLE_REFERENCE, legacyColorsToGraph } from '@/lib/css-variable-utils';
import { CssVariableValidationError, cssVariableIdSchema, cssVariableSetSchema, cssVariableModeSchema, cssVariableGroupSchema, cssVariableSchema, cssVariableValueSchema, cssVariableOrderSchema } from '@/lib/css-variable-schemas';
import { getSupabaseAdmin } from '@/lib/supabase-server';
import { generateContentHash } from '@/lib/hash-utils';
import type {
  ColorVariable,
  CssVariable,
  CssVariableGroup,
  CssVariableSet,
  CssVariableSetActivationKind,
  CssVariableSetMode,
  CssVariableType,
  CssVariableValue,
  CssVariablesGraph,
} from '@/types';

export interface CreateCssVariableSetData {
  name: string;
  activation_kind?: CssVariableSetActivationKind;
}

export interface UpdateCssVariableSetData {
  name?: string;
  activation_kind?: CssVariableSetActivationKind;
}

export interface CreateCssVariableSetModeData {
  set_id: string;
  name: string;
  is_default?: boolean;
  data_theme?: string | null;
  min_width?: number | null;
}

export interface UpdateCssVariableSetModeData {
  name?: string;
  is_default?: boolean;
  data_theme?: string | null;
  min_width?: number | null;
}

export interface CreateCssVariableGroupData {
  set_id: string;
  name: string;
}

export interface UpdateCssVariableGroupData {
  name?: string;
}

export interface CreateCssVariableData {
  set_id: string;
  group_id?: string | null;
  type: CssVariableType;
  name: string;
}

export interface UpdateCssVariableData {
  name?: string;
  group_id?: string | null;
  type?: CssVariableType;
}

export interface UpsertCssVariableValueData {
  css_variable_id: string;
  mode_id: string;
  value: string;
}

async function getClient(tenantId?: string) {
  const client = await getSupabaseAdmin(tenantId);
  if (!client) throw new Error('Supabase not configured');
  return client;
}

// ----- Full graph -----------------------------------------------------------

/**
 * Fetch the entire CSS variables graph in a single round trip.
 * Suitable for SSR globals and the in-builder editor.
 */
export async function getCssVariablesGraph(tenantId?: string): Promise<CssVariablesGraph> {
  const client = await getClient(tenantId);

  const [setsRes, modesRes, groupsRes, varsRes, valuesRes] = await Promise.all([
    client.from('css_variable_sets').select('*').order('sort_order', { ascending: true }).order('created_at', { ascending: true }),
    client.from('css_variable_set_modes').select('*').order('sort_order', { ascending: true }).order('created_at', { ascending: true }),
    client.from('css_variable_groups').select('*').order('sort_order', { ascending: true }).order('created_at', { ascending: true }),
    client.from('css_variables').select('*').order('sort_order', { ascending: true }).order('created_at', { ascending: true }),
    client.from('css_variable_values').select('*'),
  ]);

  // Vercel prerenders public/error pages before the builder can run migrations.
  // Fall back only when the whole typed schema is absent; other errors remain visible.
  const results = [setsRes, modesRes, groupsRes, varsRes, valuesRes];
  if (results.every(result => result.error && ['PGRST205', '42P01'].includes(result.error.code))) {
    const legacy = await client.from('color_variables').select('*').order('sort_order', { ascending: true });
    if (legacy.error) throw new Error(`Failed to fetch legacy color variables: ${legacy.error.message}`);
    return legacyColorsToGraph((legacy.data ?? []) as ColorVariable[]);
  }

  if (setsRes.error) throw new Error(`Failed to fetch CSS variable sets: ${setsRes.error.message}`);
  if (modesRes.error) throw new Error(`Failed to fetch CSS variable modes: ${modesRes.error.message}`);
  if (groupsRes.error) throw new Error(`Failed to fetch CSS variable groups: ${groupsRes.error.message}`);
  if (varsRes.error) throw new Error(`Failed to fetch CSS variables: ${varsRes.error.message}`);
  if (valuesRes.error) throw new Error(`Failed to fetch CSS variable values: ${valuesRes.error.message}`);

  return {
    sets: (setsRes.data || []) as CssVariableSet[],
    modes: (modesRes.data || []) as CssVariableSetMode[],
    groups: (groupsRes.data || []) as CssVariableGroup[],
    variables: (varsRes.data || []) as CssVariable[],
    values: (valuesRes.data || []) as CssVariableValue[],
  };
}

/**
 * Deterministic hash of the entire CSS variables graph.
 * Used by the publish flow to detect changes between snapshots.
 */
export async function getCssVariablesGraphHash(tenantId?: string): Promise<string> {
  const graph = await getCssVariablesGraph(tenantId);
  return generateContentHash({
    sets: graph.sets.map((s) => ({ id: s.id, name: s.name, activation_kind: s.activation_kind, sort_order: s.sort_order })),
    modes: graph.modes.map((m) => ({ id: m.id, set_id: m.set_id, name: m.name, is_default: m.is_default, data_theme: m.data_theme, min_width: m.min_width, sort_order: m.sort_order })),
    groups: graph.groups.map((g) => ({ id: g.id, set_id: g.set_id, name: g.name, sort_order: g.sort_order })),
    variables: graph.variables.map((v) => ({ id: v.id, set_id: v.set_id, group_id: v.group_id, type: v.type, name: v.name, sort_order: v.sort_order })),
    values: graph.values.slice().sort((a, b) => `${a.css_variable_id}:${a.mode_id}`.localeCompare(`${b.css_variable_id}:${b.mode_id}`)).map((v) => ({ css_variable_id: v.css_variable_id, mode_id: v.mode_id, value: v.value })),
  });
}

// ----- Sets -----------------------------------------------------------------

export async function createCssVariableSet(
  data: CreateCssVariableSetData,
  tenantId?: string
): Promise<CssVariableSet> {
  data = cssVariableSetSchema.parse(data);
  const client = await getClient(tenantId);
  const { data: maxRow } = await client
    .from('css_variable_sets')
    .select('sort_order')
    .order('sort_order', { ascending: false })
    .limit(1)
    .maybeSingle();
  const nextOrder = (maxRow?.sort_order ?? -1) + 1;

  const { data: row, error } = await client
    .from('css_variable_sets')
    .insert({
      name: data.name,
      activation_kind: data.activation_kind ?? 'default',
      sort_order: nextOrder,
    })
    .select()
    .single();

  if (error) throw new Error(`Failed to create CSS variable set: ${error.message}`);

  return row as CssVariableSet;
}

export async function updateCssVariableSet(
  id: string,
  updates: UpdateCssVariableSetData,
  tenantId?: string
): Promise<CssVariableSet> {
  updates = cssVariableSetSchema.partial().parse(updates);
  id = cssVariableIdSchema.parse(id);
  const client = await getClient(tenantId);
  const { data, error } = await client
    .from('css_variable_sets')
    .update({ ...updates, updated_at: new Date().toISOString() })
    .eq('id', id)
    .select()
    .single();

  if (error) throw new Error(`Failed to update CSS variable set: ${error.message}`);
  return data as CssVariableSet;
}

export async function deleteCssVariableSet(id: string, tenantId?: string): Promise<void> {
  id = cssVariableIdSchema.parse(id);
  const graph = await getCssVariablesGraph(tenantId);
  const removed = new Set(graph.variables.filter(v => v.set_id === id).map(v => v.id));
  if (graph.values.some(v => !removed.has(v.css_variable_id) && removed.has(CSS_VARIABLE_REFERENCE.exec(v.value)?.[1] ?? ''))) throw new CssVariableValidationError('Remove aliases referencing these variables first');
  const client = await getClient(tenantId);
  const { error } = await client.from('css_variable_sets').delete().eq('id', id);
  if (error) throw new Error(`Failed to delete CSS variable set: ${error.message}`);
}

export async function reorderCssVariableSets(orderedIds: string[], tenantId?: string): Promise<void> {
  await reorderRows('css_variable_sets', orderedIds, tenantId);
}

// ----- Modes ----------------------------------------------------------------

export async function createCssVariableSetMode(
  data: CreateCssVariableSetModeData,
  tenantId?: string
): Promise<CssVariableSetMode> {
  data = cssVariableModeSchema.parse(data);
  const client = await getClient(tenantId);

  const { data: maxRow } = await client
    .from('css_variable_set_modes')
    .select('sort_order')
    .eq('set_id', data.set_id)
    .order('sort_order', { ascending: false })
    .limit(1)
    .maybeSingle();
  const nextOrder = (maxRow?.sort_order ?? -1) + 1;

  if (data.is_default) throw new CssVariableValidationError('A collection already has a default mode');
  const { data: row, error } = await client
    .from('css_variable_set_modes')
    .insert({
      set_id: data.set_id,
      name: data.name,
      is_default: data.is_default ?? false,
      data_theme: data.data_theme ?? null,
      min_width: data.min_width ?? null,
      sort_order: nextOrder,
    })
    .select()
    .single();

  if (error) throw new Error(`Failed to create CSS variable set mode: ${error.message}`);
  return row as CssVariableSetMode;
}

export async function updateCssVariableSetMode(
  id: string,
  updates: UpdateCssVariableSetModeData,
  tenantId?: string
): Promise<CssVariableSetMode> {
  updates = cssVariableModeSchema.omit({ set_id: true }).partial().parse(updates);
  id = cssVariableIdSchema.parse(id);
  const client = await getClient(tenantId);

  if (updates.is_default !== undefined) throw new CssVariableValidationError('The default mode cannot be changed');
  const { data, error } = await client
    .from('css_variable_set_modes')
    .update({ ...updates, updated_at: new Date().toISOString() })
    .eq('id', id)
    .select()
    .single();

  if (error) throw new Error(`Failed to update CSS variable set mode: ${error.message}`);
  return data as CssVariableSetMode;
}

export async function deleteCssVariableSetMode(id: string, tenantId?: string): Promise<void> {
  const graph = await getCssVariablesGraph(tenantId);
  if (graph.modes.find(m => m.id === id)?.is_default) throw new CssVariableValidationError('The default mode cannot be deleted');
  const client = await getClient(tenantId);
  const { error } = await client.from('css_variable_set_modes').delete().eq('id', id);
  if (error) throw new Error(`Failed to delete CSS variable set mode: ${error.message}`);
}

export async function reorderCssVariableSetModes(orderedIds: string[], tenantId?: string): Promise<void> {
  await reorderRows('css_variable_set_modes', orderedIds, tenantId);
}

// ----- Groups ---------------------------------------------------------------

export async function createCssVariableGroup(
  data: CreateCssVariableGroupData,
  tenantId?: string
): Promise<CssVariableGroup> {
  data = cssVariableGroupSchema.parse(data);
  const client = await getClient(tenantId);

  const { data: maxRow } = await client
    .from('css_variable_groups')
    .select('sort_order')
    .eq('set_id', data.set_id)
    .order('sort_order', { ascending: false })
    .limit(1)
    .maybeSingle();
  const nextOrder = (maxRow?.sort_order ?? -1) + 1;

  const { data: row, error } = await client
    .from('css_variable_groups')
    .insert({ set_id: data.set_id, name: data.name, sort_order: nextOrder })
    .select()
    .single();

  if (error) throw new Error(`Failed to create CSS variable group: ${error.message}`);
  return row as CssVariableGroup;
}

export async function updateCssVariableGroup(
  id: string,
  updates: UpdateCssVariableGroupData,
  tenantId?: string
): Promise<CssVariableGroup> {
  updates = cssVariableGroupSchema.omit({ set_id: true }).partial().parse(updates);
  id = cssVariableIdSchema.parse(id);
  const client = await getClient(tenantId);
  const { data, error } = await client
    .from('css_variable_groups')
    .update({ ...updates, updated_at: new Date().toISOString() })
    .eq('id', id)
    .select()
    .single();

  if (error) throw new Error(`Failed to update CSS variable group: ${error.message}`);
  return data as CssVariableGroup;
}

export async function deleteCssVariableGroup(id: string, tenantId?: string): Promise<void> {
  const client = await getClient(tenantId);
  const graph = await getCssVariablesGraph(tenantId);
  const group = graph.groups.find(g => g.id === id);
  const replacement = graph.groups.find(g => g.set_id === group?.set_id && g.id !== id);
  if (!replacement) throw new CssVariableValidationError('Keep at least one group per collection');
  const { error: moveError } = await client.from('css_variables').update({ group_id: replacement.id }).eq('group_id', id);
  if (moveError) throw new Error(moveError.message);
  const { error } = await client.from('css_variable_groups').delete().eq('id', id);
  if (error) throw new Error(`Failed to delete CSS variable group: ${error.message}`);
}

export async function reorderCssVariableGroups(orderedIds: string[], tenantId?: string): Promise<void> {
  await reorderRows('css_variable_groups', orderedIds, tenantId);
}

// ----- Variables ------------------------------------------------------------

export async function createCssVariable(
  data: CreateCssVariableData,
  tenantId?: string
): Promise<CssVariable> {
  data = cssVariableSchema.parse(data);
  const client = await getClient(tenantId);
  const graph = await getCssVariablesGraph(tenantId);
  data.group_id ??= graph.groups.find(g => g.set_id === data.set_id)?.id ?? null;
  assertGroup(graph, data.set_id, data.group_id);

  const { data: maxRow } = await client
    .from('css_variables')
    .select('sort_order')
    .eq('set_id', data.set_id)
    .order('sort_order', { ascending: false })
    .limit(1)
    .maybeSingle();
  const nextOrder = (maxRow?.sort_order ?? -1) + 1;

  const { data: row, error } = await client
    .from('css_variables')
    .insert({
      set_id: data.set_id,
      group_id: data.group_id ?? null,
      type: data.type,
      name: data.name,
      sort_order: nextOrder,
    })
    .select()
    .single();

  if (error) throw new Error(`Failed to create CSS variable: ${error.message}`);
  return row as CssVariable;
}

export async function updateCssVariable(
  id: string,
  updates: UpdateCssVariableData,
  tenantId?: string
): Promise<CssVariable> {
  updates = cssVariableSchema.omit({ set_id: true }).partial().parse(updates);
  id = cssVariableIdSchema.parse(id);
  const client = await getClient(tenantId);
  const graph = await getCssVariablesGraph(tenantId);
  const variable = graph.variables.find(v => v.id === id);
  if (!variable) throw new CssVariableValidationError('Variable not found');
  if (updates.group_id !== undefined) assertGroup(graph, variable.set_id, updates.group_id);
  validateCssVariableValues({ ...graph, variables: graph.variables.map(v => v.id === id ? { ...v, ...updates } : v) });
  const { data, error } = await client
    .from('css_variables')
    .update({ ...updates, updated_at: new Date().toISOString() })
    .eq('id', id)
    .select()
    .single();

  if (error) throw new Error(`Failed to update CSS variable: ${error.message}`);
  return data as CssVariable;
}

export async function deleteCssVariable(id: string, tenantId?: string): Promise<void> {
  id = cssVariableIdSchema.parse(id);
  const graph = await getCssVariablesGraph(tenantId);
  const removed = new Set([id]);
  if (graph.values.some(v => !removed.has(v.css_variable_id) && removed.has(CSS_VARIABLE_REFERENCE.exec(v.value)?.[1] ?? ''))) throw new CssVariableValidationError('Remove aliases referencing these variables first');
  const client = await getClient(tenantId);
  const { error } = await client.from('css_variables').delete().eq('id', id);
  if (error) throw new Error(`Failed to delete CSS variable: ${error.message}`);
}

export async function reorderCssVariables(orderedIds: string[], tenantId?: string): Promise<void> {
  await reorderRows('css_variables', orderedIds, tenantId);
}

// ----- Values ---------------------------------------------------------------

export async function upsertCssVariableValue(
  data: UpsertCssVariableValueData,
  tenantId?: string
): Promise<CssVariableValue> {
  data = cssVariableValueSchema.parse(data);
  await upsertCssVariableValues([data], tenantId);
  const graph = await getCssVariablesGraph(tenantId);
  const row = graph.values.find(v => v.css_variable_id === data.css_variable_id && v.mode_id === data.mode_id);
  if (!row) throw new Error('Saved CSS variable value not found');
  return row;
}

export async function upsertCssVariableValues(
  values: UpsertCssVariableValueData[],
  tenantId?: string
): Promise<void> {
  values = cssVariableValueSchema.array().max(1000).parse(values);
  const graph = await getCssVariablesGraph(tenantId);
  const keys = new Set(values.map(v => `${v.css_variable_id}:${v.mode_id}`));
  if (keys.size !== values.length) throw new CssVariableValidationError('Duplicate variable/mode values');
  const nowForValidation = new Date().toISOString();
  validateCssVariableValues({ ...graph, values: [...graph.values.filter(v => !keys.has(`${v.css_variable_id}:${v.mode_id}`)), ...values.map(v => ({ ...v, created_at: nowForValidation, updated_at: nowForValidation }))] });
  if (values.length === 0) return;
  const client = await getClient(tenantId);
  const now = new Date().toISOString();
  const { error } = await client
    .from('css_variable_values')
    .upsert(
      values.map((v) => ({ ...v, updated_at: now })),
      { onConflict: 'css_variable_id,mode_id' }
    );
  if (error) throw new Error(`Failed to upsert CSS variable values: ${error.message}`);
}

export async function deleteCssVariableValue(
  cssVariableId: string,
  modeId: string,
  tenantId?: string
): Promise<void> {
  const client = await getClient(tenantId);
  const { error } = await client
    .from('css_variable_values')
    .delete()
    .eq('css_variable_id', cssVariableId)
    .eq('mode_id', modeId);
  if (error) throw new Error(`Failed to delete CSS variable value: ${error.message}`);
}

// ----- Internal helpers -----------------------------------------------------

/**
 * Batch reorder rows of any table by upserting `sort_order` based on the order
 * of `orderedIds`. Fetches full rows first so NOT NULL columns are preserved.
 */
async function reorderRows(
  table: 'css_variable_sets' | 'css_variable_set_modes' | 'css_variable_groups' | 'css_variables',
  orderedIds: string[],
  tenantId?: string
): Promise<void> {
  orderedIds = cssVariableOrderSchema.parse(orderedIds);
  if (orderedIds.length === 0) return;
  const client = await getClient(tenantId);

  const { data: existing, error: fetchError } = await client
    .from(table)
    .select('*')
    .in('id', orderedIds);

  if (fetchError) throw new Error(`Failed to fetch ${table} for reorder: ${fetchError.message}`);

  const existingMap = new Map((existing || []).map((r: { id: string }) => [r.id, r]));
  const now = new Date().toISOString();
  const updates = orderedIds
    .map((id, index) => {
      const row = existingMap.get(id);
      if (!row) return null;
      return { ...row, sort_order: index, updated_at: now };
    })
    .filter((row): row is NonNullable<typeof row> => row !== null);

  if (updates.length === 0) return;

  const { error } = await client.from(table).upsert(updates, { onConflict: 'id' });
  if (error) throw new Error(`Failed to reorder ${table}: ${error.message}`);
}

// Backwards-compat type aliases for the graph shape used in this file
export type { CssVariable, CssVariableGroup, CssVariableSet, CssVariableSetMode, CssVariableValue };

function assertGroup(graph: CssVariablesGraph, setId: string, groupId?: string | null): void {
  if (!graph.sets.some(s => s.id === setId)) throw new CssVariableValidationError('Collection not found');
  if (!groupId || !graph.groups.some(g => g.id === groupId && g.set_id === setId)) throw new CssVariableValidationError('Group must belong to the same collection');
}
