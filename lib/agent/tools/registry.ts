import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { registerPageTools } from '@/lib/mcp/tools/pages';
import { registerPageFolderTools } from '@/lib/mcp/tools/page-folders';
import { registerLayerTools } from '@/lib/mcp/tools/layers';
import { registerBatchTools } from '@/lib/mcp/tools/batch';
import { registerLayoutTools } from '@/lib/mcp/tools/layouts';
import { registerCollectionTools } from '@/lib/mcp/tools/collections';
import { registerCollectionLayerTools } from '@/lib/mcp/tools/collection-layers';
import { registerStyleTools } from '@/lib/mcp/tools/styles';
import { registerAssetTools } from '@/lib/mcp/tools/assets';
import { registerAssetFolderTools } from '@/lib/mcp/tools/asset-folders';
import { registerComponentTools } from '@/lib/mcp/tools/components';
import { registerCssVariableTools } from '@/lib/mcp/tools/css-variables';
import { registerColorVariableTools } from '@/lib/mcp/tools/color-variables';
import { registerFontTools } from '@/lib/mcp/tools/fonts';
import { registerLocaleTools } from '@/lib/mcp/tools/locales';
import { registerFormTools } from '@/lib/mcp/tools/forms';
import { registerSettingsTools } from '@/lib/mcp/tools/settings';
import { registerPublishingTools } from '@/lib/mcp/tools/publishing';
import { registerAnimationTools } from '@/lib/mcp/tools/animations';

import type { AgentTool, AgentToolGroup, AgentToolResult } from './types';

/**
 * Shared, framework-agnostic tool registry.
 *
 * The existing MCP tool files register their tools by calling
 * `server.tool(name, description, zodRawShape, handler)`. Rather than rewrite
 * all of them, we replay the exact same registration calls against a lightweight
 * collecting host. This captures every tool's name, description, schema, and
 * handler without touching the MCP code path — so the MCP server (external
 * agents) and the in-app agent runtime are guaranteed to expose identical tools.
 */

type ToolRegistrar = (server: McpServer) => void;

/**
 * Every registrar from createMcpServer, MINUS the resource registrars
 * (registerReferenceResources / registerSiteResources), which expose read-only
 * MCP resources rather than callable tools.
 */
const TOOL_REGISTRARS: Array<[ToolRegistrar, AgentToolGroup]> = [
  [registerPageTools, 'core'],
  [registerPageFolderTools, 'site'],
  [registerLayerTools, 'core'],
  [registerBatchTools, 'core'],
  [registerLayoutTools, 'core'],
  [registerCollectionTools, 'cms'],
  [registerCollectionLayerTools, 'cms'],
  [registerStyleTools, 'styles'],
  [registerAssetTools, 'core'],
  [registerAssetFolderTools, 'site'],
  [registerComponentTools, 'components'],
  [registerColorVariableTools, 'core'],
  [registerCssVariableTools, 'styles'],
  [registerFontTools, 'core'],
  [registerLocaleTools, 'localization'],
  [registerFormTools, 'site'],
  [registerSettingsTools, 'site'],
  [registerPublishingTools, 'site'],
  [registerAnimationTools, 'animations'],
];

/**
 * Per-tool group overrides for tools whose registrar default doesn't fit.
 * Redirects are registered by the pages file but are site-level config, and
 * form-submission settings live in the layers file but building a working
 * contact form is a core task.
 */
const TOOL_GROUP_OVERRIDES: Record<string, AgentToolGroup> = {
  list_redirects: 'site',
  add_redirect: 'site',
  update_redirect: 'site',
  delete_redirect: 'site',
};

/** The raw handler shape every tool file passes as the 4th arg to server.tool. */
type RawToolHandler = (args: Record<string, unknown>) => Promise<AgentToolResult>;

interface CollectedTool {
  name: string;
  description: string;
  inputSchema: z.ZodRawShape;
  handler: RawToolHandler;
  group: AgentToolGroup;
}

/** The single `server.tool(...)` overload every tool file actually uses. */
interface CollectingHost {
  tool: (
    name: string,
    description: string,
    inputSchema: z.ZodRawShape,
    handler: RawToolHandler,
  ) => void;
}

/**
 * A stand-in for McpServer that records `server.tool(...)` calls instead of
 * wiring them to an MCP transport. Only the 4-arg overload is used by the
 * tool files (verified across all of lib/mcp/tools), so that is all we capture.
 */
function createCollectingHost(sink: CollectedTool[], group: AgentToolGroup): CollectingHost {
  return {
    tool(name, description, inputSchema, handler) {
      sink.push({ name, description, inputSchema, handler, group: TOOL_GROUP_OVERRIDES[name] ?? group });
    },
  };
}

/**
 * Tools the in-app agent must NOT expose, even though the shared MCP tool files
 * register them.
 *
 * `publish` pushes every draft live. The in-app builder is a draft-first surface:
 * the user reviews the agent's edits on the canvas and clicks Publish when ready.
 * Letting the agent auto-publish made changes go live immediately, so the user's
 * own Publish button then reported "no changes" (the edits were already live).
 * Leaving it out keeps the human in control of what ships.
 *
 * `get_unpublished_changes` stays available — it is read-only status reporting.
 *
 * External MCP clients are unaffected: createMcpServer registers these tools
 * directly rather than through this registry.
 */
const EXCLUDED_AGENT_TOOLS = new Set<string>(['publish']);

let cachedTools: AgentTool[] | null = null;

/**
 * Collect every building tool as a framework-agnostic descriptor.
 *
 * Each descriptor's `execute` validates incoming args against the tool's zod
 * schema (applying defaults, stripping unknown keys) exactly as the MCP SDK
 * does before invoking the handler.
 */
export function getAgentTools(): AgentTool[] {
  if (cachedTools) return cachedTools;

  const collected: CollectedTool[] = [];
  for (const [register, group] of TOOL_REGISTRARS) {
    register(createCollectingHost(collected, group) as unknown as McpServer);
  }

  const tools = collected
    .filter((tool) => !EXCLUDED_AGENT_TOOLS.has(tool.name))
    .map((tool): AgentTool => {
      const schema = z.object(tool.inputSchema);
      return {
        name: tool.name,
        description: tool.description,
        inputSchema: tool.inputSchema,
        group: tool.group,
        execute: async (args) => {
          const parsed = schema.parse(args ?? {}) as Record<string, unknown>;
          return tool.handler(parsed);
        },
      };
    });

  // Tool names must be unique across files — the LLM and MCP both key on name.
  const seen = new Set<string>();
  for (const tool of tools) {
    if (seen.has(tool.name)) {
      throw new Error(`Duplicate agent tool name: "${tool.name}"`);
    }
    seen.add(tool.name);
  }

  cachedTools = tools;
  return cachedTools;
}

let cachedToolMap: Map<string, AgentTool> | null = null;

/** Tool descriptors keyed by name, for fast lookup during a tool-calling loop. */
export function getAgentToolMap(): Map<string, AgentTool> {
  if (cachedToolMap) return cachedToolMap;
  cachedToolMap = new Map(getAgentTools().map((tool) => [tool.name, tool]));
  return cachedToolMap;
}
