/**
 * CSS Variable Stylesheet Generator (server-side)
 *
 * Thin server-side wrapper around the pure
 * {@link import('@/lib/css-variables-stylesheet').buildCssVariablesStylesheet}
 * builder that fetches the graph from the database first. Use this from
 * server components and API routes; client code should call the pure builder
 * directly from `lib/css-variables-stylesheet`.
 */

import { buildCssVariablesStylesheet, formatCssVariableValue } from '@/lib/css-variables-stylesheet';
import { getCssVariablesGraph } from '@/lib/repositories/cssVariableRepository';

export { buildCssVariablesStylesheet, formatCssVariableValue };

/**
 * Fetch the graph and produce the stylesheet. Returns null when no variables exist.
 */
export async function generateCssVariablesStylesheet(tenantId?: string): Promise<string | null> {
  try {
    const graph = await getCssVariablesGraph(tenantId);
    if (graph.sets.length === 0) return null;
    const css = buildCssVariablesStylesheet(graph);
    return css || null;
  } catch {
    return null;
  }
}
