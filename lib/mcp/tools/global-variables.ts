import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import {
  getAllGlobalVariables,
  getGlobalVariableById,
  createGlobalVariable,
  updateGlobalVariable,
  softDeleteGlobalVariable,
} from '@/lib/repositories/globalVariableRepository';
import { broadcastGlobalVariablesChanged } from '@/lib/mcp/broadcast';
import { coerceGlobalVariableValue } from '@/lib/mcp/utils';
import { GLOBAL_VARIABLE_TYPES } from '@/types';
import type { GlobalVariable, GlobalVariableType, UpdateGlobalVariableData } from '@/types';

const globalTypeEnum = z.enum(GLOBAL_VARIABLE_TYPES as unknown as [GlobalVariableType, ...GlobalVariableType[]]);

const VALUE_FORMATS = `Value format by type: text = plain string; number = numeric string ("10");
rich_text = markdown string; date = ISO string; color = "#hex"; image = asset ID; link = URL.
Store values that include a currency or suffix ("$0.12", "1,000+") as text — a number renders
as the bare number.`;

function toSummary(variable: GlobalVariable) {
  return { id: variable.id, name: variable.name, key: variable.key, type: variable.type, value: variable.value };
}

export function registerGlobalVariableTools(server: McpServer) {
  server.tool(
    'list_global_variables',
    `List the site-wide global variables (name / type / value). Bind one into text on any page with
set_dynamic_text or bind_layer_field using source "global" and field_id = the global's id.`,
    {},
    async () => {
      const variables = await getAllGlobalVariables();
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(variables.map(toSummary), null, 2) }],
      };
    },
  );

  server.tool(
    'create_global_variable',
    `Create a site-wide global variable: a single value (price, count, contact email…) reused across
pages, components and locales. Changing it later updates every layer bound to it.
${VALUE_FORMATS}`,
    {
      name: z.string().min(1).describe('Display name, e.g. "Price per photo"'),
      type: globalTypeEnum.describe('Value type'),
      value: z.string().nullable().optional().describe('Initial value'),
    },
    async ({ name, type, value }) => {
      const variable = await createGlobalVariable({
        name,
        type,
        value: coerceGlobalVariableValue(type, value ?? null),
      });
      await broadcastGlobalVariablesChanged();
      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({
            message: `Created global variable "${name}"`,
            variable: toSummary(variable),
            usage: `Bind with source "global" and field_id "${variable.id}"`,
          }, null, 2),
        }],
      };
    },
  );

  server.tool(
    'update_global_variable',
    `Update a global variable's name, type or value. Every bound layer shows the new value after
publishing. ${VALUE_FORMATS}`,
    {
      global_id: z.string().describe('The global variable ID'),
      name: z.string().min(1).optional().describe('New name'),
      type: globalTypeEnum.optional().describe('New type (pass a matching value)'),
      value: z.string().nullable().optional().describe('New value (null clears it)'),
    },
    async ({ global_id, name, type, value }) => {
      const existing = await getGlobalVariableById(global_id);
      if (!existing) {
        return { content: [{ type: 'text' as const, text: `Error: Global variable "${global_id}" not found.` }], isError: true };
      }

      const nextType = type ?? existing.type;
      const updates: UpdateGlobalVariableData = {};
      if (name !== undefined) updates.name = name;
      if (type !== undefined) updates.type = type;
      if (value !== undefined) updates.value = coerceGlobalVariableValue(nextType, value);

      const variable = await updateGlobalVariable(global_id, updates);
      await broadcastGlobalVariablesChanged();
      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({ message: `Updated global variable "${variable.name}"`, variable: toSummary(variable) }, null, 2),
        }],
      };
    },
  );

  server.tool(
    'delete_global_variable',
    'Delete a global variable. Layers bound to it render empty once the deletion is published.',
    {
      global_id: z.string().describe('The global variable ID to delete'),
    },
    async ({ global_id }) => {
      const existing = await getGlobalVariableById(global_id);
      if (!existing) {
        return { content: [{ type: 'text' as const, text: `Error: Global variable "${global_id}" not found.` }], isError: true };
      }

      await softDeleteGlobalVariable(global_id);
      await broadcastGlobalVariablesChanged();
      return {
        content: [{ type: 'text' as const, text: `Global variable ${global_id} deleted.` }],
      };
    },
  );
}
