import { Knex } from 'knex';

/**
 * Migration: Add folder column to components table
 *
 * Groups components into single-level folders in the builder. A NULL folder
 * means the component sits in the default "Components" group. Folders are
 * builder-only organisation: they are not part of the content hash and are
 * not copied on publish.
 *
 * Idempotent: safe to run multiple times and on freshly-applied template data.
 */
export async function up(knex: Knex): Promise<void> {
  await knex.raw(`
    ALTER TABLE components
    ADD COLUMN IF NOT EXISTS folder text;
  `);
}

export async function down(knex: Knex): Promise<void> {
  const hasColumn = await knex.schema.hasColumn('components', 'folder');
  if (hasColumn) {
    await knex.schema.alterTable('components', (table) => {
      table.dropColumn('folder');
    });
  }
}
