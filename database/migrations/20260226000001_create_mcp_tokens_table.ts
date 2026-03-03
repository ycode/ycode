import type { Knex } from 'knex';

/**
 * Migration: Create MCP Tokens Table
 *
 * Stores per-project MCP tokens for the embedded MCP server.
 * Each token generates a unique URL that users paste into Claude/Cursor.
 */

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('mcp_tokens', (table) => {
    table.uuid('id').defaultTo(knex.raw('gen_random_uuid()')).primary();
    table.string('name', 255).notNullable();
    table.string('token', 128).notNullable().unique();
    table.string('token_prefix', 12).notNullable();
    table.boolean('is_active').notNullable().defaultTo(true);
    table.timestamp('last_used_at', { useTz: true }).nullable();
    table.timestamp('created_at', { useTz: true }).defaultTo(knex.fn.now());
    table.timestamp('updated_at', { useTz: true }).defaultTo(knex.fn.now());
  });

  await knex.schema.raw(
    'CREATE INDEX idx_mcp_tokens_token ON mcp_tokens(token) WHERE is_active = true',
  );

  await knex.schema.raw('ALTER TABLE mcp_tokens ENABLE ROW LEVEL SECURITY');

  await knex.schema.raw(`
    CREATE POLICY "MCP tokens are viewable by authenticated users"
      ON mcp_tokens FOR SELECT
      USING ((SELECT auth.uid()) IS NOT NULL)
  `);

  await knex.schema.raw(`
    CREATE POLICY "Authenticated users can create MCP tokens"
      ON mcp_tokens FOR INSERT
      WITH CHECK ((SELECT auth.uid()) IS NOT NULL)
  `);

  await knex.schema.raw(`
    CREATE POLICY "Authenticated users can update MCP tokens"
      ON mcp_tokens FOR UPDATE
      USING ((SELECT auth.uid()) IS NOT NULL)
  `);

  await knex.schema.raw(`
    CREATE POLICY "Authenticated users can delete MCP tokens"
      ON mcp_tokens FOR DELETE
      USING ((SELECT auth.uid()) IS NOT NULL)
  `);
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('mcp_tokens');
}
