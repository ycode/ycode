import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { getAllCollections, createCollection } from '@/lib/repositories/collectionRepository';
import { getFieldsByCollectionId, createField } from '@/lib/repositories/collectionFieldRepository';
import { getItemsByCollectionId, getItemsWithValues, createItem, deleteItem } from '@/lib/repositories/collectionItemRepository';
import { setValuesByFieldName } from '@/lib/repositories/collectionItemValueRepository';

export function registerCollectionTools(server: McpServer) {
  server.tool(
    'list_collections',
    "List all CMS collections with their IDs, names, and slugs. Collections are YCode's CMS — each collection is like a database table.",
    {},
    async () => {
      const collections = await getAllCollections();
      return { content: [{ type: 'text' as const, text: JSON.stringify(collections, null, 2) }] };
    },
  );

  server.tool(
    'create_collection',
    'Create a new CMS collection. After creating, use add_collection_field to define its schema.',
    { name: z.string().describe('Collection name (e.g. "Blog Posts", "Team Members")') },
    async ({ name }) => {
      const collection = await createCollection({ name });
      return { content: [{ type: 'text' as const, text: JSON.stringify(collection, null, 2) }] };
    },
  );

  server.tool(
    'add_collection_field',
    `Add a field to a collection's schema.

FIELD TYPES:
- text, number, boolean, date, reference, rich-text, color, asset, status`,
    {
      collection_id: z.string().describe('The collection ID'),
      name: z.string().describe('Field display name'),
      type: z.enum(['text', 'number', 'boolean', 'date', 'reference', 'multi_reference', 'rich_text', 'image', 'audio', 'video', 'document', 'link', 'email', 'phone', 'color', 'status']).describe('Field data type'),
      key: z.string().optional().describe('Unique field key (auto-generated from name if omitted)'),
      reference_collection_id: z.string().optional().describe('For reference fields: the target collection ID'),
    },
    async ({ collection_id, ...fieldData }) => {
      const existingFields = await getFieldsByCollectionId(collection_id);
      const order = existingFields.length;
      const field = await createField({ collection_id, order, ...fieldData });
      return { content: [{ type: 'text' as const, text: JSON.stringify(field, null, 2) }] };
    },
  );

  server.tool(
    'list_collection_items',
    'List items in a collection with their field values.',
    {
      collection_id: z.string().describe('The collection ID'),
      search: z.string().optional().describe('Search term to filter items'),
    },
    async ({ collection_id, search }) => {
      const fields = await getFieldsByCollectionId(collection_id);
      const { items, total } = await getItemsByCollectionId(collection_id, false, search ? { search } : undefined);
      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({
            fields: fields.map((f) => ({ id: f.id, name: f.name, type: f.type, key: f.key })),
            items,
            total,
          }, null, 2),
        }],
      };
    },
  );

  server.tool(
    'create_collection_item',
    'Create a new item in a collection. Optionally provide field values as { fieldId: value } pairs.',
    {
      collection_id: z.string().describe('The collection ID'),
      values: z.record(z.string(), z.unknown()).optional()
        .describe('Field values as { fieldId: value } pairs'),
    },
    async ({ collection_id, values }) => {
      const item = await createItem({ collection_id });

      if (values && Object.keys(values).length > 0) {
        const fields = await getFieldsByCollectionId(collection_id);
        const fieldType: Record<string, string> = {};
        for (const f of fields) {
          fieldType[f.id] = f.type;
        }
        await setValuesByFieldName(item.id, collection_id, values, fieldType as any);
      }

      const { items: itemWithValues } = await getItemsWithValues(collection_id);
      const created = itemWithValues.find((i) => i.id === item.id);

      return { content: [{ type: 'text' as const, text: JSON.stringify(created || item, null, 2) }] };
    },
  );

  server.tool(
    'update_collection_item',
    'Update field values for an existing collection item',
    {
      collection_id: z.string().describe('The collection ID'),
      item_id: z.string().describe('The item ID to update'),
      values: z.record(z.string(), z.unknown()).describe('Field values to update as { fieldId: value } pairs'),
    },
    async ({ collection_id, item_id, values }) => {
      const fields = await getFieldsByCollectionId(collection_id);
      const fieldType: Record<string, string> = {};
      for (const f of fields) {
        fieldType[f.id] = f.type;
      }
      await setValuesByFieldName(item_id, collection_id, values, fieldType as any);
      return { content: [{ type: 'text' as const, text: `Updated item ${item_id}` }] };
    },
  );

  server.tool(
    'delete_collection_item',
    'Delete an item from a collection',
    {
      collection_id: z.string().describe('The collection ID'),
      item_id: z.string().describe('The item ID to delete'),
    },
    async ({ item_id }) => {
      await deleteItem(item_id);
      return { content: [{ type: 'text' as const, text: `Deleted item ${item_id}` }] };
    },
  );
}
