/**
 * MCP Server Factory
 *
 * Creates a new McpServer instance with all tools and resources registered.
 * Each HTTP session gets its own server instance.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ZodRawShape } from 'zod';
import { DEFERRED_GROUP_GUIDES, MCP_PUBLISHING_INSTRUCTIONS, SYSTEM_INSTRUCTIONS } from '@/lib/mcp/instructions';
import { withToolAnnotations } from '@/lib/mcp/tool-annotations';
import packageJson from '@/package.json';
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
import { registerGlobalVariableTools } from '@/lib/mcp/tools/global-variables';
import { registerFontTools } from '@/lib/mcp/tools/fonts';
import { registerLocaleTools } from '@/lib/mcp/tools/locales';
import { registerFormTools } from '@/lib/mcp/tools/forms';
import { registerSettingsTools } from '@/lib/mcp/tools/settings';
import { registerPublishingTools } from '@/lib/mcp/tools/publishing';
import { registerAnimationTools } from '@/lib/mcp/tools/animations';
import { registerHtmlImportTools } from '@/lib/mcp/tools/html-import';
import { registerRichTextStyleTools } from '@/lib/mcp/tools/rich-text-styles';
import { registerCollectionPageTools } from '@/lib/mcp/tools/collection-pages';
import { registerReferenceResources } from '@/lib/mcp/resources/reference';
import { registerSiteResources } from '@/lib/mcp/resources/site';

export interface CreateMcpServerOptions {
  /**
   * Register additional tools after the built-in ones (e.g. a hosted
   * deployment adding site-selection tools). Tools registered here must have
   * an entry in `lib/mcp/tool-annotations.ts` or be registered via
   * `server.registerTool` with their own title/annotations.
   */
  extraTools?: (server: McpServer) => void;
  /** Appended to the server instructions sent to the client on initialize. */
  extraInstructions?: string;
  /**
   * Optional parameters added to every built-in tool (not `extraTools`) and
   * stripped before the handler runs, e.g. a per-call site selector that the
   * hosting layer reads from the raw request to pick the tenant.
   */
  sharedToolParams?: ZodRawShape;
}

export function createMcpServer(options: CreateMcpServerOptions = {}): McpServer {
  // External MCP agents get every tool up front, so they also get the full
  // deferred-group guides plus the publishing instructions. The in-app agent
  // runtime uses SYSTEM_INSTRUCTIONS alone, delivers group guides via
  // load_tools, and appends its own draft-first (never publish) policy instead.
  const instructions = SYSTEM_INSTRUCTIONS
    + '\n' + Object.values(DEFERRED_GROUP_GUIDES).join('\n\n')
    + MCP_PUBLISHING_INSTRUCTIONS
    + (options.extraInstructions ? '\n\n' + options.extraInstructions : '');

  const rawServer = new McpServer(
    { name: 'ycode', version: packageJson.version },
    { instructions },
  );

  // Tool files call the plain `server.tool(...)` API; the wrapper attaches the
  // per-tool title and read-only/destructive hints from tool-annotations.ts.
  const server = withToolAnnotations(rawServer, options.sharedToolParams);

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
  registerGlobalVariableTools(server);
  registerFontTools(server);
  registerLocaleTools(server);
  registerFormTools(server);
  registerSettingsTools(server);
  registerPublishingTools(server);
  registerAnimationTools(server);
  registerHtmlImportTools(server);
  registerRichTextStyleTools(server);
  registerCollectionPageTools(server);

  registerReferenceResources(server);
  registerSiteResources(server);

  options.extraTools?.(server);

  return rawServer;
}
