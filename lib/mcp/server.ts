/**
 * MCP Server Factory
 *
 * Creates a new McpServer instance with all tools and resources registered.
 * Each HTTP session gets its own server instance.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { SYSTEM_INSTRUCTIONS } from '@/lib/mcp/instructions';
import { registerPageTools } from '@/lib/mcp/tools/pages';
import { registerLayerTools } from '@/lib/mcp/tools/layers';
import { registerBatchTools } from '@/lib/mcp/tools/batch';
import { registerLayoutTools } from '@/lib/mcp/tools/layouts';
import { registerCollectionTools } from '@/lib/mcp/tools/collections';
import { registerStyleTools } from '@/lib/mcp/tools/styles';
import { registerAssetTools } from '@/lib/mcp/tools/assets';
import { registerComponentTools } from '@/lib/mcp/tools/components';
import { registerPublishingTools } from '@/lib/mcp/tools/publishing';
import { registerReferenceResources } from '@/lib/mcp/resources/reference';
import { registerSiteResources } from '@/lib/mcp/resources/site';

export function createMcpServer(): McpServer {
  const server = new McpServer(
    { name: 'ycode', version: '0.2.0' },
    { instructions: SYSTEM_INSTRUCTIONS },
  );

  registerPageTools(server);
  registerLayerTools(server);
  registerBatchTools(server);
  registerLayoutTools(server);
  registerCollectionTools(server);
  registerStyleTools(server);
  registerAssetTools(server);
  registerComponentTools(server);
  registerPublishingTools(server);

  registerReferenceResources(server);
  registerSiteResources(server);

  return server;
}
