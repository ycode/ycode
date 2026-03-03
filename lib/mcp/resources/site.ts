import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { getAllPages } from '@/lib/repositories/pageRepository';
import { getAllPageFolders } from '@/lib/repositories/pageFolderRepository';
import { getAllCollections } from '@/lib/repositories/collectionRepository';
import { getFieldsByCollectionId } from '@/lib/repositories/collectionFieldRepository';

export function registerSiteResources(server: McpServer) {
  server.resource(
    'site-pages',
    'ycode://site/pages',
    {
      description: 'Current site structure — all pages with IDs, names, slugs, and folder hierarchy',
      mimeType: 'application/json',
    },
    async () => {
      const [pages, folders] = await Promise.all([
        getAllPages(),
        getAllPageFolders(),
      ]);

      return {
        contents: [{
          uri: 'ycode://site/pages',
          mimeType: 'application/json',
          text: JSON.stringify({
            pages: pages.map((p) => ({
              id: p.id,
              name: p.name,
              slug: p.slug,
              is_index: p.is_index,
              is_dynamic: p.is_dynamic,
              folder_id: p.page_folder_id,
            })),
            folders: folders.map((f) => ({
              id: f.id,
              name: f.name,
              parent_id: f.page_folder_id,
            })),
          }, null, 2),
        }],
      };
    },
  );

  server.resource(
    'site-collections',
    'ycode://site/collections',
    {
      description: 'Current CMS schema — all collections with their field definitions',
      mimeType: 'application/json',
    },
    async () => {
      const collections = await getAllCollections();

      const schema = await Promise.all(
        collections.map(async (c) => {
          const fields = await getFieldsByCollectionId(c.id);
          return {
            id: c.id,
            name: c.name,
            uuid: c.uuid,
            fields: fields.map((f) => ({
              id: f.id,
              name: f.name,
              key: f.key,
              type: f.type,
              reference_collection_id: f.reference_collection_id,
            })),
          };
        }),
      );

      return {
        contents: [{
          uri: 'ycode://site/collections',
          mimeType: 'application/json',
          text: JSON.stringify(schema, null, 2),
        }],
      };
    },
  );
}
