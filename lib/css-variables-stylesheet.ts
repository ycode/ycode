/**
 * CSS Variable Stylesheet Builder (pure, client-safe)
 *
 * Builds the `<style>` content shipped to the public site, the canvas iframe,
 * and the preview. Emits:
 *   - `:root { ... }` for default-mode values of every set
 *   - `[data-theme="..."] { ... }` for theme-activation modes
 *   - `@media (min-width: ...) { :root { ... } }` for breakpoint-activation modes
 *
 * This module has NO server-only imports so it can be used from client
 * components, the Zustand store, and the canvas iframe injector. The async
 * server-side helper that fetches the graph lives in
 * {@link ./repositories/cssVariableRepository.generateCssVariablesStylesheet}.
 */

import { isValidCssVariableValue } from '@/lib/css-variable-utils';
import { toCssColorValue } from '@/lib/color-utils';
import type {
  CssVariable,
  CssVariableSetMode,
  CssVariableType,
  CssVariablesGraph,
} from '@/types';

/** Convert a stored value to its CSS form, dispatching on the variable type. */
export function formatCssVariableValue(type: CssVariableType, value: string): string {
  if (!value) return value;
  if (type === 'color') return toCssColorValue(value);
  // Other types pass through (size/percentage/number/font_family — and `var(...)` references)
  return value;
}

interface DeclarationGroup {
  selector: string;
  mediaQuery: string | null;
  declarations: string[];
}

/** Build the stylesheet string from a fully resolved graph. */
export function buildCssVariablesStylesheet(graph: CssVariablesGraph): string {
  const modesBySet = new Map<string, CssVariableSetMode[]>();
  for (const mode of graph.modes) {
    const list = modesBySet.get(mode.set_id) ?? [];
    list.push(mode);
    modesBySet.set(mode.set_id, list);
  }

  // Index values by (variable, mode)
  const valueLookup = new Map<string, string>();
  for (const v of graph.values) {
    valueLookup.set(`${v.css_variable_id}:${v.mode_id}`, v.value);
  }

  const groups: DeclarationGroup[] = [];
  const rootDeclarations: string[] = [];

  for (const set of graph.sets) {
    const modes = (modesBySet.get(set.id) ?? []).slice().sort((a, b) => set.activation_kind === 'breakpoint'
      ? (a.min_width ?? -1) - (b.min_width ?? -1) || a.sort_order - b.sort_order
      : a.sort_order - b.sort_order);
    if (modes.length === 0) continue;

    const defaultMode = modes.find((m) => m.is_default) ?? modes[0];
    const setVariables = graph.variables.filter((v) => v.set_id === set.id);

    // Default-mode declarations always land on :root
    for (const variable of setVariables) {
      const raw = valueLookup.get(`${variable.id}:${defaultMode.id}`);
      if (raw === undefined || raw === '' || !isValidCssVariableValue(variable.type, raw)) continue;
      rootDeclarations.push(`--${variable.id}: ${formatCssVariableValue(variable.type, raw)};`);
    }

    if (set.activation_kind === 'theme') {
      for (const mode of modes) {
        if (mode.id === defaultMode.id) continue;
        if (!mode.data_theme || /[<>\n\r]/.test(mode.data_theme)) continue;
        const decls = collectModeDeclarations(setVariables, mode, valueLookup);
        if (decls.length === 0) continue;
        groups.push({
          selector: `[data-theme="${escapeAttribute(mode.data_theme)}"]`,
          mediaQuery: null,
          declarations: decls,
        });
      }
    } else if (set.activation_kind === 'breakpoint') {
      for (const mode of modes) {
        if (mode.id === defaultMode.id) continue;
        if (mode.min_width === null || !Number.isSafeInteger(mode.min_width) || mode.min_width < 0) continue;
        const decls = collectModeDeclarations(setVariables, mode, valueLookup);
        if (decls.length === 0) continue;
        groups.push({
          selector: ':root',
          mediaQuery: `@media (min-width: ${mode.min_width}px)`,
          declarations: decls,
        });
      }
    }
  }

  const parts: string[] = [];
  if (rootDeclarations.length > 0) {
    parts.push(`:root { ${rootDeclarations.join(' ')} }`);
  }
  for (const group of groups) {
    const rule = `${group.selector} { ${group.declarations.join(' ')} }`;
    if (group.mediaQuery) parts.push(`${group.mediaQuery} { ${rule} }`);
    else parts.push(rule);
  }

  return parts.join(' ');
}

function collectModeDeclarations(
  variables: CssVariable[],
  mode: CssVariableSetMode,
  valueLookup: Map<string, string>
): string[] {
  const decls: string[] = [];
  for (const variable of variables) {
    const raw = valueLookup.get(`${variable.id}:${mode.id}`);
    if (raw === undefined || raw === '' || !isValidCssVariableValue(variable.type, raw)) continue;
    decls.push(`--${variable.id}: ${formatCssVariableValue(variable.type, raw)};`);
  }
  return decls;
}

function escapeAttribute(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}
