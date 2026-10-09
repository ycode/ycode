/** Compatibility API for existing color pickers, renderers and integrations. */
import { generateContentHash } from '@/lib/hash-utils';
import { getDefaultColorVariables } from '@/lib/css-variable-utils';
import { generateCssVariablesStylesheet } from '@/lib/repositories/cssVariableStylesheetGenerator';
import {
  getCssVariablesGraph, createCssVariableSet, createCssVariable,
  updateCssVariable, deleteCssVariable, reorderCssVariables, upsertCssVariableValue,
} from '@/lib/repositories/cssVariableRepository';
import type { ColorVariable } from '@/types';

export interface CreateColorVariableData { name: string; value: string }
export interface UpdateColorVariableData { name?: string; value?: string }

export async function generateColorVariablesCss(tenantId?: string): Promise<string | null> {
  return generateCssVariablesStylesheet(tenantId);
}

export async function getAllColorVariables(tenantId?: string): Promise<ColorVariable[]> {
  return getDefaultColorVariables(await getCssVariablesGraph(tenantId));
}

export async function getColorVariableById(id: string, tenantId?: string): Promise<ColorVariable | null> {
  return (await getAllColorVariables(tenantId)).find(v => v.id === id) ?? null;
}

export async function createColorVariable(data: CreateColorVariableData, tenantId?: string): Promise<ColorVariable> {
  let graph = await getCssVariablesGraph(tenantId);
  let collection = graph.sets.find(s => s.name === 'Colors' && s.activation_kind === 'default');
  if (!collection) {
    collection = await createCssVariableSet({ name: 'Colors' }, tenantId);
    graph = await getCssVariablesGraph(tenantId);
  }
  const mode = graph.modes.find(m => m.set_id === collection.id && m.is_default);
  if (!mode) throw new Error('Default color mode not found');
  const variable = await createCssVariable({ set_id: collection.id, type: 'color', name: data.name }, tenantId);
  try {
    await upsertCssVariableValue({ css_variable_id: variable.id, mode_id: mode.id, value: data.value }, tenantId);
  } catch (error) {
    await deleteCssVariable(variable.id, tenantId);
    throw error;
  }
  return { ...variable, value: data.value };
}

export async function updateColorVariable(id: string, updates: UpdateColorVariableData, tenantId?: string): Promise<ColorVariable> {
  const graph = await getCssVariablesGraph(tenantId);
  const variable = graph.variables.find(v => v.id === id && v.type === 'color');
  if (!variable) throw new Error('Color variable not found');
  const mode = graph.modes.find(m => m.set_id === variable.set_id && m.is_default);
  if (!mode) throw new Error('Default color mode not found');
  if (updates.value !== undefined) await upsertCssVariableValue({ css_variable_id: id, mode_id: mode.id, value: updates.value }, tenantId);
  if (updates.name !== undefined) await updateCssVariable(id, { name: updates.name }, tenantId);
  const result = await getColorVariableById(id, tenantId);
  if (!result) throw new Error('Color variable not found after saving');
  return result;
}

export async function deleteColorVariable(id: string, tenantId?: string): Promise<void> {
  const variable = await getColorVariableById(id, tenantId);
  if (!variable) throw new Error('Color variable not found');
  await deleteCssVariable(id, tenantId);
}

export async function reorderColorVariables(ids: string[], tenantId?: string): Promise<void> {
  await reorderCssVariables(ids, tenantId);
}

export async function getColorVariablesHash(tenantId?: string): Promise<string> {
  const variables = await getAllColorVariables(tenantId);
  return generateContentHash(variables.map(v => ({ id: v.id, name: v.name, value: v.value, sort_order: v.sort_order })));
}
