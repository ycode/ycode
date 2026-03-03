import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { getAllPages, getPageById, getPagesByFolder, createPage, updatePage, deletePage } from '@/lib/repositories/pageRepository';
import { getAllPageFolders } from '@/lib/repositories/pageFolderRepository';
import { upsertDraftLayers } from '@/lib/repositories/pageLayersRepository';
import { broadcastPageCreated, broadcastPageUpdated, broadcastPageDeleted, broadcastLayersChanged } from '@/lib/mcp/broadcast';

export function registerPageTools(server: McpServer) {
  server.tool(
    'list_pages',
    'List all pages in the website with their IDs, names, slugs, and folder structure',
    {},
    async () => {
      const pages = await getAllPages();
      const folders = await getAllPageFolders();
      return {
        content: [{ type: 'text' as const, text: JSON.stringify({ pages, folders }, null, 2) }],
      };
    },
  );

  server.tool(
    'get_page',
    'Get a single page by ID, including its settings and metadata',
    { page_id: z.string().describe('The page ID') },
    async ({ page_id }) => {
      const page = await getPageById(page_id);
      if (!page) {
        return { content: [{ type: 'text' as const, text: `Error: Page "${page_id}" not found.` }], isError: true };
      }
      return { content: [{ type: 'text' as const, text: JSON.stringify(page, null, 2) }] };
    },
  );

  server.tool(
    'create_page',
    'Create a new page. Returns the created page with its ID. The page is created as a draft — use the publish tool to make it live.',
    {
      name: z.string().describe('Page title (e.g. "About Us", "Contact")'),
      slug: z.string().optional().describe('URL slug. Auto-generated from name if omitted.'),
      page_folder_id: z.string().nullable().optional().describe('Parent folder ID, or null for root'),
      is_index: z.boolean().optional().describe('Set to true to make this the homepage'),
      is_dynamic: z.boolean().optional().describe('Set to true for CMS dynamic pages'),
    },
    async (args) => {
      const isIndex = args.is_index || false;
      const slug = isIndex ? '' : (args.slug || args.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''));
      const folderId = args.page_folder_id ?? null;

      const siblings = await getPagesByFolder(folderId);
      const maxOrder = siblings.reduce((max, p) => Math.max(max, p.order ?? 0), -1);

      const page = await createPage({
        name: args.name,
        slug,
        is_published: false,
        page_folder_id: folderId,
        order: maxOrder + 1,
        depth: 0,
        is_index: isIndex,
        is_dynamic: args.is_dynamic || false,
        error_page: null,
        settings: {},
      });

      const initialLayers = [{
        id: 'body',
        name: 'body',
        classes: '',
        children: [],
      }];
      await upsertDraftLayers(page.id, initialLayers);

      broadcastPageCreated(page).catch(() => {});
      broadcastLayersChanged(page.id, initialLayers).catch(() => {});

      return { content: [{ type: 'text' as const, text: JSON.stringify(page, null, 2) }] };
    },
  );

  server.tool(
    'update_page',
    "Update a page's settings (name, slug, SEO settings, etc.)",
    {
      page_id: z.string().describe('The page ID to update'),
      name: z.string().optional().describe('New page title'),
      slug: z.string().optional().describe('New URL slug'),
      settings: z.record(z.string(), z.unknown()).optional().describe('Page settings object'),
    },
    async ({ page_id, ...data }) => {
      const page = await updatePage(page_id, data);
      broadcastPageUpdated(page_id, data).catch(() => {});
      return { content: [{ type: 'text' as const, text: JSON.stringify(page, null, 2) }] };
    },
  );

  server.tool(
    'delete_page',
    'Permanently delete a page and all its layers',
    { page_id: z.string().describe('The page ID to delete') },
    async ({ page_id }) => {
      await deletePage(page_id);
      broadcastPageDeleted(page_id).catch(() => {});
      return { content: [{ type: 'text' as const, text: `Page ${page_id} deleted successfully.` }] };
    },
  );
}
