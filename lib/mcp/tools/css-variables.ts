import { broadcastColorVariablesChanged } from '@/lib/mcp/broadcast';
import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import {
  createCssVariable,
  createCssVariableGroup,
  createCssVariableSet,
  createCssVariableSetMode,
  deleteCssVariable,
  deleteCssVariableGroup,
  deleteCssVariableSet,
  deleteCssVariableSetMode,
  getCssVariablesGraph,
  updateCssVariable,
  updateCssVariableGroup,
  updateCssVariableSet,
  updateCssVariableSetMode,
  upsertCssVariableValue,
} from '@/lib/repositories/cssVariableRepository';

const variableTypeSchema = z.enum(['color', 'size', 'percentage', 'number', 'font_family']);
const activationKindSchema = z.enum(['default', 'theme', 'breakpoint']);

/**
 * Register MCP tools that expose the typed CSS variables system to agents.
 * Each entity (set, mode, group, variable, value) gets its own CRUD surface.
 */
export function registerCssVariableTools(server: McpServer) {
  server.tool(
    'get_css_variables_graph',
    'Return the full CSS variables graph: sets, modes, groups, variables and values. Reference any variable in design properties as var(--<variable_id>).',
    {},
    async () => {
      const graph = await getCssVariablesGraph();
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(graph, null, 2) }],
      };
    },
  );

  // --- Sets ---------------------------------------------------------------

  server.tool(
    'create_css_variable_set',
    'Create a new CSS variable set (top-level container for related variables). Theme sets activate via [data-theme=...]; breakpoint sets activate via @media (min-width: ...).',
    {
      name: z.string().describe('Set name (e.g. "Theme", "Spacing scale")'),
      activation_kind: activationKindSchema.optional().describe('default | theme | breakpoint (default: "default")'),
    },
    async ({ name, activation_kind }) => {
      const set = await createCssVariableSet({ name, activation_kind });
      await broadcastColorVariablesChanged();
      return { content: [{ type: 'text' as const, text: JSON.stringify(set, null, 2) }] };
    },
  );

  server.tool(
    'update_css_variable_set',
    'Update a CSS variable set name or activation kind.',
    {
      set_id: z.string(),
      name: z.string().optional(),
      activation_kind: activationKindSchema.optional(),
    },
    async ({ set_id, name, activation_kind }) => {
      const set = await updateCssVariableSet(set_id, { name, activation_kind });
      await broadcastColorVariablesChanged();
      return { content: [{ type: 'text' as const, text: JSON.stringify(set, null, 2) }] };
    },
  );

  server.tool(
    'delete_css_variable_set',
    'Delete a CSS variable set and all of its modes, groups, variables and values.',
    { set_id: z.string() },
    async ({ set_id }) => {
      await deleteCssVariableSet(set_id);
      await broadcastColorVariablesChanged();
      return { content: [{ type: 'text' as const, text: `Set ${set_id} deleted.` }] };
    },
  );

  // --- Modes --------------------------------------------------------------

  server.tool(
    'create_css_variable_set_mode',
    'Create a new mode in a set. For theme sets, set `data_theme` (e.g. "dark"). For breakpoint sets, set `min_width` (px).',
    {
      set_id: z.string(),
      name: z.string(),
      is_default: z.boolean().optional(),
      data_theme: z.string().nullable().optional(),
      min_width: z.number().nullable().optional(),
    },
    async (input) => {
      const mode = await createCssVariableSetMode(input);
      await broadcastColorVariablesChanged();
      return { content: [{ type: 'text' as const, text: JSON.stringify(mode, null, 2) }] };
    },
  );

  server.tool(
    'update_css_variable_set_mode',
    'Update mode metadata.',
    {
      mode_id: z.string(),
      name: z.string().optional(),
      is_default: z.boolean().optional(),
      data_theme: z.string().nullable().optional(),
      min_width: z.number().nullable().optional(),
    },
    async ({ mode_id, ...rest }) => {
      const mode = await updateCssVariableSetMode(mode_id, rest);
      await broadcastColorVariablesChanged();
      return { content: [{ type: 'text' as const, text: JSON.stringify(mode, null, 2) }] };
    },
  );

  server.tool(
    'delete_css_variable_set_mode',
    'Delete a mode. Values bound to this mode are removed.',
    { mode_id: z.string() },
    async ({ mode_id }) => {
      await deleteCssVariableSetMode(mode_id);
      await broadcastColorVariablesChanged();
      return { content: [{ type: 'text' as const, text: `Mode ${mode_id} deleted.` }] };
    },
  );

  // --- Groups -------------------------------------------------------------

  server.tool(
    'create_css_variable_group',
    'Create a group inside a set for organising variables (e.g. "Background colors").',
    { set_id: z.string(), name: z.string() },
    async (input) => {
      const group = await createCssVariableGroup(input);
      await broadcastColorVariablesChanged();
      return { content: [{ type: 'text' as const, text: JSON.stringify(group, null, 2) }] };
    },
  );

  server.tool(
    'update_css_variable_group',
    'Rename a CSS variable group.',
    { group_id: z.string(), name: z.string().optional() },
    async ({ group_id, name }) => {
      const group = await updateCssVariableGroup(group_id, { name });
      await broadcastColorVariablesChanged();
      return { content: [{ type: 'text' as const, text: JSON.stringify(group, null, 2) }] };
    },
  );

  server.tool(
    'delete_css_variable_group',
    'Delete a group. Variables move to another group in the same collection.',
    { group_id: z.string() },
    async ({ group_id }) => {
      await deleteCssVariableGroup(group_id);
      await broadcastColorVariablesChanged();
      return { content: [{ type: 'text' as const, text: `Group ${group_id} deleted.` }] };
    },
  );

  // --- Variables ----------------------------------------------------------

  server.tool(
    'create_css_variable',
    'Create a typed CSS variable inside a set. Reference it from design properties as var(--<returned id>).',
    {
      set_id: z.string(),
      type: variableTypeSchema,
      name: z.string(),
      group_id: z.string().nullable().optional(),
    },
    async (input) => {
      const variable = await createCssVariable(input);
      await broadcastColorVariablesChanged();
      return { content: [{ type: 'text' as const, text: JSON.stringify(variable, null, 2) }] };
    },
  );

  server.tool(
    'update_css_variable',
    'Update a CSS variable\'s name, group or type.',
    {
      variable_id: z.string(),
      name: z.string().optional(),
      group_id: z.string().nullable().optional(),
      type: variableTypeSchema.optional(),
    },
    async ({ variable_id, ...rest }) => {
      const variable = await updateCssVariable(variable_id, rest);
      await broadcastColorVariablesChanged();
      return { content: [{ type: 'text' as const, text: JSON.stringify(variable, null, 2) }] };
    },
  );

  server.tool(
    'delete_css_variable',
    'Delete a CSS variable and all of its values across modes.',
    { variable_id: z.string() },
    async ({ variable_id }) => {
      await deleteCssVariable(variable_id);
      await broadcastColorVariablesChanged();
      return { content: [{ type: 'text' as const, text: `Variable ${variable_id} deleted.` }] };
    },
  );

  // --- Values -------------------------------------------------------------

  server.tool(
    'set_css_variable_value',
    'Set the value of a CSS variable for a specific mode. Use a plain string (e.g. "1rem", "#ff0000/80", "Inter, sans-serif") or `var(--<other_variable_id>)` to reference another CSS variable of the same type.',
    {
      css_variable_id: z.string(),
      mode_id: z.string(),
      value: z.string(),
    },
    async (input) => {
      const row = await upsertCssVariableValue(input);
      await broadcastColorVariablesChanged();
      return { content: [{ type: 'text' as const, text: JSON.stringify(row, null, 2) }] };
    },
  );
}
