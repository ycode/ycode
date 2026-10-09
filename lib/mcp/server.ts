/**
 * MCP Server Factory
 *
 * Creates a new McpServer instance with all tools and resources registered.
 * Each HTTP session gets its own server instance.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { DEFERRED_GROUP_GUIDES, MCP_PUBLISHING_INSTRUCTIONS, SYSTEM_INSTRUCTIONS } from '@/lib/mcp/instructions';
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
import { registerColorVariableTools } from '@/lib/mcp/tools/color-variables';
import { registerCssVariableTools } from '@/lib/mcp/tools/css-variables';
import { registerFontTools } from '@/lib/mcp/tools/fonts';
import { registerLocaleTools } from '@/lib/mcp/tools/locales';
import { registerFormTools } from '@/lib/mcp/tools/forms';
import { registerSettingsTools } from '@/lib/mcp/tools/settings';
import { registerPublishingTools } from '@/lib/mcp/tools/publishing';
import { registerAnimationTools } from '@/lib/mcp/tools/animations';
import { registerReferenceResources } from '@/lib/mcp/resources/reference';
import { registerSiteResources } from '@/lib/mcp/resources/site';

export function createMcpServer(): McpServer {
  // External MCP agents get every tool up front, so they also get the full
  // deferred-group guides plus the publishing instructions. The in-app agent
  // runtime uses SYSTEM_INSTRUCTIONS alone, delivers group guides via
  // load_tools, and appends its own draft-first (never publish) policy instead.
  const server = new McpServer(
    { name: 'ycode', version: '1.0.0' },
    { instructions: SYSTEM_INSTRUCTIONS + '\n' + Object.values(DEFERRED_GROUP_GUIDES).join('\n\n') + MCP_PUBLISHING_INSTRUCTIONS },
  );

  registerPageTools(server);
  registerPageFolderTools(server);
  registerLayerTools(server);
  registerBatchTools(server);
  registerLayoutTools(server);
  registerCollectionTools(server);
  registerCollectionLayerTools(server);
  registerStyleTools(server);
  registerAssetTools(server);
  registerAssetFolderTools(server);
  registerComponentTools(server);
  registerColorVariableTools(server);
  registerCssVariableTools(server);
  registerFontTools(server);
  registerLocaleTools(server);
  registerFormTools(server);
  registerSettingsTools(server);
  registerPublishingTools(server);
  registerAnimationTools(server);

  registerReferenceResources(server);
  registerSiteResources(server);

  return server;
}
