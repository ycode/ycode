import { z } from 'zod';

import { getAgentTools } from '@/lib/agent/tools/registry';

import type { AgentTool, AgentToolGroup } from './types';

/**
 * Deferred tool loading for the in-app agent.
 *
 * The full registry is ~113 tools (~30k tokens of schemas) and every schema is
 * re-sent (or cache-read) on every model call, so a multi-turn edit pays for
 * the whole registry many times over. Most requests only ever touch the core
 * building tools, so the runtime sends `core` up front and withholds the rest
 * behind a `load_tools` meta-tool. The runtime also auto-loads a group when the
 * model calls one of its tools directly (the system instructions document the
 * important deferred tools by name, so the model often knows what to call).
 *
 * External MCP clients are unaffected — createMcpServer registers every tool.
 */

export const LOAD_TOOLS_NAME = 'load_tools';

const DEFERRED_GROUPS: Exclude<AgentToolGroup, 'core'>[] = [
  'cms',
  'components',
  'styles',
  'animations',
  'localization',
  'site',
];

const GROUP_HINTS: Record<Exclude<AgentToolGroup, 'core'>, string> = {
  cms: 'collections, collection items/fields, collection lists on pages, filtering, field binding, dynamic text, site-wide global variables',
  components: 'reusable components, variants, component layer editing, reusing/instancing a component on a page',
  styles: 'shared reusable styles (create/apply/update, combo stacks)',
  animations: 'GSAP animation presets and raw interactions',
  localization: 'locales and translations',
  site: 'site settings, redirects, form submissions, page/asset folders, unpublished-changes status, importing user-provided HTML',
};

/** Names of the tools in each deferred group, for discovery via load_tools. */
export function getDeferredGroupCatalog(): Array<{ group: Exclude<AgentToolGroup, 'core'>; hint: string; tools: string[] }> {
  const byGroup = new Map<AgentToolGroup, string[]>();
  for (const tool of getAgentTools()) {
    const list = byGroup.get(tool.group) ?? [];
    list.push(tool.name);
    byGroup.set(tool.group, list);
  }
  return DEFERRED_GROUPS.map((group) => ({
    group,
    hint: GROUP_HINTS[group],
    tools: byGroup.get(group) ?? [],
  }));
}

/**
 * Build the `load_tools` meta-tool descriptor. Its execute is a placeholder —
 * the runtime intercepts calls to it and swaps the active toolset itself.
 */
export function buildLoadToolsTool(): AgentTool {
  const catalog = getDeferredGroupCatalog()
    .map((entry) => `- ${entry.group} (${entry.hint}): ${entry.tools.join(', ')}`)
    .join('\n');

  return {
    name: LOAD_TOOLS_NAME,
    description:
      'Load additional tool groups into this conversation. Only the core building tools are available by default; '
      + 'call this BEFORE using any tool from these groups (loaded tools stay available for the rest of the conversation):\n'
      + catalog,
    inputSchema: {
      groups: z.array(z.enum(DEFERRED_GROUPS)).min(1).describe('Tool group(s) to load'),
    },
    group: 'core',
    execute: async () => ({
      content: [{ type: 'text', text: 'Tools loaded.' }],
    }),
  };
}

/** Look up the deferred group a tool belongs to, or null for core/unknown tools. */
export function deferredGroupOf(toolName: string): Exclude<AgentToolGroup, 'core'> | null {
  const tool = getAgentTools().find((entry) => entry.name === toolName);
  if (!tool || tool.group === 'core') return null;
  return tool.group;
}
